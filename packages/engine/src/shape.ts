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
  /** The bust (a woman's breasts, a man's pecs): a rounded volume swelling out from the chest, not a stretch. */
  bust: number;
}

export type Sex = 'm' | 'f';

export const SHAPE_KEYS: readonly (keyof BodyShape)[] = ['height', 'shoulders', 'chest', 'bust', 'waist', 'belly', 'hips', 'glutes', 'thighs', 'calves', 'arms'];

export const NEUTRAL_SHAPE: BodyShape = { height: 0, shoulders: 0, chest: 0, bust: 0, waist: 0, belly: 0, hips: 0, glutes: 0, thighs: 0, calves: 0, arms: 0 };

const P = (s: Partial<BodyShape>): BodyShape => ({ ...NEUTRAL_SHAPE, ...s });
export const SHAPE_PRESETS: Record<Sex, Record<string, BodyShape>> = {
  m: {
    average: NEUTRAL_SHAPE,
    slim: P({ height: 0.2, shoulders: -0.5, chest: -0.6, bust: -0.5, waist: -0.7, belly: -0.6, hips: -0.5, glutes: -0.4, thighs: -0.6, calves: -0.4, arms: -0.6 }),
    athletic: P({ shoulders: 0.8, chest: 0.7, bust: 0.6, waist: -0.4, belly: -0.5, glutes: 0.2, thighs: 0.5, calves: 0.4, arms: 0.8 }),
    heavy: P({ height: -0.1, shoulders: 0.4, chest: 0.6, bust: 0.5, waist: 0.85, belly: 0.9, hips: 0.5, glutes: 0.45, thighs: 0.6, calves: 0.4, arms: 0.6 }),
    stocky: P({ height: -0.6, shoulders: 0.6, chest: 0.4, bust: 0.3, waist: 0.4, belly: 0.3, thighs: 0.5, calves: 0.5, arms: 0.5 }),
  },
  f: {
    average: NEUTRAL_SHAPE,
    slim: P({ height: 0.2, shoulders: -0.4, chest: -0.3, bust: -0.5, waist: -0.6, belly: -0.5, hips: -0.5, glutes: -0.4, thighs: -0.6, calves: -0.3, arms: -0.5 }),
    curvy: P({ chest: 0.2, bust: 0.7, waist: -0.3, hips: 0.7, glutes: 0.6, thighs: 0.45, calves: 0.2 }),
    pear: P({ shoulders: -0.3, chest: -0.2, bust: -0.2, hips: 0.75, glutes: 0.55, thighs: 0.6, calves: 0.3 }),
    athletic: P({ shoulders: 0.5, chest: 0.1, bust: -0.2, waist: -0.4, belly: -0.5, glutes: 0.5, thighs: 0.5, calves: 0.5, arms: 0.5 }),
    heavy: P({ height: -0.1, shoulders: 0.3, chest: 0.4, bust: 0.7, waist: 0.8, belly: 0.8, hips: 0.6, glutes: 0.5, thighs: 0.6, calves: 0.4, arms: 0.6 }),
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
  return humanShape(out);
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
  // Saves from before the bust slider: their chest slider drove the bust too.
  if (typeof (spec as Partial<BodyShape>).bust !== 'number') out.bust = out.chest;
  return out;
}

/** The preset a shape equals, if any. */
export function presetOf(sex: Sex, shape: BodyShape): string | null {
  for (const [id, p] of Object.entries(SHAPE_PRESETS[sex])) if (SHAPE_KEYS.every((k) => Math.abs(p[k] - shape[k]) < 1e-3)) return id;
  return null;
}

/**
 * Faces: sliders, each -1..1 (0 = the modelled face), turned by the renderer into a displacement of the head
 * (bodyShape.ts): the skull's width and length, the forehead, the brow, the eyes (size, spacing, tilt), the nose
 * (size, width, bridge, tip), the mouth, the jaw and chin, the cheeks and the ears. The first five are the
 * original sliders (saves before v13 only have those; the rest read as 0).
 */
export interface FaceShape {
  brow: number;
  jaw: number;
  chin: number;
  nose: number;
  cheeks: number;
  headWidth: number;
  headLength: number;
  forehead: number;
  browHeight: number;
  eyeSize: number;
  eyeSpacing: number;
  eyeTilt: number;
  noseWidth: number;
  noseBridge: number;
  noseTip: number;
  lips: number;
  mouthWidth: number;
  chinLength: number;
  chinShape: number;
  cleft: number;
  cheekFull: number;
  ears: number;
}

export const FACE_KEYS: readonly (keyof FaceShape)[] = [
  'headWidth', 'headLength', 'forehead',
  'brow', 'browHeight',
  'eyeSize', 'eyeSpacing', 'eyeTilt',
  'nose', 'noseWidth', 'noseBridge', 'noseTip',
  'lips', 'mouthWidth',
  'jaw', 'chin', 'chinLength', 'chinShape', 'cleft',
  'cheeks', 'cheekFull',
  'ears',
];
/** The sliders in their creator groups. */
export const FACE_GROUPS: readonly { id: string; label: string; keys: readonly (keyof FaceShape)[] }[] = [
  { id: 'head', label: 'Head', keys: ['headWidth', 'headLength', 'forehead'] },
  { id: 'brow', label: 'Brow', keys: ['brow', 'browHeight'] },
  { id: 'eyes', label: 'Eyes', keys: ['eyeSize', 'eyeSpacing', 'eyeTilt'] },
  { id: 'nose', label: 'Nose', keys: ['nose', 'noseWidth', 'noseBridge', 'noseTip'] },
  { id: 'mouth', label: 'Mouth', keys: ['lips', 'mouthWidth'] },
  { id: 'jaw', label: 'Jaw & chin', keys: ['jaw', 'chin', 'chinLength', 'chinShape', 'cleft'] },
  { id: 'cheeks', label: 'Cheeks', keys: ['cheeks', 'cheekFull'] },
  { id: 'ears', label: 'Ears', keys: ['ears'] },
];
export const NEUTRAL_FACE: FaceShape = Object.fromEntries(FACE_KEYS.map((k) => [k, 0])) as unknown as FaceShape;

const F = (s: Partial<FaceShape>): FaceShape => ({ ...NEUTRAL_FACE, ...s });
/** Whole faces (the Face tab's "Overall" tiles; NPC faces start from one). The first six are the old presets. */
export const FACE_PRESETS: Record<string, FaceShape> = {
  classic: NEUTRAL_FACE,
  soft: F({ brow: -0.6, jaw: -0.7, chin: -0.4, nose: -0.4, cheeks: 0.5, cheekFull: 0.4, noseTip: 0.3, lips: 0.3, chinShape: -0.2 }),
  angular: F({ brow: 0.4, jaw: 0.6, chin: 0.5, nose: 0.2, cheeks: 0.9, cheekFull: -0.6, chinShape: 0.3, noseBridge: 0.3, headLength: 0.3 }),
  rugged: F({ brow: 0.9, jaw: 0.9, chin: 0.6, nose: 0.6, cheeks: 0.2, noseBridge: 0.5, noseWidth: 0.4, chinShape: -0.6, browHeight: -0.4, eyeSize: -0.3 }),
  narrow: F({ brow: 0.2, jaw: -0.9, chin: 0.8, nose: 0.5, cheeks: -0.6, headWidth: -0.7, headLength: 0.5, noseWidth: -0.5, chinShape: 0.6, eyeSpacing: -0.4 }),
  broad: F({ brow: 0.5, jaw: 0.9, chin: -0.5, nose: -0.3, cheeks: 0.6, headWidth: 0.7, headLength: -0.4, noseWidth: 0.6, mouthWidth: 0.5, eyeSpacing: 0.4 }),
  round: F({ jaw: -0.3, chin: -0.6, cheekFull: 0.9, headWidth: 0.5, headLength: -0.5, chinShape: -0.3, noseTip: 0.4, nose: -0.3, eyeSize: 0.3 }),
  hawk: F({ nose: 0.8, noseBridge: 0.9, noseTip: -0.6, noseWidth: -0.3, brow: 0.5, cheeks: 0.5, cheekFull: -0.5, eyeSize: -0.3, chin: 0.4, headLength: 0.3 }),
  doll: F({ eyeSize: 0.8, nose: -0.6, noseTip: 0.6, noseWidth: -0.4, lips: 0.6, chin: -0.2, chinShape: 0.5, jaw: -0.5, forehead: 0.4, brow: -0.6 }),
  heavyset: F({ cheekFull: 0.8, jaw: 0.6, chin: -0.3, chinLength: -0.4, headWidth: 0.6, noseWidth: 0.5, nose: 0.3, lips: 0.3, eyeSize: -0.4, ears: 0.3 }),
  gaunt: F({ cheekFull: -0.9, cheeks: 0.7, jaw: 0.2, headWidth: -0.4, eyeSize: -0.2, noseBridge: 0.4, chinLength: 0.4, lips: -0.5, forehead: 0.3 }),
  boxer: F({ noseBridge: -0.6, noseWidth: 0.8, nose: -0.2, brow: 0.8, browHeight: -0.6, jaw: 0.7, chinShape: -0.7, ears: 0.6, eyeSize: -0.5, lips: 0.2 }),
  elfin: F({ chinShape: 0.8, chin: 0.3, jaw: -0.7, cheeks: 0.8, eyeTilt: 0.7, eyeSize: 0.4, noseWidth: -0.5, ears: -0.3, forehead: 0.5, browHeight: 0.4 }),
  wide_set: F({ eyeSpacing: 0.8, eyeSize: 0.3, noseBridge: -0.4, noseWidth: 0.3, mouthWidth: 0.4, headWidth: 0.3, chinShape: -0.3, browHeight: 0.3 }),
  long: F({ headLength: 0.8, chinLength: 0.7, forehead: 0.5, nose: 0.5, headWidth: -0.4, jaw: -0.3, cheekFull: -0.3, mouthWidth: -0.3 }),
  cleft: F({ cleft: 0.9, chin: 0.6, jaw: 0.6, chinShape: -0.5, brow: 0.4, noseBridge: 0.2, lips: -0.2, eyeTilt: -0.3 }),
  delicate: F({ headWidth: -0.3, jaw: -0.6, chin: -0.2, nose: -0.5, noseWidth: -0.6, lips: 0.5, mouthWidth: -0.4, eyeSize: 0.5, ears: -0.4, browHeight: 0.5 }),
  weathered: F({ brow: 0.7, browHeight: -0.5, eyeSize: -0.6, eyeTilt: -0.5, noseBridge: 0.6, nose: 0.4, cheekFull: -0.5, lips: -0.6, chinLength: 0.3, ears: 0.5 }),
};

/** Parts to mix into a face (the Face tab's Nose, Eyes, Mouth and Jaw tiles): each sets only its own sliders. */
export const FACE_PARTS: Record<'nose' | 'eyes' | 'mouth' | 'jaw', Record<string, Partial<FaceShape>>> = {
  nose: {
    straight: { nose: 0, noseWidth: 0, noseBridge: 0, noseTip: 0 },
    button: { nose: -0.7, noseWidth: -0.1, noseBridge: -0.4, noseTip: 0.6 },
    aquiline: { nose: 0.6, noseWidth: -0.2, noseBridge: 0.8, noseTip: -0.2 },
    wide: { nose: 0.1, noseWidth: 0.9, noseBridge: -0.2, noseTip: 0.1 },
    narrow: { nose: 0.2, noseWidth: -0.85, noseBridge: 0.2, noseTip: 0 },
    upturned: { nose: -0.2, noseWidth: 0, noseBridge: -0.5, noseTip: 0.9 },
    hooked: { nose: 0.8, noseWidth: 0.1, noseBridge: 0.9, noseTip: -0.9 },
  },
  eyes: {
    average: { eyeSize: 0, eyeSpacing: 0, eyeTilt: 0 },
    large: { eyeSize: 0.85, eyeSpacing: 0.1, eyeTilt: 0 },
    small: { eyeSize: -0.8, eyeSpacing: 0, eyeTilt: 0 },
    close_set: { eyeSize: 0, eyeSpacing: -0.85, eyeTilt: 0 },
    wide_set: { eyeSize: 0.1, eyeSpacing: 0.85, eyeTilt: 0 },
    upturned: { eyeSize: 0.2, eyeSpacing: 0, eyeTilt: 0.85 },
    downturned: { eyeSize: -0.1, eyeSpacing: 0, eyeTilt: -0.85 },
  },
  mouth: {
    average: { lips: 0, mouthWidth: 0 },
    full: { lips: 0.85, mouthWidth: 0.1 },
    thin: { lips: -0.85, mouthWidth: 0 },
    wide: { lips: 0.1, mouthWidth: 0.85 },
    small: { lips: 0.2, mouthWidth: -0.8 },
  },
  jaw: {
    average: { jaw: 0, chin: 0, chinLength: 0, chinShape: 0, cleft: 0 },
    square: { jaw: 0.8, chin: 0.3, chinLength: 0, chinShape: -0.85, cleft: 0 },
    round: { jaw: -0.2, chin: -0.3, chinLength: -0.3, chinShape: -0.3, cleft: 0 },
    pointed: { jaw: -0.7, chin: 0.4, chinLength: 0.4, chinShape: 0.85, cleft: 0 },
    cleft: { jaw: 0.4, chin: 0.5, chinLength: 0.1, chinShape: -0.4, cleft: 0.9 },
    long: { jaw: -0.2, chin: 0.3, chinLength: 0.85, chinShape: 0.2, cleft: 0 },
    weak: { jaw: -0.5, chin: -0.85, chinLength: -0.5, chinShape: 0.1, cleft: 0 },
  },
};

/** Which part preset a face's sliders equal, if any. */
export function facePartOf(face: FaceShape, part: keyof typeof FACE_PARTS): string | null {
  for (const [id, p] of Object.entries(FACE_PARTS[part])) if (Object.entries(p).every(([k, v]) => Math.abs(face[k as keyof FaceShape] - (v as number)) < 1e-3)) return id;
  return null;
}

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

/** How many distinct NPC faces there are: a seed snaps to one, so their shaped heads are shared. */
export const NPC_FACE_VARIANTS = 40;

/** An NPC's face by seed: an overall face with a nose, eyes, mouth and jaw mixed in, jittered and kept human
 * (one of NPC_FACE_VARIANTS per seed, so shaped heads are shared). Draws on every preset and part. */
export function faceFromSeed(seed: number): FaceShape {
  let s = (((Math.imul(seed | 0, 2246822519) ^ 0x27d4eb2f) >>> 0) % NPC_FACE_VARIANTS) + 1;
  s = Math.imul(s, 2654435761) >>> 0;
  const rnd = () => (s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
  return randomHumanFace(rnd, undefined, true);
}

/**
 * Believable people only. A random look is a preset plus a small jitter (±0.15 of each slider's -1..1 range),
 * and the result is kept inside HUMAN_LIMIT: no single slider past it and no stacking of several near-extremes
 * (the mean size of the soft-tissue sliders is capped, so "everything +1" is out of reach).
 */
export const HUMAN_LIMIT = 0.9;
const SOFT: readonly (keyof BodyShape)[] = ['chest', 'bust', 'waist', 'belly', 'hips', 'glutes', 'thighs', 'calves', 'arms'];
const SOFT_MEAN = 0.75;
const LEG_TOP = 1.35;

/** A shape kept to human proportions (see HUMAN_LIMIT). Presets already are; this tames jitter and stacking. */
export function humanShape(s: BodyShape): BodyShape {
  const out = { ...s };
  for (const k of SHAPE_KEYS) out[k] = Math.max(-HUMAN_LIMIT, Math.min(HUMAN_LIMIT, out[k]));
  const mean = SOFT.reduce((a, k) => a + Math.abs(out[k]), 0) / SOFT.length;
  if (mean > SOFT_MEAN) for (const k of SOFT) out[k] *= SOFT_MEAN / mean;
  // Hips and thighs both widen the top of the leg; together they're capped (no breeches silhouette).
  const legTop = Math.max(0, out.hips) + Math.max(0, out.thighs);
  if (legTop > LEG_TOP) {
    if (out.hips > 0) out.hips *= LEG_TOP / legTop;
    if (out.thighs > 0) out.thighs *= LEG_TOP / legTop;
  }
  return out;
}

/** A face kept inside HUMAN_LIMIT, with at most four features near an extreme at once (one per part of the face
 * is fine: a big nose and a long chin; every feature at once is a caricature). */
export function humanFace(f: FaceShape): FaceShape {
  const out = resolveFace(f);
  for (const k of FACE_KEYS) out[k] = Math.max(-HUMAN_LIMIT, Math.min(HUMAN_LIMIT, out[k]));
  const strong = FACE_KEYS.filter((k) => Math.abs(out[k]) > 0.7).sort((a, b) => Math.abs(out[b]) - Math.abs(out[a]));
  for (const k of strong.slice(4)) out[k] = Math.sign(out[k]) * 0.7;
  return out;
}

const JITTER = 0.15;

/** A random build: the preset (or one picked) with a small jitter, kept human. `rnd` returns 0..1. */
export function randomHumanShape(sex: Sex, rnd: () => number, preset?: string): BodyShape {
  const names = Object.keys(SHAPE_PRESETS[sex]);
  const base = SHAPE_PRESETS[sex][preset && SHAPE_PRESETS[sex][preset] ? preset : names[Math.floor(rnd() * names.length)]!]!;
  const out = { ...base };
  for (const k of SHAPE_KEYS) out[k] = base[k] + (rnd() * 2 - 1) * JITTER;
  return humanShape(out);
}

/**
 * A random face: the preset (or one picked), with (if `mix`, or no preset was asked for) a random nose, eyes, mouth
 * and jaw blended in half way, then a small jitter, kept human.
 */
export function randomHumanFace(rnd: () => number, preset?: string, mix?: boolean): FaceShape {
  const names = Object.keys(FACE_PRESETS);
  const base = FACE_PRESETS[preset && FACE_PRESETS[preset] ? preset : names[Math.floor(rnd() * names.length)]!]!;
  const out = { ...base };
  if (mix ?? !preset)
    for (const parts of Object.values(FACE_PARTS)) {
      const ids = Object.keys(parts);
      const part = parts[ids[Math.floor(rnd() * ids.length)]!]!;
      for (const [k, v] of Object.entries(part)) out[k as keyof FaceShape] = out[k as keyof FaceShape] * 0.4 + (v as number) * 0.6;
    }
  for (const k of FACE_KEYS) out[k] = out[k] + (rnd() * 2 - 1) * JITTER;
  return humanFace(out);
}
