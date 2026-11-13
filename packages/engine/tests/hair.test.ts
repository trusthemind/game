import { describe, expect, it } from 'vitest';
import {
  BEARD_BY_ID,
  BEARD_STYLES,
  beardId,
  createProfile,
  HAIR_BY_ID,
  HAIR_PALETTE,
  HAIR_STYLES,
  hairStylesFor,
  migrateProfile,
  NATURAL_HAIR,
  npcBeard,
  npcHair,
  PROFILE_VERSION,
  tidyLook,
  type PlayerLook,
} from '../src/index';

describe('hair catalogue', () => {
  it('offers a wide choice per sex, with unique ids', () => {
    expect(new Set(HAIR_STYLES.map((h) => h.id)).size).toBe(HAIR_STYLES.length);
    expect(new Set(BEARD_STYLES.map((b) => b.id)).size).toBe(BEARD_STYLES.length);
    expect(hairStylesFor('m').length).toBeGreaterThanOrEqual(16);
    expect(hairStylesFor('f').length).toBeGreaterThanOrEqual(16);
    expect(BEARD_STYLES.filter((b) => b.id !== 'none').length).toBeGreaterThanOrEqual(10);
    expect(HAIR_PALETTE.some((c) => c.dyed)).toBe(true);
  });

  it('keeps every id older saves could hold', () => {
    for (const id of ['bald', 'buzz', 'short', 'messy', 'long', 'ponytail', 'bob', 'bun']) expect(HAIR_BY_ID[id]).toBeDefined();
  });

  it('reads old true/false beards', () => {
    expect(beardId(true)).toBe('full');
    expect(beardId(false)).toBe('none');
    expect(beardId('goatee')).toBe('goatee');
    expect(beardId('nonsense')).toBe('none');
  });

  it('seeds NPCs deterministically from the whole range, natural colours only', () => {
    const m = new Set<string>();
    const f = new Set<string>();
    const b = new Set<string>();
    for (let s = 0; s < 400; s++) {
      expect(npcHair('m', s)).toBe(npcHair('m', s));
      m.add(npcHair('m', s));
      f.add(npcHair('f', s));
      b.add(npcBeard('m', s));
      expect(npcBeard('f', s)).toBe('none');
    }
    expect(m.size).toBeGreaterThanOrEqual(15);
    expect(f.size).toBeGreaterThanOrEqual(15);
    expect(b.size).toBeGreaterThanOrEqual(10);
    for (const id of m) expect(hairStylesFor('m').some((h) => h.id === id)).toBe(true);
    for (const id of b) expect(BEARD_BY_ID[id]).toBeDefined();
    for (const c of NATURAL_HAIR) expect(HAIR_PALETTE.find((p) => p.hex === c)?.dyed).toBeFalsy();
  });

  it('tidies looks: unknown styles fall back, women are clean shaven', () => {
    const look = tidyLook({ sex: 'f', skin: 1, hair: 'gone', hairColor: 2, beard: 'full' } as PlayerLook);
    expect(look.hair).toBe('ponytail');
    expect(look.beard).toBe('none');
  });

  it('migrates v11 looks (boolean beard) to v12 ids', () => {
    const p = createProfile() as unknown as { version: number; look: Record<string, unknown> };
    p.version = 11;
    p.look.beard = true;
    p.look.hair = 'messy';
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(m.version).toBe(PROFILE_VERSION);
    expect(m.look.beard).toBe('full');
    expect(m.look.hair).toBe('messy');
    p.look.beard = false;
    expect(migrateProfile(JSON.parse(JSON.stringify(p))).look.beard).toBe('none');
  });
});
