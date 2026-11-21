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
import { FACE_KEYS, NEUTRAL_FACE, NEUTRAL_SHAPE, type BodyShape, type FaceShape, type IdentityMix } from '@ashfall/engine';
import { identityDeltas, type IdentityField } from './faceIdentity';
export { NEUTRAL_SHAPE, SHAPE_PRESETS, shapeFromSeed, type BodyShape, type FaceShape } from '@ashfall/engine';

/** The cache key of a body shape and face ('' for the modelled body and face as they are). */
export function shapeKey(s: BodyShape | undefined, face?: FaceShape): string {
  const v = s ? (Object.keys(NEUTRAL_SHAPE) as (keyof BodyShape)[]).map((k) => Math.round((s[k] ?? 0) * 20)) : [];
  const f = face ? FACE_KEYS.map((k) => Math.round((face[k] ?? 0) * 20)) : [];
  return [...v, ...f].every((x) => x === 0) ? '' : `${v.join(',')}|${f.join(',')}`;
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
  /** Between the eyes, at their front (the face's landmark), if the model has eyes. */
  eye: THREE.Vector3 | null;
  /** The eyeballs' half spacing and radius as measured on this body's eyes (else EYE_X / EYE_R: the old bodies). */
  eyeX?: number;
  eyeR?: number;
}

/** The displacement field of one shape on one skeleton (built at rest, in the model's space). */
export class ShapeField {
  /** The sliders as the field uses them: a fuller build (+) goes further than a leaner one (-), which a limb's
   * own thickness limits (a slim thigh can't lose as much as a heavy one gains). */
  private s: BodyShape;
  /** The model's height scale for this shape (rigid armour is scaled back by it: one size for everyone). */
  readonly k: number;
  constructor(
    private m: Marks,
    s: BodyShape,
    private sex: 'm' | 'f',
    private face: FaceShape | null = null,
  ) {
    this.k = heightFactor(s);
    // The old (UBC) bodies' heads, corrected towards measured proportions (OLD_FIX): their own sliders are added to
    // the face, the rest (cranium, eye line, lower face) are terms of faceAt. MPFB bodies (eyeX measured) are as built.
    if (m.eye && m.eyeX === undefined) {
      this.fix = OLD_FIX[sex];
      const f = { ...(face ?? NEUTRAL_FACE) };
      for (const [k, v] of Object.entries(this.fix.face) as [keyof FaceShape, number][]) f[k] = f[k] + v;
      this.face = f;
    }
    const out = { ...s };
    // MPFB bodies (eyeX measured) are fitted to real scans: their own waist / hips / legs are already realistic,
    // so the presets' pushes are scaled down there (MPFB_GAIN) to stay inside ANSUR's 5th-95th percentiles.
    const g = m.eyeX !== undefined ? MPFB_GAIN[sex] : null;
    for (const k of Object.keys(out) as (keyof BodyShape)[]) {
      // (the AI build is a morph target's weight, baked with the identities: faceIdentity.ts, character.ts applyShape)
      if (k === 'ai') continue;
      const [up, down] = g?.[k] ?? [1, 1];
      out[k] = out[k] > 0 ? out[k] * GAIN_UP * up : out[k] * GAIN_DOWN * down;
    }
    this.s = out;
  }

  static fromBones(bones: THREE.Bone[], model: THREE.Object3D, s: BodyShape, sex: 'm' | 'f', face: FaceShape | null = null, eye: THREE.Vector3 | null = null, eyeDims: { x: number; r?: number } | null = null): ShapeField {
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const at = (n: string) => {
      const b = bones.find((x) => x.name === n);
      return b ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld)) : new THREE.Vector3();
    };
    const lr = (n: string) => [at(`${n}_l`), at(`${n}_r`)];
    return new ShapeField(
      { pelvis: at('pelvis'), s1: at('spine_01'), s2: at('spine_02'), s3: at('spine_03'), neck: at('neck_01'), ua: lr('upperarm'), la: lr('lowerarm'), hand: lr('hand'), thigh: lr('thigh'), calf: lr('calf'), foot: lr('foot'), eye, eyeX: eyeDims?.x, eyeR: eyeDims?.r },
      s,
      sex,
      face,
    );
  }

  /**
   * The eyes' own field: the body's, plus each eyeball moved as one piece with the face round it (its socket's
   * spacing, the head's width), scaled for the eye size and turned for the tilt. The face's other features move
   * the skin over the eyes, not the eyes.
   */
  private fix: OldFix | null = null;
  eyesOnly(): ShapeField {
    const f = new ShapeField(this.m, NEUTRAL_SHAPE, this.sex, null);
    f.face = this.face;
    f.fix = this.fix;
    f.s = this.s;
    (f as { k: number }).k = this.k;
    f.eyeMode = true;
    f.mix = this.mix;
    f.idField = this.idField;
    return f;
  }
  private eyeMode = false;

  /** The face identity (faceIdentity.ts): meshes with its targets bake them per vertex, the rest take idField. */
  mix: IdentityMix | null = null;
  private idField: IdentityField | null = null;
  setIdentity(mix: IdentityMix, f: IdentityField | null): void {
    this.mix = mix;
    this.idField = f;
  }

  /** Kept for callers that want the body without the face. */
  bodyOnly(): ShapeField {
    const f = new ShapeField({ ...this.m, eye: null }, NEUTRAL_SHAPE, this.sex);
    f.s = this.s;
    (f as { k: number }).k = this.k;
    return f;
  }

  /** An eyeball's point: rigidly with its socket (see eyesOnly). */
  private eyeAt(p: THREE.Vector3, out: THREE.Vector3): void {
    const F = this.face;
    const e = this.m.eye;
    if (!F || !e) return;
    const sx = p.x >= 0 ? 1 : -1;
    const c = _ec.set(sx * (this.m.eyeX ?? EYE_X), e.y, e.z - (this.m.eyeR ?? EYE_R)).add(_ez.set(e.x, 0, 0));
    // Where the socket goes: the face's displacement at the eyeball's centre (spacing, head width).
    this.faceAt(c, _ed.set(0, 0, 0), true);
    _ed.x += sx * F.eyeSpacing * 0.006;
    const q = _eq.subVectors(p, c);
    // Size: about its centre; tilt: the outer corner up (a turn about the forward axis).
    const k = F.eyeSize * 0.2;
    const th = F.eyeTilt * 0.2 * sx;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const rx = q.x * cs - q.y * sn;
    const ry = q.x * sn + q.y * cs;
    out.x += _ed.x + (rx - q.x) + rx * k;
    out.y += _ed.y + (ry - q.y) + ry * k;
    out.z += _ed.z + q.z * k;
  }

  /**
   * The face's part of D(p) (model space, metres, round the landmark between the eyes): the skull's width and
   * length, the forehead, the brow ridge and its height, the skin round the eyes (with the eyes: size, spacing,
   * tilt), the nose (size, width, bridge, tip), the lips and the mouth's width, the jaw, the chin (forward, longer,
   * pointed or square, a cleft), the cheekbones and the cheeks' fullness, the ears. `socket`: only what moves an
   * eye socket as a whole (for eyeAt).
   */
  private faceAt(p: THREE.Vector3, out: THREE.Vector3, socket = false): void {
    const F = this.face;
    const e = this.m.eye;
    if (!F || !e) return;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dz = p.z - e.z;
    if (dy > 0.16 || dy < -0.2 || Math.abs(dx) > 0.14 || dz < -0.26) return;
    const ax = Math.abs(dx);
    const sx = dx >= 0 ? 1 : -1;
    // The head (not the neck): round its centre, fading out under the jaw and down the back of the neck.
    const hx = dx / 0.115;
    const hy = (dy - 0.0) / 0.16;
    const hz = (dz + 0.085) / 0.135;
    const head = (1 - smooth(0.9, 1.15, Math.hypot(hx, hy, hz))) * smooth(-0.15, -0.115, dy - Math.max(0, -dz - 0.06) * 0.6);
    // The skull's width (the sides of the head out, the face with it) and length (the crown up).
    out.x += F.headWidth * 0.008 * (dx / 0.08) * head;
    out.y += F.headLength * 0.009 * smooth(-0.02, 0.11, dy) * head;
    const X = this.fix;
    if (X) {
      // Cranium narrower behind the face (the old male head was ~13% too broad for ANSUR; the face itself was not).
      out.x += X.cranium * dx * head * (1 - smooth(-0.115, -0.08, dz));
      // The face's vertical proportions: the eyes (and brows) a little lower, the nose base and mouth higher, the chin
      // longer (eye -> subnasale / stomion / menton to the London medians), front of the face only.
      const v = lin(X.vert, dy * 1000) / 1000;
      out.y += v * smooth(-0.11, -0.03, dz) * (1 - smooth(0.07, 0.1, ax));
    }
    if (socket) return;
    // Only the face: fading out towards the ears and behind the jaw.
    const front = smooth(-0.075, -0.02, dz);
    const jawSide = smooth(-0.12, -0.05, dz);
    // Round each eye: the lids and the skin round them follow the eyeball (size, spacing, tilt).
    {
      const ex = dx - sx * (this.m.eyeX ?? EYE_X);
      const ey = dy;
      const ez = dz + (this.m.eyeR ?? EYE_R);
      const d = Math.hypot(ex, ey * 1.15, ez * 0.8);
      const w = bump(d, 0, 0.034) * front;
      if (w > 0) {
        const k = F.eyeSize * 0.2;
        const th = F.eyeTilt * 0.2 * sx;
        out.x += (ex * (Math.cos(th) - 1) - ey * Math.sin(th) + ex * k) * w;
        out.y += (ex * Math.sin(th) + ey * (Math.cos(th) - 1) + ey * k * 1.2) * w;
        out.z += ez * k * 0.5 * w;
        out.x += sx * F.eyeSpacing * 0.006 * bump(d, 0, 0.04) * front;
        // (old bodies) the lids' opening taller and the eye's length shorter, round its centre
        if (this.fix) {
          out.y += ey * this.fix.eyeOpen * w;
          out.x += ex * this.fix.eyeLong * w;
        }
      }
    }
    // Forehead: sloping back (-) or upright and full (+).
    out.z += F.forehead * 0.008 * bump(dy, 0.07, 0.05) * bump(ax, 0, 0.065) * front;
    // Brow ridge: forward over the eyes; and the brows' height.
    out.z += F.brow * 0.014 * bump(dy, 0.026, 0.022) * bump(ax, 0.028, 0.045) * front;
    out.y += F.browHeight * 0.006 * bump(dy, 0.024, 0.02) * bump(ax, 0.03, 0.045) * front;
    // Nose: forward along the middle, from the bridge to the tip (its size).
    out.z += F.nose * 0.017 * bump(dy, -0.03, 0.032) * bump(dx, 0, 0.017) * front;
    // Its width at the nostrils.
    out.x += sx * F.noseWidth * 0.009 * bump(dy, -0.047, 0.018) * bump(ax, 0.013, 0.016) * front;
    // The bridge: a hump (aquiline, +) or a scoop (-).
    out.z += F.noseBridge * 0.009 * bump(dy, -0.016, 0.016) * bump(dx, 0, 0.011) * front;
    // The tip: up (+, upturned) or down and hooked (-).
    {
      const t = bump(dy, -0.043, 0.014) * bump(dx, 0, 0.016) * smooth(0.012, 0.03, dz);
      out.y += F.noseTip * 0.009 * t;
      out.z -= F.noseTip * 0.003 * t;
    }
    // Lips: fuller forward and apart (+) or thin (-); the mouth's width at the corners.
    {
      const up = bump(dy, -0.067, 0.009);
      const lo = bump(dy, -0.083, 0.011);
      const across = bump(ax, 0, 0.026) * front;
      out.z += F.lips * 0.0065 * (up + lo) * across;
      out.y += F.lips * 0.0026 * (up - lo) * across;
      out.x += sx * F.mouthWidth * 0.008 * bump(dy, -0.075, 0.016) * bump(ax, 0.022, 0.016) * front;
    }
    // Cheekbones: out and a little forward, under the outer corner of the eyes.
    // (Broad and modest: a tight 1 cm ball here read as a bruised dent under it, not as a cheekbone.)
    // Fading out slower below than above: a cheekbone that stopped short over a narrow jaw left a ledge (elfin's crease).
    const cheek = F.cheeks * bump(dy, -0.024, dy < -0.024 ? 0.058 : 0.04) * bump(ax, 0.05, 0.045) * front;
    // Cheeks: full (+) or hollow (-) below the cheekbones.
    const full = F.cheekFull * bump(dy, -0.062, 0.032) * bump(ax, 0.043, 0.03) * smooth(-0.09, -0.03, dz);
    // Jaw: wider or narrower from below the ears to the chin's sides.
    // Out at the jaw's sides and angles, little round the mouth (a narrow jaw pulled in there grooved the cheeks).
    // Narrowing is gentler than widening, and fades up into the cheek slower (an in-pulled jaw under a full cheekbone
    // creased the cheek across).
    const jaw = F.jaw * (F.jaw < 0 ? 0.011 : 0.016) * bump(dy, -0.09, F.jaw < 0 && dy > -0.09 ? 0.062 : 0.05) * smooth(0.026, 0.066, ax) * jawSide;
    // Chin: forward and a little down.
    const chin = F.chin * bump(dy, -0.105, 0.032) * bump(dx, 0, 0.032) * front;
    // Cheekbones and cheeks swell out of the face (along it, from the head's vertical axis), not sideways: a
    // sideways push only slid the skin across the front of the face and creased it into a dent beside the nose.
    {
      const rz = dz + 0.07;
      const rl = Math.hypot(dx, rz) || 1;
      const k = cheek * 0.0075 + full * 0.008;
      out.x += (dx / rl) * k;
      out.z += (rz / rl) * k;
      // The jaw likewise, out of its own surface (narrowing it sideways creased the face from the mouth's corners).
      const js = F.jaw < 0 ? 0.45 : 0.7;
      out.x += sx * jaw * js + (dx / rl) * jaw * (1 - js);
      out.z += (rz / rl) * jaw * (1 - js) * smooth(0.02, 0.05, ax);
    }
    // Forward more than down: down as well dragged a forward chin into a point (narrow).
    out.y -= chin * (chin > 0 ? 0.0055 : 0.01);
    out.z += chin * 0.016;
    // Chin: longer (+) or shorter, the lower face from the mouth down (and under the chin with it).
    out.y -= F.chinLength * 0.012 * smooth(-0.076, -0.112, dy) * smooth(-0.11, -0.05, dz) * bump(ax, 0, 0.07);
    // Its shape: pointed (+, the sides in) or square (-, out).
    // (In or out of the chin's own surface: pinching it sideways creased the face down from the mouth's corners.)
    {
      // Pointed tapers the jaw's front broadly (a tight pinch beside the tip read as a spike on narrow / elfin).
      const k = F.chinShape * (F.chinShape > 0 ? 0.0065 : 0.009) * bump(dy, -0.1, 0.038) * smooth(0.006, 0.034, ax) * bump(ax, 0.034, 0.046) * front;
      const rz = dz + 0.07;
      const rl = Math.hypot(dx, rz) || 1;
      out.x -= (dx / rl) * k * 0.6 + sx * k * 0.4;
      out.z -= (rz / rl) * k * 0.6;
    }
    // A cleft down its middle.
    out.z -= Math.max(0, F.cleft) * 0.0035 * bump(dy, -0.108, 0.013) * bump(dx, 0, 0.0055) * front;
    // Ears: bigger or smaller about where they join the head.
    {
      const ex = dx - sx * 0.074;
      const ey = dy + 0.008;
      const ez = dz + 0.102;
      const d = Math.hypot(ex * 0.8, ey, ez);
      const w = bump(d, 0, 0.045) * smooth(0.066, 0.08, ax);
      if (w > 0) {
        const k = F.ears * 0.35 * w;
        out.x += ex * k + sx * Math.max(0, F.ears) * 0.003 * w;
        out.y += ey * k;
        out.z += ez * k;
      }
    }
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
  at(p: THREE.Vector3, out: THREE.Vector3, skipIdentity = false): THREE.Vector3 {
    out.set(0, 0, 0);
    if (this.idField && !skipIdentity) this.idField.add(p, out);
    const { m, s } = this;
    const f = this.sex === 'f';
    const ax = Math.abs(p.x);
    const side = p.x >= 0 ? 0 : 1;
    // Which way the parts go: the arms beyond the shoulder (T-pose, along x), the legs below the crotch.
    const sx = Math.abs(m.ua[0]!.x);
    // (A wide blend: a 8 cm one left a step round the top of the arm, a puffed sleeve at the shoulder.)
    const wArm = smooth(sx - 0.06, sx + 0.09, ax) * smooth(m.s3.y - 0.05, m.s3.y + 0.05, p.y);
    const crotch = m.thigh[0]!.y - 0.1;
    // (Wide too: the torso's push and the thighs' meet here; a 12 cm blend creased a fuller hip into a tyre's edge.)
    const wLeg = 1 - smooth(crotch - 0.1, crotch + 0.1, p.y);
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
        d += s.shoulders * 0.03 * bump(y, m.ua[0]!.y - 0.02, 0.1) * lat * lat;
        // (Broad: at 0.12 a heavy waist with the belly read as a tyre round the middle.)
        d += s.waist * 0.032 * bump(y, waistY, 0.17) * (0.6 + 0.4 * lat);
        // Fuller below the navel than above, fading slowly into the groin (a symmetric bump left a hard lower rim).
        d += s.belly * (s.belly > 0 ? 0.036 : 0.02) * bump(y, bellyY - 0.02, y < bellyY - 0.02 ? 0.17 : 0.15) * front ** 1.5;
        d += s.hips * 0.03 * bump(y, hipY - 0.02, 0.18) * lat ** 1.5;
        d += s.glutes * 0.035 * bump(y, hipY - 0.04, 0.12) * back ** 1.5;
        out.x += cx * d * wTorso;
        out.z += cz * d * wTorso;
      }
    }
    // The bust (breasts; a man's pecs): a rounded volume that swells out from inside the chest, each side round its
    // own centre (C, behind the surface), along the line from C to the point: the front grows forward, the sides
    // out and the underside down, as a fuller (or smaller) breast is, rather than the whole chest sliding forward.
    if (wTorso > 0 && s.bust) {
      const bx = f ? 0.088 : 0.085;
      const by = m.s3.y + (f ? 0.0 : 0.035);
      const cz = this.axisZ(by) + (f ? 0.045 : 0.035);
      const cx = p.x >= 0 ? bx : -bx;
      const dx = p.x - cx;
      const dy = p.y - by;
      const dz = p.z - cz;
      const r = Math.hypot(dx, dy, dz);
      if (r > 1e-5) {
        // Round the breast's own axis (forward through C): full on the front, fading round to the ribs at the sides
        // and up to the collarbone; nothing behind C.
        const lat = Math.hypot(dx, (dy > 0 ? dy * 1.25 : dy) * 1.05);
        const R = f ? 0.105 : 0.11;
        const w = bump(lat, 0, R) * smooth(-0.02, 0.03, dz);
        const a = s.bust * (f ? 0.012 : 0.0055) * w * wTorso;
        out.x += (dx / r) * a * 0.7;
        out.y += (dy / r) * a * (dy < 0 ? 0.9 : 0.35);
        out.z += (dz / r) * a;
      }
    }

    // Arms: round the upper arm, less on the forearm; the shoulders widen the top of the arm too.
    {
      const ua = m.ua[side]!;
      const hand = m.hand[side]!;
      const tE = ua.distanceTo(m.la[side]!) / Math.max(1e-6, ua.distanceTo(hand));
      // The upper arm fullest at the biceps / triceps (a uniform tube read as a pipe), easing in from the shoulder; the
      // shoulders a deltoid cap over the top of the arm, not a ring round it.
      this.limb(p, ua, hand, wArm, (t, dir) => {
        const u = t / tE;
        const upper = t < tE ? 0.019 * (0.55 + 0.45 * bump(u, 0.5, 0.6)) * smooth(-0.1, 0.25, u) : THREE.MathUtils.lerp(0.012, 0, (t - tE) / (1 - tE));
        return s.arms * upper + s.shoulders * 0.012 * bump(t, tE * 0.12, tE * 0.45) * (0.45 + 0.55 * Math.max(0, dir.y));
      }, out);
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
          // Fullest at the top, tapering steadily to the knee (a thigh that stayed full to mid-length read as breeches).
          const thigh = t < tK ? 1 - 0.65 * (t / tK) : 0.35 * bump(t, tK, 0.12);
          const calf = bump(t, tK + (1 - tK) * 0.35, (1 - tK) * 0.55) * (0.5 + 0.5 * bk);
          // Hips carry on down the thigh's outside at ~0.85 strength (full strength ballooned the top of the leg out
          // ~16 cm a side, riding breeches; two thirds left a crease where the torso's hips met the thigh's).
          return s.thighs * 0.02 * thigh + s.calves * 0.016 * calf + s.hips * 0.026 * top * lat ** 1.5 + s.glutes * 0.03 * top * bk ** 1.5;
        }, out);
      }
    }
    // (old bodies) the neck slimmer: his was ~30% over ANSUR's median girth. Radially round the neck's axis, between
    // the shoulders' top and the jaw, not the trapezius (only within ~11 cm of the axis).
    if (this.fix?.neck && !this.eyeMode) {
      const n = m.neck;
      const dx = p.x - n.x;
      const dz = p.z - n.z;
      const r = Math.hypot(dx, dz);
      const w = bump(p.y, n.y + 0.05, 0.06) * (1 - smooth(0.095, 0.13, r));
      if (w > 0 && r > 1e-5) {
        out.x += dx * this.fix.neck * w;
        out.z += dz * this.fix.neck * w;
      }
    }
    if (this.eyeMode) this.eyeAt(p, out);
    else this.faceAt(p, out);
    return out;
  }
}
/**
 * Overall strength of the shapes (the amounts above are per unit slider at gain 1). At 1.6 a slim or athletic
 * build moved the clothes 2-3.5 cm at most and nobody could tell the bodies apart from the raid camera; now a
 * slim waist loses ~5 cm a side, a heavy one gains ~7, athletic shoulders ~6.
 */
const GAIN_UP = 2.7;
const GAIN_DOWN = 2.1;
/**
 * Per slider [up, down] on the scan-fitted MPFB bodies (tools/assets/mpfb-pilot/fit_scan.py), from measure_shapes.mjs
 * against ANSUR II: at the old gains heavy reached the 147th percentile waist (a tyre), slim / athletic went under
 * the 5th (waist, calves, thighs), pear's hips the 97th; the women's athletic shoulders puffed.
 */
const MPFB_GAIN: Record<'m' | 'f', Partial<Record<keyof BodyShape, readonly [number, number]>>> = {
  m: { waist: [0.5, 0.55], belly: [0.45, 0.8], hips: [0.2, 0.7], glutes: [1, 0.7], thighs: [0.85, 0.7], calves: [1, 0.4] },
  f: { waist: [0.7, 0.15], belly: [0.4, 0.6], hips: [0.8, 0.5], glutes: [1, 0.5], thighs: [1, 0.5], calves: [1, 0.4], shoulders: [0.7, 1] },
};

/** The eyeballs' centres from the landmark between the eyes (half their spacing; how far behind its front). */
/** Piecewise linear through [x, y] knots (x ascending), flat beyond the ends. */
function lin(k: readonly (readonly [number, number])[], x: number): number {
  if (x <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) if (x <= k[i]![0]) return THREE.MathUtils.lerp(k[i - 1]![1], k[i]![1], (x - k[i - 1]![0]) / (k[i]![0] - k[i - 1]![0]));
  return k[k.length - 1]![1];
}
interface OldFix {
  face: Partial<FaceShape>;
  cranium: number;
  /** Vertical shift (mm) by height round the eyes (mm, + up). */
  vert: readonly (readonly [number, number])[];
  eyeOpen: number;
  eyeLong: number;
  /** The neck's girth, relative (radial scale round its axis). */
  neck: number;
}
/**
 * The old (UBC) heads against the London Face Set medians and ANSUR II (tools/assets/mpfb-pilot: measure_face.mjs,
 * measure_body.mjs): both had the eyes ~68 mm apart (London ~64), set high over a long nose (eye -> nose base 58 mm
 * on him, London ~45) and a short chin; narrow noses; his eyes narrow, hers long thin slits; his skull ~13% too broad.
 */
const OLD_FIX: Record<'m' | 'f', OldFix> = {
  m: {
    face: { eyeSpacing: -0.3, noseWidth: 0.45 },
    cranium: -0.15,
    vert: [[-145, 0], [-123, -2], [-103, 0], [-78, 3.5], [-58, 6.5], [-40, 4], [-20, -1], [0, -5], [12, -6], [32, 0]],
    eyeOpen: 0.3,
    eyeLong: -0.2,
    neck: -0.2,
  },
  f: {
    face: { eyeSpacing: -0.42, noseWidth: 0.4, mouthWidth: 0.1 },
    cranium: 0,
    vert: [[-140, 0], [-119, 0], [-96, 0.5], [-73, 1.7], [-54, 5.8], [-37, 3], [-18, -1], [0, -3], [17, -4.5], [36, 0]],
    eyeOpen: 0.45,
    eyeLong: -0.5,
    neck: 0,
  },
};
const EYE_X = 0.034;
const EYE_R = 0.017;
const _ec = new THREE.Vector3();
const _ez = new THREE.Vector3();
const _ed = new THREE.Vector3();
const _eq = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _q = new THREE.Vector3();
const _idv = new THREE.Vector3();

/** Per neutral geometry: its shaped copies by `${sex}|${shapeKey}`. */
let SHAPED = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
/**
 * Every shaped copy, least recently used first: past SHAPED_MAX the oldest is forgotten and its GPU buffers freed
 * (a mesh still drawing it just uploads it again). The character creator bakes a copy per look it shows.
 */
const SHAPED_LRU = new Map<string, { neutral: THREE.BufferGeometry; key: string; g: THREE.BufferGeometry }>();
const SHAPED_MAX = 160;
/** Forgets every shaped copy (a dev carousel of ever-new looks would otherwise keep them all). */
export function clearShapedGeometries(): void {
  SHAPED = new WeakMap();
  SHAPED_LRU.clear();
}
/** Keep only the `keep` most recently used shaped copies (the creator closing). */
export function trimShapedGeometries(keep = 0): void {
  while (SHAPED_LRU.size > keep) {
    const [id, e] = SHAPED_LRU.entries().next().value!;
    SHAPED_LRU.delete(id);
    SHAPED.get(e.neutral)?.delete(e.key);
    e.g.dispose();
  }
}
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
  const id = `${neutral.uuid}|${key}`;
  if (!g) {
    const t0 = performance.now();
    g = bakeShape(mesh, neutral, model, field, rigid);
    per.set(key, g);
    shapeStats.builds++;
    shapeStats.ms += performance.now() - t0;
    shapeStats.verts += neutral.attributes.position!.count;
  } else SHAPED_LRU.delete(id);
  SHAPED_LRU.set(id, { neutral, key, g });
  trimShapedGeometries(SHAPED_MAX);
  mesh.geometry = g;
}

/** A skinned mesh's vertices (every `step`th) as they stand now, in the model's space (bakeShape's skinning). */
export function restPoints(mesh: THREE.SkinnedMesh, model: THREE.Object3D, step = 1): THREE.Vector3[] {
  model.updateMatrixWorld(true);
  const sk = mesh.skeleton;
  const bmInv = mesh.bindMode === 'attached' ? new THREE.Matrix4().copy(mesh.matrixWorld).invert() : mesh.bindMatrixInverse;
  const pre = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(mesh.matrixWorld).multiply(bmInv);
  const B = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(pre, b.matrixWorld).multiply(sk.boneInverses[i]!).multiply(mesh.bindMatrix));
  const geo = (mesh.userData.neutralGeo as THREE.BufferGeometry | undefined) ?? mesh.geometry;
  const pos = geo.attributes.position!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const out: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += step) {
    const p = new THREE.Vector3();
    let ws = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (!w) continue;
      ws += w;
      p.addScaledVector(t.copy(v.fromBufferAttribute(pos, i)).applyMatrix4(B[si.getComponent(i, c)]!), w);
    }
    out.push(ws ? p.multiplyScalar(1 / ws) : p.copy(v.fromBufferAttribute(pos, i)));
  }
  return out;
}

/**
 * The shaped surface's normals: the model's own, turned by as much as the surface turned (the difference between
 * the face normals of the shaped and the neutral positions). A fuller bust or a longer nose then shades as the new
 * shape instead of keeping the old one's light, and the model's own smoothing and seams are kept.
 */
function reshadeNormals(src: THREE.BufferGeometry, g: THREE.BufferGeometry): void {
  const n0 = src.attributes.normal as THREE.BufferAttribute | undefined;
  if (!n0 || !src.index) return;
  const flat = (pos: THREE.BufferAttribute) => {
    const t = new THREE.BufferGeometry();
    t.setAttribute('position', pos);
    t.setIndex(src.index);
    t.computeVertexNormals();
    return t.attributes.normal as THREE.BufferAttribute;
  };
  let a = NEUTRAL_N.get(src);
  if (!a) NEUTRAL_N.set(src, (a = flat(src.attributes.position as THREE.BufferAttribute)));
  const b = flat(g.attributes.position as THREE.BufferAttribute);
  const out = new Float32Array(n0.count * 3);
  const v = new THREE.Vector3();
  let moved = false;
  for (let i = 0; i < n0.count; i++) {
    const dx = b.getX(i) - a.getX(i);
    const dy = b.getY(i) - a.getY(i);
    const dz = b.getZ(i) - a.getZ(i);
    if (dx * dx + dy * dy + dz * dz > 1e-8) moved = true;
    v.set(n0.getX(i) + dx, n0.getY(i) + dy, n0.getZ(i) + dz).normalize();
    v.toArray(out, i * 3);
  }
  if (moved) g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}
const NEUTRAL_N = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();

/**
 * `rigid`: armour plates and carriers are one size for everyone: they never bulge, widen or stretch with a
 * shape or a height (see rigidify).
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
  // Facial hair lifted off the skin says where on the skin it grows (aAnchor): it moves as that skin point does.
  const anchor = src.attributes.aAnchor as THREE.BufferAttribute | undefined;
  // The face identity's own per-vertex targets (body, eyes, brows), geometry space; else its field (in field.at).
  const idD = field.mix ? identityDeltas(src, field.mix) : null;
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
    v.fromBufferAttribute(pos, i);
    if (idD) v.add(_idv.set(idD[i * 3]!, idD[i * 3 + 1]!, idD[i * 3 + 2]!));
    v.applyMatrix4(M).toArray(P, i * 3);
    if (anchor) v.fromBufferAttribute(anchor, i).applyMatrix4(M);
    field.at(v, d, !!idD).toArray(D, i * 3);
  }
  if (rigid) rigidify(P, D, field);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    if (idD) v.add(_idv.set(idD[i * 3]!, idD[i * 3 + 1]!, idD[i * 3 + 2]!));
    d.fromArray(D, i * 3);
    if (d.lengthSq() > 1e-12) v.add(d.applyMatrix3(m3.setFromMatrix4(M.fromArray(Ms, i * 16)).invert()));
    v.toArray(out, i * 3);
  }
  // Only the positions (and, where the surface turned, the normals) are new: everything else (uvs, skinning, index)
  // is shared with the neutral mesh.
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setIndex(src.index);
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.userData = src.userData;
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  if (!rigid) reshadeNormals(src, g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Armour is one size for everyone. The front and the back (the plates and what's on them) each move as one rigid
 * piece: out (or in) by as much as the field moves the body under them, upper and lower half apart, which tips
 * the piece (a true rotation, so it keeps its size) over a belly or a chest instead of wrapping it. Only the side
 * bands (cummerbund, straps) between them conform: they follow the body's sides and join the two pieces. The
 * model's height scale is taken back out about the piece's centre, the plates kept as far off the body as before.
 */
function rigidify(P: Float32Array, D: Float32Array, field: ShapeField): void {
  const n = P.length / 3;
  const k = field.k;
  let y0 = Infinity;
  let y1 = -Infinity;
  const c = new THREE.Vector3();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    lo.min(c.fromArray(P, i * 3));
    hi.max(c);
  }
  c.addVectors(lo, hi).multiplyScalar(0.5);
  y0 = lo.y;
  y1 = hi.y;
  const mid = (y0 + y1) / 2;
  const CZ = new Float32Array(n);
  const CX = new Float32Array(n);
  // Front (q 0, +z) and back (q 1, -z): the most the field pushes either half out, and how far out the piece is.
  const top = [-Infinity, -Infinity];
  const bot = [-Infinity, -Infinity];
  const out = [0, 0];
  const cnt = [0, 0];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!;
    const y = P[i * 3 + 1]!;
    const z = P[i * 3 + 2]! - field.axisZ(y);
    const r = Math.hypot(x, z) || 1;
    CX[i] = x / r;
    CZ[i] = z / r;
    if (Math.abs(CZ[i]!) < 0.5) continue;
    const q = CZ[i]! > 0 ? 0 : 1;
    const along = q === 0 ? D[i * 3 + 2]! : -D[i * 3 + 2]!;
    if (y > mid) top[q] = Math.max(top[q]!, along);
    else bot[q] = Math.max(bot[q]!, along);
    out[q]! += Math.abs(P[i * 3 + 2]! - c.z);
    cnt[q]!++;
  }
  for (let q = 0; q < 2; q++) {
    if (!Number.isFinite(top[q]!)) top[q] = Number.isFinite(bot[q]!) ? bot[q]! : 0;
    if (!Number.isFinite(bot[q]!)) bot[q] = top[q]!;
  }
  const span = Math.max(1e-6, (y1 - y0) / 2);
  const pz = field.axisZ(mid);
  // Each piece's pose: a rotation about x through (mid, axis) and a push along z.
  const pose = (q: number, x: number, y: number, z: number, o: THREE.Vector3) => {
    const sgn = q === 0 ? 1 : -1;
    // A plate tips at most ~12° (it rests on a belly, it doesn't follow it) and stands off by as much as it
    // needs to clear the body at its top and bottom.
    const tn = THREE.MathUtils.clamp((top[q]! - bot[q]!) / span, -0.2, 0.2);
    const th = Math.atan(tn) * sgn;
    const push = Math.max(top[q]! - (tn * span) / 2, bot[q]! + (tn * span) / 2);
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const dy = y - mid;
    const dz = z - pz;
    // The plates kept as far off the body as before once the height scale is taken out (below).
    const keep = (cnt[q]! ? out[q]! / cnt[q]! : 0) * (1 - 1 / k) * k;
    o.set(x, mid + dy * cs - dz * sn, pz + dz * cs + dy * sn + sgn * (push + keep));
    return o;
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!;
    const y = P[i * 3 + 1]!;
    const z = P[i * 3 + 2]!;
    const wf = THREE.MathUtils.smoothstep(CZ[i]!, -0.35, 0.35);
    pose(0, x, y, z, a);
    pose(1, x, y, z, b);
    a.lerp(b, 1 - wf);
    // The side bands follow the body's sides (and its height scale, so they stay on them).
    const wS = THREE.MathUtils.smoothstep(Math.abs(CX[i]!), 0.8, 0.97);
    a.x += wS * (D[i * 3]! + x * (k - 1));
    // Height taken back out about the piece's centre: the same size on everyone.
    a.sub(c).divideScalar(k).add(c);
    D[i * 3] = a.x - x;
    D[i * 3 + 1] = a.y - y;
    D[i * 3 + 2] = a.z - z;
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
