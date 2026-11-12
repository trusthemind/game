import * as THREE from 'three';

/**
 * Body shapes on our one modelled body per sex (V10). The base meshes carry no morph targets, so a shape is a
 * smooth displacement field D(p) over the neutral body as it stands at rest (T-pose, model space): a radial push
 * out from the body's axis (the spine for the torso, the bone for a limb) whose size depends only on where the
 * point is (height, angle round the axis, how far along the limb), never on how far out it is. The same field is
 * applied to the body and to everything fitted to it (clothes, armour, hair), so a jacket over the belly moves by
 * exactly as much as the belly under it and keeps its thickness: the clothes are fitted once, to the neutral
 * body, and follow without re-fitting.
 *
 * Applied by baking: each mesh's geometry is displaced once per (geometry, sex, shape) on the CPU and cached, the
 * skin weights untouched, so animation, shadows and depth need nothing extra and a frame costs nothing.
 * Bones are not moved: most clips key every bone's position and scale, which would undo it (height is the
 * model's scale instead).
 */
export interface BodyShape {
  /** Each -1..1, 0 = the base mesh. */
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

export const NEUTRAL_SHAPE: BodyShape = { height: 0, shoulders: 0, chest: 0, waist: 0, belly: 0, hips: 0, glutes: 0, thighs: 0, calves: 0, arms: 0 };

const P = (s: Partial<BodyShape>): BodyShape => ({ ...NEUTRAL_SHAPE, ...s });
export const SHAPE_PRESETS: Record<'m' | 'f', Record<string, BodyShape>> = {
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

/** An NPC's shape: a preset by seed, jittered a little (deterministic). */
export function shapeFromSeed(sex: 'm' | 'f', seed: number): BodyShape {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const names = Object.keys(SHAPE_PRESETS[sex]);
  const base = SHAPE_PRESETS[sex][names[Math.floor(rnd() * names.length)]!]!;
  const out = { ...base };
  for (const k of Object.keys(out) as (keyof BodyShape)[]) out[k] = THREE.MathUtils.clamp(out[k] + (rnd() - 0.5) * 0.3, -1, 1);
  return out;
}

export function shapeKey(s: BodyShape | undefined): string {
  if (!s) return '';
  const v = (Object.keys(NEUTRAL_SHAPE) as (keyof BodyShape)[]).map((k) => Math.round((s[k] ?? 0) * 20));
  return v.every((x) => x === 0) ? '' : v.join(',');
}

/** The model's scale for a shape's height (±6%). */
export const heightFactor = (s: BodyShape | undefined) => 1 + 0.06 * (s?.height ?? 0);

// Compact bump: 1 at c, 0 beyond r.
const bump = (x: number, c: number, r: number) => {
  const t = (x - c) / r;
  return t * t >= 1 ? 0 : (1 - t * t) * (1 - t * t);
};
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Where the joints stand at rest (model space): the field's landmarks. */
interface Marks {
  pelvis: THREE.Vector3;
  s1: THREE.Vector3;
  s2: THREE.Vector3;
  s3: THREE.Vector3;
  neck: THREE.Vector3;
  ua: THREE.Vector3[];
  la: THREE.Vector3[];
  hand: THREE.Vector3[];
  thigh: THREE.Vector3[];
  calf: THREE.Vector3[];
  foot: THREE.Vector3[];
}

/** The displacement field of one shape on one skeleton (built at rest, in the model's space). */
export class ShapeField {
  constructor(
    private m: Marks,
    private s: BodyShape,
    private sex: 'm' | 'f',
  ) {}

  static fromBones(bones: THREE.Bone[], model: THREE.Object3D, s: BodyShape, sex: 'm' | 'f'): ShapeField {
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const at = (n: string) => {
      const b = bones.find((x) => x.name === n);
      return b ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld)) : new THREE.Vector3();
    };
    const lr = (n: string) => [at(`${n}_l`), at(`${n}_r`)];
    return new ShapeField(
      { pelvis: at('pelvis'), s1: at('spine_01'), s2: at('spine_02'), s3: at('spine_03'), neck: at('neck_01'), ua: lr('upperarm'), la: lr('lowerarm'), hand: lr('hand'), thigh: lr('thigh'), calf: lr('calf'), foot: lr('foot') },
      s,
      sex,
    );
  }

  /** The spine's depth (z) at a height. */
  axisZ(y: number): number {
    const k = [this.m.pelvis, this.m.s1, this.m.s2, this.m.s3, this.m.neck];
    if (y <= k[0]!.y) return k[0]!.z;
    for (let i = 1; i < k.length; i++)
      if (y <= k[i]!.y) return THREE.MathUtils.lerp(k[i - 1]!.z, k[i]!.z, (y - k[i - 1]!.y) / Math.max(1e-6, k[i]!.y - k[i - 1]!.y));
    return k[k.length - 1]!.z;
  }

  /** Radial push off a limb's segment a→b, `amt(t)` along it (t 0..1); added to `out`, weighted by `w`. */
  private limb(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, w: number, amt: (t: number, dir: THREE.Vector3) => number, out: THREE.Vector3): void {
    if (w <= 0) return;
    const ab = _ab.subVectors(b, a);
    const L2 = ab.lengthSq();
    const t = THREE.MathUtils.clamp(_ap.subVectors(p, a).dot(ab) / L2, 0, 1);
    const dir = _ap.subVectors(p, _q.copy(a).addScaledVector(ab, t));
    dir.addScaledVector(ab, -dir.dot(ab) / L2);
    if (dir.lengthSq() < 1e-10) return;
    dir.normalize();
    const d = amt(t, dir);
    if (d) out.addScaledVector(dir, d * w);
  }

  /** D(p): the offset of a rest-pose point (model space). */
  at(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const { m, s } = this;
    const f = this.sex === 'f';
    const ax = Math.abs(p.x);
    const side = p.x >= 0 ? 0 : 1;
    // Which way the parts go: the arms beyond the shoulder (T-pose, along x), the legs below the crotch.
    const sx = Math.abs(m.ua[0]!.x);
    const wArm = smooth(sx - 0.03, sx + 0.05, ax) * smooth(m.s3.y - 0.05, m.s3.y + 0.05, p.y);
    const crotch = m.thigh[0]!.y - 0.1;
    const wLeg = 1 - smooth(crotch - 0.06, crotch + 0.06, p.y);
    const wTorso = (1 - wArm) * (1 - wLeg) * (1 - smooth(m.neck.y - 0.02, m.neck.y + 0.06, p.y));

    // Torso: out from the spine in the horizontal plane, by height and angle (front = +z).
    if (wTorso > 0) {
      const dx = p.x;
      const dz = p.z - this.axisZ(p.y);
      const r = Math.hypot(dx, dz);
      if (r > 1e-5) {
        const cx = dx / r;
        const cz = dz / r;
        const front = Math.max(0, cz);
        const back = Math.max(0, -cz);
        const lat = Math.abs(cx);
        const y = p.y;
        const chestY = m.s3.y + 0.04;
        const waistY = (m.s1.y + m.s2.y) / 2;
        const bellyY = (m.pelvis.y + m.s2.y) / 2;
        const hipY = m.pelvis.y - 0.03;
        let d = 0;
        d += s.chest * (f ? 0.008 : 0.02) * bump(y, chestY, 0.13) * (0.4 + 0.6 * front);
        d += s.shoulders * 0.025 * bump(y, m.ua[0]!.y - 0.02, 0.1) * lat * lat;
        d += s.waist * 0.028 * bump(y, waistY, 0.12) * (0.6 + 0.4 * lat);
        d += s.belly * (s.belly > 0 ? 0.06 : 0.02) * bump(y, bellyY, 0.15) * front ** 1.5;
        d += s.hips * 0.035 * bump(y, hipY, 0.13) * lat ** 1.5;
        d += s.glutes * 0.035 * bump(y, hipY - 0.04, 0.12) * back ** 1.5;
        out.x += cx * d * wTorso;
        out.z += cz * d * wTorso;
      }
      // The bust (both sexes, smaller on a man): forward, round each breast.
      const bx = f ? 0.085 : 0.08;
      const by = m.s3.y + (f ? 0.02 : 0.04);
      const cone = Math.max(bump(Math.hypot(ax - bx, (p.y - by) * 1.1), 0, f ? 0.11 : 0.12), 0);
      const fr = smooth(0, 0.5, (p.z - this.axisZ(p.y)) / 0.1);
      out.z += s.chest * (f ? 0.035 : 0.012) * cone * fr * wTorso;
    }

    // Arms: round the upper arm, less on the forearm; the shoulders widen the top of the arm too.
    {
      const ua = m.ua[side]!;
      const hand = m.hand[side]!;
      const tE = ua.distanceTo(m.la[side]!) / Math.max(1e-6, ua.distanceTo(hand));
      this.limb(p, ua, hand, wArm, (t) => s.arms * (t < tE ? 0.016 : THREE.MathUtils.lerp(0.012, 0, (t - tE) / (1 - tE))) + s.shoulders * 0.012 * bump(t, 0, tE * 1.2), out);
    }

    // Legs: each thigh, then calf; hips and glutes carry on down the top of the thigh. Blend the sides at x = 0.
    if (wLeg > 0) {
      const wl = smooth(-0.025, 0.025, p.x);
      for (const [k, w] of [
        [0, wl * wLeg],
        [1, (1 - wl) * wLeg],
      ] as const) {
        const outward = k === 0 ? 1 : -1;
        // One segment hip → ankle: thigh above the knee, calf below, nothing at the ankle (the boots stay).
        const tK = m.thigh[k]!.distanceTo(m.calf[k]!) / Math.max(1e-6, m.thigh[k]!.distanceTo(m.foot[k]!));
        this.limb(p, m.thigh[k]!, m.foot[k]!, w, (t, dir) => {
          const top = bump(t, 0, 0.3);
          const lat = Math.max(0, dir.x * outward);
          const bk = Math.max(0, -dir.z);
          const thigh = t < tK ? 1 - 0.5 * (t / tK) ** 2 : 0.5 * bump(t, tK, 0.12);
          const calf = bump(t, tK + (1 - tK) * 0.35, (1 - tK) * 0.55) * (0.5 + 0.5 * bk);
          return s.thighs * 0.026 * thigh + s.calves * 0.016 * calf + s.hips * 0.035 * top * lat ** 1.5 + s.glutes * 0.035 * top * bk ** 1.5;
        }, out);
      }
    }
    return out.multiplyScalar(GAIN);
  }
}
/** Overall strength of the shapes (the amounts above are per unit slider at gain 1). */
const GAIN = 1.6;

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _q = new THREE.Vector3();

/** Per neutral geometry: its shaped copies by `${sex}|${shapeKey}`. */
const SHAPED = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
export const shapeStats = { builds: 0, ms: 0, verts: 0 };

/**
 * Shape one skinned mesh by the field: each vertex is skinned to where it stands at rest (the skeleton must be
 * at rest), pushed by D there, and the push carried back into the geometry's own space by the inverse of that
 * vertex's skinning. Idempotent: the neutral geometry is kept on the mesh (userData.neutralGeo).
 */
export function shapeMesh(mesh: THREE.SkinnedMesh, model: THREE.Object3D, field: ShapeField | null, key: string): void {
  const rigid = !!mesh.userData.rigidShape;
  const neutral = (mesh.userData.neutralGeo as THREE.BufferGeometry | undefined) ?? mesh.geometry;
  if (!field || !key) {
    if (mesh.userData.neutralGeo) mesh.geometry = neutral;
    delete mesh.userData.neutralGeo;
    return;
  }
  mesh.userData.neutralGeo = neutral;
  let per = SHAPED.get(neutral);
  if (!per) SHAPED.set(neutral, (per = new Map()));
  let g = per.get(key);
  if (!g) {
    const t0 = performance.now();
    g = bakeShape(mesh, neutral, model, field, rigid);
    per.set(key, g);
    shapeStats.builds++;
    shapeStats.ms += performance.now() - t0;
    shapeStats.verts += neutral.attributes.position!.count;
  }
  mesh.geometry = g;
}

/**
 * `rigid`: armour plates and carriers don't bulge with a belly. Round the spine in 16 sectors, each piece moves
 * out by the most the field pushes anything in that sector, upper and lower half apart (so it tilts over a belly
 * rather than wrapping it), and never less than the field there (no clipping).
 */
function bakeShape(mesh: THREE.SkinnedMesh, src: THREE.BufferGeometry, model: THREE.Object3D, field: ShapeField, rigid = false): THREE.BufferGeometry {
  model.updateMatrixWorld(true);
  const sk = mesh.skeleton;
  // world = matrixWorld · bindMatrixInverse · Σ w·(bone · boneInverse) · bindMatrix · v ('attached': the inverse
  // is matrixWorld's own); then into the model's space.
  const bmInv = mesh.bindMode === 'attached' ? new THREE.Matrix4().copy(mesh.matrixWorld).invert() : mesh.bindMatrixInverse;
  const pre = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(mesh.matrixWorld).multiply(bmInv);
  const B = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(pre, b.matrixWorld).multiply(sk.boneInverses[i]!).multiply(mesh.bindMatrix).elements);
  const pos = src.attributes.position!;
  const si = src.attributes.skinIndex!;
  const sw = src.attributes.skinWeight!;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const Ms: Float32Array = new Float32Array(n * 16);
  const P = new Float32Array(n * 3);
  const D = new Float32Array(n * 3);
  const M = new THREE.Matrix4();
  const e = M.elements;
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  const m3 = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    e.fill(0);
    let ws = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (!w) continue;
      ws += w;
      const be = B[si.getComponent(i, c)]!;
      for (let k = 0; k < 16; k++) e[k]! += be[k]! * w;
    }
    if (ws > 0 && Math.abs(ws - 1) > 1e-3) for (let k = 0; k < 16; k++) e[k]! /= ws;
    if (!ws) e[0] = e[5] = e[10] = e[15] = 1;
    Ms.set(e, i * 16);
    v.fromBufferAttribute(pos, i).applyMatrix4(M).toArray(P, i * 3);
    field.at(v, d).toArray(D, i * 3);
  }
  if (rigid) rigidify(P, D, field);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    d.fromArray(D, i * 3);
    if (d.lengthSq() > 1e-12) v.add(d.applyMatrix3(m3.setFromMatrix4(M.fromArray(Ms, i * 16)).invert()));
    v.toArray(out, i * 3);
  }
  // Only the positions are new: everything else (normals, uvs, skinning, index) is shared with the neutral mesh.
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setIndex(src.index);
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.userData = src.userData;
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function rigidify(P: Float32Array, D: Float32Array, field: ShapeField): void {
  const n = P.length / 3;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) (y0 = Math.min(y0, P[i * 3 + 1]!)), (y1 = Math.max(y1, P[i * 3 + 1]!));
  // Four faces (front +z, back -z, left +x, right -x), each moved straight out as one, by the most the field
  // pushes it in its upper and lower half; in between by height (it tilts), blended round the corners.
  const QX = [0, 0, 1, -1];
  const QZ = [1, -1, 0, 0];
  const top = [0, 0, 0, 0];
  const bot = [0, 0, 0, 0];
  const mid = (y0 + y1) / 2;
  const W = new Float32Array(n * 4);
  const dir = new Float32Array(n * 2);
  const rad = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!;
    const y = P[i * 3 + 1]!;
    const z = P[i * 3 + 2]! - field.axisZ(y);
    const r = Math.hypot(x, z) || 1;
    const cx = x / r;
    const cz = z / r;
    dir[i * 2] = cx;
    dir[i * 2 + 1] = cz;
    rad[i] = D[i * 3]! * cx + D[i * 3 + 2]! * cz;
    let ws = 0;
    for (let q = 0; q < 4; q++) ws += W[i * 4 + q] = Math.max(0, cx * QX[q]! + cz * QZ[q]!) ** 2;
    for (let q = 0; q < 4; q++) {
      W[i * 4 + q]! /= ws || 1;
      if (W[i * 4 + q]! < 0.5) continue;
      const along = D[i * 3]! * QX[q]! + D[i * 3 + 2]! * QZ[q]!;
      if (y > mid) top[q] = Math.max(top[q]!, along);
      else bot[q] = Math.max(bot[q]!, along);
    }
  }
  const yt = (mid + y1) / 2;
  const yb = (y0 + mid) / 2;
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp((P[i * 3 + 1]! - yb) / Math.max(1e-6, yt - yb), 0, 1);
    let dx = 0;
    let dz = 0;
    for (let q = 0; q < 4; q++) {
      const a = THREE.MathUtils.lerp(bot[q]!, top[q]!, t) * W[i * 4 + q]!;
      dx += QX[q]! * a;
      dz += QZ[q]! * a;
    }
    // Never inside what the field puts under it.
    const short = rad[i]! - (dx * dir[i * 2]! + dz * dir[i * 2 + 1]!);
    if (short > 0) (dx += short * dir[i * 2]!), (dz += short * dir[i * 2 + 1]!);
    D[i * 3] = dx;
    D[i * 3 + 2] = dz;
  }
}

/** Run `fn` with these meshes back on their neutral geometry (gear is measured and fitted on the neutral body). */
export function withNeutral<T>(meshes: THREE.Mesh[], fn: () => T): T {
  const was = meshes.map((m) => m.geometry);
  for (const m of meshes) if (m.userData.neutralGeo) m.geometry = m.userData.neutralGeo as THREE.BufferGeometry;
  try {
    return fn();
  } finally {
    meshes.forEach((m, i) => (m.geometry = was[i]!));
  }
}
