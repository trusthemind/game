import { describe, expect, it } from 'vitest';
import { createProfile, migrateProfile, PROFILE_VERSION } from '../src/profile';
import { FACE_KEYS, FACE_PARTS, FACE_PRESETS, faceFromSeed, HUMAN_LIMIT, facePresetOf, npcShape, NPC_SHAPE_VARIANTS, presetOf, resolveFace, resolveShape, SHAPE_KEYS, SHAPE_PRESETS, shapeFromSeed } from '../src/shape';

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

describe('faces and the bust (v13)', () => {
  it('has a wide range of faces and parts, all in range', () => {
    expect(Object.keys(FACE_PRESETS).length).toBeGreaterThanOrEqual(14);
    expect(Object.keys(FACE_PARTS.nose)).toEqual(expect.arrayContaining(['straight', 'button', 'aquiline', 'wide', 'narrow', 'upturned', 'hooked']));
    expect(Object.keys(FACE_PARTS.jaw)).toEqual(expect.arrayContaining(['square', 'round', 'pointed', 'cleft']));
    for (const p of Object.values(FACE_PRESETS)) for (const k of FACE_KEYS) expect(Math.abs(p[k])).toBeLessThanOrEqual(1);
    for (const group of Object.values(FACE_PARTS)) for (const p of Object.values(group)) for (const v of Object.values(p)) expect(Math.abs(v as number)).toBeLessThanOrEqual(1);
  });

  it('NPC faces vary and stay human', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const f = faceFromSeed(seed);
      seen.add(JSON.stringify(f));
      for (const k of FACE_KEYS) expect(Math.abs(f[k])).toBeLessThanOrEqual(HUMAN_LIMIT);
      expect(FACE_KEYS.filter((k) => Math.abs(f[k]) > 0.7).length).toBeLessThanOrEqual(4);
    }
    expect(seen.size).toBeGreaterThan(25);
    // Noses differ across the crowd.
    const noses = Array.from({ length: 200 }, (_, i) => faceFromSeed(i).noseBridge);
    expect(Math.max(...noses) - Math.min(...noses)).toBeGreaterThan(0.8);
  });

  it('old five-slider faces and shapes without a bust migrate', () => {
    const p = createProfile() as unknown as { version: number; look: Record<string, unknown> };
    p.version = 12;
    p.look.sex = 'f';
    p.look.beard = 'full';
    p.look.beardColor = 0x111111;
    p.look.face = { brow: 0.5, jaw: -0.2, chin: 0, nose: 0.3, cheeks: 0 };
    p.look.shape = { height: 0, shoulders: 0, chest: 0.6, waist: 0, belly: 0, hips: 0, glutes: 0, thighs: 0, calves: 0, arms: 0 };
    const m = migrateProfile(p);
    expect(m.version).toBe(PROFILE_VERSION);
    expect(m.look.beard).toBe('none');
    expect(m.look.beardColor).toBeUndefined();
    const face = m.look.face as Record<string, number>;
    expect(face.brow).toBe(0.5);
    for (const k of FACE_KEYS) expect(typeof face[k]).toBe('number');
    expect((m.look.shape as Record<string, number>).bust).toBe(0.6);
    expect(resolveFace('soft').eyeSize).toBe(0);
  });
});
