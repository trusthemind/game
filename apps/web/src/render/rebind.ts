import * as THREE from 'three';

/**
 * Put a character mesh rigged for another skeleton (Mixamo and look-alikes) onto our own body skeleton
 * (the Quaternius/UE-style one every animation, attachment and gear fit is authored for).
 *
 * Instead of retargeting every animation onto a foreign skeleton, we do it once, the other way round:
 *  1. scale and centre the source mesh to our body's height;
 *  2. pose our skeleton like the source's bind pose: each mapped joint is moved to the source joint's place
 *     (this becomes the bone's rest offset, so proportions follow the new body) and swung so it points at
 *     its child the way the source bone does;
 *  3. bind the source geometry to our bones in that pose, remapping vertex weights by joint name
 *     (unmapped source joints — pouches, pads, twist and leaf bones — fall back to their nearest mapped parent);
 *  4. put our bones back to their rest rotations. Animations then drive the new mesh as they do our own.
 */

/** Source joint (prefix and numeric suffix stripped) → our bone. */
const MAP: Record<string, string> = {
  Hips: 'pelvis',
  Spine: 'spine_01',
  Spine1: 'spine_02',
  Spine2: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',
};
for (const [side, s] of [
  ['Left', 'l'],
  ['Right', 'r'],
] as const) {
  Object.assign(MAP, {
    [`${side}Shoulder`]: `clavicle_${s}`,
    [`${side}Arm`]: `upperarm_${s}`,
    [`${side}ForeArm`]: `lowerarm_${s}`,
    [`${side}Hand`]: `hand_${s}`,
    [`${side}UpLeg`]: `thigh_${s}`,
    [`${side}Leg`]: `calf_${s}`,
    [`${side}Foot`]: `foot_${s}`,
    [`${side}ToeBase`]: `ball_${s}`,
  });
  for (const [f, ours] of [
    ['Thumb', 'thumb'],
    ['Index', 'index'],
    ['Middle', 'middle'],
    ['Ring', 'ring'],
    ['Pinky', 'pinky'],
  ] as const)
    for (let k = 1; k <= 3; k++) MAP[`${side}Hand${f}${k}`] = `${ours}_0${k}_${s}`;
}
// Reallusion Character Creator rigs (CC_Base_*, prefix stripped by `clean`).
Object.assign(MAP, { Hip: 'pelvis', Waist: 'spine_01', Spine01: 'spine_02', Spine02: 'spine_03', NeckTwist01: 'neck_01' });
for (const s of ['l', 'r'] as const) {
  const S = s.toUpperCase();
  Object.assign(MAP, {
    [`${S}_Clavicle`]: `clavicle_${s}`,
    [`${S}_Upperarm`]: `upperarm_${s}`,
    [`${S}_Forearm`]: `lowerarm_${s}`,
    [`${S}_Hand`]: `hand_${s}`,
    [`${S}_Thigh`]: `thigh_${s}`,
    [`${S}_Calf`]: `calf_${s}`,
    [`${S}_Foot`]: `foot_${s}`,
    [`${S}_ToeBase`]: `ball_${s}`,
  });
  for (const [f, ours] of [
    ['Thumb', 'thumb'],
    ['Index', 'index'],
    ['Mid', 'middle'],
    ['Ring', 'ring'],
    ['Pinky', 'pinky'],
  ] as const)
    for (let k = 1; k <= 3; k++) MAP[`${S}_${f}${k}`] = `${ours}_0${k}_${s}`;
}
// A hand-made Maya-style rig (hip / spine / chest, L_arm / L_elbow / L_wrist, L_point1 …).
Object.assign(MAP, { hip: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head' });
for (const s of ['l', 'r'] as const) {
  const S = s.toUpperCase();
  Object.assign(MAP, {
    [`${S}_shoulder`]: `clavicle_${s}`,
    [`${S}_arm`]: `upperarm_${s}`,
    [`${S}_elbow`]: `lowerarm_${s}`,
    [`${S}_wrist`]: `hand_${s}`,
    [`${S}_leg`]: `thigh_${s}`,
    [`${S}_knee`]: `calf_${s}`,
    [`${S}_ankle`]: `foot_${s}`,
    [`${S}_foot`]: `ball_${s}`,
  });
  for (const [f, ours] of [
    ['thumb', 'thumb'],
    ['point', 'index'],
    ['middle', 'middle'],
    ['ring', 'ring'],
    ['pink', 'pinky'],
  ] as const)
    for (let k = 1; k <= 3; k++) MAP[`${S}_${f}${k}`] = `${ours}_0${k}_${s}`;
}

/** Child each of our bones should point at when the pose is matched (direction only). */
const AIM: Record<string, string> = {
  pelvis: 'spine_01',
  spine_01: 'spine_02',
  spine_02: 'spine_03',
  spine_03: 'neck_01',
  neck_01: 'Head',
};
for (const s of ['l', 'r']) {
  Object.assign(AIM, {
    [`clavicle_${s}`]: `upperarm_${s}`,
    [`upperarm_${s}`]: `lowerarm_${s}`,
    [`lowerarm_${s}`]: `hand_${s}`,
    [`hand_${s}`]: `middle_01_${s}`,
    [`thigh_${s}`]: `calf_${s}`,
    [`calf_${s}`]: `foot_${s}`,
    [`foot_${s}`]: `ball_${s}`,
  });
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    AIM[`${f}_01_${s}`] = `${f}_02_${s}`;
    AIM[`${f}_02_${s}`] = `${f}_03_${s}`;
  }
}

const geoCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

const clean = (name: string) =>
  name
    .replace(/^mixamorig[:_]?/, '')
    .replace(/^CC_Base_/, '')
    .replace(/_\d+$/, '');

export interface Rebound {
  meshes: THREE.Object3D[];
}

/**
 * Bind every mesh of `src` (a loaded glTF scene) to `bones` (our skeleton, in its rest pose, children of
 * `model`). Returns the new meshes, already parented under `model` or under one of our bones.
 * `materialFor` lets the caller swap each material (fog-of-war patch, tint).
 */
export function rebindToSkeleton(
  src: THREE.Object3D,
  /** The model's own first clip, if any: some exports only look right posed by it (their bind pose is off). */
  pose: THREE.AnimationClip | undefined,
  model: THREE.Object3D,
  bones: THREE.Bone[],
  materialFor: (m: THREE.Material) => THREE.Material,
  /** Same key → same source and target proportions: the transformed geometry is shared between characters. */
  cacheKey: string,
): Rebound {
  if (pose) {
    const mx = new THREE.AnimationMixer(src);
    mx.clipAction(pose).play();
    mx.update(0);
    mx.stopAllAction();
  }
  src.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const ours = new Map(bones.map((b) => [b.name, b]));
  const restQ = new Map(bones.map((b) => [b, b.quaternion.clone()]));
  const modelPos = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld));

  // Source joints in their bind pose (world = glTF scene frame), by our bone name.
  const skinned: THREE.SkinnedMesh[] = [];
  src.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) return { meshes: [] };
  const srcBind = new Map<string, THREE.Matrix4>();
  // Work from the source exactly as three.js draws it in that pose: joints at their world matrices, vertices
  // skinned by the same matrices the shader uses (no trust in each file's bind pose or inverse bind matrices).
  for (const sm of skinned) {
    sm.skeleton.update();
    sm.skeleton.bones.forEach((b) => {
      const ours = MAP[clean(b.name)];
      if (ours && !srcBind.has(ours)) srcBind.set(ours, b.matrixWorld.clone());
    });
  }
  const sp = (name: string) => (srcBind.get(name) ? new THREE.Vector3().setFromMatrixPosition(srcBind.get(name)!) : null);

  // Similarity transform source → our model space: same height (head joint over the feet), pelvis over pelvis,
  // facing the same way (a Mixamo body may face −Z relative to ours).
  const footS = Math.min(sp('foot_l')?.y ?? 0, sp('foot_r')?.y ?? 0);
  const footT = Math.min(modelPos(ours.get('foot_l')!).y, modelPos(ours.get('foot_r')!).y);
  const k = (modelPos(ours.get('Head')!).y - footT) / ((sp('Head')?.y ?? 1) - footS);
  const pelS = sp('pelvis')!;
  const pelT = modelPos(ours.get('pelvis')!);
  const sideS = sp('upperarm_l')!.x - pelS.x;
  const sideT = modelPos(ours.get('upperarm_l')!).x - pelT.x;
  const flip = Math.sign(sideS) !== Math.sign(sideT);
  const T = new THREE.Matrix4()
    .makeTranslation(pelT.x, footT, pelT.z)
    .multiply(new THREE.Matrix4().makeRotationY(flip ? Math.PI : 0))
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-pelS.x, -footS, -pelS.z));
  const want = (name: string) => sp(name)?.applyMatrix4(T) ?? null;

  // Match the pose, parents before children (bones are listed in hierarchy order).
  const q = new THREE.Quaternion();
  const parentInv = new THREE.Matrix4();
  for (const b of bones) {
    const target = want(b.name);
    if (!target) continue;
    // Move the joint: new rest offset in the parent's frame.
    b.parent!.updateMatrixWorld(true);
    parentInv.multiplyMatrices(toModel, b.parent!.matrixWorld).invert();
    b.position.copy(target.clone().applyMatrix4(parentInv));
    b.updateMatrixWorld(true);
    // Swing it so it points at its child like the source bone does.
    const child = AIM[b.name];
    const to = child && want(child);
    const cb = child && ours.get(child);
    if (!to || !cb) continue;
    const from = modelPos(cb).sub(target);
    const dir = to.clone().sub(target);
    if (from.lengthSq() < 1e-10 || dir.lengthSq() < 1e-10) continue;
    q.setFromUnitVectors(from.normalize(), dir.normalize());
    // World-space swing → local: q_local' = q_parent^-1 * q * q_parent * q_local.
    const pq = new THREE.Quaternion();
    new THREE.Matrix4().multiplyMatrices(toModel, b.parent!.matrixWorld).decompose(new THREE.Vector3(), pq, new THREE.Vector3());
    b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
    b.updateMatrixWorld(true);
  }
  model.updateMatrixWorld(true);
  const inverses = bones.map((b) => new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld).invert());

  const out: THREE.Object3D[] = [];
  for (const sm of skinned) {
    // Source joint index → our bone index, falling back to the nearest mapped ancestor.
    const lut = sm.skeleton.bones.map((b) => {
      let o: THREE.Object3D | null = b;
      while (o) {
        const name = MAP[clean(o.name)];
        const idx = name ? bones.findIndex((x) => x.name === name) : -1;
        if (idx >= 0) return idx;
        o = o.parent;
      }
      return bones.findIndex((x) => x.name === 'pelvis');
    });
    let perMesh = geoCache.get(sm.geometry);
    if (!perMesh) geoCache.set(sm.geometry, (perMesh = new Map()));
    let g = perMesh.get(cacheKey);
    if (!g) {
      g = sm.geometry.clone();
      // Vertices as drawn (skinned, to world), then T; joints remapped to our bone indices.
      const si = g.attributes.skinIndex!;
      const sw = g.attributes.skinWeight!;
      const pos = g.attributes.position!;
      const nor = g.attributes.normal;
      const bm = sm.skeleton.boneMatrices!;
      const pre = new THREE.Matrix4().multiplyMatrices(T, sm.matrixWorld).multiply(sm.bindMatrixInverse);
      const C = sm.skeleton.bones.map((_, i) => new THREE.Matrix4().fromArray(bm, i * 16).premultiply(pre).multiply(sm.bindMatrix));
      const P = new Float32Array(pos.count * 3);
      const N = nor ? new Float32Array(pos.count * 3) : null;
      const acc = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const nm = new THREE.Matrix3();
      for (let i = 0; i < pos.count; i++) {
        acc.elements.fill(0);
        let wsum = 0;
        for (let c = 0; c < 4; c++) {
          const w = sw.getComponent(i, c);
          if (!w) continue;
          wsum += w;
          const e = C[si.getComponent(i, c)]!.elements;
          for (let k = 0; k < 16; k++) acc.elements[k]! += e[k]! * w;
        }
        if (wsum > 0 && Math.abs(wsum - 1) > 1e-3) for (let k = 0; k < 16; k++) acc.elements[k]! /= wsum;
        v.fromBufferAttribute(pos, i).applyMatrix4(acc);
        P[i * 3] = v.x;
        P[i * 3 + 1] = v.y;
        P[i * 3 + 2] = v.z;
        if (N && nor) {
          v.fromBufferAttribute(nor, i).applyMatrix3(nm.getNormalMatrix(acc)).normalize();
          N[i * 3] = v.x;
          N[i * 3 + 1] = v.y;
          N[i * 3 + 2] = v.z;
        }
      }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      const remapped = new Uint16Array(si.count * 4);
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) remapped[i * 4 + c] = lut[si.getComponent(i, c)]!;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(remapped, 4));
      g.computeBoundingSphere();
      perMesh.set(cacheKey, g);
    }
    const mats = Array.isArray(sm.material) ? sm.material.map(materialFor) : materialFor(sm.material);
    const mesh = new THREE.SkinnedMesh(g, mats);
    mesh.name = sm.name;
    mesh.frustumCulled = false;
    model.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    out.push(mesh);
  }

  // Rigid (unskinned) meshes hanging off joints — usually eyeballs — are left out: their node scales don't
  // agree with the skin's bind pose on these exports, and our characters never get close enough to need them.

  for (const [b, rq] of restQ) b.quaternion.copy(rq);
  model.updateMatrixWorld(true);
  return { meshes: out };
}
