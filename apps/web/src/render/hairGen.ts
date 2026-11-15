import * as THREE from 'three';
import { patchWorldMaterial, type WorldUniforms } from './patches';

/**
 * Procedural hair and facial hair, built on the body's own head so it follows the skull, and skinned to the body's
 * skeleton (the head bone; anything hanging below it blends into the neck and back like the skin it lies on), so
 * the body-shape displacement (bodyShape.ts shapeMesh) moves it with the face and skull it sits on.
 *
 * Scalp hair is a shell over a smoothed copy of the skull: rays from inside the head (so the ears and the face's
 * features are ignored) give the skull's radius in each direction on a latitude/longitude grid; each style says,
 * per direction, how thick the hair is there and whether it grows there (its hairline). Long hair hangs from a
 * ring round the head (the drape), pushed clear of the body; ponytails, braids and buns are tubes and balls.
 * Facial hair is the face's own surface lifted along its normals by a per-style mask.
 *
 * Units: a head is ~0.2 model units wide; styles are written in centimetres of a 15 cm wide head (Frame.cm).
 */

// ── Head measurement ─────────────────────────────────────────────────────────

const NA = 72; // columns round the head (5°)
const DEL = 2.5; // degrees per skull row
const NE = 69; // skull rows: 90° (crown) down to -80°
const ND = 90; // drape rows at most

export interface Frame {
  c: THREE.Vector3;
  W: number;
  cm: number;
  tipY: number;
  topY: number;
  span: number;
  /** Landmarks in yN (0 at the nose tip, 1 at the crown): the front hairline, the top and bottom of the ears. */
  front: number;
  earTop: number;
  earBot: number;
  R: Float32Array;
  head: number;
  /** Body vertices (head, neck, torso, arms near the shoulders) for collisions and skin weights. */
  pts: Float32Array;
  nrm: Float32Array;
  wIdx: Uint16Array;
  wVal: Float32Array;
  headPts: number;
  body: THREE.BufferGeometry;
  sex: 'm' | 'f';
}

const FRAMES = new WeakMap<THREE.BufferGeometry, Frame>();

const dir = (azDeg: number, elDeg: number, out = new THREE.Vector3()) => {
  const a = THREE.MathUtils.degToRad(azDeg);
  const e = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
};

function dominant(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, i: number): number {
  let best = 0;
  let bw = -1;
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (w > bw) (bw = w), (best = si.getComponent(i, k));
  }
  return best;
}

export function headFrame(body: THREE.SkinnedMesh, sex: 'm' | 'f'): Frame | null {
  const geo = (body.userData.neutralGeo as THREE.BufferGeometry | undefined) ?? body.geometry;
  const hit = FRAMES.get(geo);
  if (hit) return hit;
  const bones = body.skeleton.bones;
  const head = bones.findIndex((b) => /^head$/i.test(b.name));
  if (head < 0 || !geo.index) return null;
  const neck = new Set(bones.map((b, i) => (/^neck/i.test(b.name) ? i : -1)).filter((i) => i >= 0));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrmA = geo.attributes.normal as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const dom = new Int32Array(pos.count);
  let topY = -Infinity;
  let tipZ = -Infinity;
  let tipY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    dom[i] = dominant(si, sw, i);
    if (dom[i] !== head) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    topY = Math.max(topY, y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    if (z > tipZ) (tipZ = z), (tipY = y);
  }
  let backZ = Infinity;
  for (let i = 0; i < pos.count; i++) if (dom[i] === head && pos.getY(i) > tipY) backZ = Math.min(backZ, pos.getZ(i));
  const span = topY - tipY;
  const W = maxX - minX;
  const c = new THREE.Vector3(0, tipY + 0.42 * span, (backZ + tipZ) / 2 - 0.1 * (tipZ - backZ));
  // The head and neck surface, for rays from inside.
  const idx = geo.index;
  const tri: number[] = [];
  const isHead = (i: number) => dom[i] === head || neck.has(dom[i]!);
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const d = idx.getX(t + 2);
    if (!isHead(a) || !isHead(b) || !isHead(d)) continue;
    for (const v of [a, b, d]) tri.push(pos.getX(v), pos.getY(v), pos.getZ(v));
  }
  // Rays from the centre out; the nearest hit is the skull (ears and the nose stand outside it). Möller–Trumbore.
  const T = new Float32Array(tri);
  const nt = T.length / 9;
  const R = new Float32Array(NA * NE).fill(NaN);
  const d = new THREE.Vector3();
  for (let ie = 0; ie < NE; ie++)
    for (let ia = 0; ia < NA; ia++) {
      dir((ia / NA) * 360, 90 - ie * DEL, d);
      let best = Infinity;
      for (let t = 0; t < nt; t++) {
        const o = t * 9;
        const ax = T[o]!, ay = T[o + 1]!, az = T[o + 2]!;
        const e1x = T[o + 3]! - ax, e1y = T[o + 4]! - ay, e1z = T[o + 5]! - az;
        const e2x = T[o + 6]! - ax, e2y = T[o + 7]! - ay, e2z = T[o + 8]! - az;
        const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = c.x - ax, sy = c.y - ay, sz = c.z - az;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 1e-5 && dist < best) best = dist;
      }
      if (best < Infinity) R[ie * NA + ia] = best;
    }
  // Holes (eye sockets, the mouth): neighbours' average; then smooth a little.
  for (let pass = 0; pass < 40; pass++) {
    let left = 0;
    for (let ie = 0; ie < NE; ie++)
      for (let ia = 0; ia < NA; ia++) {
        const k = ie * NA + ia;
        if (!Number.isNaN(R[k]!)) continue;
        let s = 0;
        let n = 0;
        for (const [de, da] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const e = ie + de;
          if (e < 0 || e >= NE) continue;
          const v = R[e * NA + ((ia + da + NA) % NA)]!;
          if (!Number.isNaN(v)) (s += v), n++;
        }
        if (n) R[k] = s / n;
        else left++;
      }
    if (!left) break;
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = R.slice();
    for (let ie = 1; ie < NE - 1; ie++)
      for (let ia = 0; ia < NA; ia++) {
        let s = src[ie * NA + ia]! * 4;
        s += src[(ie - 1) * NA + ia]! + src[(ie + 1) * NA + ia]!;
        s += src[ie * NA + ((ia + 1) % NA)]! + src[ie * NA + ((ia + NA - 1) % NA)]!;
        R[ie * NA + ia] = s / 8;
      }
  }
  // Collision / weight points: the head first (headPts of them), then the neck, chest, back and shoulders.
  const pick: number[] = [];
  for (let i = 0; i < pos.count; i++) if (dom[i] === head) pick.push(i);
  const headPts = pick.length;
  const low = c.y - span * 3.2;
  for (let i = 0; i < pos.count; i++) if (dom[i] !== head && pos.getY(i) > low && Math.abs(pos.getX(i)) < W * 1.6) pick.push(i);
  const n = pick.length;
  const pts = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const wIdx = new Uint16Array(n * 4);
  const wVal = new Float32Array(n * 4);
  pick.forEach((v, j) => {
    pts.set([pos.getX(v), pos.getY(v), pos.getZ(v)], j * 3);
    nrm.set([nrmA.getX(v), nrmA.getY(v), nrmA.getZ(v)], j * 3);
    for (let k = 0; k < 4; k++) (wIdx[j * 4 + k] = si.getComponent(v, k)), (wVal[j * 4 + k] = sw.getComponent(v, k));
  });
  const L = sex === 'f' ? { front: 0.8, earTop: 0.41, earBot: -0.06 } : { front: 0.72, earTop: 0.47, earBot: 0.06 };
  const f: Frame = { c, W, cm: W / 15, tipY, topY, span, ...L, R, head, pts, nrm, wIdx, wVal, headPts, body: geo, sex };
  FRAMES.set(geo, f);
  return f;
}

/** Skull radius towards (az, el), bilinear on the grid. */
function radius(f: Frame, az: number, el: number): number {
  const fa = ((((az % 360) + 360) % 360) / 360) * NA;
  const fe = THREE.MathUtils.clamp((90 - el) / DEL, 0, NE - 1.001);
  const a0 = Math.floor(fa) % NA;
  const a1 = (a0 + 1) % NA;
  const e0 = Math.floor(fe);
  const ta = fa - Math.floor(fa);
  const te = fe - e0;
  const r = (e: number, a: number) => f.R[e * NA + a]!;
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(r(e0, a0), r(e0, a1), ta), THREE.MathUtils.lerp(r(e0 + 1, a0), r(e0 + 1, a1), ta), te);
}

/** Nearest body point (index into Frame.pts) to p; `headOnly` searches only the head's own. */
function nearest(f: Frame, p: THREE.Vector3, headOnly: boolean): number {
  const n = headOnly ? f.headPts : f.pts.length / 3;
  let best = 0;
  let bd = Infinity;
  const P = f.pts;
  for (let j = 0; j < n; j++) {
    const dx = P[j * 3]! - p.x;
    const dy = P[j * 3 + 1]! - p.y;
    const dz = P[j * 3 + 2]! - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) (bd = d), (best = j);
  }
  return best;
}

/** Push p out of the body to at least `margin` along the nearest point's normal. Returns that point. */
function clear(f: Frame, p: THREE.Vector3, margin: number, headOnly: boolean): number {
  let j = 0;
  for (let it = 0; it < 2; it++) {
    j = nearest(f, p, headOnly);
    const nx = f.nrm[j * 3]!;
    const ny = f.nrm[j * 3 + 1]!;
    const nz = f.nrm[j * 3 + 2]!;
    const s = (p.x - f.pts[j * 3]!) * nx + (p.y - f.pts[j * 3 + 1]!) * ny + (p.z - f.pts[j * 3 + 2]!) * nz;
    if (s >= margin) break;
    p.x += nx * (margin - s);
    p.y += ny * (margin - s);
    p.z += nz * (margin - s);
  }
  return j;
}

// ── Geometry buffer ──────────────────────────────────────────────────────────

class Buf {
  pos: number[] = [];
  st: number[] = [];
  hair: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  get n() {
    return this.pos.length / 3;
  }
  add(p: THREE.Vector3, across: number, along: number, edge: number, dens: number, tint: number, w: [number[], number[]]): number {
    this.pos.push(p.x, p.y, p.z);
    this.st.push(across, along);
    this.hair.push(edge, dens, tint);
    this.si.push(...w[0]);
    this.sw.push(...w[1]);
    return this.n - 1;
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aStrand', new THREE.Float32BufferAttribute(this.st, 2));
    g.setAttribute('aHair', new THREE.Float32BufferAttribute(this.hair, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Seams (where a ring closes, a ball's poles): average the normals of vertices at the same place, so the
    // surface shades as one smooth piece instead of showing its polygons.
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    for (const [a, b] of [[0, this.n] as [number, number]]) {
      const at = new Map<string, number[]>();
      for (let i = a; i < b; i++) {
        const k = `${Math.round(this.pos[i * 3]! * 1e5)},${Math.round(this.pos[i * 3 + 1]! * 1e5)},${Math.round(this.pos[i * 3 + 2]! * 1e5)}`;
        const l = at.get(k);
        if (l) l.push(i);
        else at.set(k, [i]);
      }
      const v = new THREE.Vector3();
      for (const l of at.values()) {
        if (l.length < 2) continue;
        v.set(0, 0, 0);
        for (const i of l) v.x += nrm.getX(i), v.y += nrm.getY(i), v.z += nrm.getZ(i);
        v.normalize();
        for (const i of l) nrm.setXYZ(i, v.x, v.y, v.z);
      }
    }
    g.computeBoundingSphere();
    return g;
  }
}

const headW = (f: Frame): [number[], number[]] => [[f.head, 0, 0, 0], [1, 0, 0, 0]];

/** The head bone, blending into body point j's own weights by s (0..1). */
function blendW(f: Frame, j: number, s: number): [number[], number[]] {
  if (s <= 0.001) return headW(f);
  const m = new Map<number, number>();
  m.set(f.head, 1 - s);
  for (let k = 0; k < 4; k++) {
    const w = f.wVal[j * 4 + k]! * s;
    if (!w) continue;
    const b = f.wIdx[j * 4 + k]!;
    m.set(b, (m.get(b) ?? 0) + w);
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
  while (top.length < 4) top.push([0, 0]);
  return [top.map(([b]) => b), top.map(([, w]) => w / sum)];
}

// ── Noise ────────────────────────────────────────────────────────────────────

const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
/** Smooth value noise, 0..1. */
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - xi);
  const fy = s(y - yi);
  const fz = s(z - zi);
  const L = THREE.MathUtils.lerp;
  const c = (a: number, b: number, d: number) => hash3(xi + a, yi + b, zi + d);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy), L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

// ── Styles ───────────────────────────────────────────────────────────────────

/** A point on the scalp grid, as a style sees it. */
export interface ScalpPt {
  /** Azimuth, degrees: 0 the face, ±180 the back, + the head's left (+x). */
  az: number;
  /** |az|. */
  a: number;
  el: number;
  /** Height: 0 at the nose tip, 1 at the crown. */
  yN: number;
  /** Across: -1..1 at the sides of the head. */
  xN: number;
  d: THREE.Vector3;
  f: Frame;
}
export interface ScalpOut {
  /** Thickness, cm. */
  t: number;
  /** Grows here (0..1, soft at the hairline). */
  cov: number;
  /** Fraction of the surface with hair (stubble < 1). */
  dens?: number;
  /** Extra lift up / forward, cm (a quiff, a pompadour). */
  up?: number;
  fwd?: number;
}
export interface DrapeSpec {
  /** The ring it hangs from (elevation, degrees from the head's centre). */
  el: number;
  /** Length at this azimuth, cm (0: no drape there). */
  len: (a: number, az: number) => number;
  /** Outward spread, cm per 10 cm hanging. */
  flare?: number;
  /** Waves: amplitude and period, cm. */
  wave?: [number, number];
  /** Curls the ends under by this much, cm. */
  tuck?: number;
  /** Bumpy, curly surface, cm. */
  curl?: number;
}
export interface TailSpec {
  kind: 'tube' | 'braid' | 'bun';
  az: number;
  yN: number;
  /** Path from the root, cm (x the head's left, y up, z the face's way). */
  path: [number, number, number][];
  /** Radius along it (0..1 → cm). */
  r: (s: number) => number;
  /** Ties: fractions along the path. */
  ties?: number[];
}
export interface HairSpec {
  shell?: (p: ScalpPt) => ScalpOut;
  /** A shaved-scalp shadow (stubble) under the hair wherever the natural hairline is. */
  shadow?: number;
  drape?: DrapeSpec;
  tails?: TailSpec[];
}

const sm = THREE.MathUtils.smoothstep;
/** smoothstep that also runs downhill (a > b). */
const ss = (a: number, b: number, x: number) => (a < b ? sm(x, a, b) : 1 - sm(x, b, a));
/** Piecewise-linear lookup over |az| (or any x), table sorted by x. */
function lin(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return table[table.length - 1]![1];
}

interface Line {
  /** The front hairline, relative to the natural one (+ recedes). */
  front?: number;
  temple?: number;
  /** Sideburn bottom (yN); null: none. */
  burn?: number;
  nape?: number;
  /** Over the ears (long hair). */
  ears?: boolean;
  feather?: number;
}
/** The hairline: 1 where hair grows (soft edge). */
export function hairline(p: ScalpPt, o: Line = {}): number {
  const f = p.f;
  const front = f.front + (o.front ?? 0);
  const temple = front - 0.1 + (o.temple ?? 0);
  const side = o.ears ? f.earBot - 0.2 : f.earTop + 0.02;
  // A man's sideburn runs down in front of the ear; a woman's hairline turns round above it (a sideburn down the
  // cheek read as a beard on her).
  const burn = o.burn ?? (f.sex === 'f' ? f.earTop - 0.04 : f.earBot + 0.05);
  const nape = o.nape ?? -0.22;
  const y = lin(
    [
      [0, front],
      [28, front - 0.02],
      [50, temple],
      [66, temple - 0.08],
      [76, o.ears ? side : burn],
      [84, o.ears ? side : burn],
      [90, side],
      [114, side],
      [130, (side + nape) / 2],
      [150, nape],
      [180, nape],
    ],
    p.a,
  );
  // Not a ruled line: it wanders a little (more round the front and temples, where it shows).
  const wob = (vnoise(p.az * 0.11 + 3.3, 0.5, 1.7) - 0.5) * 0.05 + (vnoise(p.az * 0.37 + 9.1, 2.5, 0.3) - 0.5) * 0.025;
  const fe = o.feather ?? 0.085;
  return sm(p.yN, y + wob - fe, y + wob + fe);
}

/** Thickness by zone: crown/top vs the front, sides and back below `cut` (yN). */
export function zones(p: ScalpPt, top: number, front: number, side: number, back: number, cut = 0.62, soft = 0.1): number {
  const ca = Math.cos(THREE.MathUtils.degToRad(p.az));
  const fw = Math.max(0, ca) ** 2;
  const bw = Math.max(0, -ca) ** 2;
  const sw = 1 - ca * ca;
  const low = (fw * front + sw * side + bw * back) / (fw + sw + bw);
  return THREE.MathUtils.lerp(low, top, sm(p.yN, cut - soft, cut + soft));
}

const noiseAt = (p: ScalpPt, freq: number, seed = 0) => vnoise(p.d.x * freq + seed, p.d.y * freq, p.d.z * freq);
/** Curls: rounded bumps, 0..1 (a softened |n|: no creases between them). */
const curls = (p: ScalpPt, freq: number) => {
  const n = noiseAt(p, freq) * 2 - 1;
  return Math.sqrt(n * n + 0.04) - 0.2;
};

// ── Builders ─────────────────────────────────────────────────────────────────

interface Built {
  scalp: THREE.BufferGeometry | null;
  long: THREE.BufferGeometry | null;
}

const GAP = 0.1; // cm between the skin and a shell's inside

function scalpPoint(f: Frame, az: number, el: number): ScalpPt {
  const d = dir(az, el);
  const r = radius(f, az, el);
  const y = f.c.y + d.y * r;
  return { az: az > 180 ? az - 360 : az, a: Math.abs(az > 180 ? az - 360 : az), el, yN: (y - f.tipY) / f.span, xN: (d.x * r) / (f.W / 2), d, f };
}

/** Build the scalp shell (and its drape) into `scalp`/`long`. */
function buildShell(f: Frame, shell: (p: ScalpPt) => ScalpOut, drape: DrapeSpec | undefined, scalp: Buf, long: Buf, tint = 1): void {
  const cm = f.cm;
  const anchorRow = drape ? Math.round((90 - drape.el) / DEL) : NE;
  const step = 0.6;
  // grid[ia][row] = vertex index or -1; drapeFlag per vertex.
  const grid: number[][] = [];
  const isDrape: boolean[][] = [];
  const covs: number[][] = [];
  const p = new THREE.Vector3();
  const hd = new THREE.Vector3();
  for (let ia = 0; ia <= NA; ia++) {
    const az = (ia / NA) * 360;
    const col: number[] = [];
    const dr: boolean[] = [];
    const cv: number[] = [];
    let lenHere = drape ? drape.len(Math.abs(az > 180 ? az - 360 : az), az > 180 ? az - 360 : az) : 0;
    // Uneven ends.
    if (lenHere > 0) lenHere *= 0.9 + 0.2 * vnoise((ia % NA) * 0.45, 1.3, 0.7);
    let along = 0;
    let prev: THREE.Vector3 | null = null;
    let anchor: THREE.Vector3 | null = null;
    let anchorOut = 0;
    // The style down this column, and how far into the hair each row is: the mean growth over the next rows
    // down towards the hairline (~2.5 cm). The thickness builds up over that, so the front of a short cut lies
    // down onto the forehead in a slope like real hair, not a cap's edge with a ledge under it.
    const outs: ScalpOut[] = [];
    const sps: ScalpPt[] = [];
    for (let ie = 0; ie < NE; ie++) {
      sps.push(scalpPoint(f, az, 90 - ie * DEL));
      outs.push(shell(sps[ie]!));
    }
    // The drape hangs only from hair: where the anchor ring is bare skin (in front of the ear, below the temple's
    // hairline) a drape hung from it began in a ledge, a step between the scalp's edge and the hanging part.
    // Shorter and fading out where the shell's own edge is, so the two blend.
    let anchorCov = 1;
    if (lenHere > 0 && anchorRow < NE) {
      anchorCov = THREE.MathUtils.clamp(Math.min(outs[anchorRow]!.cov, outs[Math.max(0, anchorRow - 3)]!.cov), 0, 1);
      lenHere *= sm(anchorCov, 0.3, 0.9);
      if (lenHere < 1.5) lenHere = 0;
    }
    const RAMP = 10;
    const ramp = (ie: number) => {
      let sum = 0;
      for (let k = 0; k <= RAMP; k++) sum += THREE.MathUtils.clamp(outs[Math.min(NE - 1, ie + k)]!.cov, 0, 1);
      return sum / (RAMP + 1);
    };
    for (let ie = 0; ie < NE + ND; ie++) {
      const skull = ie < NE && (ie <= anchorRow || lenHere <= 0);
      if (!skull && (ie <= anchorRow || lenHere <= 0)) break;
      let cov = 0;
      let dens = 1;
      let edge = 1;
      let w = headW(f);
      let target: Buf = scalp;
      if (skull) {
        const el = 90 - ie * DEL;
        const sp = sps[ie]!;
        const o = outs[ie]!;
        cov = THREE.MathUtils.clamp(o.cov, 0, 1);
        // Thinning out to the skin over the soft hairline and the hair just above it, so its edge is a taper.
        const r = Math.min(cov, ramp(ie));
        const out = (GAP + Math.max(0, o.t) * sm(cov, 0.1, 1) ** 2 * sm(r, 0.05, 1) ** 1.5) * cm;
        p.copy(sp.d).multiplyScalar(radius(f, az, el) + out).add(f.c);
        p.y += (o.up ?? 0) * cm * cov * sm(r, 0.2, 1);
        p.z += (o.fwd ?? 0) * cm * cov * sm(r, 0.2, 1);
        clear(f, p, Math.max(GAP * cm, out * 0.6), true);
        dens = o.dens ?? 1;
        edge = cov;
        if (ie === anchorRow) {
          anchor = p.clone();
          anchorOut = out;
        }
      } else {
        // The drape: straight down from the anchor ring, spreading, waving, its ends tucked.
        const s = (ie - anchorRow) * step;
        if (s > lenHere + step) break;
        const a = anchor!;
        hd.set(a.x - f.c.x, 0, a.z - f.c.z).normalize();
        let outw = (drape!.flare ?? 0) * (s / 10);
        if (drape!.wave) outw += drape!.wave[0] * Math.sin((s / drape!.wave[1]) * Math.PI * 2 + az * 0.11) * sm(s, 0, 4);
        if (drape!.tuck) outw -= drape!.tuck * sm(s, lenHere - 4, lenHere);
        if (drape!.curl) outw += drape!.curl * (vnoise(az * 0.06, s * 0.35, 3.1) * 2 - 1) * sm(s, 0, 3);
        p.copy(a).addScaledVector(hd, outw * cm);
        p.y -= s * cm;
        const j = clear(f, p, Math.max(anchorOut * 0.5, (p.y < f.tipY - f.span * 0.5 ? 1.6 : 0.5) * cm), false);
        w = blendW(f, j, sm(s, 2, 14));
        cov = 1;
        edge = (1 - sm(s, lenHere - 2.5, lenHere)) * sm(anchorCov, 0.3, 0.75);
        target = long;
      }
      if (prev) along += prev.distanceTo(p) / cm;
      prev = p.clone();
      const across = (az / 360) * 60;
      // Drape vertices are their own (in `long`); the anchor row is shared by both.
      if (skull) {
        col.push(scalp.add(p, across, along, edge, dens, tint, w));
      } else col.push(target.add(p, across, along, edge, dens, tint, w));
      dr.push(!skull);
      cv.push(skull ? cov : 1);
      if (skull && ie === anchorRow && lenHere > 0) {
        // Duplicate the anchor into `long` so the drape is one piece.
        const k = long.add(p, across, along, 1, dens, tint, w);
        (col as number[] & { anchorLong?: number }).anchorLong = k;
      }
    }
    grid.push(col);
    isDrape.push(dr);
    covs.push(cv);
  }
  for (let ia = 0; ia < NA; ia++) {
    const A = grid[ia]!;
    const B = grid[ia + 1]!;
    const n = Math.min(A.length, B.length);
    for (let r = 0; r + 1 < n; r++) {
      const dA0 = isDrape[ia]![r]!;
      const dA1 = isDrape[ia]![r + 1]!;
      const dB0 = isDrape[ia + 1]![r]!;
      const dB1 = isDrape[ia + 1]![r + 1]!;
      const c = covs[ia]!;
      const d = covs[ia + 1]!;
      if (Math.max(c[r]!, c[r + 1]!, d[r]!, d[r + 1]!) < 0.02) continue;
      if (!dA1 && !dB1) {
        if (dA0 || dB0) continue;
        scalp.idx.push(A[r]!, A[r + 1]!, B[r]!, B[r]!, A[r + 1]!, B[r + 1]!);
      } else if (dA1 && dB1) {
        const la = (A as number[] & { anchorLong?: number }).anchorLong;
        const lb = (B as number[] & { anchorLong?: number }).anchorLong;
        const a0 = dA0 ? A[r]! : la;
        const b0 = dB0 ? B[r]! : lb;
        if (a0 === undefined || b0 === undefined) continue;
        long.idx.push(a0, A[r + 1]!, b0, b0, A[r + 1]!, B[r + 1]!);
      }
    }
  }
}

/** Parallel-transport frames along a polyline. */
function frames(pts: THREE.Vector3[]): { T: THREE.Vector3[]; N: THREE.Vector3[]; B: THREE.Vector3[] } {
  const T = pts.map((_, i) => new THREE.Vector3().subVectors(pts[Math.min(i + 1, pts.length - 1)]!, pts[Math.max(i - 1, 0)]!).normalize());
  const N: THREE.Vector3[] = [];
  const B: THREE.Vector3[] = [];
  let n = new THREE.Vector3(1, 0, 0);
  if (Math.abs(T[0]!.dot(n)) > 0.9) n.set(0, 0, 1);
  n = n.sub(T[0]!.clone().multiplyScalar(n.dot(T[0]!))).normalize();
  for (let i = 0; i < pts.length; i++) {
    if (i) n = n.sub(T[i]!.clone().multiplyScalar(n.dot(T[i]!))).normalize();
    N.push(n.clone());
    B.push(new THREE.Vector3().crossVectors(T[i]!, n).normalize());
  }
  return { T, N, B };
}

/** Where on the outside of the hair a root at (az, yN) sits, `out` cm off the skull. */
function rootAt(f: Frame, az: number, yN: number, out: number): THREE.Vector3 {
  let lo = -80;
  let hi = 90;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const sp = scalpPoint(f, az, mid);
    if (sp.yN > yN) hi = mid;
    else lo = mid;
  }
  const el = (lo + hi) / 2;
  return dir(az, el).multiplyScalar(radius(f, az, el) + out * f.cm).add(f.c);
}

function buildTail(f: Frame, t: TailSpec, out: Buf, tint = 1): void {
  const cm = f.cm;
  const root = rootAt(f, t.az, t.yN, 0.4);
  const RING = 24;
  if (t.kind === 'bun') {
    // A ball of hair, its strands wound round it.
    const r = t.r(0) * cm;
    const o = t.path[0] ?? [0, 0, 0];
    const c = root.clone().add(new THREE.Vector3(o[0], o[1], o[2]).multiplyScalar(cm));
    const rows = 18;
    const grid: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const v = i / rows;
      const ph = v * Math.PI;
      const row: number[] = [];
      for (let k = 0; k <= RING; k++) {
        const th = (k / RING) * Math.PI * 2;
        // A wound coil: a soft twist round the ball, not lumps.
        const bump = 1 + 0.025 * Math.sin(th * 2 + ph * 3) * Math.sin(ph);
        const p = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.8, Math.sin(ph) * Math.sin(th)).multiplyScalar(r * bump).add(c);
        row.push(out.add(p, (k / RING) * 2 * Math.PI * (r / cm) + v * 6, v * Math.PI * (r / cm) + k * 0.4, 1, 1, tint, headW(f)));
      }
      grid.push(row);
    }
    for (let i = 0; i < rows; i++)
      for (let k = 0; k < RING; k++) out.idx.push(grid[i]![k]!, grid[i + 1]![k]!, grid[i]![k + 1]!, grid[i]![k + 1]!, grid[i + 1]![k]!, grid[i + 1]![k + 1]!);
    return;
  }
  // Tube: a smooth path from the root, kept clear of the body.
  const ctrl = [root.clone(), ...t.path.map(([x, y, z]) => root.clone().add(new THREE.Vector3(x, y, z).multiplyScalar(cm)))];
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const N = 40;
  const pts = curve.getSpacedPoints(N);
  const js: number[] = [];
  pts.forEach((p, i) => {
    const s = i / N;
    js.push(clear(f, p, (t.r(s) + 0.35) * cm, false));
  });
  // Smooth after pushing so it doesn't kink.
  for (let it = 0; it < 2; it++) for (let i = 1; i < N; i++) pts[i]!.lerp(pts[i - 1]!.clone().add(pts[i + 1]!).multiplyScalar(0.5), 0.5);
  const { N: Ns, B: Bs } = frames(pts);
  let len = 0;
  const grid: number[][] = [];
  for (let i = 0; i <= N; i++) {
    if (i) len += pts[i]!.distanceTo(pts[i - 1]!) / cm;
    const s = i / N;
    const r0 = t.r(s);
    const drop = Math.max(0, (root.y - pts[i]!.y) / cm);
    const w = blendW(f, js[i]!, sm(drop, 1.5, 12));
    const tie = t.ties?.some((x) => Math.abs(x - s) < 0.5 / N);
    const row: number[] = [];
    for (let k = 0; k <= RING; k++) {
      const th = (k / RING) * Math.PI * 2;
      let r = r0;
      if (t.kind === 'braid') {
        const ph = (len / 2.2) * Math.PI;
        r *= 0.8 + 0.32 * Math.abs(Math.cos(1.5 * th + ph));
      }
      if (tie) r = r0 * 1.08 + 0.12;
      const p = pts[i]!.clone()
        .addScaledVector(Ns[i]!, Math.cos(th) * r * cm)
        .addScaledVector(Bs[i]!, Math.sin(th) * r * cm);
      const across = t.kind === 'braid' ? th * r0 + len * 1.3 : th * r0;
      row.push(out.add(p, across, len, s > 0.92 ? 1 - sm(s, 0.92, 1) : 1, 1, tie ? 0.28 : tint, w));
    }
    grid.push(row);
  }
  for (let i = 0; i < N; i++)
    for (let k = 0; k < RING; k++) out.idx.push(grid[i]![k]!, grid[i + 1]![k]!, grid[i]![k + 1]!, grid[i]![k + 1]!, grid[i + 1]![k]!, grid[i + 1]![k + 1]!);
}

const HAIR_CACHE = new Map<string, Built>();
/** Triangles per hairstyle (the last body built), for the dev checks. */
export const hairStats: Record<string, number> = {};

/** Scalp + hanging geometry for a style on this body (cached per body and style). */
export function hairGeometry(body: THREE.SkinnedMesh, sex: 'm' | 'f', id: string, spec: HairSpec): Built {
  const f = headFrame(body, sex);
  if (!f) return { scalp: null, long: null };
  const key = `${f.body.uuid}|${id}`;
  const hit = HAIR_CACHE.get(key);
  if (hit) return hit;
  const scalp = new Buf();
  const long = new Buf();
  if (spec.shadow) buildShell(f, (p) => ({ t: 0.04, cov: hairline(p, { feather: 0.08 }), dens: spec.shadow }), undefined, scalp, long, 0.75);
  if (spec.shell) buildShell(f, spec.shell, spec.drape, scalp, long);
  for (const t of spec.tails ?? []) buildTail(f, t, long);
  hairStats[id] = (scalp.idx.length + long.idx.length) / 3;
  const out = { scalp: scalp.geometry(), long: long.geometry() };
  HAIR_CACHE.set(key, out);
  return out;
}

// ── Facial hair ──────────────────────────────────────────────────────────────

export interface FacePt {
  /** |x| across the face: 1 at the side of the head. */
  xN: number;
  yN: number;
  /** Degrees round from the front (0) to the side (90), measured from the head's centre. */
  faz: number;
}
export interface FaceOut {
  t: number;
  cov: number;
  dens?: number;
  /** Hangs down by this much, cm (long beards). */
  drop?: number;
}
export type BeardSpec = (p: FacePt) => FaceOut;

const BEARD_CACHE = new Map<string, THREE.BufferGeometry | null>();

/** Triangles per beard style (the last body built), for the dev checks. */
export const beardStats: Record<string, number> = {};

export function beardGeometry(body: THREE.SkinnedMesh, sex: 'm' | 'f', id: string, spec: BeardSpec): THREE.BufferGeometry | null {
  const f = headFrame(body, sex);
  if (!f) return null;
  const key = `${f.body.uuid}|${id}`;
  if (BEARD_CACHE.has(key)) return BEARD_CACHE.get(key)!;
  const geo = f.body;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const idx = geo.index!;
  const cm = f.cm;
  const yLo = f.tipY - f.span * 0.85;
  const yHi = f.tipY + f.span * 0.45;
  const near = (i: number) => {
    const y = pos.getY(i);
    if (y < yLo || y > yHi) return false;
    const faz = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(pos.getX(i)), pos.getZ(i) - f.c.z));
    return faz < 105;
  };
  const P: THREE.Vector3[] = [];
  const Nn: THREE.Vector3[] = [];
  const src: number[] = [];
  const W: Map<number, number>[] = [];
  const cov: number[] = [];
  const outs: FaceOut[] = [];
  const v = new THREE.Vector3();
  /** The style's mask here; nothing on the ears (they stand clear of the skull: a beard there was a lump). */
  const evalAt = (k: number) => {
    const p = P[k]!;
    const fp: FacePt = {
      xN: Math.abs(p.x) / (f.W / 2),
      yN: (p.y - f.tipY) / f.span,
      faz: THREE.MathUtils.radToDeg(Math.atan2(Math.abs(p.x), p.z - f.c.z)),
    };
    const o = spec(fp);
    let c = THREE.MathUtils.clamp(o.cov, 0, 1);
    // (From 80°: further forward the cheek in front of the ear stands out of the skull's radius too, and cutting it
    // there left skin between a full beard and the sideburn.)
    if (c > 0 && fp.faz > 80 && fp.yN > f.earBot - 0.12) {
      v.subVectors(p, f.c);
      const r = v.length();
      const az = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z));
      const el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)));
      const out = (r - radius(f, az, el)) / cm;
      c *= sm(out, 1.6, 0.9);
    }
    cov[k] = c;
    outs[k] = o;
  };
  const map = new Map<number, number>();
  // The body's mesh is split along its UV seams (the same point twice, its normals not always the same): welded
  // here, or the beard opened along each seam into a crack.
  const weld = new Map<string, number>();
  const vert = (i0: number) => {
    const wk = `${Math.round(pos.getX(i0) * 2e4)},${Math.round(pos.getY(i0) * 2e4)},${Math.round(pos.getZ(i0) * 2e4)}`;
    let i = weld.get(wk);
    if (i === undefined) weld.set(wk, (i = i0));
    let k = map.get(i);
    if (k === undefined) {
      k = P.length;
      P.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      Nn.push(new THREE.Vector3().fromBufferAttribute(nrm, i));
      src.push(i);
      const wm = new Map<number, number>();
      for (let q = 0; q < 4; q++) {
        const x = sw.getComponent(i, q);
        if (x > 0) wm.set(si.getComponent(i, q), (wm.get(si.getComponent(i, q)) ?? 0) + x);
      }
      W.push(wm);
      map.set(i, k);
      evalAt(k);
    }
    return k;
  };
  const mids = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key2 = a < b ? `${a}_${b}` : `${b}_${a}`;
    let k = mids.get(key2);
    if (k === undefined) {
      k = P.length;
      // A little out from the flat chord towards the curved surface (the mean of the ends' normals), so the
      // finer mesh stays on the face instead of cutting into it between the body's vertices.
      const pa = P[a]!;
      const pb = P[b]!;
      const na = Nn[a]!;
      const nb = Nn[b]!;
      const d = pb.clone().sub(pa);
      const bulge = (d.dot(nb) - d.dot(na)) * 0.125;
      const n = na.clone().add(nb).normalize();
      P.push(pa.clone().add(pb).multiplyScalar(0.5).addScaledVector(n, bulge));
      Nn.push(n);
      src.push(src[a]!);
      const wm = new Map<number, number>();
      for (const [bn, x] of W[a]!) wm.set(bn, x * 0.5);
      for (const [bn, x] of W[b]!) wm.set(bn, (wm.get(bn) ?? 0) + x * 0.5);
      W.push(wm);
      mids.set(key2, k);
      evalAt(k);
    }
    return k;
  };
  // The face's triangles, split in four (twice where the beard is: finer edges and a smooth taper), with
  // a triangle kept wherever any corner has hair (its bare corners are the transparent edge, not a cut).
  let tris: [number, number, number][] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    if (!near(a) || !near(b) || !near(c)) continue;
    tris.push([vert(a), vert(b), vert(c)]);
  }
  const has = (tr: [number, number, number]) => cov[tr[0]]! > 0.001 || cov[tr[1]]! > 0.001 || cov[tr[2]]! > 0.001;
  for (let level = 0; level < 1; level++) {
    const next: [number, number, number][] = [];
    for (const tr of tris) {
      // Split anything with hair or next to it (a bare triangle beside the edge may get some once split).
      const [A, B, C] = tr;
      const ab = mid(A, B);
      const bc = mid(B, C);
      const ca = mid(C, A);
      const kids: [number, number, number][] = [[A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]];
      if (!has(tr) && !kids.some(has)) continue;
      next.push(...kids);
    }
    tris = next;
  }
  tris = tris.filter(has);
  // Lift along smoothed normals: the skin's own turn sharply in its creases (the mouth's corners, under the lip),
  // and a thick beard lifted along them folded over itself there in a visible seam.
  {
    const nb = new Map<number, Set<number>>();
    const link = (a: number, b: number) => {
      let s = nb.get(a);
      if (!s) nb.set(a, (s = new Set()));
      s.add(b);
    };
    for (const [a, b, c] of tris) (link(a, b), link(b, a), link(b, c), link(c, b), link(c, a), link(a, c));
    for (let pass = 0; pass < 6; pass++) {
      const next = new Map<number, THREE.Vector3>();
      for (const [k, s] of nb) {
        const n = Nn[k]!.clone().multiplyScalar(2);
        for (const j of s) n.add(Nn[j]!);
        next.set(k, n.normalize());
      }
      for (const [k, n] of next) Nn[k] = n;
    }
  }
  const out = new Buf();
  const vi = new Int32Array(P.length).fill(-1);
  const pp = new THREE.Vector3();
  const add = (k: number) => {
    if (vi[k]! >= 0) return vi[k]!;
    const p = P[k]!;
    const o = outs[k]!;
    const c = cov[k]!;
    // Thickness swells in from the edge (a rounded mass, no ledge), the lift never below the skin.
    // Clumps: a thick beard isn't a smooth mask; its surface rises and falls a little, strand-wise (long down).
    const t = Math.max(0, o.t);
    const lump = t > 0.3 ? 0.82 + 0.36 * vnoise(p.x / cm * 1.4, p.y / cm * 0.45, p.z / cm * 1.4) : 1;
    const lift = (0.05 + t * lump * sm(c, 0.1, 1) ** 2) * cm;
    pp.copy(p).addScaledVector(Nn[k]!, lift);
    if (o.drop) {
      pp.y -= o.drop * cm * c;
      pp.z += o.drop * 0.25 * cm * c;
    }
    // Skinned as the skin under it (the split points too: their ends' blend), so jaw and neck move it together
    // with no tear where the head's weights give way to the neck's.
    const top = [...W[k]!.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((acc, [, x]) => acc + x, 0) || 1;
    while (top.length < 4) top.push([0, 0]);
    const w: [number[], number[]] = [top.map(([bn]) => bn), top.map(([, x]) => x / sum)];
    // Strands run down the face: across = x, along = -y.
    vi[k] = out.add(pp, p.x / cm, -(p.y / cm), c, o.dens ?? 1, 1, w);
    return vi[k]!;
  };
  const anchors: number[] = [];
  const add2 = (k: number) => {
    const fresh = vi[k]! < 0;
    const j = add(k);
    if (fresh) anchors.push(P[k]!.x, P[k]!.y, P[k]!.z);
    return j;
  };
  for (const [a, b, c] of tris) out.idx.push(add2(a), add2(b), add2(c));
  beardStats[id] = tris.length;
  const g = out.geometry();
  g?.setAttribute('aAnchor', new THREE.Float32BufferAttribute(anchors, 3));
  BEARD_CACHE.set(key, g);
  return g;
}

export { lin as hairLin, ss as hairSs, curls as hairCurls, noiseAt as hairNoise };

// ── Material ─────────────────────────────────────────────────────────────────

const MATS = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Headwear over the hair (the body's bind space): the hair keeps its style, and what of it is under the headwear's
 * shell is drawn in under it. Above the rim (a plane, `rim` at z = `pivotZ`, rising `slope` per unit forward) the
 * hair is pulled inside the ellipsoid (centre `c`, radii `r`), blending out over `band` below the rim, so it never
 * pokes through; what hangs below the rim (the nape, the sides, a ponytail, long hair) stays as it is. A fringe
 * over the forehead (in front, above `fringeY`) is tucked in under it, i.e. not drawn.
 */
export interface HeadClip {
  c: THREE.Vector3;
  r: THREE.Vector3;
  rim: number;
  slope: number;
  pivotZ: number;
  band: number;
  fringeY: number;
}

const clipKey = (c: HeadClip | null | undefined) =>
  c ? [c.c.x, c.c.y, c.c.z, c.r.x, c.r.y, c.r.z, c.rim, c.slope, c.pivotZ, c.band, c.fringeY].map((v) => v.toFixed(4)).join(',') : '';

/**
 * Hair: solid shells shaded as strands (lighter and darker strands along the growth, darker towards the roots and
 * the hairline, a soft sheen), with a soft, clean hairline: the edge fades out (blended, not speckled) through
 * fine wisps. A shaved scalp or stubble (density < 1) is a thin translucent shadow, not dots. `clip`: headwear over
 * it (HeadClip).
 */
export function hairGenMaterial(color: number, u: WorldUniforms, clip?: HeadClip | null): THREE.MeshStandardMaterial {
  const key = `${color}|${clipKey(clip)}`;
  let m = MATS.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: true, alphaTest: 0.02 });
  m.name = 'hairgen';
  const on = clip ? 1 : 0;
  const C = clip?.c ?? new THREE.Vector3();
  const R = clip?.r ?? new THREE.Vector3(1, 1, 1);
  const rim = new THREE.Vector4(clip?.rim ?? 0, clip?.slope ?? 0, clip?.pivotZ ?? 0, clip?.band ?? 0.01);
  patchWorldMaterial(m, u, {
    key: `hairgen${on}`,
    pre: (sh) => {
      sh.uniforms.uClipOn = { value: on };
      sh.uniforms.uClipC = { value: C };
      sh.uniforms.uClipR = { value: R };
      sh.uniforms.uClipRim = { value: rim };
      sh.uniforms.uClipF = { value: clip?.fringeY ?? 0 };
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 aStrand;
          attribute vec3 aHair;
          varying vec2 vStrand;
          varying vec3 vHair;
          varying vec3 vBindP;
          uniform float uClipOn;
          uniform vec3 uClipC;
          uniform vec3 uClipR;
          uniform vec4 uClipRim;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vStrand = aStrand;
          vHair = aHair;
          vBindP = position;
          if (uClipOn > 0.5) {
            float rimY = uClipRim.x + uClipRim.y * (transformed.z - uClipRim.z);
            float above = smoothstep(rimY - uClipRim.w, rimY + uClipRim.w * 0.25, transformed.y);
            vec3 hq = (transformed - uClipC) / uClipR;
            float L = length(hq);
            // Below the rim the hair is let out again gradually (squashed by the rim, not cut off flat by it).
            float maxL = mix(1.0 + max(0.0, rimY - transformed.y) / (uClipRim.w * 2.0), 0.96, above);
            if (L > maxL) transformed = uClipC + (transformed - uClipC) * (maxL / L);
          }`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vStrand;
          varying vec3 vHair;
          varying vec3 vBindP;
          uniform float uClipOn;
          uniform vec3 uClipC;
          uniform vec3 uClipR;
          uniform vec4 uClipRim;
          uniform float uClipF;
          float hgH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float hgN(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hgH(i), hgH(i + vec2(1.0, 0.0)), f.x), mix(hgH(i + vec2(0.0, 1.0)), hgH(i + vec2(1.0, 1.0)), f.x), f.y);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          if (uClipOn > 0.5) {
            float rimY = uClipRim.x + uClipRim.y * (vBindP.z - uClipRim.z);
            vec3 hq = (vBindP - uClipC) / uClipR;
            // A fringe tucked in under the front rim.
            if (hq.z > 0.3 && abs(hq.x) < 0.75 && vBindP.y > uClipF && vBindP.y < rimY + uClipRim.w) discard;
          }
          // Strands: smooth noise across them (clumps, then single strands), stretched along them.
          float hgS = hgN(vStrand * vec2(3.0, 0.15)) * 0.55 + hgN(vStrand * vec2(11.0, 0.4) + 7.0) * 0.3 + hgN(vStrand * vec2(29.0, 0.8) + 3.0) * 0.15;
          // Single hairs up close (faded out where they'd be finer than a pixel and shimmer).
          float hgFk = 1.0 - clamp(fwidth(vStrand.x) * 30.0, 0.0, 1.0);
          hgS = mix(hgS, hgS * 0.7 + hgN(vStrand * vec2(70.0, 1.8) + 19.0) * 0.3, hgFk);
          // Clumps a shade warmer or cooler than each other (natural hair isn't one flat colour).
          float hgHue = hgN(vStrand * vec2(1.2, 0.06) + 41.0) - 0.5;
          // The hairline: soft wisps (strands of different lengths), blended into the skin.
          float hgW = hgN(vec2(vStrand.x * 7.0, 0.5)) * 0.6 + hgN(vec2(vStrand.x * 23.0, 2.5)) * 0.4;
          float hgA = vHair.x >= 0.995 ? 1.0 : smoothstep(0.0, 0.55, vHair.x * 1.2 - hgW * 0.25);
          // Sparse growth (shaved, stubble): a translucent shadow, as dense as the growth.
          // Up close it is fine stipple (the hairs' cut ends, ~1 mm apart); far off, where the dots would shimmer,
          // their average.
          if (vHair.y < 0.995) {
            // Each octave goes to its average once its dots are under ~4 px (by ~1.5 px they're gone): faded only at
            // ~1 px before, the dots crawled at game distance.
            float hgFw = max(fwidth(vStrand.x), fwidth(vStrand.y));
            float hgF1 = smoothstep(0.25, 0.7, hgFw * 16.0);
            float hgF2 = smoothstep(0.25, 0.7, hgFw * 31.0);
            float hgSt = mix(smoothstep(0.42, 0.78, hgN(vStrand * vec2(16.0, 10.0) + 11.0)), 0.42, hgF1) * 0.7
              + mix(smoothstep(0.5, 0.85, hgN(vStrand * vec2(31.0, 23.0) + 5.0)), 0.35, hgF2) * 0.3;
            hgA *= vHair.y * (0.35 + 0.95 * hgSt);
          }
          diffuseColor.a *= hgA;
          // Darker under the surface and at the hairline (roots), lighter strands on top.
          float hgRoot = mix(0.84, 1.0, smoothstep(0.0, 0.8, vHair.x));
          diffuseColor.rgb *= (0.62 + 0.62 * hgS) * vHair.z * hgRoot;
          diffuseColor.rgb *= vec3(1.0 + 0.12 * hgHue, 1.0 + 0.02 * hgHue, 1.0 - 0.1 * hgHue);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor * (0.8 + 0.45 * hgS), 0.3, 1.0);`,
        );
    },
  });
  MATS.set(key, m);
  return m;
}

export function disposeHairGen(): void {
  for (const b of HAIR_CACHE.values()) (b.scalp?.dispose(), b.long?.dispose());
  HAIR_CACHE.clear();
  for (const g of BEARD_CACHE.values()) g?.dispose();
  BEARD_CACHE.clear();
  for (const m of MATS.values()) m.dispose();
  MATS.clear();
}
