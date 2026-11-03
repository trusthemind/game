import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  addItem,
  canPlace,
  countAmmo,
  createEquipment,
  createGrid,
  createItem,
  findSpot,
  footprint,
  generateLoadout,
  generateLoot,
  moveItem,
  quickMove,
  removeItem,
  Rng,
  slotAccepts,
  starterKit,
  takeAmmo,
  CONTAINERS,
  createProfile,
  itemValue,
  repair,
  repairCost,
  sellPrice,
  sortGrid,
  type ContainerKind,
} from '../src/index';

describe('grid inventory', () => {
  it('places items without overlap and respects bounds', () => {
    const g = createGrid(4, 4);
    const rifle = createItem('ak74m');
    const { w, h } = footprint(rifle);
    expect(addItem(g, rifle)).toBe(true);
    const other = createItem('ak74m');
    expect(canPlace(g, other, 0, 0, false)).toBe(false);
    expect(canPlace(g, other, 4 - w + 1, 0, false)).toBe(false);
    expect(h).toBeGreaterThan(0);
  });

  it('rotates to fit when needed', () => {
    const g = createGrid(2, 6);
    const rifle = createItem('ak74m');
    const spot = findSpot(g, rifle);
    expect(spot?.rot).toBe(true);
  });

  it('removes and re-adds items', () => {
    const g = createGrid(3, 3);
    const b = createItem('bandage');
    addItem(g, b);
    expect(removeItem(g, b.uid)?.item.uid).toBe(b.uid);
    expect(g.items.length).toBe(0);
  });

  it('stacks ammo when adding', () => {
    const g = createGrid(2, 2);
    addItem(g, createItem('a_545ps', { stack: 20 }));
    addItem(g, createItem('a_545ps', { stack: 20 }));
    const total = g.items.reduce((s, p) => s + (p.item.stack ?? 1), 0);
    expect(total).toBe(40);
  });
});

describe('equipment', () => {
  it('only accepts matching items per slot', () => {
    expect(slotAccepts('primary', ITEMS.ak74m!)).toBe(true);
    expect(slotAccepts('helmet', ITEMS.ak74m!)).toBe(false);
    expect(slotAccepts('melee', ITEMS.knife!)).toBe(true);
    expect(slotAccepts('armor', ITEMS['6b23']!)).toBe(true);
  });

  it('moves an item from a grid into a slot and back', () => {
    const eq = createEquipment();
    const g = createGrid(6, 6);
    const gun = createItem('ak74m');
    addItem(g, gun);
    expect(moveItem({ kind: 'grid', grid: g, uid: gun.uid }, { kind: 'slot', eq, slot: 'primary' })).toBe(true);
    expect(eq.slots.primary?.uid).toBe(gun.uid);
    expect(quickMove({ kind: 'slot', eq, slot: 'primary' }, [g])).toBe(true);
    expect(eq.slots.primary).toBeNull();
  });

  it('draws ammo from carried stacks', () => {
    const eq = starterKit();
    const cal = ITEMS[eq.slots.secondary!.def]!.weapon!.caliber;
    const before = countAmmo(eq, cal);
    expect(before).toBeGreaterThan(0);
    const { taken } = takeAmmo(eq, cal, 5);
    expect(taken).toBe(5);
    expect(countAmmo(eq, cal)).toBe(before - 5);
  });
});

describe('loot and loadouts', () => {
  it('generates loot for every container kind deterministically', () => {
    for (const kind of Object.keys(CONTAINERS) as ContainerKind[]) {
      const a = generateLoot(kind, new Rng(9), 1);
      const b = generateLoot(kind, new Rng(9), 1);
      expect(a.items.map((p) => p.item.def)).toEqual(b.items.map((p) => p.item.def));
    }
  });

  it('gives raiders better gear than scavs on average', () => {
    const rng = new Rng(3);
    let scav = 0;
    let raider = 0;
    for (let i = 0; i < 40; i++) {
      scav += generateLoadout('scav', rng).slots.armor ? 1 : 0;
      raider += generateLoadout('raider', rng).slots.armor ? 1 : 0;
    }
    expect(raider).toBeGreaterThan(scav);
  });

  it('arms every bot', () => {
    const rng = new Rng(11);
    for (const a of ['scav', 'raider', 'guard', 'boss'] as const) {
      const eq = generateLoadout(a, rng, 1);
      expect(eq.slots.primary || eq.slots.secondary || eq.slots.melee).toBeTruthy();
    }
  });
});

describe('stash sort', () => {
  it('groups by kind, biggest first, tops up part-stacks and keeps everything', () => {
    const g = createGrid(8, 6);
    const items = [createItem('a_9x19', { stack: 20 }), createItem('bandage'), createItem('ak74m'), createItem('a_9x19', { stack: 30 }), createItem('paca'), createItem('pm')];
    for (const it of items) expect(addItem(g, it)).toBe(true);
    // addItem tops stacks up by itself; split one by hand to see the sort do it.
    g.items.push({ item: createItem('a_9x19', { stack: 5 }), x: 7, y: 5 });
    const total = g.items.filter((p) => p.item.def === 'a_9x19').reduce((n, p) => n + p.item.stack, 0);
    expect(sortGrid(g)).toBe(true);
    const order = [...g.items].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.item.def);
    expect(order.indexOf('ak74m')).toBeLessThan(order.indexOf('a_9x19'));
    expect(order.indexOf('a_9x19')).toBeLessThan(order.indexOf('paca'));
    expect(order.indexOf('paca')).toBeLessThan(order.indexOf('bandage'));
    const ammo = g.items.filter((p) => p.item.def === 'a_9x19');
    expect(ammo.reduce((n, p) => n + p.item.stack, 0)).toBe(total);
    expect(ammo.filter((p) => p.item.stack < ITEMS.a_9x19!.stackMax!).length).toBeLessThanOrEqual(1);
    // Nothing overlaps and everything is inside.
    for (const p of g.items) expect(canPlace(g, p.item, p.x, p.y, !!p.item.rot)).toBe(true);
    expect(sortGrid(g)).toBe(false);
  });

  it('leaves a grid it cannot lay out again as it was, stacks too', () => {
    // More than fits (a grid shrunk under its items): no order works, so nothing may change.
    const g = createGrid(1, 1);
    g.items = [
      { item: createItem('a_9x19', { stack: 10 }), x: 0, y: 0 },
      { item: createItem('a_9x19', { stack: 15 }), x: 0, y: 0 },
      { item: createItem('bandage'), x: 0, y: 0 },
    ];
    const before = JSON.stringify(g.items);
    expect(sortGrid(g)).toBe(false);
    expect(JSON.stringify(g.items)).toBe(before);
  });
});

describe('armour repair', () => {
  it('charges half the value for the share worn away and restores it', () => {
    const p = createProfile();
    const vest = createItem('trooper');
    vest.dur = ITEMS.trooper!.armor!.durability / 2;
    expect(repairCost(vest)).toBe(Math.round(ITEMS.trooper!.value * 0.25));
    p.money = 1000;
    expect(repair(p, vest)).toEqual({ ok: false, reason: 'Not enough credits' });
    p.money = 100000;
    expect(repair(p, vest).ok).toBe(true);
    expect(vest.dur).toBe(ITEMS.trooper!.armor!.durability);
    expect(p.money).toBe(100000 - Math.round(ITEMS.trooper!.value * 0.25));
    expect(repairCost(vest)).toBe(0);
    expect(repairCost(createItem('ak74m'))).toBe(0);
  });

  it('never costs more than the armour sells for as it is', () => {
    const p = createProfile();
    for (const d of Object.values(ITEMS)) {
      if (!d.armor) continue;
      for (const f of [0, 0.05, 0.3, 0.6, 0.95]) {
        const worn = createItem(d.id, { dur: d.armor.durability * f });
        expect(repairCost(worn)).toBeLessThanOrEqual(Math.max(100, sellPrice(worn, p)));
        expect(repairCost(worn)).toBeLessThanOrEqual(Math.round(d.value * 0.5 * (1 - f)) + 1);
      }
    }
  });
});
