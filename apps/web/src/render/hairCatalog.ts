import * as THREE from 'three';
import { hairCurls, hairNoise, hairline, zones, type DrapeSpec, type Frame, type HairSpec, type ScalpOut, type ScalpPt, type TailSpec } from './hairGen';

/**
 * The hairstyle catalogue past the first few dozen (engine hair.ts lists them): parameterised families after real
 * cuts — barbers' fades and tapers (low / mid / high, skin or not), crops, slick backs, flat-tops, receding and
 * balding patterns, curl types 2A to 4C, afros and puffs, twists, cornrows, box braids and locs, ponytails, braids
 * and buns. Every one is built on the head's measured landmarks (hairGen.ts measureLandmarks), so its hairline
 * sits round the ears whatever the head; the scalp under it is drawn as its roots (hairGen.ts buildUnderlay).
 * Thicknesses are cm on a 15 cm wide head; heights (yN) from the nose tip (0) to the crown (1).
 */

const sm = (x: number, a: number, b: number) => (a < b ? THREE.MathUtils.smoothstep(x, a, b) : 1 - THREE.MathUtils.smoothstep(x, b, a));
const gauss = (x: number, w: number) => Math.exp(-((x / w) ** 2));
const lerp = THREE.MathUtils.lerp;
const D = THREE.MathUtils.degToRad;

type Fade = 'low' | 'mid' | 'high' | 'taper';

/**
 * How much of the top's length grows at this point of a fade (0: down to the skin, or a taper's shortest; 1: full).
 * The fade runs up the sides and back only (the front and top keep their length): a low fade from just over the
 * nape and ear lobes, a mid fade to the ears' top, a high one to the temples' height; a taper only round the
 * ears and nape, leaving length above them.
 */
function fadeAt(p: ScalpPt, kind: Fade): number {
  const { earTop: eT, earBot: eB } = p.f;
  const [lo, hi] = kind === 'low' ? [eB - 0.12, eT - 0.02] : kind === 'mid' ? [eB - 0.02, eT + 0.16] : kind === 'high' ? [eT - 0.06, eT + 0.3] : [eB - 0.14, eT - 0.06];
  const side = sm(p.a, 34, 64);
  return lerp(1, sm(p.yN, lo, hi), side);
}

interface Cut {
  /** Thickness on top, at the front, the sides and the back (below `cut`), cm. */
  top: number;
  front?: number;
  side: number;
  back?: number;
  cut?: number;
  soft?: number;
  fade?: Fade;
  /** A skin fade (to bare skin) rather than a clipper's shortest guard. */
  skin?: boolean;
  /** Parting: azimuth (degrees: + the head's left), how deep. */
  part?: number;
  partDepth?: number;
  /** A shaved line along the part. */
  hardPart?: boolean;
  /** Lift at the front (cm up and forward: a quiff, a pompadour); off to one side by `liftAz`. */
  up?: number;
  fwd?: number;
  liftAz?: number;
  liftW?: number;
  /** Swept towards the part's other side (cm) above it. */
  sweep?: number;
  /** Texture: curls (cm, frequency), spiky tufts (cm). */
  curl?: number;
  curlFreq?: number;
  tufts?: number;
  /** A fringe down to yN `to`, `width` degrees either side, swept by `fsweep`. */
  fringe?: [number, number, number?];
  /** Hairline offsets: the front's recession, the temples' (an M), the nape. */
  recede?: number;
  temple?: number;
  nape?: number;
  ears?: boolean;
  feather?: number;
  /** Fraction of the surface with hair (thinning). */
  dens?: (p: ScalpPt) => number;
  /** Where it grows at all (a horseshoe, a mohawk strip): multiplies the coverage. */
  mask?: (p: ScalpPt) => number;
}

/** A fringe: the hairline brought down to `to` (yN) across the forehead. */
const fringeAt = (p: ScalpPt, to: number, width = 46, sweep = 0) => {
  const w = sm(Math.abs(p.az - sweep * 10), width, width - 14) * (p.a < 90 ? 1 : 0);
  const edge = to + sweep * 0.0015 * p.az;
  return w * sm(p.yN, edge - 0.03, edge + 0.03);
};

/** A short-to-medium cut from its parameters (a whole family: crops, fades, side parts, slick backs...). */
function cut(c: Cut): (p: ScalpPt) => ScalpOut {
  return (p) => {
    const g = c.fade ? fadeAt(p, c.fade) : 1;
    let t = zones(p, c.top, c.front ?? c.top * 0.9, c.side, c.back ?? c.side, c.cut ?? 0.62, c.soft ?? 0.1);
    // Faded: the length goes down with the growth (to a stubble's 0.15 cm, or nothing).
    if (c.fade) t = lerp(c.skin ? 0.05 : 0.18, t, g ** 1.3);
    if (c.curl) t += c.curl * hairCurls(p, c.curlFreq ?? 10) * sm(g, 0.3, 0.8);
    if (c.tufts) t += c.tufts * Math.max(0, hairNoise(p, 8, 1.7) * 1.6 - 0.45) ** 1.6 * sm(g, 0.4, 0.9);
    if (c.part !== undefined && p.a < 110 && p.yN > 0.55) t *= 1 - (c.partDepth ?? 0.45) * gauss(p.az - c.part, 5);
    const line = hairline(p, { front: c.recede, temple: c.temple, nape: c.nape, ears: c.ears, feather: c.feather });
    let cov = line;
    let fwd = 0;
    if (c.fringe) {
      const fr = fringeAt(p, c.fringe[0], c.fringe[1], c.fringe[2] ?? 0);
      cov = Math.max(cov, fr);
      fwd = 0.45 * fr;
    }
    if (c.mask) cov *= c.mask(p);
    // The geometry stops where the fade is down to stubble; below that it is drawn on the scalp (shade).
    // Down the fade the hair thins out (stipple, translucent) over the shading on the scalp under it.
    const shell = c.fade ? sm(g, 0.08, 0.3) : 1;
    let shade = c.fade ? line * (c.skin ? sm(g, 0.0, 0.5) : 0.45 + 0.55 * sm(g, 0, 0.5)) * (c.mask ? c.mask(p) : 1) : 0;
    if (c.hardPart && c.part !== undefined && p.a < 100 && p.yN > 0.6) {
      const gap = gauss(p.az - c.part, 2.2);
      cov *= 1 - gap;
      shade *= 1 - gap;
    }
    const lift = c.up || c.fwd ? gauss(p.az - (c.liftAz ?? 0), c.liftW ?? 42) * sm(p.yN, 0.55, 0.78) * (1 - 0.6 * sm(p.yN, 0.86, 1)) : 0;
    t += lift * (c.up ?? 0) * 0.6;
    const sweep = c.sweep && c.part !== undefined && p.yN > 0.55 ? c.sweep * Math.sign(c.part) * -1 * sm(p.yN, 0.55, 0.85) * (Math.sign(p.az - c.part) === Math.sign(c.part) ? 0.2 : 1) : 0;
    return {
      t,
      cov: cov * shell,
      dens: (c.dens ? c.dens(p) : 1) * (c.fade ? 0.2 + 0.8 * sm(g, 0.15, 0.7) : 1),
      up: lift * (c.up ?? 0),
      fwd: lift * (c.fwd ?? 0) + fwd,
      side: sweep,
      shade,
    };
  };
}

/** A shaved shadow following a cut's own fade (the stipple of the short growth up close). */
const fadeShadow = (kind: Fade, skin: boolean) => (p: ScalpPt) => {
  const g = fadeAt(p, kind);
  return g > 0.98 ? 0 : (skin ? sm(g, 0.0, 0.6) : 0.45 + 0.55 * sm(g, 0, 0.6)) * 0.75;
};

/** A cut with its fade's shadow. */
const faded = (c: Cut, o: Partial<HairSpec> = {}): HairSpec => ({ shell: cut(c), ...(c.fade ? { shadow: fadeShadow(c.fade, !!c.skin) } : {}), ...o });

const side = (a: number, from: number, to: number, len: number) => len * sm(a, from, to);
function drape(len: number, sideLen: number, o: Partial<DrapeSpec> = {}): DrapeSpec {
  return { el: -4, len: (a) => (a < 52 ? 0 : a < 95 ? side(a, 52, 80, sideLen) : lerp(sideLen, len, sm(a, 95, 150))), flare: 0.4, ...o };
}

// ── Locs, twists and box braids ──────────────────────────────────────────────

/**
 * Many ropes from all over the scalp: each lies back over the skull from its root (the front ones swept back and
 * to the sides, off the face) to `hang` (yN) and then falls `len` cm, a little splayed. `n` of them on a jittered
 * spiral (even cover), `r` cm thick.
 */
function ropes(f: Frame, o: { n: number; len: number; r: number; kind: 'lock' | 'braid'; hang?: number; splay?: number; seed?: number; tie?: boolean; lenVar?: number }): TailSpec[] {
  const out: TailSpec[] = [];
  const hangY = o.hang ?? f.earTop - 0.02;
  const golden = 137.508;
  // (Thin ropes: few sides and segments; ~190 triangles each.)
  for (let i = 0; i < o.n; i++) {
    const u = (i + 0.5) / o.n;
    const az0 = ((i * golden + (o.seed ?? 0) * 31) % 360) - 180;
    // Roots from the crown down to just inside the hairline (the front's a little further back).
    const a = Math.abs(az0);
    const lowest = a < 60 ? f.front + 0.1 : a < 70 ? f.front - 0.03 : a < 130 ? f.earTop + 0.1 : f.earBot + 0.1;
    const yN = lerp(0.98, lowest, Math.sqrt(u));
    // The front ones go back past the temple; the back ones straight down.
    const sx = Math.sign(az0 || 1);
    // The front ones go up and back first (off the face), then down past the temple; the back ones straight down.
    // The front ones are pulled back over the crown and hang behind; the rest fall where they grow.
    const azTo = a < 60 ? sx * lerp(165, 135, a / 60) : az0;
    const via: [number, number][] = a < 60 ? [[az0 * 0.6, 0.97], [sx * lerp(140, 110, a / 60), 0.9]] : [];
    const to = a < 60 ? f.earBot + 0.12 : Math.min(yN - 0.02, a < 130 ? hangY : lerp(hangY, f.earBot - 0.08, sm(a, 130, 170)));
    const len = o.len * (1 - (o.lenVar ?? 0.15) * ((i * 0.618) % 1));
    const sp = (o.splay ?? 0.18) * len;
    const out1 = [Math.sin(D(azTo)) * sp * 0.4, -len * 0.45, Math.cos(D(azTo)) * sp * 0.4] as [number, number, number];
    const out2 = [Math.sin(D(azTo)) * sp, -len, Math.cos(D(azTo)) * sp] as [number, number, number];
    out.push({
      kind: o.kind,
      az: az0,
      yN,
      follow: { to, azTo, out: 0.35 + o.r * 0.6, via },
      path: len > 0 ? [out1, out2] : [],
      r: (s) => o.r * (s < 0.04 ? 0.8 : 1 - 0.25 * s),
      ring: 5,
      segs: Math.max(8, Math.round(6 + len / 2.5)),
      ...(o.tie ? { ties: [0.97] } : {}),
    });
  }
  return out;
}

/** A bundle of ropes gathered into one (a loc or braid ponytail, a bun of them): a thick tube textured as one. */
const ropeTail = (yN: number, len: number, r: number, kind: TailSpec['kind'] = 'lock'): TailSpec => ({
  kind,
  az: 180,
  yN,
  path: [[0, 0.6, -2.4], [0, -len * 0.3, -3.6], [0, -len * 0.7, -3.4], [0, -len, -2.6]],
  r: (s) => (s < 0.06 ? r * 0.55 : r * (1 - 0.35 * s) + 0.3),
  ties: [0.05],
});

// ── Cornrows and waves ───────────────────────────────────────────────────────

/** Cornrows straight back: `rows` raised plaits over the head, scalp showing in the parts between them. */
function cornrows(rows: number, h = 0.7): (p: ScalpPt) => ScalpOut {
  return (p) => {
    // Each plait runs from the forehead back over the crown (or along the side) to the nape: planes through an
    // axis from low on the forehead to low on the nape, fanning a little at each end (as real rows converge).
    const ax = 0.35 / Math.hypot(0.35, 1);
    const az_ = 1 / Math.hypot(0.35, 1);
    const yy = (p.d.y * az_ - p.d.z * ax);
    const th = Math.atan2(p.d.x, yy);
    const along = Math.acos(THREE.MathUtils.clamp(p.d.y * ax + p.d.z * az_, -1, 1));
    const w = Math.cos(th * rows) * 0.5 + 0.5;
    const ridge = sm(w, 0.1, 0.7);
    const cross = 0.8 + 0.2 * Math.abs(Math.sin(along * 24 + (Math.round((th * rows) / Math.PI) % 2) * 1.57));
    const line = hairline(p, { feather: 0.04 });
    return { t: h * ridge ** 0.6 * cross, cov: line * sm(w, 0.06, 0.3), shade: line * 0.45 };
  };
}

/** 360 waves: a short brushed cut rippling out from the crown. */
const waves = (p: ScalpPt): ScalpOut => {
  const from = Math.acos(THREE.MathUtils.clamp(p.d.y, -1, 1));
  const r = Math.sin(from * 46 + p.az * 0.035 + hairNoise(p, 3) * 2);
  return { t: 0.32 + 0.1 * r, cov: hairline(p, { feather: 0.04 }), dens: 0.96 };
};

/** Under box braids and twists: the plaited roots, a low even layer (the ropes over it carry the look). */
const braidBase = (p: ScalpPt): ScalpOut => ({ t: 0.55 + 0.15 * hairCurls(p, 16), cov: hairline(p, { feather: 0.05 }) });

// ── Curl types ───────────────────────────────────────────────────────────────

/**
 * Curly hair by its type (the 1–4 / A–C scale): 2 waves (A loose S-bends, C deep ones that frizz), 3 curls (A
 * loose ringlets, C tight corkscrews), 4 coils (A springy, C tight zig-zags that shrink, so the hair stands as a
 * mass more than it hangs). Length is the drape's, before shrinkage.
 */
function curlType(type: '2a' | '2b' | '2c' | '3a' | '3b' | '3c' | '4a' | '4b' | '4c', len: number, partAz = 18): HairSpec {
  const k = { '2a': 0, '2b': 1, '2c': 2, '3a': 3, '3b': 4, '3c': 5, '4a': 6, '4b': 7, '4c': 8 }[type];
  if (k >= 6) {
    // Coils: a rounded mass (shrinkage), knobbly at the coils' scale, fuller the longer.
    const vol = 1.6 + len * 0.22;
    return {
      shell: (p) => ({
        t: zones(p, vol * 1.15, vol * 0.75, vol * 0.95, vol, 0.5, 0.3) - 0.8 * sm(p.yN, 0.35, -0.1) + (0.55 + 0.1 * (k - 6)) * hairCurls(p, 12 + (k - 6) * 5) + 0.3 * hairCurls(p, 26),
        cov: hairline(p, { ears: len > 8, nape: -0.26 }),
      }),
    };
  }
  const flare = [0.5, 0.7, 1.0, 1.3, 1.6, 1.9][k]!;
  const wave: [number, number] = [[0.45, 11], [0.6, 8], [0.8, 6], [0.7, 4.5], [0.65, 3.6], [0.55, 2.8]][k]! as [number, number];
  const curl = [0.1, 0.25, 0.45, 0.7, 0.9, 1.1][k]!;
  const vol = [1.4, 1.6, 1.9, 2.3, 2.6, 2.9][k]!;
  return {
    shell: (p) => ({
      t: zones(p, vol, vol * 0.9, vol * 0.85, vol * 0.95, 0.55) * (1 - 0.35 * gauss(p.az - partAz, 5) * (p.yN > 0.55 && p.a < 100 ? 1 : 0)) + (k >= 3 ? 0.45 * hairCurls(p, 9 + k) : 0.15 * hairCurls(p, 7)),
      cov: hairline(p, { ears: true }),
    }),
    drape: drape(len * (1 - k * 0.06), len * 0.8 * (1 - k * 0.06), { flare, wave, curl, tuck: k >= 4 ? 0.6 : 0 }),
  };
}

// ── The catalogue ────────────────────────────────────────────────────────────

const tube = (t: TailSpec) => t;

export const HAIR_CATALOG: Record<string, HairSpec> = {
  // Fades and tapers.
  lowfade: faded({ top: 1.7, front: 1.6, side: 1.0, back: 1.1, fade: 'low', skin: true, part: 24, partDepth: 0.3 }),
  midfade: faded({ top: 1.9, front: 1.8, side: 0.9, fade: 'mid', skin: true, tufts: 0.4 }),
  skinfade: faded({ top: 2.3, front: 2.2, side: 0.8, fade: 'high', skin: true, tufts: 0.7, curl: 0.25, curlFreq: 12 }),
  taper: faded({ top: 1.8, front: 1.7, side: 0.9, back: 0.9, fade: 'taper', part: 26, partDepth: 0.35, sweep: 0.5 }),
  buzzfade: faded({ top: 0.4, front: 0.38, side: 0.3, fade: 'mid', skin: true, feather: 0.04 }),
  hightight: faded({ top: 0.7, front: 0.65, side: 0.3, fade: 'high', skin: true, feather: 0.04 }),
  flattop: faded(
    { top: 0, side: 0.6, fade: 'high', skin: false },
    {
      shell: (p) => {
        const base = cut({ top: 0.8, side: 0.6, fade: 'high' })(p);
        // A level top: as thick as it takes to reach one height over the crown, squared off at the edges.
        const level = 1 + 2.4 / (p.f.span / p.f.cm);
        const flat = Math.max(0, (level - p.yN) * (p.f.span / p.f.cm)) * sm(p.yN, 0.7, 0.8) * sm(p.a, 170, 160);
        return { ...base, t: Math.max(base.t, Math.min(flat, 3.4) * fadeAt(p, 'high') ** 2) };
      },
    },
  ),
  frenchcrop: faded({ top: 1.5, front: 1.4, side: 0.8, fade: 'mid', skin: true, fringe: [0.66, 52], tufts: 0.45, feather: 0.04 }),
  texcrop: faded({ top: 2.0, front: 1.8, side: 0.7, fade: 'high', skin: true, fringe: [0.68, 46, -1], tufts: 1.0, curl: 0.3, curlFreq: 14 }),
  slickfade: faded({ top: 2.4, front: 2.4, side: 0.8, fade: 'high', skin: false, cut: 0.66, up: 0.7, fwd: -0.6, liftW: 60 }),
  hardpart: faded({ top: 2.0, front: 2.0, side: 0.8, fade: 'mid', skin: true, part: 32, partDepth: 0.5, hardPart: true, sweep: 1.2, up: 0.6, liftAz: -10 }),
  combover: faded({ top: 2.2, front: 2.1, side: 1.0, fade: 'taper', part: 34, partDepth: 0.5, sweep: 1.8, up: 0.4, liftAz: -12 }),
  curlfade: faded({ top: 3.0, front: 2.6, side: 0.6, fade: 'mid', skin: true, curl: 0.7, curlFreq: 13 }),
  afrofade: faded({ top: 3.4, front: 2.6, side: 1.2, back: 1.2, fade: 'low', skin: true, curl: 0.55, curlFreq: 14, cut: 0.55, soft: 0.2 }),
  longtop: faded({ top: 3.6, front: 3.4, side: 0.5, fade: 'high', skin: true, part: -30, partDepth: 0.4, sweep: 2.4, up: 0.8, liftAz: 10, cut: 0.7 }),
  waves: { shell: waves },
  receding: faded({ top: 1.5, front: 1.3, side: 0.9, back: 1.0, recede: 0.07, temple: 0.1, fade: 'taper', part: 26, partDepth: 0.3 }),
  thinning: faded({
    top: 1.4,
    front: 1.1,
    side: 0.9,
    back: 1.0,
    recede: 0.05,
    temple: 0.08,
    fade: 'taper',
    // The crown thins (scalp through it) and the front too.
    dens: (p) => 1 - 0.5 * sm(p.yN, 0.86, 0.97) * sm(p.a, 90, 140) - 0.3 * sm(p.yN, p.f.front - 0.06, p.f.front + 0.04) * sm(p.a, 60, 20),
  }),
  horseshoe: faded(
    {
      top: 0.6,
      side: 0.6,
      back: 0.7,
      fade: 'taper',
      // A fringe of hair round the sides and back only; the top bald.
      mask: (p) => sm(p.yN, p.f.earTop + 0.32 + 0.14 * sm(p.a, 110, 175), p.f.earTop + 0.2 + 0.14 * sm(p.a, 110, 175)) * sm(p.a, 50, 72),
    },
  ),
  fauxhawk: faded(
    { top: 1.0, side: 0.5, fade: 'mid', skin: true },
    {
      shell: (p) => {
        const base = cut({ top: 1.0, front: 1.0, side: 0.5, fade: 'mid', skin: true, tufts: 0.6 })(p);
        // A strip down the middle swept up into a ridge (the sides faded, not shaved).
        const strip = sm(Math.abs(p.xN), 0.5, 0.25) * sm(p.yN, 0.6, 0.8) * sm(p.a, 150, 110);
        return { ...base, t: base.t + 2.2 * strip, up: 1.2 * strip * sm(p.a, 80, 0), fwd: 0.3 * strip * sm(p.a, 60, 0) };
      },
    },
  ),
  bunundercut: faded(
    { top: 1.4, front: 1.3, side: 0.5, fade: 'high', skin: true, cut: 0.7 },
    { tails: [tube({ kind: 'bun', az: 180, yN: 0.9, path: [[0, 1.4, -1.6]], r: () => 2.4 })] },
  ),
  // Medium and long, straight to wavy.
  surfer: { shell: cut({ top: 2.6, front: 2.4, side: 2.0, back: 2.2, tufts: 0.9, curl: 0.4, curlFreq: 9, fringe: [0.5, 40, 1], ears: true }), drape: drape(9, 7, { flare: 0.9, wave: [0.5, 6], curl: 0.5 }) },
  curtains: {
    shell: (p) => {
      const base = cut({ top: 2.6, front: 2.8, side: 1.6, back: 1.7, part: 0, partDepth: 0.6, tufts: 0.3 })(p);
      // Curtained: from a centre part the front falls to either side over the forehead's corners.
      const fr = sm(p.a, 5, 12) * sm(p.a, 58, 44) * sm(p.yN, 0.56 + 0.002 * p.a - 0.03, 0.56 + 0.002 * p.a + 0.03);
      return { ...base, cov: Math.max(base.cov, fr), fwd: 0.5 * fr, side: 0.9 * fr * Math.sign(p.az) };
    },
  },
  mullet: { shell: cut({ top: 2.0, front: 1.8, side: 0.9, back: 1.6, tufts: 0.5, fade: 'taper' }), drape: { el: -6, len: (a) => side(a, 115, 155, 13), flare: 0.5, wave: [0.3, 7] } },
  wolf: { shell: cut({ top: 2.6, front: 2.2, side: 2.0, back: 2.2, tufts: 1.1, curl: 0.35, curlFreq: 11, fringe: [0.5, 40], ears: true }), drape: drape(16, 11, { flare: 1.1, wave: [0.4, 7], curl: 0.6 }) },
  // Women's short.
  pixielong: { shell: cut({ top: 2.3, front: 2.2, side: 1.2, back: 1.0, part: 30, partDepth: 0.4, sweep: 1.4, fringe: [0.5, 50, -1.4], tufts: 0.4 }) },
  pixieundercut: faded({ top: 2.4, front: 2.4, side: 0.4, fade: 'mid', skin: false, part: 34, partDepth: 0.4, sweep: 1.6, fringe: [0.5, 46, -1.4], cut: 0.7 }),
  // Bobs.
  abob: {
    shell: cut({ top: 1.8, front: 1.6, side: 1.5, back: 1.3, part: 22, partDepth: 0.4, ears: true }),
    // Short at the nape, longer towards the face.
    drape: { el: -2, len: (a) => (a < 54 ? 0 : lerp(14, 5, sm(a, 70, 175)) * sm(a, 54, 70)), flare: 0.8, tuck: 0.8 },
  },
  bobwavy: { shell: cut({ top: 2.0, front: 1.8, side: 1.7, back: 1.8, part: 20, partDepth: 0.35, ears: true, curl: 0.2 }), drape: { el: -2, len: (a) => (a < 54 ? 0 : side(a, 54, 78, 9)), flare: 1.3, wave: [0.6, 5], curl: 0.3 } },
  bobcurly: { shell: cut({ top: 2.8, front: 2.4, side: 2.4, back: 2.6, curl: 0.6, curlFreq: 11, ears: true }), drape: { el: -2, len: (a) => (a < 54 ? 0 : side(a, 54, 78, 8)), flare: 1.9, wave: [0.6, 3.4], curl: 1.0, tuck: 0.5 } },
  lobwavy: { shell: cut({ top: 1.8, front: 1.6, side: 1.5, back: 1.6, part: -24, partDepth: 0.4, ears: true }), drape: { el: -3, len: (a) => (a < 52 ? 0 : side(a, 52, 78, 16)), flare: 1.0, wave: [0.7, 6], curl: 0.25 } },
  // Long.
  layers: { shell: cut({ top: 1.9, front: 1.7, side: 1.5, back: 1.6, part: 20, partDepth: 0.4, ears: true, tufts: 0.3 }), drape: drape(30, 18, { flare: 0.9, wave: [0.35, 9], curl: 0.35 }) },
  sideswept: {
    shell: cut({ top: 1.7, front: 1.7, side: 1.4, back: 1.5, part: 42, partDepth: 0.5, ears: true, sweep: 1.6, fringe: [0.52, 52, -1.6] }),
    drape: { el: -4, len: (a, az) => (a < 52 ? 0 : a < 95 ? side(a, 52, 80, az < 0 ? 26 : 22) : lerp(az < 0 ? 26 : 22, 28, sm(a, 95, 150))), flare: 0.5, wave: [0.3, 9] },
  },
  curtainbangs: {
    shell: (p) => {
      const base = cut({ top: 1.6, front: 1.5, side: 1.4, back: 1.5, part: 0, partDepth: 0.5, ears: true })(p);
      const fr = sm(p.a, 5, 12) * sm(p.a, 64, 50) * sm(p.yN, 0.44 + 0.003 * p.a - 0.03, 0.44 + 0.003 * p.a + 0.03);
      return { ...base, cov: Math.max(base.cov, fr), fwd: 0.6 * fr, side: 0.6 * fr * Math.sign(p.az) };
    },
    drape: drape(28, 22, { flare: 0.5, wave: [0.25, 9] }),
  },
  // Curl types (the 1–4 / A–C scale).
  wave2a: curlType('2a', 28),
  wave2c: curlType('2c', 24, -20),
  curl3a: curlType('3a', 22),
  curl3c: curlType('3c', 16, 0),
  coil4a: curlType('4a', 10),
  coil4c: curlType('4c', 6),
  twa: { shell: (p) => ({ t: zones(p, 1.5, 1.1, 1.1, 1.2, 0.55, 0.2) + 0.45 * hairCurls(p, 20) + 0.2 * hairCurls(p, 34), cov: hairline(p, { feather: 0.05 }) }) },
  twists: faded({ top: 2.4, front: 2.0, side: 0.6, fade: 'low', skin: false, curl: 1.0, curlFreq: 20, cut: 0.55, soft: 0.2 }),
  // Afro puffs: pulled back smooth into a round puff (or two).
  puff: {
    shell: (p) => ({ t: zones(p, 0.7, 0.6, 0.6, 0.7, 0.55) + 0.12 * hairCurls(p, 22), cov: hairline(p, { feather: 0.05 }) }),
    tails: [tube({ kind: 'bun', az: 180, yN: 0.94, path: [[0, 2.6, -2.2]], r: () => 4.6, bump: 0.7 })],
  },
  puffs: {
    shell: (p) => ({ t: zones(p, 0.7, 0.6, 0.6, 0.7, 0.55) * (1 - 0.5 * gauss(p.az, 4) * (p.yN > 0.6 ? 1 : 0)) + 0.12 * hairCurls(p, 22), cov: hairline(p, { feather: 0.05 }) }),
    tails: [1, -1].map((sx) => tube({ kind: 'bun', az: sx * 120, yN: 0.94, path: [[sx * 2.2, 2.0, -0.6]], r: () => 3.6, bump: 0.6 })),
  },
  // Cornrows, braids, locs.
  cornrows: { shell: cornrows(11) },
  cornrowsbraids: {
    shell: cornrows(9),
    tails: (f) => ropes(f, { n: 9, len: 30, r: 0.55, kind: 'braid', hang: f.earBot - 0.12, seed: 3, splay: 0.08, tie: true }).map((t, i) => ({ ...t, az: 180 + (i - 4) * 9, yN: f.earBot - 0.1, follow: undefined, path: [[(i - 4) * 0.6, -6, -1.6], [(i - 4) * 0.9, -18, -1.2], [(i - 4) * 1.1, -30, -0.6]] })),
  },
  boxbraids: { shell: braidBase, tails: (f) => ropes(f, { n: 30, len: 34, r: 0.58, kind: 'braid', splay: 0.12, tie: true }) },
  boxbob: { shell: braidBase, tails: (f) => ropes(f, { n: 34, len: 11, r: 0.52, kind: 'braid', splay: 0.22, hang: f.earTop + 0.06 }) },
  braidspony: {
    shell: cornrows(13, 0.55),
    tails: (f) => [
      ropeTail(f.earTop + 0.3, 30, 2.6, 'braid'),
      ...ropes(f, { n: 10, len: 26, r: 0.48, kind: 'braid', splay: 0.05, seed: 7 }).map((t, i) => ({ ...t, az: 180 + (i - 4.5) * 7, yN: f.earTop + 0.28, follow: undefined, path: [[(i - 4.5) * 0.5, 0, -3], [(i - 4.5) * 0.7, -12, -3.8], [(i - 4.5) * 0.9, -26, -3]] as [number, number, number][] })),
    ],
  },
  twistslong: { shell: braidBase, tails: (f) => ropes(f, { n: 31, len: 26, r: 0.63, kind: 'lock', splay: 0.15 }) },
  locsshort: { shell: (p) => ({ t: 0.7 + 0.2 * hairCurls(p, 18), cov: hairline(p, { feather: 0.05 }) }), tails: (f) => ropes(f, { n: 36, len: 7, r: 0.65, kind: 'lock', splay: 0.22, hang: f.earTop + 0.2, lenVar: 0.3 }) },
  locs: { shell: (p) => ({ t: 0.8 + 0.2 * hairCurls(p, 18), cov: hairline(p, { feather: 0.05 }) }), tails: (f) => ropes(f, { n: 31, len: 28, r: 0.78, kind: 'lock', splay: 0.14, lenVar: 0.2 }) },
  locstied: {
    shell: (p) => ({ t: 0.9 + 0.35 * Math.max(0, Math.cos(Math.atan2(p.d.x, p.d.y) * 12)) + 0.15 * hairCurls(p, 18), cov: hairline(p, { feather: 0.05 }) }),
    tails: (f) => [ropeTail(f.earTop + 0.32, 24, 3.0, 'lock'), ...ropes(f, { n: 8, len: 22, r: 0.7, kind: 'lock', splay: 0.05, seed: 5 }).map((t, i) => ({ ...t, az: 180 + (i - 3.5) * 9, yN: f.earTop + 0.3, follow: undefined, path: [[(i - 3.5) * 0.7, 0, -3.2], [(i - 3.5) * 1.0, -10, -4], [(i - 3.5) * 1.2, -22, -3]] as [number, number, number][] }))],
  },
  // Tied.
  sidepony: {
    shell: (p) => ({ t: zones(p, 1.0, 1.1, 0.8, 0.9, 0.55) * (1 - 0.4 * gauss(p.az - 30, 5) * (p.yN > 0.6 ? 1 : 0)), cov: hairline(p), side: -0.3 * sm(p.yN, 0.5, 0.8) }),
    tails: (f) => [tube({ kind: 'tube', az: -128, yN: f.earBot + 0.02, path: [[-1.4, -2, -0.6], [-2.2, -8, 1.4], [-2.0, -18, 3.0], [-1.6, -26, 3.6]], r: (s) => (s < 0.05 ? 1.1 : 2.2 * (1 - 0.6 * s) + 0.3), ties: [0.04] })],
  },
  ponybangs: {
    shell: (p) => {
      const fr = fringeAt(p, 0.4, 48);
      return { t: zones(p, 0.9, 1.3, 0.8, 0.9, 0.55), cov: Math.max(hairline(p), fr), fwd: 0.45 * fr };
    },
    tails: [tube({ kind: 'tube', az: 180, yN: 0.62, path: [[0, 1.0, -2.6], [0, -3, -4.4], [0, -11, -4.0], [0, -22, -3.2]], r: (s) => (s < 0.05 ? 1.1 : 2.3 * (1 - 0.7 * s) + 0.3), ties: [0.03] })],
  },
  bubblepony: {
    shell: (p) => ({ t: zones(p, 0.9, 1.0, 0.8, 0.9, 0.55), cov: hairline(p) }),
    tails: [tube({ kind: 'tube', az: 180, yN: 0.66, path: [[0, 1.2, -2.6], [0, -4, -4.4], [0, -12, -4.0], [0, -22, -3.2]], r: (s) => (s < 0.04 ? 1.1 : (2.1 + 0.7 * Math.sin(s * Math.PI * 4) ** 2) * (1 - 0.4 * s)), ties: [0.03, 0.25, 0.5, 0.75] })],
  },
  frenchbraid: {
    shell: (p) => ({ t: zones(p, 0.9, 1.0, 0.8, 0.9, 0.55) * (1 + 0.3 * gauss(p.az, 30) * sm(p.yN, 0.5, 0.8)), cov: hairline(p), side: 0 }),
    tails: (f) => [tube({ kind: 'braid', az: 0, yN: f.front - 0.02, follow: { to: f.earBot + 0.02, azTo: 180, out: 0.6, via: [[0, 0.92], [180, 0.85]] }, path: [[0, -6, -1.4], [0, -16, -1.2], [0, -22, -0.8]], r: (s) => (s < 0.04 ? 0.7 : s < 0.5 ? 1.1 + 0.6 * s : 1.4 * (1 - 0.3 * (s - 0.5))), ties: [0.96], segs: 60, ring: 14 })],
  },
  dutchbraids: {
    shell: (p) => ({ t: zones(p, 0.9, 1.0, 0.8, 0.9, 0.55) * (1 - 0.5 * gauss(p.az, 4) * (p.yN > 0.6 && p.a < 100 ? 1 : 0)), cov: hairline(p) }),
    tails: (f) =>
      [1, -1].map((sx) =>
        tube({ kind: 'braid', az: sx * 22, yN: f.front - 0.02, follow: { to: f.earBot + 0.0, azTo: sx * 158, out: 0.7, via: [[sx * 30, 0.92], [sx * 130, 0.78]] }, path: [[sx * 0.6, -5, 0.4], [sx * 1.0, -14, 1.4], [sx * 1.0, -20, 1.8]], r: (s) => (s < 0.03 ? 0.6 : s < 0.55 ? 0.9 + 0.5 * s : 1.1 * (1 - 0.3 * (s - 0.55))), ties: [0.96], segs: 60, ring: 14 }),
      ),
  },
  sidebraid: {
    shell: (p) => ({ t: zones(p, 1.1, 1.2, 1.0, 1.0, 0.55) * (1 - 0.4 * gauss(p.az - 26, 5) * (p.yN > 0.6 ? 1 : 0)), cov: hairline(p), side: -0.4 * sm(p.yN, 0.4, 0.8) * sm(p.a, 40, 140) }),
    tails: (f) => [tube({ kind: 'braid', az: -110, yN: f.earBot - 0.02, path: [[-1.2, -3, 1.4], [-1.0, -10, 4.2], [-0.4, -20, 5.4], [0, -28, 5.2]], r: (s) => (s < 0.04 ? 1.2 : 1.8 * (1 - 0.4 * s)), ties: [0.94] })],
  },
  crownbraid: {
    shell: (p) => ({ t: zones(p, 0.9, 1.0, 0.8, 0.9, 0.55), cov: hairline(p) }),
    tails: (f) => [tube({ kind: 'braid', az: -178, yN: f.earTop + 0.36, follow: { to: f.earTop + 0.36, azTo: 178, out: 0.55, via: [[-90, f.earTop + 0.34], [0, f.front + 0.06], [90, f.earTop + 0.34]] }, path: [], r: () => 1.25, segs: 80, ring: 12 })],
  },
  messybun: {
    shell: (p) => ({ t: zones(p, 1.1, 1.2, 0.9, 1.0, 0.55) + 0.25 * Math.max(0, hairNoise(p, 9) * 1.6 - 0.5), cov: hairline(p) }),
    tails: [tube({ kind: 'bun', az: 180, yN: 0.97, path: [[0, 2.4, -1.4]], r: () => 3.3, bump: 0.9 })],
  },
  ballerina: {
    shell: (p) => ({ t: zones(p, 0.7, 0.8, 0.6, 0.7, 0.55), cov: hairline(p, { feather: 0.05 }) }),
    tails: [tube({ kind: 'bun', az: 180, yN: 0.93, path: [[0, 2.0, -1.6]], r: () => 2.7 })],
  },
  halfup: {
    shell: cut({ top: 1.5, front: 1.4, side: 1.3, back: 1.4, part: 20, partDepth: 0.4, ears: true }),
    drape: drape(22, 18, { flare: 0.5, wave: [0.3, 9] }),
    tails: [tube({ kind: 'bun', az: 180, yN: 0.84, path: [[0, 0.6, -1.8]], r: () => 2.0 })],
  },
};
