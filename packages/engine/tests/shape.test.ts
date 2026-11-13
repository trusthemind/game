import { describe, expect, it } from 'vitest';
import { createProfile, migrateProfile, PROFILE_VERSION } from '../src/profile';
import { FACE_KEYS, FACE_PRESETS, faceFromSeed, facePresetOf, npcShape, NPC_SHAPE_VARIANTS, presetOf, resolveFace, resolveShape, SHAPE_KEYS, SHAPE_PRESETS, shapeFromSeed } from '../src/shape';

describe('body shapes', () => {
  it('presets stay within -1..1 and both sexes have an average', () => {
    for (const sex of ['m', 'f'] as const) {
      expect(SHAPE_PRESETS[sex].average).toBeDefined();
      for (const p of Object.values(SHAPE_PRESETS[sex])) for (const k of SHAPE_KEYS) expect(Math.abs(p[k])).toBeLessThanOrEqual(1);
    }
  });

  it('seeded shapes are deterministic and in range', () => {
    for (let seed = 0; seed < 200; seed++)
      for (const sex of ['m', 'f'] as const) {
        const a = shapeFromSeed(sex, seed);
        expect(shapeFromSeed(sex, seed)).toEqual(a);
        for (const k of SHAPE_KEYS) expect(Math.abs(a[k])).toBeLessThanOrEqual(1);
      }
  });

  it('NPC shapes snap to a few variants per sex', () => {
    for (const sex of ['m', 'f'] as const) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 2000; seed++) seen.add(JSON.stringify(npcShape(sex, seed)));
      expect(seen.size).toBeLessThanOrEqual(NPC_SHAPE_VARIANTS);
      expect(seen.size).toBeGreaterThanOrEqual(NPC_SHAPE_VARIANTS - 2);
    }
  });

  it('resolves presets, sliders and junk', () => {
    expect(resolveShape('f', 'curvy')).toEqual(SHAPE_PRESETS.f.curvy);
    expect(resolveShape('m', 'nope')).toEqual(SHAPE_PRESETS.m.average);
    expect(resolveShape('m', { height: 5, chest: Number.NaN } as never).height).toBe(1);
    expect(resolveShape('m', { height: 5, chest: Number.NaN } as never).chest).toBe(0);
    expect(presetOf('m', resolveShape('m', 'heavy'))).toBe('heavy');
  });

  it('old saves get the average shape; new ones keep theirs', () => {
    const p = createProfile() as unknown as { version: number; look: Record<string, unknown> };
    p.version = 10;
    delete p.look.shape;
    const m = migrateProfile(p);
    expect(m.version).toBe(PROFILE_VERSION);
    expect(m.look.shape).toBe('average');
    const q = createProfile('x', 'y', { sex: 'f', skin: 0, hair: 'bob', hairColor: 0, beard: 'none', shape: 'pear' });
    expect(migrateProfile(JSON.parse(JSON.stringify(q))).look.shape).toBe('pear');
    const r = createProfile('x', 'y', { sex: 'f', skin: 0, hair: 'bob', hairColor: 0, beard: 'none', shape: 'stocky' });
    expect(migrateProfile(JSON.parse(JSON.stringify(r))).look.shape).toBe('average');
  });

  it('NPC crowds mix builds and heights', () => {
    for (const sex of ['m', 'f'] as const) {
      const hs = Array.from({ length: 200 }, (_, i) => npcShape(sex, i).height);
      expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.8);
      const waists = Array.from({ length: 200 }, (_, i) => npcShape(sex, i).waist);
      expect(Math.max(...waists) - Math.min(...waists)).toBeGreaterThan(1);
    }
  });

  it('faces resolve presets, sliders and junk; seeded faces stay in range', () => {
    expect(resolveFace('rugged')).toEqual(FACE_PRESETS.rugged);
    expect(resolveFace(undefined)).toEqual(FACE_PRESETS.classic);
    expect(resolveFace({ jaw: 3, nose: Number.NaN } as never).jaw).toBe(1);
    expect(facePresetOf(resolveFace('narrow'))).toBe('narrow');
    for (let seed = 0; seed < 100; seed++) for (const k of FACE_KEYS) expect(Math.abs(faceFromSeed(seed)[k])).toBeLessThanOrEqual(1);
  });
});
