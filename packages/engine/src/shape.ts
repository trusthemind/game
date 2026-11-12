/**
 * Body shapes (V10): everybody is one of two modelled base bodies (male, female); only the body's shape, face, skin
 * and hair vary. A shape is ten sliders, each -1..1 (0 = the base mesh); the renderer turns them into a smooth
 * displacement field (apps/web/src/render/bodyShape.ts). Pure data here so the profile can store one.
 */
export interface BodyShape {
  height: number;
  shoulders: number;
  chest: number;
  waist: number;
  belly: number;
  hips: number;
  glutes: number;
  thighs: number;
  calves: number;
  arms: number;
}

export type Sex = 'm' | 'f';

export const SHAPE_KEYS: readonly (keyof BodyShape)[] = ['height', 'shoulders', 'chest', 'waist', 'belly', 'hips', 'glutes', 'thighs', 'calves', 'arms'];

export const NEUTRAL_SHAPE: BodyShape = { height: 0, shoulders: 0, chest: 0, waist: 0, belly: 0, hips: 0, glutes: 0, thighs: 0, calves: 0, arms: 0 };

const P = (s: Partial<BodyShape>): BodyShape => ({ ...NEUTRAL_SHAPE, ...s });
export const SHAPE_PRESETS: Record<Sex, Record<string, BodyShape>> = {
  m: {
    average: NEUTRAL_SHAPE,
    slim: P({ height: 0.2, shoulders: -0.5, chest: -0.6, waist: -0.7, belly: -0.6, hips: -0.5, glutes: -0.4, thighs: -0.6, calves: -0.4, arms: -0.6 }),
    athletic: P({ shoulders: 0.8, chest: 0.7, waist: -0.4, belly: -0.5, glutes: 0.2, thighs: 0.5, calves: 0.4, arms: 0.8 }),
    heavy: P({ height: -0.1, shoulders: 0.4, chest: 0.6, waist: 0.9, belly: 1, hips: 0.6, glutes: 0.5, thighs: 0.7, calves: 0.4, arms: 0.6 }),
    stocky: P({ height: -0.6, shoulders: 0.6, chest: 0.4, waist: 0.4, belly: 0.3, thighs: 0.5, calves: 0.5, arms: 0.5 }),
  },
  f: {
    average: NEUTRAL_SHAPE,
    slim: P({ height: 0.2, shoulders: -0.4, chest: -0.5, waist: -0.6, belly: -0.5, hips: -0.5, glutes: -0.4, thighs: -0.6, calves: -0.3, arms: -0.5 }),
    curvy: P({ chest: 0.8, waist: -0.3, hips: 0.9, glutes: 0.8, thighs: 0.6, calves: 0.2 }),
    pear: P({ shoulders: -0.3, chest: -0.2, hips: 1, glutes: 0.7, thighs: 0.9, calves: 0.4 }),
    athletic: P({ shoulders: 0.5, chest: -0.1, waist: -0.4, belly: -0.5, glutes: 0.5, thighs: 0.5, calves: 0.5, arms: 0.5 }),
    heavy: P({ height: -0.1, shoulders: 0.3, chest: 0.8, waist: 0.9, belly: 0.9, hips: 0.8, glutes: 0.6, thighs: 0.8, calves: 0.4, arms: 0.6 }),
  },
};

const clamp1 = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** A shape by seed: a preset, jittered a little (deterministic). */
export function shapeFromSeed(sex: Sex, seed: number, preset?: string): BodyShape {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => (s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
  const names = Object.keys(SHAPE_PRESETS[sex]);
  const pick = names[Math.floor(rnd() * names.length)]!;
  const base = SHAPE_PRESETS[sex][preset && SHAPE_PRESETS[sex][preset] ? preset : pick]!;
  const out = { ...base };
  for (const k of SHAPE_KEYS) out[k] = clamp1(out[k] + (rnd() - 0.5) * 0.4);
  // Height is nearly independent of build: people of every build come tall and short (±6% at the extremes).
  out.height = clamp1(base.height * 0.5 + (rnd() - 0.5) * 1.6);
  return out;
}

/** How many distinct NPC shapes there are per sex: a seed snaps to one, so their baked meshes are shared. */
export const NPC_SHAPE_VARIANTS = 12;

/** An NPC's shape: one of NPC_SHAPE_VARIANTS per sex, picked by seed; the variants go round every preset in turn,
 * so a crowd always shows the whole range (not a run of near-average bodies). */
export function npcShape(sex: Sex, seed: number): BodyShape {
  const v = ((Math.imul(seed | 0, 2246822519) ^ 0x5bd1e995) >>> 0) % NPC_SHAPE_VARIANTS;
  const names = Object.keys(SHAPE_PRESETS[sex]).filter((n) => n !== 'average');
  return shapeFromSeed(sex, 7919 * (v + 1) + (sex === 'f' ? 101 : 0), names[v % names.length]);
}

/** A stored shape: a preset's id or the sliders themselves. */
export type ShapeSpec = BodyShape | string;

/** The sliders a stored shape stands for (an unknown preset or junk is the sex's average), each clamped -1..1. */
export function resolveShape(sex: Sex, spec: ShapeSpec | undefined | null): BodyShape {
  if (typeof spec === 'string') return { ...(SHAPE_PRESETS[sex][spec] ?? NEUTRAL_SHAPE) };
  if (!spec || typeof spec !== 'object') return { ...NEUTRAL_SHAPE };
  const out = { ...NEUTRAL_SHAPE };
  for (const k of SHAPE_KEYS) {
    const v = (spec as Partial<BodyShape>)[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? clamp1(v) : 0;
  }
  return out;
}

/** The preset a shape equals, if any. */
export function presetOf(sex: Sex, shape: BodyShape): string | null {
  for (const [id, p] of Object.entries(SHAPE_PRESETS[sex])) if (SHAPE_KEYS.every((k) => Math.abs(p[k] - shape[k]) < 1e-3)) return id;
  return null;
}

/**
 * Faces: five sliders, each -1..1 (0 = the modelled face), turned by the renderer into a small displacement round
 * the eyes (bodyShape.ts): the brow ridge, the jaw's width, the chin, the nose and the cheekbones.
 */
export interface FaceShape {
  brow: number;
  jaw: number;
  chin: number;
  nose: number;
  cheeks: number;
}

export const FACE_KEYS: readonly (keyof FaceShape)[] = ['brow', 'jaw', 'chin', 'nose', 'cheeks'];
export const NEUTRAL_FACE: FaceShape = { brow: 0, jaw: 0, chin: 0, nose: 0, cheeks: 0 };

const F = (s: Partial<FaceShape>): FaceShape => ({ ...NEUTRAL_FACE, ...s });
export const FACE_PRESETS: Record<string, FaceShape> = {
  classic: NEUTRAL_FACE,
  soft: F({ brow: -0.6, jaw: -0.7, chin: -0.4, nose: -0.4, cheeks: 0.5 }),
  angular: F({ brow: 0.4, jaw: 0.6, chin: 0.5, nose: 0.2, cheeks: 0.9 }),
  rugged: F({ brow: 1, jaw: 1, chin: 0.6, nose: 0.7, cheeks: 0.2 }),
  narrow: F({ brow: 0.2, jaw: -0.9, chin: 0.8, nose: 0.5, cheeks: -0.6 }),
  broad: F({ brow: 0.5, jaw: 0.9, chin: -0.5, nose: -0.3, cheeks: 0.6 }),
};

/** A stored face: a preset's id or the sliders. */
export type FaceSpec = FaceShape | string;

export function resolveFace(spec: FaceSpec | undefined | null): FaceShape {
  if (typeof spec === 'string') return { ...(FACE_PRESETS[spec] ?? NEUTRAL_FACE) };
  if (!spec || typeof spec !== 'object') return { ...NEUTRAL_FACE };
  const out = { ...NEUTRAL_FACE };
  for (const k of FACE_KEYS) {
    const v = (spec as Partial<FaceShape>)[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? clamp1(v) : 0;
  }
  return out;
}

export function facePresetOf(face: FaceShape): string | null {
  for (const [id, p] of Object.entries(FACE_PRESETS)) if (FACE_KEYS.every((k) => Math.abs(p[k] - face[k]) < 1e-3)) return id;
  return null;
}

/** An NPC's face by seed: a preset, jittered (one of a few per seed so baked heads are shared). */
export function faceFromSeed(seed: number): FaceShape {
  let s = ((Math.imul(seed | 0, 2246822519) ^ 0x27d4eb2f) >>> 0) % 16;
  const names = Object.keys(FACE_PRESETS);
  const base = FACE_PRESETS[names[s % names.length]!]!;
  s = (s * 2654435761) >>> 0;
  const rnd = () => (s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
  const out = { ...base };
  for (const k of FACE_KEYS) out[k] = clamp1(out[k] + (rnd() - 0.5) * 0.6);
  return out;
}
