import * as THREE from 'three';
import { pieces } from './gearModels';

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
  /** Bone indices of each side's clavicle and upper arm, the side of `joints.shoulder` (upperarm_l) first
   * (-1 when missing). */
  shoulders?: { clav: number[]; arm: number[]; pts?: Float32Array };
  /** The body alone, and with its clothes on. */
  bare: TorsoField;
  dressed: TorsoField;
  head: HeadFit | null;
  /** The torso's vertices as dressed (bind space) with their weights on the torso's bones (body skeleton
   * indices, 4 a vertex): what laid-on gear (a pack's straps) copies to move as the clothes under it do. */
  skin?: { pos: Float32Array; bi: Int16Array; bw: Float32Array; arms: number[] };
}

/** Per-model handles (gearModels.ts `fit`): all optional, all relative to the measured fit. */
export interface FitHandles {
  w?: number;
  d?: number;
  h?: number;
  y?: number;
  size?: number;
  gap?: number;
  /** Vests and rigs: how far what stands off the cavity (pouches, plates) stands off, times its own. */
  bulk?: number;
  /** Vests with shoulder caps (meshes named `cap…`): nudges, in body units (k), from where they're seated (on top of
   * the dressed shoulder, outer edge just past the sleeve): `x` outwards, `y` up, `z` forwards. */
  cap?: { x?: number; y?: number; z?: number };
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
  // Torso skin samples: the body (when it shows) and the clothes on it, their torso and upper-arm weights (the
  // clothes over the shoulder blades and the shoulders' tops follow the upper arms too).
  const arm = bones.map((b) => /^upperarm_[lr]$/i.test(b.name));
  const sp: number[] = [];
  const sbi: number[] = [];
  const sbw: number[] = [];
  const meshes = bareBody ? [body, ...clothes] : clothes;
  meshes.forEach((m, mi) => {
    const vs = m === body ? own : worn[mi - (bareBody ? 1 : 0)]!;
    const si = m.geometry.attributes.skinIndex!;
    const sw = m.geometry.attributes.skinWeight!;
    const lut = m.skeleton.bones.map((b) => {
      const j = bones.indexOf(b);
      return j >= 0 ? j : bones.findIndex((x) => x.name === b.name);
    });
    for (let i = 0; i < vs.bone.length; i++) {
      const y = vs.pos[i * 3 + 1]!;
      if (y < pelvis.y - 0.05 * k || y > neck.y + 0.05 * k) continue;
      let sum = 0;
      let core = 0;
      const ws: number[] = [];
      for (let c = 0; c < 4; c++) {
        const j = lut[si.getComponent(i, c)] ?? -1;
        const w = sw.getComponent(i, c);
        if (j < 0 || w <= 0 || !(torso[j] || arm[j])) continue;
        ws.push(j, w);
        sum += w;
        if (torso[j]) core += w;
      }
      // Not the sleeves (the arm's own): only what the torso carries at least half of.
      if (sum < 0.5 || core < 0.15 * sum) continue;
      sp.push(vs.pos[i * 3]!, y, vs.pos[i * 3 + 2]!);
      for (let c = 0; c < 4; c++) {
        sbi.push(c * 2 < ws.length ? ws[c * 2]! : 0);
        sbw.push(c * 2 < ws.length ? ws[c * 2 + 1]! / sum : 0);
      }
    }
  });
  const skin = {
    pos: new Float32Array(sp),
    bi: new Int16Array(sbi),
    bw: new Float32Array(sbw),
    arms: bones.flatMap((_, i) => (arm[i] ? [i] : [])),
  };
  const bi = (re: RegExp) => bones.findIndex((b) => re.test(b.name));
  // The shoulders as dressed (body when it shows, and the clothes): what a vest's shoulder caps must sit on.
  const shoulderBone = bones.map((b) => /^(clavicle|upperarm)_[lr]$/i.test(b.name) || TORSO.test(b.name));
  const jx = Math.abs(shoulder.x - pelvis.x);
  const sp2: number[] = [];
  for (const v of bareBody ? [own, ...worn] : worn)
    for (let i = 0; i < v.bone.length; i++) {
      const y = v.pos[i * 3 + 1]!;
      if (!shoulderBone[v.bone[i]!] || y < shoulder.y - 0.16 * k || y > neck.y + 0.04 * k) continue;
      if (Math.abs(v.pos[i * 3]! - pelvis.x) < jx * 0.45) continue;
      sp2.push(v.pos[i * 3]!, y, v.pos[i * 3 + 2]!);
    }
  const shoulders = { clav: [bi(/^clavicle_l$/i), bi(/^clavicle_r$/i)], arm: [bi(/^upperarm_l$/i), bi(/^upperarm_r$/i)], pts: new Float32Array(sp2) };
  return { k, joints: { pelvis, spine_01: s1, spine_02: s2, spine_03: s3, neck, head, shoulder }, spine, shoulders, bare, dressed, head: headFit, skin };
}

/**
 * Positions as plain floats. gear.glb is meshopt-quantized (KHR_mesh_quantization): its positions are normalized
 * int16, so a fitted vertex written back is clamped to ±1 of the model's units and the raw array holds integers
 * (a rig over armour read the armour as 12 km wide and burst into spikes round the player).
 */
export function floatPositions(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position!;
  if (p.array instanceof Float32Array && !p.normalized && !(p as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return g;
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    a[i * 3] = p.getX(i);
    a[i * 3 + 1] = p.getY(i);
    a[i * 3 + 2] = p.getZ(i);
  }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * Splits every edge longer than `max` (all attributes interpolated, normals renormalised) until none is. The wrap
 * bends a model round the body, but a triangle stays flat between its corners: a large one cut its chord into the
 * chest (the sweater showed through the 6B23 as dark flecks), and of two layers a few mm apart, tessellated
 * differently (a pouch flap and its lining), the coarse one sagged through the fine one (dark holes in the pc_tan's
 * flaps). An edge is split by its length alone, so neighbours split it alike and no cracks open. Groups are kept.
 */
export function subdivideLong(g: THREE.BufferGeometry, max: number): THREE.BufferGeometry {
  const pos = g.attributes.position!;
  const names = Object.keys(g.attributes);
  const data: Record<string, number[]> = {};
  const size: Record<string, number> = {};
  for (const n of names) {
    const a = g.attributes[n]!;
    size[n] = a.itemSize;
    const arr: number[] = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr.push(a.getComponent(i, c));
    data[n] = arr;
  }
  let count = pos.count;
  let idx: number[] = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i);
  let groups = g.groups.length ? g.groups.map((q) => ({ ...q })) : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const P = data.position!;
  const len = (a: number, b: number) => Math.hypot(P[a * 3]! - P[b * 3]!, P[a * 3 + 1]! - P[b * 3 + 1]!, P[a * 3 + 2]! - P[b * 3 + 2]!);
  const mid = new Map<string, number>();
  const midOf = (a: number, b: number): number => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let m = mid.get(key);
    if (m !== undefined) return m;
    m = count++;
    for (const n of names) {
      const s = size[n]!;
      const d = data[n]!;
      for (let c = 0; c < s; c++) d.push((d[a * s + c]! + d[b * s + c]!) / 2);
      if (n === 'normal') {
        const o = m * 3;
        const l = Math.hypot(d[o]!, d[o + 1]!, d[o + 2]!) || 1;
        for (let c = 0; c < 3; c++) d[o + c] = d[o + c]! / l;
      }
    }
    mid.set(key, m);
    return m;
  };
  for (let pass = 0; pass < 8; pass++) {
    let split = false;
    const out: number[] = [];
    const ng: typeof groups = [];
    for (const grp of groups) {
      const start = out.length;
      for (let t = grp.start; t < grp.start + grp.count; t += 3) {
        const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const long = [len(v[0]!, v[1]!) > max, len(v[1]!, v[2]!) > max, len(v[2]!, v[0]!) > max];
        const nl = long.filter(Boolean).length;
        if (!nl) {
          out.push(v[0]!, v[1]!, v[2]!);
          continue;
        }
        split = true;
        if (nl === 3) {
          const ab = midOf(v[0]!, v[1]!);
          const bc = midOf(v[1]!, v[2]!);
          const ca = midOf(v[2]!, v[0]!);
          out.push(v[0]!, ab, ca, ab, v[1]!, bc, ca, bc, v[2]!, ab, bc, ca);
          continue;
        }
        // Rotate so the (first) long edge is a→b.
        let r = long.indexOf(true);
        if (nl === 2 && long[(r + 2) % 3]) r = (r + 2) % 3;
        const a = v[r]!;
        const b = v[(r + 1) % 3]!;
        const c = v[(r + 2) % 3]!;
        const ab = midOf(a, b);
        if (nl === 1) {
          out.push(a, ab, c, ab, b, c);
        } else {
          // a→b and b→c long.
          const bc = midOf(b, c);
          out.push(a, ab, c, ab, b, bc, ab, bc, c);
        }
      }
      ng.push({ start, count: out.length - start, materialIndex: grp.materialIndex });
    }
    idx = out;
    groups = ng;
    if (!split) break;
  }
  const o = new THREE.BufferGeometry();
  for (const n of names) {
    const a = g.attributes[n]!;
    const s = size[n]!;
    const d = data[n]!;
    const norm = a.normalized;
    // Plain floats unless a normalised integer type (colours, skin weights) must stay so.
    const Ctor = (a.array as unknown as { constructor: new (n: number) => Float32Array }).constructor;
    const arr = norm ? new Ctor(d.length) : new Float32Array(d.length);
    const at = new THREE.BufferAttribute(arr, s, norm);
    for (let i = 0; i < count; i++) for (let c = 0; c < s; c++) at.setComponent(i, c, d[i * s + c]!);
    o.setAttribute(n, at);
  }
  o.setIndex(idx);
  if (g.groups.length) for (const q of groups) o.addGroup(q.start, q.count, q.materialIndex);
  return o;
}

/** The field with fitted gear on top of it: what the next layer (a rig over armour) rests on. */
/**
 * Armour under a rig: what stands further off the surface under it than `room` (its pouches, its MOLLE) is pressed in
 * to that, as the rig over it would press it. The rig rests on the armour capped at the same `room` (withLayer), so
 * otherwise those pouches came out through it in dark chunks. Copies; the armour on its own keeps its own.
 */
export function pressUnder(geos: THREE.BufferGeometry[], f: TorsoField, room: number): THREE.BufferGeometry[] {
  const yHi = f.y0 + (f.ny - 1) * DY;
  return geos.map((g0) => {
    const g = floatPositions(g0.clone());
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < f.y0 || y > yHi) continue;
      const x = p.getX(i) - f.x0;
      const z = p.getZ(i) - f.z0;
      const th = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      const lim = sample(f, f.r, th, y) + room;
      if (!(lim > room) || r <= lim) continue;
      p.setXYZ(i, f.x0 + (x * lim) / r, y, f.z0 + (z * lim) / r);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  });
}

export function withLayer(f: TorsoField, geos: THREE.BufferGeometry[], cap = Infinity): TorsoField {
  const out: TorsoField = { ...f, r: f.r.slice() };
  for (const g of geos) raster(out, floatPositions(g).attributes.position!.array as ArrayLike<number>, g.index ? (g.index.array as ArrayLike<number>) : null, null);
  finish(out);
  // `cap`: at most this much over what was under it. A rig goes over a carrier's shell and presses its pouches in;
  // resting on their tops it stood off the chest like a barrel, its straps looping wide round the shoulders.
  if (Number.isFinite(cap)) for (let i = 0; i < out.r.length; i++) if (f.r[i]! > 0) out.r[i] = Math.min(out.r[i]!, f.r[i]! + cap);
  return out;
}

/**
 * The surface with thin things standing off it taken down: a collar's points, an epaulette, a flap, a strap of the
 * clothes, which a vest's strap would otherwise be lifted onto or pushed out round one vertex at a time (and so
 * torn into shards). Each cell at most a little over the median of the cells round it (±2 slices, ±3 directions).
 */
function despike(f: TorsoField, k: number): TorsoField {
  const r = f.r.slice();
  const tol = 0.01 * k;
  const nb: number[] = [];
  for (let iy = 0; iy < f.ny; iy++)
    for (let t = 0; t < NT; t++) {
      const here = f.r[iy * NT + t]!;
      if (!(here > 0)) continue;
      nb.length = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const y = iy + dy;
        if (y < 0 || y >= f.ny) continue;
        for (let dt = -3; dt <= 3; dt++) {
          const s = f.r[y * NT + ((t + dt + NT) % NT)]!;
          if (s > 0) nb.push(s);
        }
      }
      if (nb.length < 8) continue;
      nb.sort((a, b) => a - b);
      r[iy * NT + t] = Math.min(here, nb[nb.length >> 1]! + tol);
    }
  return { ...f, r };
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
  /** The same, by the innermost vertex (env leaves the odd stray out). */
  inner: Float32Array;
  girth: number;
}

function vestShape(geos: THREE.BufferGeometry[], fine = geos): VestShape {
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
  const pass = (x0: number, z0: number, q = 0.06, from = geos): Float32Array => {
    const cells: number[][] = Array.from({ length: MB * MS }, () => []);
    for (const g of from) {
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        const b = THREE.MathUtils.clamp(Math.floor(((yMax - p.getY(i)) / H) * MB), 0, MB - 1);
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
      env[i] = c[Math.min(c.length - 1, Math.floor(c.length * q))]!;
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
  const fill = (env: Float32Array, low = false): Float32Array => {
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
      for (let s = 0; s < MS; s++) {
        if (!low) {
          env[b * MS + s] = (sm[b * MS + ((s + MS - 1) % MS)]! + 2 * sm[b * MS + s]! + sm[b * MS + ((s + 1) % MS)]!) / 4;
          continue;
        }
        // The lowest round about (it's read between cells: an average would lift it over what's in them).
        let m = Infinity;
        for (let db = -1; db <= 1; db++)
          for (let ds = -1; ds <= 1; ds++) {
            const bb = b + db;
            if (bb >= 0 && bb < MB) m = Math.min(m, sm[bb * MS + ((s + ds + MS) % MS)]!);
          }
        env[b * MS + s] = m;
      }
    return env;
  };
  fill(env);
  // The innermost of the model in each place (its panels' insides), as it's placed: subdivided, a big flat panel's
  // middle lies well inside its corners. See `place` in fitVest.
  const inner = fill(pass(x0, z0, 0, fine), true);
  let girth = 0;
  let n = 0;
  for (let b = Math.floor(MB * 0.45); b < Math.floor(MB * 0.9); b++)
    for (let s = 0; s < MS; s++) {
      girth += env[b * MS + s]!;
      n++;
    }
  return { x0, z0, yMin, yMax, env, inner, girth: girth / n };
}

/**
 * A vest model's armpit: the top of its side panels, where the arm comes out. Going up the sides (within 30° of
 * ±X) from mid-chest, the last height where the model still reaches out as far as its side panel does there; the
 * straps over the shoulders lie further in, so they end it. Kept between a sixth and two thirds of the way down.
 */
function modelArmpit(geos: THREE.BufferGeometry[], sh: VestShape): number {
  const H = sh.yMax - sh.yMin;
  const N = 60;
  const yRef = sh.yMax - H * 0.6;
  const hit = new Uint8Array(N);
  for (const g of geos) {
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) - sh.x0;
      const z = p.getZ(i) - sh.z0;
      const th = Math.atan2(z, x);
      if (Math.abs(Math.cos(th)) < 0.86) continue;
      if (Math.hypot(x, z) < cavity(sh, th, yRef) * 0.85) continue;
      hit[Math.min(N - 1, Math.max(0, Math.floor(((p.getY(i) - sh.yMin) / H) * N)))] = 1;
    }
  }
  let b = Math.floor(((yRef - sh.yMin) / H) * N);
  let miss = 0;
  let top = b;
  for (; b < N; b++) {
    if (hit[b]) {
      top = b;
      miss = 0;
    } else if (++miss > 2) break;
  }
  const y = sh.yMin + ((top + 1) / N) * H;
  return THREE.MathUtils.clamp(y, sh.yMax - H * 0.66, sh.yMax - H * 0.17);
}

function cavity(sh: VestShape, th: number, y: number, env = sh.env): number {
  const fb = THREE.MathUtils.clamp(((sh.yMax - y) / (sh.yMax - sh.yMin)) * MB - 0.5, 0, MB - 1);
  const b0 = Math.min(MB - 2, Math.floor(fb));
  const tb = fb - b0;
  let fs = ((((th / TAU) % 1) + 1) % 1) * MS - 0.5;
  if (fs < 0) fs += MS;
  const s0 = Math.floor(fs) % MS;
  const s1 = (s0 + 1) % MS;
  const ts = fs - Math.floor(fs);
  const at = (b: number) => env[b * MS + s0]! * (1 - ts) + env[b * MS + s1]! * ts;
  return at(b0) * (1 - tb) + at(b0 + 1) * tb;
}

export interface VestOptions {
  fit?: FitHandles;
  /** 'shoulders' (default): hangs by its straps. 'belt': sits round the waist. */
  anchor?: 'shoulders' | 'belt';
  /** Where its bottom edge should come, from spine_01 (0, about the navel) to spine_02 (1, the lower ribs). */
  hem?: number;
  /** The model's armpit (top of its side panels) as a share of its height from the top; found if not given. */
  arm?: number;
}

/**
 * Wrap a vest or rig model (as wornGear gives it: front to +Z) onto `under`, the surface it rests on. Returns one
 * geometry per mesh of the model, in the body's bind space, with skin weights for the body's skeleton.
 */
export function fitVest(obj: THREE.Object3D, bf: BodyFit, under: TorsoField, opt: VestOptions = {}): { geos: THREE.BufferGeometry[]; materials: (THREE.Material | THREE.Material[])[]; info: Record<string, number> } {
  obj.updateMatrixWorld(true);
  under = despike(under, bf.k);
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const all = meshes.map((m) => floatPositions(m.geometry.clone()).applyMatrix4(m.matrixWorld));
  // Shoulder caps (separate meshes named `cap…`) are rigid: seated on the shoulder joints, not wrapped, and left
  // out of the model's own shape.
  const isCap = meshes.map((m) => /^cap/i.test(m.name));
  const raw = all.filter((_, i) => !isCap[i]);
  // Fine enough that the wrap's bend shows in the surface, not only at the model's own corners (subdivideLong).
  // The model's own shape (cavity, armpit, strap undersides) is still measured on its own vertices (`raw`).
  const tall = new THREE.Box3();
  for (const g of raw) tall.union((g.computeBoundingBox(), g.boundingBox!));
  const geos = all.map((g, i) => (isCap[i] ? g : subdivideLong(g, (tall.max.y - tall.min.y) / 14)));
  const sh = vestShape(raw, geos.filter((_, i) => !isCap[i]));
  const f = opt.fit ?? {};
  const k = bf.k;
  const J = bf.joints;
  const gap = (f.gap ?? 0.012) * k;
  const skin = 0.008 * k;
  const bulk = f.bulk ?? 1;

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
  // How much wider the wrap makes the model round the body as dressed: its horizontal scale, in effect. Every
  // other scale stays within 15% of it, so pouches, plates and panels keep their proportions (a vest isn't
  // squashed flat, stretched long or blown wide to fit; one that's too short for the body ends higher).
  let girthD = 0;
  for (let y = J.spine_02.y; y <= ySide - 0.02 * k; y += DY)
    for (let t = 0; t < NT; t++) girthD += sample(under, under.r, ((t + 0.5) / NT) * TAU, y);
  let u = ((girthD / n + gap) / sh.girth) * (f.size ?? 1);
  const sOf = (uu: number) => THREE.MathUtils.clamp(((girth / n) * 1.08 / sh.girth) * (f.size ?? 1), uu * 0.9, uu * 1.15);
  let s = sOf(u);
  // Its length is the model's own, scaled with it, unless that leaves it ending high on the ribs or low on the
  // hips: then it is stretched (or squashed) towards its hem landmark, a carrier's bottom edge just above the navel.
  const yHem = J.spine_01.y + (J.spine_02.y - J.spine_01.y) * (opt.hem ?? -0.05);
  const H = sh.yMax - sh.yMin;
  // Landmarks: strap tops onto the shoulders, bottom edge to the hem landmark (the waist), in one vertical scale
  // bounded to ±15% of the width's `u` (see toHem). The model's armpit (top of its side panels: `arm`, or found)
  // splits that in two only when given, and it's reported in `info` for the dev views.
  const yArmM = opt.arm !== undefined ? sh.yMax - H * opt.arm : modelArmpit(raw, sh);
  let sy = THREE.MathUtils.clamp(s * (f.h ?? 1), u * 0.87, u * 1.15);
  let syL = sy;
  // Never below the waist: a model that's long for its width, on a body measured bulky (a thick jacket, a rig over
  // armour), would otherwise hang past the hips at its shortest. Then it's all smaller (it still wraps the body
  // round; only its height and what stands off it shrink), never squashed.
  const yFloor = J.pelvis.y + (J.spine_01.y - J.pelvis.y) * 0.4;
  const toHem = () => {
    if (opt.anchor === 'belt') return;
    const uMax = (yTop - yFloor) / (H * 0.87);
    if (u > uMax) {
      u = uMax;
      s = sOf(u);
    }
    // Shoulders to hem in one scale, within 15% of the width's. Only with the armpit given (`arm`, a model whose
    // straps are much longer or shorter than its panels) do the two parts take scales of their own, as bounded.
    sy = THREE.MathUtils.clamp(((yTop - yHem) / H) * (f.h ?? 1), u * 0.87, u * 1.15);
    syL = sy;
    if (opt.arm !== undefined) {
      sy = THREE.MathUtils.clamp(((yTop - ySide) / Math.max(1e-6, sh.yMax - yArmM)) * (f.h ?? 1), u * 0.87, u * 1.15);
      syL = THREE.MathUtils.clamp(((ySide - yHem) / Math.max(1e-6, yArmM - sh.yMin)) * (f.h ?? 1), u * 0.87, u * 1.15);
    }
  };
  /** Model height → body height, through the landmarks. */
  const mapY = (y: number) => (y >= yArmM ? yTop - (sh.yMax - y) * sy : yTop - (sh.yMax - yArmM) * sy - (yArmM - y) * syL);

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

  let target = taut(under, mapY(sh.yMin) - 0.06 * k, yHi);
  const w = THREE.MathUtils.clamp(f.w ?? 1, 0.9, 1.1);
  const d = THREE.MathUtils.clamp(f.d ?? 1, 0.9, 1.1);

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
    for (const g of raw) {
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
    let yb = mapY(y);
    const dx = x - sh.x0;
    const dz = z - sh.z0;
    const th = Math.atan2(dz, dx);
    const r = Math.hypot(dx, dz);
    const yf = freeze(th);
    const over = Math.max(0, yb - yf);
    const cav = cavity(sh, th, y - over / sy);
    const tgt = sample(under, target, th, yb - over) * Math.hypot(w * Math.cos(th), d * Math.sin(th)) + gap;
    let rb = s * r + (tgt - s * cav) * Math.min(1, r / cav);
    // Pouches and plates stand further off (a rig's are the part the raid camera sees).
    if (r > cav) rb += (bulk - 1) * s * (r - cav);
    // Above the armpits nothing stands out past the torso's own side (shoulder guards and the tops of side panels
    // hug the shoulder instead of flaring out over the arm like a sleeve).
    if (yb > ySide - 0.05 * k && Math.abs(Math.cos(th)) > 0.5) rb = Math.min(rb, sample(under, target, th, Math.min(yb, ySide)) * Math.hypot(w * Math.cos(th), d * Math.sin(th)) + gap + 0.03 * k);
    if (y >= yStrap && opt.anchor !== 'belt') yb += liftAt(dx, dz) * THREE.MathUtils.smoothstep(yb - yf, -0.01 * k, 0.03 * k);
    const real = sample(under, under.r, th, yb) + skin;
    // Where it would be inside the body it goes out onto it, but each layer by its own depth over the model's
    // innermost there (sh.inner): pushed onto the one surface, a panel's inside and outside and the webbing on it
    // would lie in one another and show through each other in shards. Below the straps; over the shoulders a strap
    // goes up instead (next).
    const collar = yb > ySide && rb < neckR * 1.35;
    const below = 1 - THREE.MathUtils.smoothstep(yb - yf, -0.06 * k, -0.02 * k);
    const rIn = Math.min(r, cavity(sh, th, y - over / sy, sh.inner));
    const floor = real + (r - rIn) * s;
    if (!collar && below > 0 && rb < floor) rb += (floor - rb) * below;
    // Never inside what's under it: out, or for a strap over the shoulder, up.
    // (A soft collar gives way: round the neck the straps go where the model has them.)
    if (rb < real && !collar) {
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

  target = taut(under, mapY(sh.yMin) - 0.06 * k, yHi);
  // Spine weights by height: each bone's share peaks mid-way along it.
  const mids = [
    (J.pelvis.y + J.spine_01.y) / 2,
    (J.spine_01.y + J.spine_02.y) / 2,
    (J.spine_02.y + J.spine_03.y) / 2,
    (J.spine_03.y + J.neck.y) / 2,
  ];
  geos.forEach((g, gi) => {
    const p = g.attributes.position!;
    const I = new Uint16Array(p.count * 4);
    const W = new Float32Array(p.count * 4);
    if (isCap[gi]) {
      // Rigid, on top of the shoulder as dressed (bf.shoulders.pts; the bind pose has the arms level), never in
      // it: from the joint out over the deltoid, its whole underside clear of the clothes below. Skinned to the upper arm alone, so it turns with the arm as one piece: an arm raised to aim can't
      // pass through it, and nothing stretches.
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const c = bb.getCenter(new THREE.Vector3());
      const side = Math.sign(c.x - sh.x0) || 1;
      const jx = Math.abs(J.shoulder.x - under.x0);
      const own = Math.sign(J.shoulder.x - under.x0) === side ? 0 : 1;
      const cf = f.cap ?? {};
      const clear = 0.012 * k;
      const pts = bf.shoulders?.pts ?? new Float32Array();
      // Its length along the arm: the deltoid's, within 15% of the vest's own scale.
      const sc = THREE.MathUtils.clamp((0.17 * k) / Math.max(1e-6, bb.max.x - bb.min.x), s * 0.85, s * 1.15);
      const inner = side > 0 ? bb.min.x : bb.max.x;
      const tx = under.x0 + side * (jx - 0.03 * k + (cf.x ?? 0) * k) - (inner - c.x) * sc;
      // Front to back: centred on the arm's top round the joint.
      let zs = 0;
      let zn = 0;
      let yTop = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const dx = (pts[i]! - under.x0) * side;
        if (dx < jx - 0.02 * k || dx > jx + 0.12 * k) continue;
        if (pts[i + 1]! > yTop) yTop = pts[i + 1]!;
      }
      for (let i = 0; i < pts.length; i += 3) {
        const dx = (pts[i]! - under.x0) * side;
        if (dx < jx - 0.02 * k || dx > jx + 0.12 * k || pts[i + 1]! < yTop - 0.03 * k) continue;
        zs += pts[i + 2]!;
        zn++;
      }
      const tz = (zn ? zs / zn : J.shoulder.z) + (cf.z ?? 0) * k;
      // A height map of the clothes under it, to lift it clear. (Not the vest: its inner end starts at the joint,
      // past the vest's shoulder.)
      const cs = 0.012 * k;
      const top = new Map<string, number>();
      const put = (x: number, y: number, z: number) => {
        const key = `${Math.floor(x / cs)},${Math.floor(z / cs)}`;
        if (!(top.get(key)! >= y)) top.set(key, y);
      };
      for (let i = 0; i < pts.length; i += 3) put(pts[i]!, pts[i + 1]!, pts[i + 2]!);
      const at = (x: number, z: number) => {
        let y = -Infinity;
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) y = Math.max(y, top.get(`${cx + dx},${cz + dz}`) ?? -Infinity);
        return y;
      };
      let ty = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = tx + (p.getX(i) - c.x) * sc;
        const z = tz + (p.getZ(i) - c.z) * sc;
        ty = Math.max(ty, at(x, z) + clear - (p.getY(i) - c.y) * sc);
      }
      if (!Number.isFinite(ty)) ty = J.shoulder.y + 0.08 * k;
      ty += (cf.y ?? 0) * k;
      const arm = bf.shoulders?.arm[own] ?? -1;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, tx + (p.getX(i) - c.x) * sc, ty + (p.getY(i) - c.y) * sc, tz + (p.getZ(i) - c.z) * sc);
        I[i * 4] = arm >= 0 ? arm : bf.spine[3]!;
        W[i * 4] = 1;
      }
      p.needsUpdate = true;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(I, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return;
    }
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
  });
  // Landmarks as placed (for the dev views: __lab[i] and CharLab).
  const info = { arm: (sh.yMax - yArmM) / H, u, sy: sy / u, syL: syL / u, yTop, yArm: mapY(yArmM), ySide, yHem, yBottom: mapY(sh.yMin), s };
  return { geos, materials: meshes.map((m) => m.material), info };
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
  /** How far it is worn tipped back (radians, pivoting on the back rim); default ~9° unless `brow` is given. */
  tilt?: number;
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
  // Nothing of it hangs in front of the face: a chin strap's loop, a goggle band or a headset's boom below the
  // front rim crossed the eyes (more so from the raid camera above, and as the head turns). What is below the rim,
  // ahead of the ears and over the face is cut away; a faceplate meant to be down (`brow` given) stays.
  if (opt.brow === undefined && !named) {
    const zCut = cz + domeD * 0.18;
    const yCut = rim - (top - rim) * 0.04;
    const a = new THREE.Vector3();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const p = g.attributes.position!;
      const idx = g.index;
      const tri = (idx ? idx.count : p.count) / 3;
      const vi = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
      const keep: number[] = [];
      let cutN = 0;
      for (let t = 0; t < tri; t++) {
        a.set(0, 0, 0);
        for (let c = 0; c < 3; c++) a.add(v.fromBufferAttribute(p, vi(t, c)).applyMatrix4(m.matrixWorld));
        a.multiplyScalar(1 / 3);
        if (a.y < yCut && a.z > zCut && Math.abs(a.x - cx) < domeW * 0.42) cutN++;
        else keep.push(vi(t, 0), vi(t, 1), vi(t, 2));
      }
      if (!cutN) return;
      const ng = g.clone();
      ng.setIndex(keep);
      m.geometry = ng;
    });
  }
  // A brim flared out over the face (SSh-36, SSh-68) is trimmed back to the dome's own front: from the raid camera
  // (~59° above) a lip 9 cm ahead of the brow hid the eyes whatever the seat. Pulled in, not cut (it stays closed),
  // keeping a short lip; only in front, faded out round the sides.
  if (opt.brow === undefined && !named) {
    const zFront = cz + domeD / 2;
    const yLip = rim + (top - rim) * 0.4;
    const w = new THREE.Vector3();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
      const p = m.geometry.attributes.position!;
      let ng: THREE.BufferGeometry | null = null;
      for (let i = 0; i < p.count; i++) {
        w.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        if (w.y > yLip || w.z <= zFront) continue;
        const side = THREE.MathUtils.smoothstep(Math.abs(w.x - cx) / Math.max(1e-6, domeW / 2), 0.55, 0.95);
        const low = 1 - THREE.MathUtils.smoothstep(w.y, yLip - (top - rim) * 0.12, yLip);
        const s = (1 - side) * low;
        if (s <= 0) continue;
        w.z = THREE.MathUtils.lerp(w.z, zFront + (w.z - zFront) * 0.2, s);
        if (!ng) (ng = m.geometry.clone()), (m.geometry = ng);
        w.applyMatrix4(inv);
        ng.attributes.position!.setXYZ(i, w.x, w.y, w.z);
      }
      if (ng) {
        ng.attributes.position!.needsUpdate = true;
        ng.computeBoundingBox();
        ng.computeBoundingSphere();
      }
    });
  }
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
  // The rim a little over the brow line (which is at the brows themselves): on it, a brim's edge read as a band
  // across the eyes, worse from the raid camera above.
  const browY = head.brow + (opt.brow === undefined ? 0.018 : 0.014) * k;
  const ky = THREE.MathUtils.clamp((head.crown + clear - browY) / Math.max(1e-6, crown - rim), kxz * 0.78, kxz * 1.12) * (f.h ?? 1);
  // Rim on the brow; if the model is too deep for that, it rides a little high rather than over the eyes, and if
  // too shallow it rests on the crown.
  const yCrown = THREE.MathUtils.clamp(browY + (crown - rim) * ky, head.crown + 0.028 * k, head.crown + 0.05 * k);
  const yTop = yCrown + (top - crown) * ky;
  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.position.set(-cx, -top, -cz);
  wrap.scale.set(kx, ky, kz);
  // Centred over the skull, a touch back: the face is flatter than the back of the head.
  wrap.position.set(head.x, yTop + (f.y ?? 0) * (head.crown - head.chin), (head.front + head.back) / 2 - 0.004 * k);
  // Worn a little back on the head (pivoting on the back rim): aiming, the head tips forward and the raid camera
  // looks down from behind, and a brim on the brow line (SSh-36, SSh-68) hid the eyes. A faceplate meant to be
  // down (`brow` given) keeps its seat.
  const tilt = opt.tilt ?? (opt.brow === undefined ? 0.16 : 0);
  if (!tilt) return wrap;
  const pivot = new THREE.Group();
  pivot.position.set(head.x, browY, head.back);
  pivot.rotation.x = -tilt;
  wrap.position.sub(pivot.position);
  pivot.add(wrap);
  return pivot;
}

/**
 * A helmet's liner: a cap over the skull down to the brow line, a little proud of the scalp. It fills what a model
 * leaves open (the Altyn's cut-out above its faceplate, vents, the gap under a FAST's rails) so the scalp never
 * shows through, and reads as padding under the rim. In the body's bind space, like the fitted helmet.
 */
export function helmetLiner(head: HeadFit, k: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  // Its front edge rides up off the brow: a rim on the brow line itself showed as a dark band across the eyes
  // (from the front, and more from the raid camera above). Kept on the dome (the ring is pulled in as it rises).
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const lo = 0.5 * THREE.MathUtils.smoothstep(z / r, -0.25, 0.55);
    if (y >= lo) continue;
    const s = Math.sqrt(1 - lo * lo) / r;
    p.setXYZ(i, x * s, lo, z * s);
  }
  g.computeVertexNormals();
  const pad = 0.012 * k;
  g.scale(head.halfW + pad, head.crown - head.brow + pad, (head.front - head.back) / 2 + pad);
  g.translate(head.x, head.brow, (head.front + head.back) / 2);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpacks
// ─────────────────────────────────────────────────────────────────────────────

export interface PackOptions {
  /** How tall the pack comes out, as a share of the back from the pelvis to the shoulders, and how wide it may be
   * at most (bind-space metres). */
  tall: number;
  maxWidth: number;
  fit?: FitHandles;
  /** Drop the thin loose pieces (a messenger bag's strap would arc over the head). */
  dropLoose?: boolean;
  /** A sling bag: worn low on the back towards the left hip, on one strap across the body over the right
   * shoulder (built here, laid on the surface). */
  sling?: boolean;
  /** A sternum strap with a buckle across the chest between the two shoulder straps. */
  sternum?: boolean;
}

/**
 * Seat a rigid pack model (as wornGear gives it: its outer face to +Z, so the icon shows the pockets) on the back,
 * over `under` (the body with its clothes, armour and rig on). Turned so its back panel rests on the body and the
 * pack sticks out behind (−Z). Sized and placed by the bag itself, its bulky pieces (straps are thin pieces that
 * reach round the shoulders): evenly scaled to `height`, top at the shoulders (a tall pack's bottom stops at the
 * belt and it rides up), and pushed back until its surface clears the body. A group in the body's bind space, to
 * be hung on spine_02.
 */
export function fitPack(obj: THREE.Object3D, bf: BodyFit, under: TorsoField, opt: PackOptions): THREE.Group {
  const f = opt.fit ?? {};
  const k = bf.k;
  const J = bf.joints;
  const turned = new THREE.Group();
  turned.rotation.y = Math.PI;
  turned.add(obj);
  const wrap = new THREE.Group();
  wrap.add(turned);
  wrap.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
  const v = new THREE.Vector3();
  const bulk = (b: THREE.Box3) => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
  type Piece = { box: THREE.Box3; tris: number[] };
  const all: { mesh: THREE.Mesh; to: THREE.Matrix4; ps: Piece[]; vi: (t: number, c: number) => number }[] = [];
  let most = 0;
  wrap.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const to = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position!;
    const pc = pieces(m.geometry);
    const by = new Map<number, Piece>();
    for (let t = 0; t < pc.tri; t++) {
      let p = by.get(pc.of[t]!);
      if (!p) by.set(pc.of[t]!, (p = { box: new THREE.Box3(), tris: [] }));
      p.tris.push(t);
      for (let c = 0; c < 3; c++) p.box.expandByPoint(v.fromBufferAttribute(pos, pc.vi(t, c)).applyMatrix4(to));
    }
    const ps = [...by.values()];
    for (const p of ps) most = Math.max(most, bulk(p.box));
    all.push({ mesh: m, to, ps, vi: pc.vi });
  });
  const isCore = (p: Piece) => bulk(p.box) >= most * 0.2;
  const b = new THREE.Box3();
  for (const { ps } of all) for (const p of ps) if (isCore(p)) b.union(p.box);
  if (opt.dropLoose)
    for (const { mesh, ps, vi } of all) {
      const keep: number[] = [];
      for (const p of ps) if (isCore(p)) for (const t of p.tris) keep.push(vi(t, 0), vi(t, 1), vi(t, 2));
      const g = mesh.geometry.clone();
      g.setIndex(keep);
      mesh.geometry = g;
    }
  const sz = b.getSize(new THREE.Vector3());
  const back = J.shoulder.y - J.pelvis.y;
  const s = Math.min((back * opt.tall * (f.h ?? 1)) / sz.y, (opt.maxWidth * (f.w ?? 1)) / sz.x) * (f.size ?? 1);
  const h = sz.y * s;
  const top =
    (opt.sling ? J.spine_01.y + h * 0.5 : Math.max(J.shoulder.y - 0.01 * k, (J.pelvis.y + J.spine_01.y) / 2 + h)) +
    (f.y ?? 0) * k;
  const x = under.x0 - ((b.min.x + b.max.x) / 2) * s + (opt.sling ? -0.07 * k : 0);
  const y = top - b.max.y * s;
  // Back panel (the bag's +Z face now) on the spine's axis to start with, then pushed back.
  const z = under.z0 - b.max.z * s;
  // The bag's surface, sampled every couple of centimetres (a low-poly back panel is a few big triangles).
  const pts: number[] = [];
  const a = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const step = 0.02 * k;
  for (const { mesh, to, ps, vi } of all) {
    const pos = mesh.geometry.attributes.position!;
    for (const p of ps) {
      if (!isCore(p)) continue;
      for (const t of p.tris) {
        v.fromBufferAttribute(pos, vi(t, 0)).applyMatrix4(to).multiplyScalar(s);
        a.fromBufferAttribute(pos, vi(t, 1)).applyMatrix4(to).multiplyScalar(s);
        c2.fromBufferAttribute(pos, vi(t, 2)).applyMatrix4(to).multiplyScalar(s);
        const edge = Math.max(v.distanceTo(a), v.distanceTo(c2), a.distanceTo(c2));
        const n = Math.min(12, Math.max(1, Math.ceil(edge / step)));
        for (let i = 0; i <= n; i++)
          for (let j = 0; i + j <= n; j++) {
            const u = i / n;
            const w = j / n;
            const q = 1 - u - w;
            pts.push(
              x + v.x * q + a.x * u + c2.x * w,
              y + v.y * q + a.y * u + c2.y * w,
              z + v.z * q + a.z * u + c2.z * w,
            );
          }
      }
    }
  }
  const gap = (f.gap ?? 0.01) * k;
  const yTop = under.y0 + (under.ny - 1) * DY;
  const inside = (px: number, py: number, pz: number) => {
    const dx = px - under.x0;
    const dz = pz - under.z0;
    return Math.hypot(dx, dz) < sample(under, under.r, Math.atan2(dz, dx), py) + gap;
  };
  // How far back each point must go to clear the body (above the shoulders the arms and neck don't count).
  let push = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    const pz = pts[i + 2]!;
    if (py > J.shoulder.y + 0.02 * k || py > yTop || py < under.y0 || !inside(px, py, pz - push)) continue;
    let lo = push;
    let hi = push + 0.6 * k;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (inside(px, py, pz - mid)) lo = mid;
      else hi = mid;
    }
    push = hi;
  }
  wrap.scale.setScalar(s);
  wrap.position.set(x, y, z - push);
  // Its straps, laid on the body from the bag over the shoulders, bend with the spine (skinned, as the vests).
  // Where they come out: the top of the bag's back panel as the model has it (its box may reach higher, a handle).
  const bx = under.x0 + (opt.sling ? -0.07 * k : 0);
  const half = ((b.max.x - b.min.x) / 2) * s;
  let zFace = -Infinity;
  for (let i = 2; i < pts.length; i += 3) zFace = Math.max(zFace, pts[i]!);
  let panel = -Infinity;
  for (let i = 0; i < pts.length; i += 3)
    if (pts[i + 2]! > zFace - 0.04 * k && Math.abs(pts[i]! - bx) < half * 0.7) panel = Math.max(panel, pts[i + 1]!);
  const bag = { x: bx, half, top: Number.isFinite(panel) ? Math.min(top, panel) : top, bottom: top - h, face: under.z0 - push };
  wrap.userData.strap = straps(under, bf, bag, !!opt.sling, !!opt.sternum);
  return wrap;
}

/** Skin weights up the spine by height, for gear laid on the torso in bind space. */
function spineSkin(g: THREE.BufferGeometry, bf: BodyFit): THREE.BufferGeometry {
  const J = bf.joints;
  const mids = [
    (J.pelvis.y + J.spine_01.y) / 2,
    (J.spine_01.y + J.spine_02.y) / 2,
    (J.spine_02.y + J.spine_03.y) / 2,
    (J.spine_03.y + J.neck.y) / 2,
  ];
  const p = g.attributes.position!;
  const I = new Uint16Array(p.count * 4);
  const W = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    let seg = 0;
    while (seg < 2 && y > mids[seg + 1]!) seg++;
    const u = THREE.MathUtils.smoothstep(y, mids[seg]!, mids[seg + 1]!);
    I[i * 4] = bf.spine[seg]!;
    I[i * 4 + 1] = bf.spine[seg + 1]!;
    W[i * 4] = 1 - u;
    W[i * 4 + 1] = u;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(I, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Straps laid on `under` (the body with what's worn under the pack), as real webbing: a band about 4.5 cm wide and
 * 1 cm thick with soft edges, a few millimetres off the surface, running on a smooth curve. A backpack's two: out
 * of the bag's top, up the back to the top of the trapezius, over the shoulder, down the chest beside the armpit,
 * then under the arm and back to the bag's lower corner (with a sternum strap and buckle across the chest when
 * `sternum`). A sling's one: from the bag's top corner up over the right shoulder (+X), across the chest to the left
 * hip and round the side back to the bag. Skinned as the clothes under them are (bf.skin), so they ride the
 * shoulders as those move, or by height up the spine when there's nothing to copy.
 */
function straps(
  under: TorsoField,
  bf: BodyFit,
  bag: { x: number; half: number; top: number; bottom: number; face: number },
  sling: boolean,
  sternum: boolean,
): THREE.BufferGeometry {
  const k = bf.k;
  const J = bf.joints;
  const X = under.x0;
  const Z = under.z0;
  const off = 0.008 * k;
  const yS = J.shoulder.y;
  const sw = Math.abs(J.shoulder.x - X);
  const W = 0.045 * k;
  const T = 0.01 * k;
  const th = (x: number, z: number) => Math.atan2(z - Z, x - X);
  // What's worn under the pack, but never more than a vest's thickness over the clothes (a vest's shoulder pieces
  // reach out along the arms in the bind pose).
  const R = (a: number, y: number) =>
    Math.min(sample(under, under.r, a, y), sample(bf.dressed, bf.dressed.r, a, y) + 0.12 * k);
  /** Clothes ride up over the shoulders when the arms come down from the bind pose: a little more room there. */
  const lift = (y: number) => THREE.MathUtils.smoothstep(y, yS - 0.14 * k, yS - 0.04 * k) * 0.016 * k;
  /** Onto the surface (out from the axis, or onto the top of the shoulder, whichever is nearer); `outOnly`: only
   * if it is under it. */
  const hug = (p: THREE.Vector3, outOnly = false) => {
    const a = th(p.x, p.z);
    const rad = Math.hypot(p.x - X, p.z - Z);
    const rs = R(a, p.y) + off + lift(p.y);
    const up = p.y > yS - 0.06 * k ? topAt(under, a, rad) : NaN;
    const ys = Number.isFinite(up) ? up + off + lift(p.y) : NaN;
    if (outOnly) {
      if (rad >= rs) return p;
      if (Number.isFinite(ys) && ys - p.y < rs - rad) return p.setY(Math.max(p.y, ys));
      return p.set(X + Math.cos(a) * rs, p.y, Z + Math.sin(a) * rs);
    }
    if (Number.isFinite(ys) && Math.abs(ys - p.y) < Math.abs(rs - rad)) return p.setY(ys);
    return p.set(X + Math.cos(a) * rs, p.y, Z + Math.sin(a) * rs);
  };
  /** On the surface at this x and height, behind (dir −1) or in front (+1). */
  const atX = (x: number, y: number, dir: number) => {
    let z = 0;
    while (z < 0.6 * k && Math.hypot(x - X, z) < R(Math.atan2(dir * z, x - X), y) + off) z += 0.003 * k;
    return new THREE.Vector3(x, y, Z + dir * z);
  };
  /** On the surface at this angle (0 = +X, π/2 = front) and height. */
  const atA = (a: number, y: number) => hug(new THREE.Vector3(X + Math.cos(a) * 0.05, y, Z + Math.sin(a) * 0.05));
  const crest = (x: number) => hug(new THREE.Vector3(x, yS + 0.08 * k, Z + 0.005 * k));
  const yChest = J.spine_03.y + (yS - J.spine_03.y) * 0.1;

  // Each route: [tail into the bag, ...keys on the surface..., tail into the bag].
  type Route = { keys: THREE.Vector3[]; head?: THREE.Vector3; tail?: THREE.Vector3 };
  const routes: Route[] = [];
  const into = (p: THREE.Vector3, dy: number) => new THREE.Vector3(p.x, p.y + dy, bag.face - 0.02 * k);
  if (sling) {
    const s0 = atX(bag.x + bag.half * 0.75, bag.top - 0.015 * k, -1);
    const s9 = atX(bag.x - bag.half * 0.75, bag.top - 0.015 * k, -1);
    routes.push({
      head: into(s0, -0.03 * k),
      keys: [
        s0,
        atX(X + sw * 0.3, (bag.top + yS) / 2, -1),
        atX(X + sw * 0.5, yS - 0.03 * k, -1),
        crest(X + sw * 0.55),
        atX(X + sw * 0.5, yS - 0.05 * k, 1),
        atX(X + sw * 0.15, J.spine_03.y, 1),
        atX(X - sw * 0.35, J.spine_02.y - 0.02 * k, 1),
        atA(Math.PI * 0.62, J.spine_01.y + 0.04 * k),
        atA(Math.PI * 0.98, J.spine_01.y + 0.03 * k),
        s9,
      ],
      tail: into(s9, -0.03 * k),
    });
  } else
    for (const sgn of [1, -1]) {
      const side = sgn > 0 ? 0 : Math.PI;
      const s0 = atX(bag.x + sgn * Math.min(bag.half * 0.55, 0.075 * k), Math.min(bag.top - 0.02 * k, yS - 0.05 * k), -1);
      const s9 = atX(bag.x + sgn * bag.half * 0.85, bag.bottom + 0.05 * k, -1);
      routes.push({
        head: into(s0, -0.03 * k),
        keys: [
          s0,
          atX(X + sgn * sw * 0.5, yS - 0.03 * k, -1),
          crest(X + sgn * sw * 0.55),
          atX(X + sgn * sw * 0.6, yS - 0.05 * k, 1),
          atX(X + sgn * sw * 0.7, yChest, 1),
          atA(side + sgn * 0.6, J.spine_02.y + 0.03 * k),
          atA(side - sgn * 0.3, J.spine_02.y - 0.01 * k),
          s9,
        ],
        tail: into(s9, 0.01 * k),
      });
    }

  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  /** Per vertex, the point its weights are taken at (the middle of its section: a section moves as one). */
  const anchor: number[] = [];
  const paths = routes.map((r) => band(r, W, T, 1));
  if (sternum && paths.length === 2) {
    // A sternum strap between them at chest height, with its buckle in the middle.
    const at = (path: THREE.Vector3[]) =>
      path.reduce((b, p) => (p.z > Z && Math.abs(p.y - yChest) < Math.abs(b.y - yChest) && p.z > Z ? p : b), path[0]!);
    const a = at(paths[0]!);
    const b = at(paths[1]!);
    // Over the shoulder straps, not under: drawn taut between them, clear of the chest.
    const mid = hug(a.clone().lerp(b, 0.5), true);
    const st = { keys: [a.clone().setZ(a.z + T), mid.clone().setZ(Math.max(mid.z, (a.z + b.z) / 2) + T * 0.5), b.clone().setZ(b.z + T)] };
    const sp = band(st, 0.025 * k, 0.006 * k, 1, T * 0.5);
    const c = sp[Math.floor(sp.length / 2)]!;
    box(c.clone().setZ(c.z + T * 1.2), 0.045 * k, 0.032 * k, 0.012 * k, 0.25);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return clothesSkin(g, bf, bag, anchor);

  /** A band along a route: the keys on a smooth curve, hugging the surface; returns its path. */
  function band(r: Route, w: number, t: number, shade: number, lifted = 0): THREE.Vector3[] {
    const curve = new THREE.CatmullRomCurve3(r.keys, false, 'centripetal');
    const n0 = Math.max(8, Math.ceil(curve.getLength() / (0.01 * k)));
    let path = curve.getSpacedPoints(n0);
    // Onto the surface, then pulled taut like webbing: smoothed and kept out of the body, over and over (it
    // bridges hollows and wrinkles, and never kinks where the surface does).
    if (lifted) path.forEach((p) => hug(p, true));
    else {
      path.forEach((p) => hug(p));
      for (let it = 0; it < 24; it++) {
        path = path.map((p, i) =>
          i === 0 || i === path.length - 1 ? p : p.clone().multiplyScalar(2).add(path[i - 1]!).add(path[i + 1]!).multiplyScalar(0.25),
        );
        path.forEach((p) => hug(p, true));
      }
    }
    // Into the bag at the ends.
    if (r.head) path = [...seg(r.head, path[0]!), ...path];
    if (r.tail) path = [...path, ...seg(r.tail, path[path.length - 1]!).reverse()];
    // Lying on the surface: first out from a point on the spine (over the shoulder that is up and out), then turned
    // so both its edges sit on the surface as well (each edge pressed onto it, the band laid across them).
    const tang = (i: number) => path[Math.min(path.length - 1, i + 1)]!.clone().sub(path[Math.max(0, i - 1)]!).normalize();
    const n = path.map((p, i) => {
      const along = tang(i);
      // (A strap across the chest faces forward.)
      const o = lifted ? new THREE.Vector3(0, 0, 1) : p.clone().sub(new THREE.Vector3(X, Math.min(p.y, yS - 0.12 * k), Z));
      return o.addScaledVector(along, -o.dot(along)).normalize();
    });
    const free = (p: THREE.Vector3) => p.z < bag.face - 0.005 * k || lifted > 0;
    for (let pass = 0; pass < 2; pass++)
      path.forEach((p, i) => {
        if (free(p)) return;
        const along = tang(i);
        const side = new THREE.Vector3().crossVectors(along, n[i]!).normalize().multiplyScalar(w / 2);
        const a = hug(p.clone().add(side));
        const b = hug(p.clone().sub(side));
        const nn = new THREE.Vector3().crossVectors(a.sub(b), along).normalize();
        if (nn.dot(n[i]!) < 0) nn.negate();
        if (nn.dot(n[i]!) > 0.3) n[i]!.copy(nn);
      });
    for (let it = 0; it < 8; it++)
      for (let i = 1; i + 1 < n.length; i++) n[i]!.add(n[i - 1]!).add(n[i + 1]!).normalize();
    // Profile round the band: (across, out), soft corners.
    const c = Math.min(0.003 * k, t * 0.4);
    const prof = [
      [-w / 2 + c, 0], [w / 2 - c, 0], [w / 2, c], [w / 2, t - c], [w / 2 - c, t], [-w / 2 + c, t], [-w / 2, t - c], [-w / 2, c],
    ] as const;
    const frames = path.map((p, i) => {
      const along = tang(i);
      const side = new THREE.Vector3().crossVectors(along, n[i]!).normalize();
      const out = new THREE.Vector3().crossVectors(side, along).normalize();
      // Clear of the surface edge to edge (where the body curves under it), unless in the bag.
      let push = 0;
      if (!free(p))
        for (const sx of [-w / 2, 0, w / 2]) {
          const q = p.clone().addScaledVector(side, sx).addScaledVector(out, lifted);
          push = Math.max(push, hug(q.clone(), true).distanceTo(q));
        }
      return { side, out, push };
    });
    // The pushes eased along the band (a wrinkle lifts a stretch of it, not one section).
    const ramp = 0.0015 * k;
    for (let i = 1; i < frames.length; i++) frames[i]!.push = Math.max(frames[i]!.push, frames[i - 1]!.push - ramp);
    for (let i = frames.length - 2; i >= 0; i--) frames[i]!.push = Math.max(frames[i]!.push, frames[i + 1]!.push - ramp);
    for (let it = 0; it < 4; it++)
      for (let i = 1; i + 1 < frames.length; i++)
        frames[i]!.push = Math.max(frames[i]!.push, (frames[i - 1]!.push + frames[i]!.push * 2 + frames[i + 1]!.push) / 4);
    const base = pos.length / 3;
    let len = 0;
    path.forEach((p, i) => {
      if (i) len += p.distanceTo(path[i - 1]!);
      const { side, out, push } = frames[i]!;
      prof.forEach(([sx, o]) => {
        const q = p.clone().addScaledVector(side, sx).addScaledVector(out, o + lifted + push);
        pos.push(q.x, q.y, q.z);
        anchor.push(p.x, p.y, p.z);
        uv.push(sx / w + 0.5, len / w);
        col.push(shade, shade, shade);
      });
      if (i) {
        const a = base + (i - 1) * 8;
        for (let j = 0; j < 8; j++) {
          const j1 = (j + 1) % 8;
          idx.push(a + j, a + 8 + j, a + j1, a + j1, a + 8 + j, a + 8 + j1);
        }
      }
    });
    // End caps.
    const last = base + (path.length - 1) * 8;
    for (let j = 1; j < 7; j++) {
      idx.push(base, base + j + 1, base + j);
      idx.push(last, last + j, last + j + 1);
    }
    return path.slice(r.head ? 3 : 0, r.tail ? path.length - 3 : path.length);
  }

  /** Three steps from a point in the bag to the start of the band. */
  function seg(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    return [0, 1, 2].map((i) => a.clone().lerp(b, i / 3));
  }

  /** A buckle: a flat box facing +Z. */
  function box(cn: THREE.Vector3, w: number, h: number, d: number, shade: number): void {
    const base = pos.length / 3;
    for (let i = 0; i < 8; i++) {
      pos.push(cn.x + (i & 1 ? w : -w) / 2, cn.y + (i & 2 ? h : -h) / 2, cn.z + (i & 4 ? d : -d) / 2);
      anchor.push(cn.x, cn.y, cn.z);
      uv.push(0.5, 0.5);
      col.push(shade, shade, shade);
    }
    const f = [
      [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
    ];
    for (const [a, b, c, e] of f) idx.push(base + a!, base + b!, base + c!, base + a!, base + c!, base + e!);
  }
}

/** Skin weights copied from the clothes under each vertex (bf.skin, a few centimetres round it); by height up the
 * spine where there's nothing near. */
function clothesSkin(
  g: THREE.BufferGeometry,
  bf: BodyFit,
  bag: { x: number; half: number; top: number; bottom: number; face: number },
  anchor: number[],
): THREE.BufferGeometry {
  const sk = bf.skin;
  if (!sk || !sk.bi.length) return spineSkin(g, bf);
  const k = bf.k;
  // Near the bag (where they come out of it and go back in) they hang on spine_02 with it, rigidly.
  const hang = bf.spine[2]!;
  const nearBag = (x: number, y: number, z: number) => {
    const dx = Math.max(0, Math.abs(x - bag.x) - bag.half);
    const dy = Math.max(0, bag.bottom - y, y - bag.top);
    const dz = Math.max(0, bag.face - 0.3 * k - z, z - bag.face);
    return 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dy, dz), 0.015 * k, 0.07 * k);
  };
  const cs = 0.03 * k;
  const rad = 0.035 * k;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < sk.pos.length / 3; i++) {
    const kk = key(sk.pos[i * 3]!, sk.pos[i * 3 + 1]!, sk.pos[i * 3 + 2]!);
    let l = grid.get(kk);
    if (!l) grid.set(kk, (l = []));
    l.push(i);
  }
  spineSkin(g, bf);
  const p = g.attributes.position!;
  const I = g.attributes.skinIndex!.array as Uint16Array;
  const Wt = g.attributes.skinWeight!.array as Float32Array;
  // One weight map per section (the vertices sharing an anchor, in a run), normalised.
  type Sec = { at: THREE.Vector3; from: number; to: number; w: Map<number, number> };
  const secs: Sec[] = [];
  for (let v = 0; v < p.count; v++) {
    const at = new THREE.Vector3(anchor[v * 3]!, anchor[v * 3 + 1]!, anchor[v * 3 + 2]!);
    const last = secs[secs.length - 1];
    if (last && last.at.equals(at)) last.to = v + 1;
    else secs.push({ at, from: v, to: v + 1, w: new Map() });
  }
  for (const sec of secs) {
    const { x, y, z } = sec.at;
    const acc = sec.w;
    const v = sec.from;
    const cx = Math.floor(x / cs);
    const cy = Math.floor(y / cs);
    const cz = Math.floor(z / cs);
    let tot = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++) {
          const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!l) continue;
          for (const i of l) {
            const d = Math.hypot(sk.pos[i * 3]! - x, sk.pos[i * 3 + 1]! - y, sk.pos[i * 3 + 2]! - z);
            if (d >= rad) continue;
            const f = (1 - d / rad) ** 2;
            tot += f;
            for (let c = 0; c < 4; c++) {
              const w = sk.bw[i * 4 + c]!;
              if (w > 0) acc.set(sk.bi[i * 4 + c]!, (acc.get(sk.bi[i * 4 + c]!) ?? 0) + w * f);
            }
          }
        }
    if (tot <= 0) {
      // Nothing worn near (inside the bag): by height up the spine, as spineSkin left it.
      for (let c = 0; c < 4; c++) if (Wt[v * 4 + c]! > 0) acc.set(I[v * 4 + c]!, Wt[v * 4 + c]!);
    }
    // Under the arm they ride the ribs, not the arm (the clothes there stretch with it, a strap doesn't).
    const onArm = THREE.MathUtils.smoothstep(y, bf.joints.shoulder.y - 0.1 * k, bf.joints.shoulder.y - 0.02 * k);
    for (const b of sk.arms) {
      const w = acc.get(b);
      if (w) acc.set(b, w * onArm);
    }
    let sum = 0;
    for (const w of acc.values()) sum += w;
    if (!(sum > 1e-9)) {
      acc.clear();
      for (let c = 0; c < 4; c++) if (Wt[v * 4 + c]! > 0) acc.set(I[v * 4 + c]!, Wt[v * 4 + c]!);
      sum = 1;
    }
    for (const [b, w] of acc) acc.set(b, w / sum);
    const f = nearBag(x, y, z);
    if (f > 0) {
      for (const [b, w] of acc) acc.set(b, w * (1 - f));
      acc.set(hang, (acc.get(hang) ?? 0) + f);
    }
  }
  // Eased along each band (sparse clothes would otherwise hand neighbouring sections to different bones).
  const near = 0.03 * k;
  for (let it = 0; it < 8; it++) {
    const next = secs.map((sec, i) => {
      const m = new Map<number, number>();
      const add = (o: Sec | undefined, f: number) => {
        if (!o || o.at.distanceTo(sec.at) > near) o = sec;
        for (const [b, w] of o.w) m.set(b, (m.get(b) ?? 0) + w * f);
      };
      add(secs[i - 1], 0.25);
      add(sec, 0.5);
      add(secs[i + 1], 0.25);
      return m;
    });
    secs.forEach((sec, i) => (sec.w = next[i]!));
  }
  for (const sec of secs) {
    const top = [...sec.w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0);
    if (!(sum > 1e-6)) continue;
    for (let v = sec.from; v < sec.to; v++)
      for (let c = 0; c < 4; c++) {
        I[v * 4 + c] = top[c]?.[0] ?? 0;
        Wt[v * 4 + c] = top[c] ? top[c]![1] / sum : 0;
      }
  }
  return g;
}
