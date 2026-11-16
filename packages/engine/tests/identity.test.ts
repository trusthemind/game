import { describe, expect, it } from 'vitest';
import { IDENTITIES, identityKey, mainIdentity, npcIdentity, randomIdentity, resolveIdentity, tidyLook, DEFAULT_LOOK, type PlayerLook } from '../src/index';

describe('face identities', () => {
  it('resolves ids and blends, dropping unknown ones and capping the sum', () => {
    expect(resolveIdentity('nora', 'f')).toEqual([{ id: 'nora', w: 1 }]);
    expect(resolveIdentity('nora', 'm')).toEqual([]);
    expect(resolveIdentity(undefined, 'f')).toEqual([]);
    const mix = resolveIdentity([{ id: 'kira', w: 0.8 }, { id: 'mei', w: 0.6 }, { id: 'nobody', w: 1 }], 'f');
    expect(mix.map((e) => e.id)).toEqual(['kira', 'mei']);
    expect(mix.reduce((a, e) => a + e.w, 0)).toBeCloseTo(1);
    expect(mainIdentity(mix)).toBe('kira');
    expect(identityKey([])).toBe('');
  });
  it('gives every NPC seed a valid identity mix of at most three, with variety', () => {
    for (const sex of ['m', 'f'] as const) {
      const seen = new Set<string>();
      for (let s = 0; s < 400; s++) {
        const mix = npcIdentity(sex, s, s % 3);
        expect(mix.length).toBeGreaterThan(0);
        expect(mix.length).toBeLessThanOrEqual(3);
        expect(resolveIdentity(mix, sex)).toEqual(mix);
        seen.add(identityKey(mix));
      }
      expect(seen.size).toBeGreaterThan(20);
      expect(new Set([...seen].map((k) => k.split(':')[0])).size).toBe(IDENTITIES[sex].length);
    }
    let x = 0.3;
    const rnd = () => (x = (x * 9301 + 0.4927) % 1);
    for (let i = 0; i < 20; i++) expect(resolveIdentity(randomIdentity('m', rnd), 'm').length).toBeGreaterThan(0);
  });
  it('keeps old saves valid and tidies a look whose identity is not of its sex', () => {
    const old: PlayerLook = { ...DEFAULT_LOOK };
    expect(tidyLook({ ...old }).faceId).toBeUndefined();
    expect(tidyLook({ ...old, sex: 'f', faceId: 'nora' }).faceId).toBe('nora');
    expect(tidyLook({ ...old, sex: 'm', faceId: 'nora' }).faceId).toBeUndefined();
    expect(tidyLook({ ...old, sex: 'm', faceId: [{ id: 'jack', w: 0.7 }, { id: 'kofi', w: 0.3 }] }).faceId).toEqual([{ id: 'jack', w: 0.7 }, { id: 'kofi', w: 0.3 }]);
  });
});
