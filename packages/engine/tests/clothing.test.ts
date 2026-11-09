import { describe, expect, it } from 'vitest';
import {
  ALL_ITEMS,
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

  it('scavs are dressed head to toe (bar a hat), raiders are not', () => {
    for (let seed = 1; seed < 40; seed++) {
      const eq = generateLoadout('scav', new Rng(seed));
      for (const s of ['top', 'pants', 'boots'] as const) expect(getDef(eq.slots[s]!.def).clothing?.slot).toBe(s);
      const r = generateLoadout('raider', new Rng(seed));
      expect(r.slots.top ?? null).toBeNull();
    }
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
