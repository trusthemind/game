import { describe, expect, it } from 'vitest';
import {
  ALL_ITEMS,
  BOSSES,
  encounterLoadout,
  OUTFITS,
  CLOTHING_SLOTS,
  createItem,
  createProfile,
  generateLoadout,
  getDef,
  migrateProfile,
  PROFILE_VERSION,
  Rng,
  slotAccepts,
  starterKit,
} from '../src';

describe('clothing', () => {
  it('each piece goes in its own slot and nowhere else', () => {
    const clothes = ALL_ITEMS.filter((d) => d.category === 'clothing');
    expect(clothes.length).toBeGreaterThan(25);
    for (const d of clothes) {
      expect(d.clothing).toBeDefined();
      for (const s of CLOTHING_SLOTS) expect(slotAccepts(s, d)).toBe(d.clothing!.slot === s);
      expect(slotAccepts('armor', d)).toBe(false);
    }
    expect(slotAccepts('top', getDef('paca'))).toBe(false);
  });

  it('a fresh survivor is dressed', () => {
    const eq = createProfile().equipment;
    expect(eq.slots.top).toBeTruthy();
    expect(eq.slots.pants).toBeTruthy();
    expect(eq.slots.boots).toBeTruthy();
    expect(starterKit().slots.top).toBeTruthy();
  });

  it('scavs are dressed head to toe (bar a hat), soldiers in uniform', () => {
    const tops = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const eq = generateLoadout('scav', new Rng(seed));
      for (const s of ['top', 'pants', 'boots'] as const) expect(getDef(eq.slots[s]!.def).clothing?.slot).toBe(s);
      for (const arch of ['raider', 'guard', 'boss'] as const) {
        const r = generateLoadout(arch, new Rng(seed));
        const top = getDef(r.slots.top!.def).clothing!;
        expect(top.slot).toBe('top');
        expect(getDef(r.slots.boots!.def).clothing?.slot).toBe('boots');
        // A coverall is the trousers too.
        if (top.full) expect(r.slots.pants ?? null).toBeNull();
        else expect(getDef(r.slots.pants!.def).clothing?.slot).toBe('pants');
        if (arch === 'raider') tops.add(r.slots.top!.def);
      }
    }
    expect(tops.size).toBeGreaterThanOrEqual(4);
  });

  it('bosses and named NPCs wear their own outfits', () => {
    for (const b of BOSSES) expect(b.loadout(new Rng(1)).slots.top?.def).toBe(OUTFITS[b.id]!.find((id) => getDef(id).clothing!.slot === 'top'));
    for (const id of Object.keys(OUTFITS)) for (const c of OUTFITS[id]!) expect(getDef(c).category).toBe('clothing');
    expect(encounterLoadout('taras').slots.top?.def).toBe('c_desert_top');
  });

  it('the adventurer and plainclothes sets: tagged, in loot and on people', async () => {
    const { CONTAINERS } = await import('../src/items/loot');
    const adventurer = ['c_crop_top', 'c_sports_top', 'c_tank_gloves', 'c_denim_shorts', 'c_khaki_trousers', 'c_hiking_boots'];
    const plain = ['c_baseball_cap', 'c_leather_jacket', 'c_brown_shirt', 'c_white_shirt', 'c_dark_jeans', 'c_trail_shoes', 'c_white_sneakers'];
    for (const id of adventurer) expect(getDef(id).clothing?.sex).toBe('f');
    for (const id of plain) expect(getDef(id).clothing?.sex).toBe('m');
    const wardrobe = new Set(CONTAINERS.wardrobe.table.map(([id]) => id));
    for (const id of [...adventurer, ...plain, 'c_lace_boots']) expect(wardrobe.has(id)).toBe(true);
    expect(OUTFITS.vera).toContain('c_tank_gloves');
    expect(OUTFITS.mykola).toContain('c_leather_jacket');
    const tops = new Set<string>();
    for (let seed = 1; seed < 200; seed++) tops.add(generateLoadout('scav', new Rng(seed)).slots.top!.def);
    expect(plain.some((id) => tops.has(id))).toBe(true);
  });

  it('an old save gets the new slots and clothes on', () => {
    const p = createProfile() as unknown as { version: number; equipment: { slots: Record<string, unknown> }; companionEq: Record<string, unknown> };
    for (const s of CLOTHING_SLOTS) delete p.equipment.slots[s];
    p.companionEq = { lena: { slots: { primary: createItem('pm') }, pockets: { w: 1, h: 1, items: [] } } };
    p.version = 8;
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(m.version).toBe(PROFILE_VERSION);
    expect(m.equipment.slots.top?.def).toBe('c_knit');
    expect(m.equipment.slots.hat).toBeNull();
    expect(m.companionEq.lena!.slots.boots).toBeNull();
  });
});

describe('armour zones and materials', () => {
  it('each piece covers what it says: a plate carrier leaves the stomach open, heavy armour covers the arms', async () => {
    const { armorFor } = await import('../src/sim/combat');
    const slots = (armor: string, helmet = 'ssh68') => ({ armor: createItem(armor), helmet: createItem(helmet) });
    expect(armorFor('thorax', slots('trooper'))?.def).toBe('pl_ceramic4');
    expect(armorFor('stomach', slots('trooper'))).toBeNull();
    expect(armorFor('stomach', slots('paca'))?.def).toBe('paca');
    expect(armorFor('leftArm', slots('gzhel'))?.def).toBe('gzhel');
    expect(armorFor('leftArm', slots('paca'))).toBeNull();
    expect(armorFor('head', slots('paca'))?.def).toBe('ssh68');
    expect(armorFor('leftLeg', slots('gzhel'))).toBeNull();
  });

  it('ceramic wears faster than aramid under the same absorbed damage', async () => {
    const { armorWear } = await import('../src/sim/combat');
    expect(armorWear(10, createItem('pl_ceramic4'))).toBeGreaterThan(armorWear(10, createItem('paca')) * 2.5);
    expect(armorWear(10, createItem('6b23'))).toBeGreaterThan(armorWear(10, createItem('pc_tan')));
  });
});

describe('plate carriers', () => {
  it('a carrier comes with its plate; the plate takes chest hits until it breaks', async () => {
    const { armorFor } = await import('../src/sim/combat');
    const { plateOf, insertPlate, removePlate, itemWeight } = await import('../src');
    const pc = createItem('pc_tan');
    const plate = plateOf(pc)!;
    expect(plate.def).toBe('pl_poly5');
    expect(itemWeight(pc)).toBeCloseTo(getDef('pc_tan').weight, 5);
    const slots = { armor: pc, helmet: null };
    expect(armorFor('thorax', slots)).toBe(plate);
    expect(armorFor('stomach', slots)).toBe(pc);
    plate.dur = 0;
    expect(armorFor('thorax', slots)).toBe(pc);
    const fresh = createItem('pl_steel3');
    expect(insertPlate(pc, fresh)).toBe(plate);
    expect(armorFor('thorax', slots)).toBe(fresh);
    expect(removePlate(pc)).toBe(fresh);
    expect(armorFor('thorax', slots)).toBe(pc);
    expect(insertPlate(createItem('paca'), fresh)).toBe(false);
    expect(slotAccepts('armor', getDef('pl_steel3'))).toBe(false);
  });

  it('a carrier from an old save gets its factory plate, as worn as it was', () => {
    const p = createProfile() as unknown as { version: number; stash: { items: { item: { def: string; uid: string; stack: number; dur: number }; x: number; y: number }[] } };
    p.stash.items.push({ item: { def: 'trooper', uid: 'old1', stack: 1, dur: 30 }, x: 0, y: 30 });
    p.version = 9;
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    const it = m.stash.items.find((q) => q.item.uid === 'old1')!.item;
    expect(it.mods?.plate?.def).toBe('pl_ceramic4');
    expect(it.mods!.plate!.dur).toBe(38);
    expect(it.dur).toBe(30);
  });
});
