import * as THREE from 'three';

/**
 * Fitting rigid gear models (helmets, vests, rigs) to one body as it is dressed.
 *
 * The body is measured, not assumed: every torso vertex of the body and of the clothes on it (in the body's bind
 * pose, arms out) goes into a radial map round the spine, `TorsoField`: how far the surface reaches at each height
 * in each direction. The head gives its crown, brow line and skull section the same way.
 *
 * A vest is then wrapped, not scaled: the model's own cavity (the low envelope of its vertices round its axis) is
 * carried onto the measured surface, and whatever stands off the cavity (plates, pouches, straps) keeps its
 * thickness. It hangs by its straps on the shoulders, never dips into the clothes, and takes spine weights by
 * height so it bends with the body. A rig goes on the same way over the surface of the armour under it.
 */

const NT = 48;
const TAU = Math.PI * 2;
const DY = 0.01;

/** How far the torso reaches from its axis (x0, z0), per height slice and direction. */
export interface TorsoField {
  x0: number;
  z0: number;
  y0: number;
  ny: number;
  r: Float32Array;
}

/** The skull above the brow line, for helmets. */
export interface HeadFit {
  x: number;
  crown: number;
  brow: number;
  chin: number;
  halfW: number;
  back: number;
  front: number;
}

export interface BodyFit {
  /** Size of this body against the one the constants here were tuned on (pelvis to head joint 0.7). */
  k: number;
  joints: Record<'pelvis' | 'spine_01' | 'spine_02' | 'spine_03' | 'neck' | 'head' | 'shoulder', THREE.Vector3>;
  /** Bone indices of the spine chain in the body's skeleton, pelvis first. */
  spine: number[];
  /** The body alone, and with its clothes on. */
  bare: TorsoField;
  dressed: TorsoField;
  head: HeadFit | null;
}

/** Per-model handles (gearModels.ts `fit`): all optional, all relative to the measured fit. */
export interface FitHandles {
  w?: number;
  d?: number;
  h?: number;
  y?: number;
  size?: number;
  gap?: number;
}

interface Verts {
  pos: Float32Array;
  /** Body bone each vertex mostly follows (index into the body's skeleton), or -1. */
  bone: Int16Array;
  index: ArrayLike<number> | null;
}

/** A skinned mesh's vertices in the body's bind space (the space gear is placed and skinned in). */
function bindVerts(mesh: THREE.SkinnedMesh, body: THREE.SkinnedMesh): Verts {
  const g = mesh.geometry;
  const p = g.attributes.position!;
  const si = g.attributes.skinIndex!;
  const sw = g.attributes.skinWeight!;
  const bb = body.skeleton.bones;
  const lut = mesh.skeleton.bones.map((b) => {
    const j = bb.indexOf(b);
    return j >= 0 ? j : bb.findIndex((x) => x.name === b.name);
  });
  // Per bone: this mesh's bind space → the body's (the same joint, bound twice).
  const bodyBindInv = body.bindMatrix.clone().invert();
  const M =
    mesh === body
      ? null
      : lut.map((j, i) =>
          j < 0
            ? null
            : new THREE.Matrix4()
                .copy(bodyBindInv)
                .multiply(new THREE.Matrix4().copy(body.skeleton.boneInverses[j]!).invert())
                .multiply(mesh.skeleton.boneInverses[i]!)
                .multiply(mesh.bindMatrix),
        );
  const pos = new Float32Array(p.count * 3);
  const bone = new Int16Array(p.count);
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    let best = 0;
    for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, best)) best = c;
    bone[i] = lut[si.getComponent(i, best)] ?? -1;
    v.fromBufferAttribute(p, i);
    if (M) {
      a.set(0, 0, 0);
      let ws = 0;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        const m = w > 0 ? M[si.getComponent(i, c)] : null;
        if (!m) continue;
        a.addScaledVector(_t.copy(v).applyMatrix4(m), w);
        ws += w;
      }
      if (ws > 0) v.copy(a).multiplyScalar(1 / ws);
      else bone[i] = -1;
    }
    v.toArray(pos, i * 3);
  }
  return { pos, bone, index: g.index ? (g.index.array as ArrayLike<number>) : null };
}
const _t = new THREE.Vector3();

const cell = (th: number) => Math.min(NT - 1, Math.floor((((th / TAU) % 1) + 1) % 1 * NT));

/** Mark every triangle whose corners all pass `keep` into the field (sampled finer than its cells). */
function raster(f: TorsoField, pos: ArrayLike<number>, index: ArrayLike<number> | null, keep: ((i: number) => boolean) | null): void {
  const n = index ? index.length : pos.length / 3;
  for (let t = 0; t + 2 < n; t += 3) {
    const ia = index ? index[t]! : t;
    const ib = index ? index[t + 1]! : t + 1;
    const ic = index ? index[t + 2]! : t + 2;
    if (keep && !(keep(ia) && keep(ib) && keep(ic))) continue;
    const ax = pos[ia * 3]!, ay = pos[ia * 3 + 1]!, az = pos[ia * 3 + 2]!;
    const bx = pos[ib * 3]!, by = pos[ib * 3 + 1]!, bz = pos[ib * 3 + 2]!;
    const cx = pos[ic * 3]!, cy = pos[ic * 3 + 1]!, cz = pos[ic * 3 + 2]!;
    const edge = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const m = Math.min(16, Math.max(1, Math.ceil(edge / 0.008)));
    for (let i = 0; i <= m; i++)
      for (let j = 0; i + j <= m; j++) {
        const u = i / m;
        const w = j / m;
        const q = 1 - u - w;
        const y = ay * q + by * u + cy * w;
        const iy = Math.round((y - f.y0) / DY);
        if (iy < 0 || iy >= f.ny) continue;
        const x = ax * q + bx * u + cx * w - f.x0;
        const z = az * q + bz * u + cz * w - f.z0;
        const k = iy * NT + cell(Math.atan2(z, x));
        const r = Math.hypot(x, z);
        if (r > f.r[k]!) f.r[k] = r;
      }
  }
}

/** Close the gaps between samples and round the map off a little, never below what was measured. */
function finish(f: TorsoField): void {
  const { r, ny } = f;
  for (let iy = 0; iy < ny; iy++) {
    let have = 0;
    for (let t = 0; t < NT; t++) if (r[iy * NT + t]! > 0) have++;
    if (have < NT / 3 || have === NT) continue;
    const row = r.slice(iy * NT, iy * NT + NT);
    for (let t = 0; t < NT; t++) {
      if (row[t]! > 0) continue;
      let a = 1;
      while (row[(t - a + NT) % NT]! <= 0) a++;
      let b = 1;
      while (row[(t + b) % NT]! <= 0) b++;
      r[iy * NT + t] = (row[(t - a + NT) % NT]! * b + row[(t + b) % NT]! * a) / (a + b);
    }
  }
  const src = r.slice();
  for (let iy = 0; iy < ny; iy++)
    for (let t = 0; t < NT; t++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const y = iy + dy;
        if (y < 0 || y >= ny) continue;
        for (let dt = -1; dt <= 1; dt++) {
          const s = src[y * NT + ((t + dt + NT) % NT)]!;
          if (s > 0) {
            sum += s;
            n++;
          }
        }
      }
      if (n >= 5) r[iy * NT + t] = Math.max(src[iy * NT + t]!, sum / n);
    }
}

function row(r: Float32Array, iy: number, th: number): number {
  let ft = ((((th / TAU) % 1) + 1) % 1) * NT - 0.5;
  if (ft < 0) ft += NT;
  const t0 = Math.floor(ft) % NT;
  const tt = ft - Math.floor(ft);
  return r[iy * NT + t0]! * (1 - tt) + r[iy * NT + ((t0 + 1) % NT)]! * tt;
}

function sample(f: TorsoField, r: Float32Array, th: number, y: number): number {
  const fy = THREE.MathUtils.clamp((y - f.y0) / DY, 0, f.ny - 1);
  const iy = Math.min(f.ny - 2, Math.floor(fy));
  const ty = fy - iy;
  return row(r, iy, th) * (1 - ty) + row(r, iy + 1, th) * ty;
}

/** Height of the highest surface under (or over) a point at radius `rad` in direction `th`; NaN if none. */
function topAt(f: TorsoField, th: number, rad: number): number {
  for (let iy = f.ny - 1; iy >= 0; iy--) {
    const here = row(f.r, iy, th);
    if (here < rad) continue;
    if (iy === f.ny - 1) return f.y0 + iy * DY;
    const above = row(f.r, iy + 1, th);
    return f.y0 + (iy + (here - rad) / Math.max(1e-6, here - above)) * DY;
  }
  return NaN;
}

/**
 * The surface a stiff vest rests on: the field pulled taut, round each slice (it bridges the hollow of the back
 * and between the breasts) and then up each direction from `yLo` to `yHi(direction)` (it bridges the waist).
 */
function taut(f: TorsoField, yLo: number, yHi: Float32Array): Float32Array {
  const out = f.r.slice();
  const i0 = Math.max(0, Math.floor((yLo - f.y0) / DY));
  const px = new Float32Array(NT);
  const pz = new Float32Array(NT);
  const hull: number[] = [];
  const cross = (o: number, a: number, b: number) => (px[a]! - px[o]!) * (pz[b]! - pz[o]!) - (pz[a]! - pz[o]!) * (px[b]! - px[o]!);
  let iTop = 0;
  for (let t = 0; t < NT; t++) iTop = Math.max(iTop, Math.min(f.ny - 1, Math.ceil((yHi[t]! - f.y0) / DY)));
  for (let iy = i0; iy <= iTop; iy++) {
    let ok = true;
    for (let t = 0; t < NT; t++) {
      const rr = out[iy * NT + t]!;
      if (rr <= 0) ok = false;
      const th = ((t + 0.5) / NT) * TAU;
      px[t] = rr * Math.cos(th);
      pz[t] = rr * Math.sin(th);
    }
    if (!ok) continue;
    // The points come in angular order round the axis, so one pass with back-tracking finds the hull.
    let start = 0;
    for (let t = 1; t < NT; t++) if (px[t]! > px[start]!) start = t;
    hull.length = 0;
    for (let s = 0; s <= NT; s++) {
      const t = (start + s) % NT;
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, t) <= 0) hull.pop();
      hull.push(t);
    }
    for (let h = 0; h + 1 < hull.length; h++) {
      const a = hull[h]!;
      const b = hull[h + 1]!;
      const n = (b - a + NT) % NT || NT;
      const axb = px[a]! * pz[b]! - pz[a]! * px[b]!;
      for (let s = 1; s < n; s++) {
        const t = (a + s) % NT;
        const th = ((t + 0.5) / NT) * TAU;
        const den = Math.cos(th) * (pz[b]! - pz[a]!) - Math.sin(th) * (px[b]! - px[a]!);
        if (den > 1e-9) out[iy * NT + t] = Math.max(out[iy * NT + t]!, axb / den);
      }
    }
  }
  const up: number[] = [];
  for (let t = 0; t < NT; t++) {
    const i1 = Math.min(f.ny - 1, Math.floor((yHi[t]! - f.y0) / DY));
    up.length = 0;
    for (let iy = i0; iy <= i1; iy++) {
      const rr = out[iy * NT + t]!;
      while (up.length >= 2) {
        const a = up[up.length - 2]!;
        const b = up[up.length - 1]!;
        // b lies under the line a → iy: it is a hollow, bridged.
        if ((out[b * NT + t]! - out[a * NT + t]!) * (iy - a) <= (rr - out[a * NT + t]!) * (b - a)) up.pop();
        else break;
      }
      up.push(iy);
    }
    for (let h = 0; h + 1 < up.length; h++) {
      const a = up[h]!;
      const b = up[h + 1]!;
      for (let iy = a + 1; iy < b; iy++) out[iy * NT + t] = out[a * NT + t]! + ((out[b * NT + t]! - out[a * NT + t]!) * (iy - a)) / (b - a);
    }
  }
  return out;
}

const TORSO = /^(pelvis|spine_0\d|clavicle_[lr]|neck_0\d)$/i;
const HEAD = /^head$/i;

/**
 * Measure a body as dressed. `clothes`: what covers the torso; `headwear`: what stays on under a helmet;
 * `eyes`: their mesh, for the brow line (without it the brow is taken by the head's proportions).
 */
export function measureBody(
  body: THREE.SkinnedMesh,
  clothes: THREE.SkinnedMesh[],
  headwear: THREE.SkinnedMesh[],
  eyes: THREE.SkinnedMesh | null,
  bareBody = true,
): BodyFit | null {
  const bones = body.skeleton.bones;
  const bindInv = body.bindMatrix.clone().invert();
  const joint = (re: RegExp) => {
    const i = bones.findIndex((b) => re.test(b.name));
    if (i < 0) return null;
    return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(bindInv).multiply(new THREE.Matrix4().copy(body.skeleton.boneInverses[i]!).invert()));
  };
  const pelvis = joint(/^pelvis$/i);
  const s1 = joint(/^spine_01$/i);
  const s2 = joint(/^spine_02$/i);
  const s3 = joint(/^spine_03$/i);
  const neck = joint(/^neck_01$/i);
  const head = joint(HEAD);
  const shoulder = joint(/^upperarm_l$/i);
  if (!pelvis || !s1 || !s2 || !s3 || !neck || !head || !shoulder) return null;
  const k = (head.y - pelvis.y) / 0.7;
  const torso = bones.map((b) => TORSO.test(b.name));
  const skull = bones.map((b) => HEAD.test(b.name));
  const own = bindVerts(body, body);
  // The axis runs up the middle of the ribcage.
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < own.bone.length; i++) {
    if (!torso[own.bone[i]!]) continue;
    const y = own.pos[i * 3 + 1]!;
    if (y < s2.y || y > s3.y + (neck.y - s3.y) * 0.4) continue;
    zMin = Math.min(zMin, own.pos[i * 3 + 2]!);
    zMax = Math.max(zMax, own.pos[i * 3 + 2]!);
  }
  const y0 = pelvis.y - 0.16 * k;
  const blank = (): TorsoField => ({
    x0: pelvis.x,
    z0: Number.isFinite(zMin) ? (zMin + zMax) / 2 : s2.z,
    y0,
    ny: Math.ceil((neck.y + 0.07 * k - y0) / DY) + 1,
    r: new Float32Array((Math.ceil((neck.y + 0.07 * k - y0) / DY) + 1) * NT),
  });
  const bare = blank();
  raster(bare, own.pos, own.index, (i) => !!torso[own.bone[i]!]);
  const dressed: TorsoField = { ...bare, r: bare.r.slice() };
  if (!bareBody) dressed.r.fill(0);
  finish(bare);
  const worn = clothes.map((m) => bindVerts(m, body));
  for (const v of worn) raster(dressed, v.pos, v.index, (i) => !!torso[v.bone[i]!]);
  finish(dressed);

  // The head: crown, chin, brow line, and the skull's section above the brow.
  const heads = [...(bareBody ? [own] : worn), ...headwear.map((m) => bindVerts(m, body))];
  let crown = -Infinity;
  let chin = Infinity;
  for (const v of heads)
    for (let i = 0; i < v.bone.length; i++) {
      if (!skull[v.bone[i]!]) continue;
      crown = Math.max(crown, v.pos[i * 3 + 1]!);
      chin = Math.min(chin, v.pos[i * 3 + 1]!);
    }
  let headFit: HeadFit | null = null;
  if (Number.isFinite(crown)) {
    chin = Math.max(chin, head.y - 0.05 * k);
    let brow = crown - (crown - chin) * 0.4;
    if (eyes && bareBody) {
      const e = bindVerts(eyes, body);
      let sum = 0;
      for (let i = 0; i < e.bone.length; i++) sum += e.pos[i * 3 + 1]!;
      if (e.bone.length) brow = sum / e.bone.length + (crown - chin) * 0.13;
    }
    let halfW = 0;
    let back = Infinity;
    let front = -Infinity;
    for (const v of heads)
      for (let i = 0; i < v.bone.length; i++) {
        if (!skull[v.bone[i]!] || v.pos[i * 3 + 1]! < brow + 0.008 * k) continue;
        halfW = Math.max(halfW, Math.abs(v.pos[i * 3]! - head.x));
        back = Math.min(back, v.pos[i * 3 + 2]!);
        front = Math.max(front, v.pos[i * 3 + 2]!);
      }
    if (halfW > 0) headFit = { x: head.x, crown, brow, chin, halfW, back, front };
  }
  const spine = [/^pelvis$/i, /^spine_01$/i, /^spine_02$/i, /^spine_03$/i].map((re) => bones.findIndex((b) => re.test(b.name)));
  return { k, joints: { pelvis, spine_01: s1, spine_02: s2, spine_03: s3, neck, head, shoulder }, spine, bare, dressed, head: headFit };
}

/** The field with fitted gear on top of it: what the next layer (a rig over armour) rests on. */
export function withLayer(f: TorsoField, geos: THREE.BufferGeometry[]): TorsoField {
  const out: TorsoField = { ...f, r: f.r.slice() };
  for (const g of geos) raster(out, g.attributes.position!.array as ArrayLike<number>, g.index ? (g.index.array as ArrayLike<number>) : null, null);
  finish(out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vests and rigs
// ─────────────────────────────────────────────────────────────────────────────

const MB = 12;
const MS = 16;

/** A vest model's own cavity: where the body it was modelled for was. */
interface VestShape {
  x0: number;
  z0: number;
  yMin: number;
  yMax: number;
  /** Cavity radius per height band (from the top) and direction. */
  env: Float32Array;
  girth: number;
}

function vestShape(geos: THREE.BufferGeometry[]): VestShape {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const g of geos) {
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      yMin = Math.min(yMin, p.getY(i));
      yMax = Math.max(yMax, p.getY(i));
    }
  }
  const H = yMax - yMin;
  const pass = (x0: number, z0: number): Float32Array => {
    const cells: number[][] = Array.from({ length: MB * MS }, () => []);
    for (const g of geos) {
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        const b = Math.min(MB - 1, Math.floor(((yMax - p.getY(i)) / H) * MB));
        const x = p.getX(i) - x0;
        const z = p.getZ(i) - z0;
        const s = Math.min(MS - 1, Math.floor((((Math.atan2(z, x) / TAU) % 1) + 1) % 1 * MS));
        cells[b * MS + s]!.push(Math.hypot(x, z));
      }
    }
    const env = new Float32Array(MB * MS).fill(NaN);
    cells.forEach((c, i) => {
      if (!c.length) return;
      c.sort((a, b) => a - b);
      // The innermost vertices, bar a stray one.
      env[i] = c[Math.min(c.length - 1, Math.floor(c.length * 0.06))]!;
    });
    return env;
  };
  // The axis: midway between the cavity's walls (the bounds are thrown off by pouches and plates).
  const wall = (env: Float32Array, s: number) => {
    const v: number[] = [];
    for (let b = Math.floor(MB * 0.4); b < Math.floor(MB * 0.9); b++)
      for (const ds of [-1, 0, 1]) {
        const e = env[b * MS + ((s + ds + MS) % MS)]!;
        if (!Number.isNaN(e)) v.push(e);
      }
    v.sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)]! : NaN;
  };
  let x0 = 0;
  let z0 = 0;
  let env = pass(0, 0);
  for (let it = 0; it < 2; it++) {
    // Sector s covers angles s..s+1 of MS: +X is the seam between MS-1 and 0, +Z between MS/4-1 and MS/4.
    const right = wall(env, 0);
    const left = wall(env, MS / 2);
    const front = wall(env, MS / 4);
    const back = wall(env, (MS * 3) / 4);
    if (!Number.isNaN(right) && !Number.isNaN(left)) x0 += (right - left) / 2;
    if (!Number.isNaN(front) && !Number.isNaN(back)) z0 += (front - back) / 2;
    env = pass(x0, z0);
  }
  // Open sides and bare bands: take the cavity from round about, then from above and below.
  for (let b = 0; b < MB; b++) {
    const rowv = env.slice(b * MS, b * MS + MS);
    if (rowv.every((e) => Number.isNaN(e))) continue;
    for (let s = 0; s < MS; s++) {
      if (!Number.isNaN(rowv[s]!)) continue;
      let a = 1;
      while (Number.isNaN(rowv[(s - a + MS) % MS]!)) a++;
      let c = 1;
      while (Number.isNaN(rowv[(s + c) % MS]!)) c++;
      env[b * MS + s] = (rowv[(s - a + MS) % MS]! * c + rowv[(s + c) % MS]! * a) / (a + c);
    }
  }
  for (let b = 0; b < MB; b++) {
    if (!Number.isNaN(env[b * MS]!)) continue;
    let o = 1;
    while (o < MB && Number.isNaN(env[Math.min(MB - 1, b + o) * MS]!) && Number.isNaN(env[Math.max(0, b - o) * MS]!)) o++;
    const from = !Number.isNaN(env[Math.min(MB - 1, b + o) * MS]!) ? Math.min(MB - 1, b + o) : Math.max(0, b - o);
    for (let s = 0; s < MS; s++) env[b * MS + s] = env[from * MS + s]!;
  }
  const sm = env.slice();
  for (let b = 0; b < MB; b++)
    for (let s = 0; s < MS; s++) env[b * MS + s] = (sm[b * MS + ((s + MS - 1) % MS)]! + 2 * sm[b * MS + s]! + sm[b * MS + ((s + 1) % MS)]!) / 4;
  let girth = 0;
  let n = 0;
  for (let b = Math.floor(MB * 0.45); b < Math.floor(MB * 0.9); b++)
    for (let s = 0; s < MS; s++) {
      girth += env[b * MS + s]!;
      n++;
    }
  return { x0, z0, yMin, yMax, env, girth: girth / n };
}

function cavity(sh: VestShape, th: number, y: number): number {
  const fb = THREE.MathUtils.clamp(((sh.yMax - y) / (sh.yMax - sh.yMin)) * MB - 0.5, 0, MB - 1);
  const b0 = Math.min(MB - 2, Math.floor(fb));
  const tb = fb - b0;
  let fs = ((((th / TAU) % 1) + 1) % 1) * MS - 0.5;
  if (fs < 0) fs += MS;
  const s0 = Math.floor(fs) % MS;
  const s1 = (s0 + 1) % MS;
  const ts = fs - Math.floor(fs);
  const at = (b: number) => sh.env[b * MS + s0]! * (1 - ts) + sh.env[b * MS + s1]! * ts;
  return at(b0) * (1 - tb) + at(b0 + 1) * tb;
}

export interface VestOptions {
  fit?: FitHandles;
  /** 'shoulders' (default): hangs by its straps. 'belt': sits round the waist. */
  anchor?: 'shoulders' | 'belt';
  /** Where its bottom edge should come, from spine_01 (0, about the navel) to spine_02 (1, the lower ribs). */
  hem?: number;
}

/**
 * Wrap a vest or rig model (as wornGear gives it: front to +Z) onto `under`, the surface it rests on. Returns one
 * geometry per mesh of the model, in the body's bind space, with skin weights for the body's skeleton.
 */
export function fitVest(obj: THREE.Object3D, bf: BodyFit, under: TorsoField, opt: VestOptions = {}): { geos: THREE.BufferGeometry[]; materials: (THREE.Material | THREE.Material[])[] } {
  obj.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
  const sh = vestShape(geos);
  const f = opt.fit ?? {};
  const k = bf.k;
  const J = bf.joints;
  const gap = (f.gap ?? 0.012) * k;
  const skin = 0.004 * k;

  // Where the wrap stops and the model keeps its own shape: under the arms at the sides, at the collarbones in
  // front and behind.
  const ySide = J.shoulder.y - 0.085 * k;
  const yMid = J.shoulder.y + 0.005 * k;
  const yHi = new Float32Array(NT);
  const freeze = (th: number) => ySide + (yMid - ySide) * THREE.MathUtils.smoothstep(Math.abs(Math.sin(th)), 0.55, 0.9);
  for (let t = 0; t < NT; t++) yHi[t] = freeze(((t + 0.5) / NT) * TAU);

  // One scale for the model's height and for everything that stands off the cavity: by the bare body's girth, so
  // a jacket under the vest widens it and doesn't grow its pouches.
  let girth = 0;
  let n = 0;
  for (let y = J.spine_02.y; y <= ySide - 0.02 * k; y += DY)
    for (let t = 0; t < NT; t++) {
      girth += sample(bf.bare, bf.bare.r, ((t + 0.5) / NT) * TAU, y);
      n++;
    }
  // (A vest is cut to go over a uniform, not bare skin: a little larger than the body alone.)
  const s = ((girth / n) * 1.08 / sh.girth) * (f.size ?? 1);
  // Its length is the model's own, scaled with it, unless that leaves it ending high on the ribs or low on the
  // hips: then it is stretched (or squashed) towards its hem landmark, a carrier's bottom edge just above the navel.
  const yHem = J.spine_01.y + (J.spine_02.y - J.spine_01.y) * (opt.hem ?? 0.3);
  let sy = s * (f.h ?? 1);
  const toHem = () => {
    if (opt.anchor === 'belt') return;
    sy = THREE.MathUtils.clamp((yTop - yHem) / H, s * 0.9, s * 1.3) * (f.h ?? 1);
  };
  const H = sh.yMax - sh.yMin;

  // Shoulder line: the top of the body midway between neck and shoulder joint.
  const neckR = Math.abs(J.shoulder.x - under.x0) * 0.6;
  const strapR = neckR;
  const ySh = Math.max(topAt(under, 0, strapR) || J.shoulder.y, topAt(under, Math.PI, strapR) || J.shoulder.y);
  let yTop =
    opt.anchor === 'belt'
      ? (J.pelvis.y + J.spine_01.y) / 2 + (H * sy) / 2
      : ySh + 0.12 * k;
  yTop += (f.y ?? 0) * (J.neck.y - J.spine_02.y);
  toHem();

  let target = taut(under, yTop - H * sy - 0.06 * k, yHi);
  const w = f.w ?? 1;
  const d = f.d ?? 1;

  // What lies over the shoulders (straps, a yoke) is cloth: the vest hangs so the highest of it rests on the
  // shoulder, and the rest of it is lifted onto the body rather than held in the arch it was modelled in. Worked
  // out per column of the model, from each column's underside, so a strap keeps its thickness.
  const G = 16;
  const yRef = sh.yMax - H * 0.55;
  let yStrap = sh.yMax - H * 0.3;
  let E = 0;
  for (const e of sh.env) E = Math.max(E, e);
  E *= 1.05;
  const ceil = new Float32Array(G * G).fill(NaN);
  const lift = new Float32Array(G * G).fill(NaN);
  const gcell = (c: number) => ((c + E) / (2 * E)) * G - 0.5;
  const undersides = () => {
    ceil.fill(NaN);
    for (const g of geos) {
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < yStrap) continue;
        const c = THREE.MathUtils.clamp(Math.round(gcell(p.getZ(i) - sh.z0)), 0, G - 1) * G + THREE.MathUtils.clamp(Math.round(gcell(p.getX(i) - sh.x0)), 0, G - 1);
        if (!(ceil[c]! <= y)) ceil[c] = y;
      }
    }
  };
  const liftAt = (dx: number, dz: number): number => {
    const fx = THREE.MathUtils.clamp(gcell(dx), 0, G - 1);
    const fz = THREE.MathUtils.clamp(gcell(dz), 0, G - 1);
    const x0 = Math.min(G - 2, Math.floor(fx));
    const z0 = Math.min(G - 2, Math.floor(fz));
    let sum = 0;
    let ws = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++) {
        const v = lift[(z0 + a) * G + x0 + b]!;
        if (Number.isNaN(v)) continue;
        const wgt = (a ? fz - z0 : 1 - (fz - z0)) * (b ? fx - x0 : 1 - (fx - x0)) + 1e-4;
        sum += v * wgt;
        ws += wgt;
      }
    return ws > 0 ? sum / ws : 0;
  };

  const out = new THREE.Vector3();
  /** Model point → body bind space, by the current `yTop`. Returns the direction round the axis. */
  const place = (x: number, y: number, z: number): number => {
    let yb = yTop - (sh.yMax - y) * sy;
    const dx = x - sh.x0;
    const dz = z - sh.z0;
    const th = Math.atan2(dz, dx);
    const r = Math.hypot(dx, dz);
    const yf = freeze(th);
    const over = Math.max(0, yb - yf);
    const cav = cavity(sh, th, y - over / sy);
    const tgt = sample(under, target, th, yb - over) * Math.hypot(w * Math.cos(th), d * Math.sin(th)) + gap;
    let rb = s * r + (tgt - s * cav) * Math.min(1, r / cav);
    if (y >= yStrap && opt.anchor !== 'belt') yb += liftAt(dx, dz) * THREE.MathUtils.smoothstep(yb - yf, -0.01 * k, 0.03 * k);
    // Never inside what's under it: out, or for a strap over the shoulder, up.
    // (A soft collar gives way: round the neck the straps go where the model has them.)
    const real = sample(under, under.r, th, yb) + skin;
    if (rb < real && !(yb > ySide && rb < neckR * 1.35)) {
      let up = NaN;
      if (yb > yf - 0.03 * k)
        for (let yy = yb + DY / 2; yy < yb + 0.12 * k; yy += DY / 2)
          if (sample(under, under.r, th, yy) + skin <= rb) {
            up = yy;
            break;
          }
      if (!Number.isNaN(up) && up - yb < (real - rb) * 1.5) yb = up;
      else rb = real;
    }
    out.set(under.x0 + rb * Math.cos(th), yb, under.z0 + rb * Math.sin(th));
    return th;
  };

  // How high the vest must ride for each column over the shoulders to clear them. Twice: what counts as over the
  // shoulders (above the armpits) depends on how high it rides.
  const need: number[] = [];
  const needAt = new Float32Array(G * G);
  const yFree = yTop;
  for (let pass = 0; pass < 3; pass++) {
    if (pass) toHem();
    undersides();
    need.length = 0;
    needAt.fill(NaN);
    lift.fill(NaN);
    for (let cz = 0; cz < G; cz++)
      for (let cx = 0; cx < G; cx++) {
        const c = cz * G + cx;
        if (Number.isNaN(ceil[c]!)) continue;
        lift[c] = 0;
        const dx = ((cx + 0.5) / G) * 2 * E - E;
        const dz = ((cz + 0.5) / G) * 2 * E - E;
        const th = Math.atan2(dz, dx);
        if (Math.abs(Math.cos(th)) < 0.6) continue;
        const r = Math.hypot(dx, dz);
        const cav = cavity(sh, th, yRef);
        const rb = s * r + (sample(under, target, th, ySide) + gap - s * cav) * Math.min(1, r / cav);
        const top = topAt(under, th, rb);
        if (rb < neckR || Number.isNaN(top) || top < ySide) continue;
        needAt[c] = top + gap + (sh.yMax - ceil[c]!) * sy;
        need.push(needAt[c]!);
      }
    if (opt.anchor === 'belt') break;
    need.sort((a, b) => a - b);
    yTop = (need.length ? need[Math.floor((need.length - 1) * 0.15)]! : yFree - 0.12 * k + H * sy * 0.02) + (f.y ?? 0) * (J.neck.y - J.spine_02.y);
    yStrap = sh.yMax - (yTop - ySide - 0.015 * k) / sy;
  }
  for (let c = 0; c < G * G; c++) if (!Number.isNaN(needAt[c]!)) lift[c] = Math.max(0, needAt[c]! - yTop);

  target = taut(under, yTop - H * sy - 0.06 * k, yHi);
  // Spine weights by height: each bone's share peaks mid-way along it.
  const mids = [
    (J.pelvis.y + J.spine_01.y) / 2,
    (J.spine_01.y + J.spine_02.y) / 2,
    (J.spine_02.y + J.spine_03.y) / 2,
    (J.spine_03.y + J.neck.y) / 2,
  ];
  for (const g of geos) {
    const p = g.attributes.position!;
    const I = new Uint16Array(p.count * 4);
    const W = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      place(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, out.x, out.y, out.z);
      let seg = 0;
      while (seg < 2 && out.y > mids[seg + 1]!) seg++;
      const u = THREE.MathUtils.smoothstep(out.y, mids[seg]!, mids[seg + 1]!);
      I[i * 4] = bf.spine[seg]!;
      I[i * 4 + 1] = bf.spine[seg + 1]!;
      W[i * 4] = 1 - u;
      W[i * 4 + 1] = u;
    }
    p.needsUpdate = true;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(I, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return { geos, materials: meshes.map((m) => m.material) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helmets
// ─────────────────────────────────────────────────────────────────────────────

export interface HelmetOptions {
  /** The shell: this share of the model's height from its top (straps and headsets hang below it). */
  shell?: number;
  /** Where the front rim sits on the brow, as a share of the model's height from its top; found from the shell if
   * not given. A helmet with its visor or faceplate down needs it (the lowest point in front is the visor's edge). */
  brow?: number;
  fit?: FitHandles;
}

/**
 * Seat a helmet model on a measured head by its landmarks: the shell's width and depth round the skull with room
 * for the liner, its front rim on the brow line and its top just clear of the crown (the height is scaled for that,
 * within reason, so a deep pot doesn't come down over the eyes and a shallow one doesn't perch). A procedural model
 * names its shell in `userData.shell`; then that mesh's bounds are the shell and its lowest point the rim.
 * Returns the model wrapped and placed in the body's bind space.
 */
export function fitHelmet(obj: THREE.Object3D, head: HeadFit, k: number, opt: HelmetOptions = {}): THREE.Object3D {
  obj.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(obj);
  const H = all.max.y - all.min.y;
  const named = obj.userData.shell as THREE.Object3D | undefined;
  const cut = named ? -Infinity : all.max.y - H * (opt.shell ?? 1) - 1e-4;
  const shell = new THREE.Box3();
  const pts: number[] = [];
  const v = new THREE.Vector3();
  (named ?? obj).traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y < cut) continue;
      shell.expandByPoint(v);
      pts.push(v.x, v.y, v.z);
    }
  });
  const ss = shell.getSize(new THREE.Vector3());
  const sc = shell.getCenter(new THREE.Vector3());
  let rim = shell.min.y;
  if (opt.brow !== undefined) rim = all.max.y - H * opt.brow;
  else if (!named) {
    // The lowest point of the shell's front, in the middle.
    let low = Infinity;
    for (let i = 0; i < pts.length; i += 3)
      if (pts[i + 2]! > shell.max.z - ss.z * 0.22 && Math.abs(pts[i]! - sc.x) < ss.x * 0.22) low = Math.min(low, pts[i + 1]!);
    if (Number.isFinite(low)) rim = low;
  }
  const top = shell.max.y;
  // The dome itself, not its bounds: a faceplate, goggles or a night-vision mount stand off its front and would
  // push it back off the forehead. Its centre from the cap (well above anything hung on the front), its width
  // and depth from the band between rim and cap, the depth taken from the back (nothing hangs there).
  // (Measured over the dome's own depth, whatever the rim landmark says: a visor-down Altyn's brow is high up.)
  const base = Math.min(rim, top - (top - shell.min.y) * 0.45);
  const capY = base + (top - base) * 0.7;
  const band0 = base + (top - base) * 0.2;
  const cap = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1]! >= capY) cap.expandByPoint(v.set(pts[i]!, pts[i + 1]!, pts[i + 2]!));
  const cx = cap.isEmpty() ? sc.x : (cap.min.x + cap.max.x) / 2;
  const inBand = (i: number) => pts[i + 1]! >= band0 && pts[i + 1]! <= capY;
  let halfX = 0;
  for (let i = 0; i < pts.length; i += 3) if (inBand(i)) halfX = Math.max(halfX, Math.abs(pts[i]! - cx));
  // Front to back, the dome is widest at its middle: that is where its centre is (the cap's own centre is pulled
  // forward by a visor hinge or a night-vision mount).
  let zs = 0;
  let zn = 0;
  for (let i = 0; i < pts.length; i += 3)
    if (inBand(i) && Math.abs(pts[i]! - cx) > halfX * 0.88) {
      zs += pts[i + 2]!;
      zn++;
    }
  const cz = zn ? zs / zn : cap.isEmpty() ? sc.z : (cap.min.z + cap.max.z) / 2;
  let back = 0;
  for (let i = 0; i < pts.length; i += 3) if (inBand(i)) back = Math.max(back, cz - pts[i + 2]!);
  const domeW = halfX > 0 ? halfX * 2 : ss.x;
  const domeD = back > 0 ? back * 2 : ss.z;
  const f = opt.fit ?? {};
  const pad = 0.035 * k;
  const wide = (head.halfW * 2 + pad * 2) * (f.w ?? 1);
  const deep = (head.front - head.back + pad * 2) * (f.d ?? 1);
  // One scale where it can be: a helmet squashed to the head's proportions stops looking like itself.
  const k0 = Math.max(wide / domeW, deep / domeD);
  const kx = Math.max(wide / domeW, k0 * 0.9);
  const kz = Math.max(deep / domeD, k0 * 0.9);
  const kxz = Math.sqrt(kx * kz);
  // Height: from the brow to just over the crown, as far as the model's own proportions allow.
  const clear = 0.03 * k;
  // The dome's own top, over its centre: a knob, a visor hinge or a mount can stand higher than the shell.
  let crown = -Infinity;
  const rr = Math.max(domeW, domeD) * 0.14;
  for (let i = 0; i < pts.length; i += 3) if (Math.hypot(pts[i]! - cx, pts[i + 2]! - cz) < rr) crown = Math.max(crown, pts[i + 1]!);
  if (!Number.isFinite(crown) || crown < rim) crown = top;
  const ky = THREE.MathUtils.clamp((head.crown + clear - head.brow) / Math.max(1e-6, crown - rim), kxz * 0.78, kxz * 1.12) * (f.h ?? 1);
  // Rim on the brow; if the model is too deep for that, it rides a little high rather than over the eyes, and if
  // too shallow it rests on the crown.
  const yCrown = THREE.MathUtils.clamp(head.brow + (crown - rim) * ky, head.crown + 0.028 * k, head.crown + 0.05 * k);
  const yTop = yCrown + (top - crown) * ky;
  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.position.set(-cx, -top, -cz);
  wrap.scale.set(kx, ky, kz);
  // Centred over the skull, a touch back: the face is flatter than the back of the head.
  wrap.position.set(head.x, yTop + (f.y ?? 0) * (head.crown - head.chin), (head.front + head.back) / 2 - 0.004 * k);
  return wrap;
}

/**
 * A helmet's liner: a cap over the skull down to the brow line, a little proud of the scalp. It fills what a model
 * leaves open (the Altyn's cut-out above its faceplate, vents, the gap under a FAST's rails) so the scalp never
 * shows through, and reads as padding under the rim. In the body's bind space, like the fitted helmet.
 */
export function helmetLiner(head: HeadFit, k: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const pad = 0.012 * k;
  g.scale(head.halfW + pad, head.crown - head.brow + pad, (head.front - head.back) / 2 + pad);
  g.translate(head.x, head.brow, (head.front + head.back) / 2);
  return g;
}
