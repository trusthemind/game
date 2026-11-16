/**
 * Face identities: whole faces built from MakeHuman / MPFB2 face targets (tools/assets/mpfb-pilot/identities.json),
 * each with its own bone structure, skin character (face detail texture), eyes and brows. The MPFB bodies carry
 * them as head-only morph targets; a look picks one (or blends two or three) and the face sliders (shape.ts) tune
 * on top. Bodies without them (the old UBC ones) ignore the identity and keep the sliders only.
 *
 * Ids are what a saved look stores; keep them (and their order: the renderer's atlases are laid out by it).
 */
import type { Sex } from './shape';

export interface IdentityDef {
  id: string;
  label: string;
  /** What reads in the creator: origin and age. */
  desc: string;
  /** 0 young adult, 1 middle-aged, 2 older (NPC weighting, as hair.ts). */
  age: 0 | 1 | 2;
}

export const IDENTITIES: Record<Sex, readonly IdentityDef[]> = {
  f: [
    { id: 'nora', label: 'Nora', desc: 'Nordic, 20s', age: 0 },
    { id: 'amara', label: 'Amara', desc: 'West African, 20s', age: 0 },
    { id: 'mei', label: 'Mei', desc: 'East Asian, 20s', age: 0 },
    { id: 'lucia', label: 'Lucia', desc: 'Mediterranean, late 20s', age: 0 },
    { id: 'olena', label: 'Olena', desc: 'Eastern European, 40s', age: 1 },
    { id: 'priya', label: 'Priya', desc: 'South Asian, 30', age: 1 },
    { id: 'kira', label: 'Kira', desc: 'Freckled, elfin, 20s', age: 0 },
    { id: 'rosa', label: 'Rosa', desc: 'Late 50s', age: 2 },
  ],
  m: [
    { id: 'jack', label: 'Jack', desc: 'Rugged, 30s', age: 1 },
    { id: 'kofi', label: 'Kofi', desc: 'West African, late 20s', age: 0 },
    { id: 'kenji', label: 'Kenji', desc: 'East Asian, 30', age: 1 },
    { id: 'tariq', label: 'Tariq', desc: 'Middle Eastern, mid 30s', age: 1 },
    { id: 'viktor', label: 'Viktor', desc: 'Heavy-set, 40s', age: 1 },
    { id: 'elias', label: 'Elias', desc: 'Nordic, long face, 20s', age: 0 },
    { id: 'mateo', label: 'Mateo', desc: 'Latino, mid 20s', age: 0 },
    { id: 'walter', label: 'Walter', desc: 'Older, 60', age: 2 },
  ],
};

/** A blend of identities: weights 0..1 summing to at most 1 (the rest is the base face). */
export type IdentityMix = readonly { id: string; w: number }[];
/** As stored: one identity's id, or a blend. Unset: the base face. */
export type IdentitySpec = string | IdentityMix;

const BY_ID: Record<Sex, Map<string, IdentityDef>> = {
  f: new Map(IDENTITIES.f.map((d) => [d.id, d])),
  m: new Map(IDENTITIES.m.map((d) => [d.id, d])),
};

/** At most three identities, known for the sex, weights clamped and summing to at most 1; [] for none. */
export function resolveIdentity(spec: IdentitySpec | undefined | null, sex: Sex): { id: string; w: number }[] {
  if (!spec) return [];
  const raw = typeof spec === 'string' ? [{ id: spec, w: 1 }] : Array.isArray(spec) ? spec : [];
  const out: { id: string; w: number }[] = [];
  for (const e of raw) {
    if (!e || typeof e.id !== 'string' || !BY_ID[sex].has(e.id)) continue;
    const w = typeof e.w === 'number' && Number.isFinite(e.w) ? Math.max(0, Math.min(1, e.w)) : 0;
    if (w <= 0) continue;
    const had = out.find((o) => o.id === e.id);
    if (had) had.w += w;
    else out.push({ id: e.id, w });
  }
  out.sort((a, b) => b.w - a.w);
  const top = out.slice(0, 3);
  const sum = top.reduce((a, e) => a + e.w, 0);
  if (sum > 1) for (const e of top) e.w /= sum;
  return top;
}

/** The identity that dominates a mix (eyes and brows come from it), or null. */
export function mainIdentity(mix: IdentityMix): string | null {
  return mix.length ? [...mix].sort((a, b) => b.w - a.w)[0]!.id : null;
}

/** A stable key for caches ('' for none). */
export function identityKey(mix: IdentityMix | undefined | null): string {
  return mix && mix.length ? mix.map((e) => `${e.id}:${Math.round(e.w * 20)}`).join(',') : '';
}

const hash = (seed: number, salt: number) => {
  // murmur3's finaliser over seed and salt
  let h = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** How many distinct NPC identity blends there are per sex (a seed snaps to one: shaped heads are shared). */
export const NPC_IDENTITY_VARIANTS = 48;

/**
 * An NPC's face identity by seed: one identity, two thirds of the time blended with a second (20-45%), now and then
 * a third (10-15%): 8 identities give many distinct, still-believable people. `age` (0..2) favours matching ones.
 */
export function npcIdentity(sex: Sex, seed: number, age = 1): { id: string; w: number }[] {
  const s = Math.floor(hash(seed, 0x51a7) * NPC_IDENTITY_VARIANTS);
  const list = IDENTITIES[sex];
  const weighted: string[] = [];
  for (const d of list) {
    const w = d.age === age ? 3 : Math.abs(d.age - age) === 1 ? 1 : age === 1 ? 1 : 0;
    for (let i = 0; i < w; i++) weighted.push(d.id);
  }
  const pick = (salt: number, not: string[]) => {
    const pool = weighted.filter((id) => !not.includes(id));
    return pool[Math.floor(hash(s, salt) * pool.length)] ?? list[0]!.id;
  };
  const a = pick(0x11, []);
  const r = hash(s, 0x22);
  if (r < 0.34) return [{ id: a, w: 1 }];
  const b = pick(0x33, [a]);
  const wb = 0.2 + 0.25 * hash(s, 0x44);
  if (r < 0.85) return resolveIdentity([{ id: a, w: 1 - wb }, { id: b, w: wb }], sex);
  const c = pick(0x55, [a, b]);
  const wc = 0.1 + 0.05 * hash(s, 0x66);
  return resolveIdentity([{ id: a, w: 1 - wb - wc }, { id: b, w: wb }, { id: c, w: wc }], sex);
}

/** A random identity (the creator's Randomize): one, or (half the time) blended with a second. `rnd` returns 0..1. */
export function randomIdentity(sex: Sex, rnd: () => number): { id: string; w: number }[] {
  const list = IDENTITIES[sex];
  const a = list[Math.floor(rnd() * list.length)]!.id;
  if (rnd() < 0.5) return [{ id: a, w: 1 }];
  const rest = list.filter((d) => d.id !== a);
  const b = rest[Math.floor(rnd() * rest.length)]!.id;
  const wb = 0.15 + rnd() * 0.3;
  return [{ id: a, w: 1 - wb }, { id: b, w: wb }];
}
