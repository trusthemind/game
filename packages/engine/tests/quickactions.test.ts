import { describe, expect, it } from 'vitest';
import {
  addItem,
  allItems,
  createEquipment,
  createGrid,
  createItem,
  equipItem,
  equipTarget,
  getDef,
  ownMoveOrder,
  plateOf,
  quickMove,
  quickMoveOwn,
  unequipItem,
  type Equipment,
  type GridContainer,
  type ItemInstance,
} from '../src/index';

const uids = (eq: Equipment, ...grids: GridContainer[]) => {
  const out = allItems(eq).map((i) => i.uid);
  const walk = (g: GridContainer) => g.items.forEach((p) => (out.push(p.item.uid), p.item.grid && walk(p.item.grid)));
  grids.forEach(walk);
  return out.sort();
};

describe('equip / swap from loot', () => {
  it('equips into a free slot', () => {
    const eq = createEquipment();
    const loot = createGrid(6, 6);
    const helmet = createItem('ssh36');
    addItem(loot, helmet);
    const r = equipItem({ kind: 'grid', grid: loot, uid: helmet.uid }, eq);
    expect(r).toMatchObject({ ok: true, slot: 'helmet', displaced: null });
    expect(eq.slots.helmet).toBe(helmet);
    expect(loot.items).toHaveLength(0);
  });

  it('swaps: the old item goes into the carry grids', () => {
    const eq = createEquipment();
    eq.slots.backpack = createItem('b_daypack');
    const old = createItem('ssh36');
    eq.slots.helmet = old;
    const loot = createGrid(6, 6);
    const helmet = createItem('h_fast');
    addItem(loot, helmet);
    const r = equipItem({ kind: 'grid', grid: loot, uid: helmet.uid }, eq);
    expect(r).toMatchObject({ ok: true, slot: 'helmet', displaced: old, dropped: false });
    expect(eq.slots.helmet).toBe(helmet);
    expect(eq.slots.backpack!.grid!.items.map((p) => p.item)).toContain(old);
  });

  it('swaps: with no carry room the old item takes the freed loot spot', () => {
    const eq = createEquipment();
    const old = createItem('paca');
    eq.slots.armor = old;
    const loot = createGrid(3, 3);
    const armor = createItem('6b23');
    addItem(loot, armor);
    const r = equipItem({ kind: 'grid', grid: loot, uid: armor.uid }, eq);
    expect(r.ok).toBe(true);
    expect(eq.slots.armor).toBe(armor);
    expect(loot.items[0]).toMatchObject({ item: old, x: 0, y: 0 });
  });

  it('swaps a rig with contents: it never goes into a carry grid, drops when the loot is full', () => {
    const eq = createEquipment();
    eq.slots.backpack = createItem('b_attack');
    const oldRig = createItem('r_mbss');
    addItem(oldRig.grid!, createItem('a_545ps', { stack: 30 }));
    eq.slots.rig = oldRig;
    const loot = createGrid(3, 3);
    const rig = createItem('r_alpha');
    addItem(loot, rig);
    addItem(loot.items[0]!.item.grid!, createItem('bandage'));
    // Full rig in the loot: can't sit in a non-stash grid, so the only way out is the drop.
    const dropped: ItemInstance[] = [];
    const before = uids(eq, loot);
    const r = equipItem({ kind: 'grid', grid: loot, uid: rig.uid }, eq, { drop: (i) => dropped.push(i) });
    expect(r).toMatchObject({ ok: true, slot: 'rig', dropped: true });
    expect(dropped).toEqual([oldRig]);
    expect(eq.slots.rig).toBe(rig);
    expect(eq.slots.backpack!.grid!.items).toHaveLength(0);
    // Nothing lost: everything is either still on us, in the loot or on the ground.
    expect([...uids(eq, loot), ...dropped.flatMap((d) => [d.uid, ...d.grid!.items.map((p) => p.item.uid)])].sort()).toEqual(before);
  });

  it('rolls back when the old item fits nowhere and cannot be dropped', () => {
    const eq = createEquipment();
    const oldRig = createItem('r_mbss');
    addItem(oldRig.grid!, createItem('bandage'));
    eq.slots.rig = oldRig;
    const loot = createGrid(3, 3);
    const rig = createItem('r_alpha');
    addItem(loot, rig);
    const before = uids(eq, loot);
    const r = equipItem({ kind: 'grid', grid: loot, uid: rig.uid }, eq);
    expect(r.ok).toBe(false);
    expect(eq.slots.rig).toBe(oldRig);
    expect(loot.items[0]!.item).toBe(rig);
    expect(uids(eq, loot)).toEqual(before);
  });

  it('weapons fill a free slot first, then swap the primary', () => {
    const eq = createEquipment();
    const loot = createGrid(8, 8);
    const a = createItem('mp133');
    const b = createItem('mp133');
    const c = createItem('mp133');
    [a, b, c].forEach((i) => addItem(loot, i));
    eq.slots.backpack = createItem('b_attack');
    expect(equipItem({ kind: 'grid', grid: loot, uid: a.uid }, eq).ok).toBe(true);
    expect(equipItem({ kind: 'grid', grid: loot, uid: b.uid }, eq).ok).toBe(true);
    expect(eq.slots.primary).toBe(a);
    expect(eq.slots.secondary).toBe(b);
    expect(equipTarget(eq, c)).toBe('primary');
    expect(equipItem({ kind: 'grid', grid: loot, uid: c.uid }, eq)).toMatchObject({ ok: true, displaced: a });
    expect(eq.slots.primary).toBe(c);
  });

  it('equips from a corpse slot', () => {
    const eq = createEquipment();
    const corpse = createEquipment();
    const h = createItem('ssh36');
    corpse.slots.helmet = h;
    expect(equipItem({ kind: 'slot', eq: corpse, slot: 'helmet' }, eq).ok).toBe(true);
    expect(eq.slots.helmet).toBe(h);
    expect(corpse.slots.helmet).toBeNull();
  });

  it('a swap from a corpse slot puts the old item back in that slot when no room', () => {
    const eq = createEquipment();
    const corpse = createEquipment();
    const mine = createItem('ssh36');
    const theirs = createItem('h_fast');
    eq.slots.helmet = mine;
    corpse.slots.helmet = theirs;
    expect(equipItem({ kind: 'slot', eq: corpse, slot: 'helmet' }, eq).ok).toBe(true);
    expect(eq.slots.helmet).toBe(theirs);
    expect(corpse.slots.helmet).toBe(mine);
  });

  it('non-equippables report null', () => {
    expect(equipTarget(createEquipment(), createItem('bandage'))).toBeNull();
  });
});

describe('plate swap', () => {
  it('inserts a plate into the worn carrier and returns the old one to the carry grids', () => {
    const eq = createEquipment();
    eq.slots.armor = createItem('trooper');
    eq.slots.backpack = createItem('b_daypack');
    const oldPlate = plateOf(eq.slots.armor)!;
    const loot = createGrid(4, 4);
    const plate = createItem('pl_ceramic6');
    addItem(loot, plate);
    expect(equipTarget(eq, plate)).toBe('plate');
    const r = equipItem({ kind: 'grid', grid: loot, uid: plate.uid }, eq);
    expect(r).toMatchObject({ ok: true, slot: 'plate', displaced: oldPlate });
    expect(plateOf(eq.slots.armor)).toBe(plate);
    expect(eq.slots.backpack!.grid!.items[0]!.item).toBe(oldPlate);
    expect(loot.items).toHaveLength(0);
  });

  it('old plate takes the freed loot spot when carry grids are full; no carrier = not equippable', () => {
    const eq = createEquipment();
    const loot = createGrid(2, 2);
    const plate = createItem('pl_steel3');
    addItem(loot, plate);
    expect(equipItem({ kind: 'grid', grid: loot, uid: plate.uid }, eq).ok).toBe(false);
    eq.slots.armor = createItem('trooper');
    const oldPlate = plateOf(eq.slots.armor)!;
    expect(equipItem({ kind: 'grid', grid: loot, uid: plate.uid }, eq).ok).toBe(true);
    expect(loot.items[0]!.item).toBe(oldPlate);
    expect(plateOf(eq.slots.armor)).toBe(plate);
  });
});

describe('one-click moves between own containers', () => {
  const kit = () => {
    const eq = createEquipment();
    eq.slots.rig = createItem('r_mbss');
    eq.slots.backpack = createItem('b_daypack');
    eq.slots.secure = createItem('sc_alpha');
    return eq;
  };

  it('defines a priority order', () => {
    const ammo = getDef('a_545ps');
    const gun = getDef('mp133');
    expect(ownMoveOrder('rig', ammo)).toEqual(['backpack', 'pockets']);
    expect(ownMoveOrder('backpack', ammo)[0]).toBe('rig');
    expect(ownMoveOrder('backpack', gun)[0]).toBe('pockets');
    expect(ownMoveOrder('pockets', ammo)).toEqual(['rig', 'backpack', 'secure']);
    expect(ownMoveOrder('secure', ammo)[0]).toBe('pockets');
  });

  it('rig → backpack, backpack ammo → rig', () => {
    const eq = kit();
    const ammo = createItem('a_545ps', { stack: 20 });
    addItem(eq.slots.rig!.grid!, ammo);
    expect(quickMoveOwn(eq, 'rig', ammo.uid)).toBe(true);
    expect(eq.slots.backpack!.grid!.items[0]!.item).toBe(ammo);
    expect(quickMoveOwn(eq, 'backpack', ammo.uid)).toBe(true);
    expect(eq.slots.rig!.grid!.items[0]!.item).toBe(ammo);
  });

  it('merges into existing stacks across targets first, never losing rounds', () => {
    const eq = kit();
    const a = createItem('a_545ps', { stack: 50 });
    const b = createItem('a_545ps', { stack: 55 });
    addItem(eq.slots.rig!.grid!, a);
    addItem(eq.slots.backpack!.grid!, b);
    const moving = createItem('a_545ps', { stack: 30 });
    addItem(eq.pockets, moving);
    expect(quickMoveOwn(eq, 'pockets', moving.uid)).toBe(true);
    // 10 to the rig stack, 5 to the backpack stack, the remaining 15 placed in the rig (first with room).
    expect(a.stack).toBe(60);
    expect(b.stack).toBe(60);
    expect(eq.pockets.items).toHaveLength(0);
    const total = allItems(eq).filter((i) => i.def === 'a_545ps').reduce((n, i) => n + i.stack, 0);
    expect(total).toBe(135);
  });

  it('a partial merge keeps the remainder where it was', () => {
    const eq = createEquipment();
    eq.slots.rig = createItem('r_scav');
    const rg = eq.slots.rig.grid!;
    for (let i = 0; i < 4; i++) addItem(rg, createItem('bandage'));
    rg.items[3]!.item = createItem('a_545ps', { stack: 50 });
    const moving = createItem('a_545ps', { stack: 30 });
    addItem(eq.pockets, moving);
    expect(quickMove({ kind: 'grid', grid: eq.pockets, uid: moving.uid }, [rg])).toBe(true);
    expect(rg.items[3]!.item.stack).toBe(60);
    expect(moving.stack).toBe(20);
    expect(eq.pockets.items[0]!.item).toBe(moving);
  });

  it('a container with contents never goes into a carry grid', () => {
    const eq = kit();
    const bag = createItem('b_sling');
    addItem(bag.grid!, createItem('bandage'));
    const stash = createGrid(10, 10, true);
    addItem(stash, bag);
    expect(quickMove({ kind: 'grid', grid: stash, uid: bag.uid }, [eq.slots.backpack!.grid!])).toBe(false);
    expect(stash.items[0]!.item).toBe(bag);
  });
});

describe('own gear: equip from carried grids and unequip back (double-click toggle)', () => {
  const kit = () => {
    const eq = createEquipment();
    eq.slots.backpack = createItem('b_attack');
    eq.slots.rig = createItem('r_mbss');
    return eq;
  };
  const bag = (eq: Equipment) => eq.slots.backpack!.grid!;

  it('pistol → secondary, rifle → primary, melee → melee from own grids', () => {
    const eq = kit();
    const pm = createItem('pm');
    const shotgun = createItem('mp133');
    const bar = createItem('crowbar');
    [pm, shotgun, bar].forEach((i) => addItem(bag(eq), i));
    expect(equipItem({ kind: 'grid', grid: bag(eq), uid: pm.uid }, eq)).toMatchObject({ ok: true, slot: 'secondary' });
    expect(equipItem({ kind: 'grid', grid: bag(eq), uid: shotgun.uid }, eq)).toMatchObject({ ok: true, slot: 'primary' });
    expect(equipItem({ kind: 'grid', grid: bag(eq), uid: bar.uid }, eq)).toMatchObject({ ok: true, slot: 'melee' });
    expect(eq.slots.secondary).toBe(pm);
    expect(eq.slots.primary).toBe(shotgun);
    expect(eq.slots.melee).toBe(bar);
    expect(bag(eq).items).toHaveLength(0);
  });

  it('swaps with the worn one when the slot is taken; the old one lands in own grids', () => {
    const eq = kit();
    const worn = createItem('knife');
    eq.slots.melee = worn;
    const bar = createItem('crowbar');
    addItem(bag(eq), bar);
    const before = uids(eq);
    expect(equipItem({ kind: 'grid', grid: bag(eq), uid: bar.uid }, eq)).toMatchObject({ ok: true, slot: 'melee', displaced: worn });
    expect(eq.slots.melee).toBe(bar);
    expect(allItems(eq)).toContain(worn);
    expect(uids(eq)).toEqual(before);
  });

  it('unequips a worn weapon into the first own grid with room, then re-equips it', () => {
    const eq = kit();
    const gun = createItem('mp133');
    eq.slots.primary = gun;
    expect(unequipItem(eq, 'primary')).toBe(true);
    expect(eq.slots.primary).toBeNull();
    const where = [eq.pockets, eq.slots.rig!.grid!, bag(eq)].find((g) => g.items.some((p) => p.item === gun))!;
    expect(where).toBe(eq.pockets); // pockets come first and a 4×1 fits them
    expect(equipItem({ kind: 'grid', grid: where, uid: gun.uid }, eq)).toMatchObject({ ok: true, slot: 'primary' });
    expect(eq.slots.primary).toBe(gun);
  });

  it('unequip fails (keeps the item worn) when nothing has room; a full backpack only goes to the stash', () => {
    const eq = createEquipment();
    const pack = createItem('b_sling');
    addItem(pack.grid!, createItem('bandage'));
    eq.slots.backpack = pack;
    expect(unequipItem(eq, 'backpack')).toBe(false);
    expect(eq.slots.backpack).toBe(pack);
    const stash = createGrid(10, 10, true);
    expect(unequipItem(eq, 'backpack', [stash])).toBe(true);
    expect(stash.items[0]!.item).toBe(pack);
    expect(pack.grid!.items).toHaveLength(1);
  });
});
