import * as THREE from 'three';

/**
 * Analytic two-bone IK for an arm, applied on top of whatever the animation mixer posed: the shoulder stays,
 * the elbow bends in the plane towards `pole`, the wrist lands on `target`. `weight` blends from the animated
 * pose (0) to the full reach (1), so a gesture can ease in and out. `palm` is how far past the wrist the target
 * is held: the wrist stops short of it so the palm, not the wrist joint, lands on the target.
 */
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

/** Turn `bone` in world space by `q` (scaled by weight), keeping it a local rotation under its parent. */
function rotateWorld(bone: THREE.Bone, q: THREE.Quaternion, weight: number): void {
  // Not q.slerpQuaternions(_id, q, w): that copies _id into q before reading it, and every partial weight came out as no turn at all.
  const r = weight < 1 ? _qw.copy(_id).slerp(q, weight) : q;
  bone.getWorldQuaternion(_wq);
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(r).multiply(_wq));
  bone.updateWorldMatrix(false, true);
}

export function reachArm(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, weight = 1, palm = 0): void {
  if (weight <= 0.001) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_s);
  lower.getWorldPosition(_e);
  hand.getWorldPosition(_w);
  const a = _e.distanceTo(_s);
  const b = _w.distanceTo(_e);
  _t.copy(target);
  if (palm > 0) _t.addScaledVector(_dir.subVectors(_t, _s).normalize(), -palm);
  _dir.subVectors(_t, _s);
  const d = THREE.MathUtils.clamp(_dir.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  _dir.normalize();
  // Elbow: law of cosines, bent towards the pole.
  _pole.subVectors(pole, _s);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0);
  _pole.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  _e2.copy(_s).addScaledVector(_dir, a * cosA).addScaledVector(_pole, a * Math.sqrt(1 - cosA * cosA));
  // Upper arm: swing the elbow onto its new place.
  _q.setFromUnitVectors(_e.sub(_s).normalize(), _e2.sub(_s).normalize());
  rotateWorld(upper, _q, weight);
  // Forearm: point the wrist at the target.
  lower.getWorldPosition(_e);
  hand.getWorldPosition(_w);
  _q.setFromUnitVectors(_w.sub(_e).normalize(), _t.sub(_e).normalize());
  rotateWorld(lower, _q, weight);
}

/** An arm with the hand bones the palm frame is read from. */
export interface Arm {
  side: 'l' | 'r';
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  middle: THREE.Bone;
  index: THREE.Bone;
  pinky: THREE.Bone;
}

/** Palm frame in world space: centre of the palm, finger direction, across the palm (index → pinky), palm normal. */
export interface Palm {
  c: THREE.Vector3;
  f: THREE.Vector3;
  x: THREE.Vector3;
  n: THREE.Vector3;
  len: number;
}

export const newPalm = (): Palm => ({ c: new THREE.Vector3(), f: new THREE.Vector3(), x: new THREE.Vector3(), n: new THREE.Vector3(), len: 0.1 });

const _h = new THREE.Vector3();
const _m = new THREE.Vector3();
const _x = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fd = new THREE.Vector3();
const _nd = new THREE.Vector3();
const _fa = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

/** Palm centre sits this far along the hand (wrist → middle knuckle) and this far off the bones on the palm side. */
const PALM_ALONG = 0.6;
const PALM_OUT = 0.018;

export function palmFrame(arm: Arm, out: Palm): Palm {
  arm.hand.getWorldPosition(_h);
  arm.middle.getWorldPosition(_m);
  out.f.subVectors(_m, _h);
  out.len = out.f.length() || 0.1;
  out.f.divideScalar(out.len);
  arm.pinky.getWorldPosition(_x).sub(arm.index.getWorldPosition(_n));
  out.x.copy(_x).addScaledVector(out.f, -_x.dot(out.f)).normalize();
  // The skeleton is mirrored left/right, so f × x points out of the palm of the right hand and the back of the left.
  out.n.crossVectors(out.f, out.x);
  if (arm.side === 'l') out.n.negate();
  out.c.copy(_h).addScaledVector(out.f, out.len * PALM_ALONG).addScaledVector(out.n, PALM_OUT);
  return out;
}

const _pf = newPalm();

/** Turn the hand at the wrist so the fingers point along `fd` and the palm faces `nd` (both world, unit). */
export function orientHand(arm: Arm, fd: THREE.Vector3, nd: THREE.Vector3, weight = 1): void {
  if (weight <= 0.001) return;
  palmFrame(arm, _pf);
  _q.setFromUnitVectors(_pf.f, fd);
  _n.copy(_pf.n).applyQuaternion(_q).addScaledVector(fd, -_pf.n.dot(fd));
  _nd.copy(nd).addScaledVector(fd, -nd.dot(fd));
  if (_n.lengthSq() > 1e-8 && _nd.lengthSq() > 1e-8) {
    _n.normalize();
    _nd.normalize();
    const ang = Math.atan2(_x.crossVectors(_n, _nd).dot(fd), _n.dot(_nd));
    _q2.setFromAxisAngle(fd, ang);
    _q.premultiply(_q2);
  }
  rotateWorld(arm.hand, _q, weight);
}

/**
 * Put the palm (not the wrist) on `target` with the fingers along `fd` and the palm facing `nd`: two-bone IK for
 * the wrist, then the hand turned at the wrist. The wrist bend is capped at `maxBend` radians off the forearm so
 * a hard target folds the hand no further than a real wrist goes.
 */
export function reachPalm(arm: Arm, target: THREE.Vector3, fd: THREE.Vector3, nd: THREE.Vector3, pole: THREE.Vector3, weight = 1, maxBend = 0.9): void {
  if (weight <= 0.001) return;
  palmFrame(arm, _pf);
  _fd.copy(fd).normalize();
  _nd.copy(nd).addScaledVector(_fd, -nd.dot(_fd)).normalize();
  const wrist = _t.copy(target).addScaledVector(_fd, -_pf.len * PALM_ALONG).addScaledVector(_nd, -PALM_OUT).clone();
  reachArm(arm.upper, arm.lower, arm.hand, wrist, pole, weight);
  arm.hand.getWorldPosition(_h);
  _fa.subVectors(_h, arm.lower.getWorldPosition(_m)).normalize();
  const bend = Math.acos(THREE.MathUtils.clamp(_fa.dot(_fd), -1, 1));
  if (bend > maxBend) {
    // Swing the fingers back towards the forearm line, carrying the palm normal with them.
    _q2.setFromUnitVectors(_fd, _fa);
    _q.identity().slerp(_q2, 1 - maxBend / bend);
    _fd.applyQuaternion(_q);
    _nd.applyQuaternion(_q);
  }
  orientHand(arm, _fd, _nd, weight);
}

/** Smoothstep between edges, for easing gesture phases. */
export const ease = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
