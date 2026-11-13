import * as THREE from 'three';
import { hairCurls, hairLin, hairNoise, hairline, zones, type BeardSpec, type DrapeSpec, type HairSpec, type ScalpPt, type TailSpec } from './hairGen';

/**
 * How each hairstyle and beard (ids from the engine's hair.ts) is drawn. A few use the modelled hair cards from
 * hair.glb (Quaternius, CC0) on the body they were made for; the rest are procedural (hairGen.ts). Thicknesses are
 * centimetres on a 15 cm wide head; heights (yN) run from the nose tip (0) to the crown (1).
 */

/** Modelled hair (hair.glb mesh names) per body. Anything else is procedural. */
export const GLB_HAIR: Record<'m' | 'f', Record<string, string>> = {
  m: { buzz: 'Hair_Buzzed', short: 'Hair_SimpleParted', long: 'Hair_Long' },
  f: { crop: 'Hair_BuzzedFemale', buzz: 'Hair_BuzzedFemale', long: 'Hair_Long', bun: 'Hair_Buns' },
};

/** Smooth ramp from 0 at `a` to 1 at `b` (either way round). */
const sm = (x: number, a: number, b: number) => (a < b ? THREE.MathUtils.smoothstep(x, a, b) : 1 - THREE.MathUtils.smoothstep(x, b, a));
const gauss = (x: number, w: number) => Math.exp(-((x / w) ** 2));

/** A part line along a meridian at `az` (a shallow groove from the hairline to the crown). */
const part = (p: ScalpPt, az: number, depth = 0.5) => (p.a < 100 && p.yN > 0.55 ? 1 - depth * gauss(p.az - az, 4) : 1);
/** A fringe: the hairline brought down to `to` (yN) across the forehead (|az| < width). */
const fringe = (p: ScalpPt, to: number, width = 46, sweep = 0) => {
  const w = sm(Math.abs(p.az - sweep * 10), width, width - 14) * (p.a < 90 ? 1 : 0);
  const edge = to + sweep * 0.0015 * p.az;
  return w * sm(p.yN, edge - 0.03, edge + 0.03);
};
const spikes = (p: ScalpPt, freq: number, amp: number, pow = 3) => amp * Math.max(0, hairNoise(p, freq, 1.7) * 1.6 - 0.45) ** pow;

const side = (a: number, from: number, to: number, len: number) => len * sm(a, from, to);

function longDrape(len: number, sideLen: number, o: Partial<DrapeSpec> = {}): DrapeSpec {
  return { el: -4, len: (a) => (a < 52 ? 0 : a < 95 ? side(a, 52, 80, sideLen) : THREE.MathUtils.lerp(sideLen, len, sm(a, 95, 150))), flare: 0.4, ...o };
}

const tail = (t: TailSpec) => t;

export const HAIR_SPECS: Record<string, HairSpec> = {
  bald: {},
  shaved: { shadow: 0.5 },
  buzz: { shell: (p) => ({ t: 0.22, cov: hairline(p), dens: 0.92 }) },
  crew: { shell: (p) => ({ t: zones(p, 1.3, 1.05, 0.32, 0.42, 0.6), cov: hairline(p, { front: 0.01 }) + 0 }) },
  short: {
    shell: (p) => ({ t: zones(p, 1.8, 1.7, 0.7, 0.8) * part(p, 26) + (p.az < 20 ? 0.35 * sm(p.yN, 0.55, 0.8) : 0), cov: hairline(p) }),
  },
  ivy: {
    shell: (p) => ({ t: zones(p, 1.9, 2.1, 0.35, 0.45, 0.64, 0.07) * part(p, 24, 0.4), cov: hairline(p), up: 0.5 * gauss(p.az + 10, 40) * sm(p.yN, 0.6, 0.75) }),
  },
  fade: { shadow: 0.5, shell: (p) => ({ t: zones(p, 1.6, 1.4, 0.05, 0.06, 0.7, 0.04), cov: hairline(p) * sm(p.yN, 0.55, 0.66) }) },
  caesar: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.55, 0.6), cov: Math.max(hairline(p), fringe(p, 0.62, 40)), fwd: 0.5 * gauss(p.az, 40) * sm(p.yN, 0.8, 0.65) }),
  },
  pixie: {
    shell: (p) => ({
      t: zones(p, 2.0, 1.9, 0.55, 0.8) + 0.4 * hairNoise(p, 7),
      cov: Math.max(hairline(p), fringe(p, 0.42, 44, 1)),
      fwd: 0.6 * fringe(p, 0.42, 44, 1) * sm(p.yN, 0.66, 0.45),
    }),
  },
  crop: { shell: (p) => ({ t: zones(p, 1.2, 1.2, 0.6, 0.7), cov: hairline(p) }) },
  curls: { shell: (p) => ({ t: zones(p, 1.7, 1.6, 1.0, 1.2) + 0.7 * hairCurls(p, 16), cov: hairline(p) }) },
  undercut: {
    shadow: 0.5,
    shell: (p) => ({
      t: zones(p, 3.0, 3.1, 0.06, 0.08, 0.72, 0.025),
      cov: hairline(p) * sm(p.yN, 0.6, 0.68),
      up: 0.8 * gauss(p.az + 15, 50) * sm(p.yN, 0.7, 0.85),
    }),
  },
  slick: { shell: (p) => ({ t: zones(p, 1.5, 1.7, 0.9, 1.1, 0.55), cov: hairline(p, { front: 0.02 }) }) },
  pompadour: {
    shell: (p) => {
      const g = gauss(p.az, 48) * sm(p.yN, 0.55, 0.78) * (1 - sm(p.yN, 0.85, 1.0) * 0.6);
      return { t: zones(p, 2.4, 2.4, 0.55, 0.8, 0.62, 0.06) + 1.6 * g, cov: hairline(p), up: 2.0 * g, fwd: 1.4 * g };
    },
  },
  quiff: {
    shadow: 0.5,
    shell: (p) => {
      const g = gauss(p.az + 8, 34) * sm(p.yN, 0.6, 0.76) * (1 - sm(p.yN, 0.86, 1.0) * 0.7);
      return { t: zones(p, 2.0, 2.0, 0.3, 0.4, 0.66, 0.05) + spikes(p, 8, 0.8, 2) + 1.2 * g, cov: hairline(p) * sm(p.yN, 0.5, 0.6), up: 1.8 * g, fwd: 1.1 * g };
    },
  },
  messy: {
    shell: (p) => ({
      t: zones(p, 2.3, 2.2, 1.5, 1.7) + spikes(p, 9, 2.4, 2),
      cov: Math.max(hairline(p, { nape: -0.3 }), fringe(p, 0.5, 42, -1)),
      fwd: 0.5 * fringe(p, 0.5, 42, -1),
    }),
  },
  curlytop: { shadow: 0.5, shell: (p) => ({ t: zones(p, 3.2, 3.2, 0.12, 0.15, 0.66, 0.06) + 0.9 * hairCurls(p, 15), cov: hairline(p) * sm(p.yN, 0.5, 0.62) }) },
  afro: { shell: (p) => ({ t: 5.4 + 0.4 * sm(p.yN, 0.3, 1.0) - 1.5 * sm(p.yN, 0.3, -0.1) + 0.7 * hairCurls(p, 12), cov: hairline(p, { ears: true, nape: -0.28 }) }) },
  shag: {
    shell: (p) => ({ t: zones(p, 2.6, 2.4, 1.9, 2.1) + spikes(p, 8, 1.6, 2), cov: Math.max(hairline(p, { ears: true }), fringe(p, 0.48, 40)), fwd: 0.4 * fringe(p, 0.48, 40) }),
    drape: longDrape(9, 6, { flare: 0.8, curl: 0.7 }),
  },
  bob: {
    shell: (p) => ({ t: zones(p, 1.8, 1.6, 1.5, 1.7, 0.55) * part(p, 18, 0.4), cov: hairline(p, { ears: true }) }),
    drape: { el: -2, len: (a) => (a < 54 ? 0 : side(a, 54, 78, 8)), flare: 1.1, tuck: 1.0 },
  },
  fringebob: {
    shell: (p) => ({ t: zones(p, 1.8, 1.4, 1.5, 1.7, 0.55), cov: Math.max(hairline(p, { ears: true }), fringe(p, 0.36, 50)), fwd: 0.5 * fringe(p, 0.36, 50) }),
    drape: { el: -2, len: (a) => (a < 54 ? 0 : side(a, 54, 78, 8)), flare: 1.1, tuck: 1.0 },
  },
  lob: {
    shell: (p) => ({ t: zones(p, 1.6, 1.4, 1.3, 1.5, 0.55) * part(p, -22, 0.4), cov: hairline(p, { ears: true }) }),
    drape: { el: -3, len: (a) => (a < 52 ? 0 : side(a, 52, 78, 15)), flare: 0.8, tuck: 0.6, wave: [0.3, 8] },
  },
  long: {
    shell: (p) => ({ t: zones(p, 1.4, 1.5, 1.1, 1.3, 0.55) * part(p, 0, 0.5), cov: hairline(p, { ears: true }) }),
    drape: longDrape(30, 24, { flare: 0.35 }),
  },
  shoulder: {
    shell: (p) => ({ t: zones(p, 1.7, 1.7, 1.3, 1.5, 0.55) * part(p, 24, 0.4) + spikes(p, 8, 0.6, 2), cov: hairline(p, { ears: true }) }),
    drape: longDrape(15, 13, { flare: 0.6, wave: [0.35, 9], curl: 0.3 }),
  },
  straight: {
    shell: (p) => ({ t: zones(p, 1.3, 1.4, 1.0, 1.2, 0.55) * part(p, 0, 0.5), cov: hairline(p, { ears: true }) }),
    drape: longDrape(32, 28, { flare: 0.25 }),
  },
  wavy: {
    shell: (p) => ({ t: zones(p, 1.7, 1.7, 1.4, 1.6, 0.55) * part(p, 22, 0.4), cov: hairline(p, { ears: true }) }),
    drape: longDrape(28, 24, { flare: 0.8, wave: [0.9, 7] }),
  },
  curlylong: {
    shell: (p) => ({ t: zones(p, 2.8, 2.6, 2.4, 2.6, 0.55) + 0.8 * hairCurls(p, 13), cov: hairline(p, { ears: true }) }),
    drape: longDrape(22, 18, { flare: 1.6, curl: 1.1, wave: [0.6, 5] }),
  },
  bangs: {
    shell: (p) => ({ t: zones(p, 1.5, 1.3, 1.1, 1.3, 0.55), cov: Math.max(hairline(p, { ears: true }), fringe(p, 0.36, 50)), fwd: 0.45 * fringe(p, 0.36, 50) }),
    drape: longDrape(30, 25, { flare: 0.35 }),
  },
  ponytail: {
    shell: (p) => ({ t: zones(p, 0.9, 1.0, 0.8, 0.9, 0.55), cov: hairline(p) }),
    tails: [
      tail({ kind: 'tube', az: 180, yN: 0.66, path: [[0, 1.2, -2.6], [0, -3, -4.6], [0, -11, -4.2], [0, -20, -3.2]], r: (s) => (s < 0.05 ? 1.1 : 2.4 * (1 - 0.7 * s) + 0.3), ties: [0.03] }),
    ],
  },
  lowtail: {
    shell: (p) => ({ t: zones(p, 1.1, 1.2, 0.9, 1.0, 0.55), cov: hairline(p) }),
    tails: [tail({ kind: 'tube', az: 180, yN: 0.06, path: [[0, -1.2, -1.8], [0, -6, -2.4], [0, -12, -2]], r: (s) => (s < 0.06 ? 0.9 : 1.4 * (1 - 0.7 * s) + 0.2), ties: [0.04] })],
  },
  manbun: {
    shell: (p) => ({ t: zones(p, 1.1, 1.3, 0.8, 1.0, 0.55), cov: hairline(p) }),
    tails: [tail({ kind: 'bun', az: 180, yN: 0.86, path: [[0, 1.3, -1.8]], r: () => 2.5 })],
  },
  bun: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.8, 0.9, 0.55) * part(p, 0, 0.5), cov: hairline(p) }),
    tails: [
      tail({ kind: 'bun', az: 140, yN: 0.92, path: [[1.4, 1.2, -0.8]], r: () => 2.4 }),
      tail({ kind: 'bun', az: -140, yN: 0.92, path: [[-1.4, 1.2, -0.8]], r: () => 2.4 }),
    ],
  },
  topknot: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.8, 0.9, 0.55), cov: hairline(p) }),
    tails: [tail({ kind: 'bun', az: 180, yN: 0.99, path: [[0, 2.4, -0.8]], r: () => 3.1 })],
  },
  lowbun: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.8, 0.9, 0.55) * part(p, 18, 0.5), cov: hairline(p) }),
    tails: [tail({ kind: 'bun', az: 180, yN: 0.2, path: [[0, -0.6, -2.2]], r: () => 2.8 })],
  },
  braid: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.9, 1.0, 0.55) * part(p, 0, 0.5), cov: hairline(p) }),
    tails: [
      tail({ kind: 'braid', az: 180, yN: 0.25, path: [[0, -2, -2.4], [0, -9, -3], [0, -18, -2.6], [0, -28, -1.8]], r: (s) => 1.8 * (1 - 0.4 * s), ties: [0.93] }),
    ],
  },
  braids: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.9, 1.0, 0.55) * part(p, 0, 0.6), cov: hairline(p) }),
    tails: [1, -1].map((sx) =>
      tail({ kind: 'braid', az: sx * 112, yN: 0.12, path: [[sx * 1.5, -4, -0.4], [sx * 2.4, -11, 1.2], [sx * 2.4, -20, 2.4]], r: (s) => 1.45 * (1 - 0.35 * s), ties: [0.92] }),
    ),
  },
  mohawk: {
    shadow: 0.5,
    shell: (p) => {
      const strip = sm(Math.abs(p.xN), 0.3, 0.2);
      return { t: (2.5 + 5.5 * sm(p.yN, 0.0, 0.75)) * (0.8 + 0.4 * hairNoise(p, 10)) * strip, cov: hairline(p) * strip };
    },
  },
  spiky: { shell: (p) => ({ t: zones(p, 1.8, 2.0, 0.8, 1.0) + spikes(p, 10, 3.4, 3), cov: hairline(p) }) },
  sideshave: {
    shadow: 0.5,
    shell: (p) => {
      // The left side (+x, az > 0) shaved up to the temple; the rest swept over to the right.
      const shaved = sm(p.az, 25, 45) * sm(p.az, 165, 150) * sm(p.yN, 0.72, 0.6);
      return { t: zones(p, 2.0, 1.7, 1.4, 1.5, 0.55) + (p.az < 0 ? 0.5 : 0) * sm(p.yN, 0.5, 0.8), cov: hairline(p, { ears: p.az < 0 }) * (1 - shaved) };
    },
    drape: { el: -4, len: (a, az) => (az > 30 ? 0 : a < 52 ? 0 : a < 95 ? side(a, 52, 80, 22) : 24), flare: 0.4 },
  },
};

// ── Beards ───────────────────────────────────────────────────────────────────

const lin = hairLin;
/** Below the cheek line (where a full beard stops on the cheek), soft. */
const cheek = (yN: number, faz: number, lower = 0) =>
  sm(
    lin([[0, -0.055], [12, -0.065], [22, -0.13], [34, -0.06], [48, 0.02], [62, 0.08], [76, 0.18], [90, 0.4]], faz) - lower - yN,
    -0.02,
    0.03,
  );
/** Above the neckline under the jaw. */
const neck = (yN: number, faz: number) => sm(yN - lin([[0, -0.72], [35, -0.66], [60, -0.52], [80, -0.3], [95, 0]], faz), -0.02, 0.03);
const sides = (faz: number) => sm(faz, 98, 88);
/** 0 on the lips. */
const lips = (xN: number, yN: number, lowerOnly = false) => {
  const cy = lowerOnly ? -0.215 : -0.18;
  const hy = lowerOnly ? 0.045 : 0.07;
  return sm((xN / 0.27) ** 2 + ((yN - cy) / hy) ** 2, 0.75, 1.15);
};
const area = (xN: number, yN: number, faz: number, lower = 0) => cheek(yN, faz, lower) * neck(yN, faz) * sides(faz) * lips(xN, yN);
const mo = (xN: number, yN: number, w = 0.34, lo = -0.14, hi = -0.05) => sm(xN, w + 0.04, w - 0.03) * sm(yN, lo - 0.02, lo + 0.01) * sm(yN, hi + 0.015, hi - 0.015);
const chin = (xN: number, yN: number, w = 0.33, top = -0.24, bottom = -0.62) => sm(xN, w + 0.04, w - 0.03) * sm(yN, top + 0.02, top - 0.02) * sm(yN, bottom - 0.03, bottom + 0.03);
const jawEdge = (faz: number) => lin([[0, -0.47], [40, -0.43], [65, -0.32], [82, -0.12], [95, 0.1]], faz);
const chinDrop = (xN: number, yN: number, len: number) => len * sm(yN, -0.2, -0.5) * sm(xN, 0.72, 0.05);

export const BEARD_SPECS: Record<string, BeardSpec | null> = {
  none: null,
  stubble: ({ xN, yN, faz }) => ({ t: 0.04, cov: area(xN, yN, faz, -0.03), dens: 0.42 }),
  scruff: ({ xN, yN, faz }) => ({ t: 0.14, cov: area(xN, yN, faz, -0.02), dens: 0.82 }),
  chinstrap: ({ xN, yN, faz }) => ({ t: 0.45, cov: area(xN, yN, faz) * sm(yN - jawEdge(faz), 0.13, 0.08) }),
  soulpatch: ({ xN, yN }) => ({ t: 0.5, cov: sm(xN, 0.09, 0.05) * sm(yN, -0.35, -0.32) * sm(yN, -0.235, -0.255) }),
  goatee: ({ xN, yN, faz }) => ({ t: 0.85, cov: Math.max(mo(xN, yN, 0.3), chin(xN, yN, 0.3, -0.14, -0.58), sm(xN, 0.33, 0.27) * sm(yN, -0.27, -0.24) * sm(yN, -0.06, -0.09) * sm(xN, 0.2, 0.24)) * lips(xN, yN) * sides(faz), drop: chinDrop(xN, yN, 1.0) }),
  vandyke: ({ xN, yN, faz }) => {
    const w = 0.08 + 0.16 * sm(yN, -0.62, -0.3);
    return { t: 0.8, cov: Math.max(mo(xN, yN, 0.36), chin(xN, yN, w, -0.28, -0.62), sm(xN, 0.07, 0.04) * sm(yN, -0.3, -0.27) * sm(yN, -0.21, -0.24)) * lips(xN, yN) * sides(faz), drop: chinDrop(xN, yN, 2.6) * sm(xN, 0.2, 0.0) };
  },
  moustache: ({ xN, yN }) => ({ t: 0.7, cov: mo(xN, yN, 0.33) * lips(xN, yN, true) }),
  walrus: ({ xN, yN }) => ({ t: 1.1, cov: mo(xN, yN, 0.4, -0.2, -0.04) * lips(xN, yN, true), drop: 0.5 * sm(yN, -0.08, -0.18) }),
  pencil: ({ xN, yN }) => ({ t: 0.15, cov: mo(xN, yN, 0.3, -0.115, -0.085) }),
  horseshoe: ({ xN, yN }) => ({ t: 0.75, cov: Math.max(mo(xN, yN, 0.34), sm(xN, 0.22, 0.27) * sm(xN, 0.4, 0.34) * sm(yN, -0.5, -0.45) * sm(yN, -0.04, -0.08)) * lips(xN, yN) }),
  chops: ({ xN, yN, faz }) => ({ t: 0.9, cov: Math.max(area(xN, yN, faz) * (1 - chin(xN, yN, 0.36, -0.2, -0.9)), mo(xN, yN, 0.34)) * lips(xN, yN) * sm(yN, -0.6, -0.5) }),
  boxed: ({ xN, yN, faz }) => ({ t: 0.6, cov: area(xN, yN, faz, 0.03) }),
  full: ({ xN, yN, faz }) => ({ t: 1.25, cov: area(xN, yN, faz), drop: chinDrop(xN, yN, 1.6) }),
  long: ({ xN, yN, faz }) => ({ t: 1.5, cov: area(xN, yN, faz), drop: chinDrop(xN, yN, 7.5) }),
  viking: ({ xN, yN, faz }) => ({ t: 1.4, cov: area(xN, yN, faz), drop: chinDrop(xN, yN, 8) * (0.45 + 0.55 * sm(Math.abs(xN - 0.17), 0.16, 0.0)) }),
};
