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

// Blender's human metarig (names as three.js leaves them: no dots).
Object.assign(MAP, { spine: 'pelvis', spine001: 'spine_01', spine002: 'spine_02', spine003: 'spine_03', spine004: 'neck_01', spine006: 'Head' });
for (const s of ['l', 'r'] as const) {
  const S = s.toUpperCase();
  Object.assign(MAP, {
    [`shoulder${S}`]: `clavicle_${s}`,
    [`upper_arm${S}`]: `upperarm_${s}`,
    [`forearm${S}`]: `lowerarm_${s}`,
    [`hand${S}`]: `hand_${s}`,
    [`thigh${S}`]: `thigh_${s}`,
    [`shin${S}`]: `calf_${s}`,
    [`foot${S}`]: `foot_${s}`,
    [`toe${S}`]: `ball_${s}`,
  });
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

/** Foot to head along the joints, to size a body that wasn't exported standing up. */
const CHAIN = ['foot_l', 'calf_l', 'thigh_l', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'];

const geoCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

const clean = (name: string) =>
  name
    .replace(/^mixamorig[:_]?/, '')
    .replace(/^CC_Base_/, '')
    // HumanIK (Character3_Hips …) and Blender's metarig (spine003_Metarig: three.js drops the dots).
    .replace(/^Character\d+_/, '')
    .replace(/_Metarig$/, '')
    .replace(/_\d+$/, '');

export interface Rebound {
  meshes: THREE.SkinnedMesh[];
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
  let k = (modelPos(ours.get('Head')!).y - footT) / ((sp('Head')?.y ?? 1) - footS);
  // A body exported mid-action (crouched, a foot raised) is shorter head-over-feet than it really is, and would
  // come out a giant: size it by the length of its joint chain from foot to head instead.
  const chain = CHAIN.filter((n) => srcBind.has(n));
  const along = (at: (n: string) => THREE.Vector3) => chain.slice(1).reduce((sum, n, i) => sum + at(n).distanceTo(at(chain[i]!)), 0);
  const chainS = along((n) => sp(n)!);
  const chainT = along((n) => modelPos(ours.get(n)!));
  if (((sp('Head')?.y ?? 1) - footS) / chainS < (0.92 * (modelPos(ours.get('Head')!).y - footT)) / chainT) k = chainT / chainS;
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

  const out: THREE.SkinnedMesh[] = [];
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
    // The source material's name says what a piece is (helmet, plate, pouch…): see SF_KIT in character.ts.
    mesh.userData.part = (Array.isArray(sm.material) ? sm.material[0]! : sm.material).name;
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

/**
 * Put clothes from a rigged model onto OUR body as it is (the opposite of rebindToSkeleton, which reshapes the
 * skeleton to the model): each source joint is carried onto the matching bone of our rest pose (moved, swung to
 * point the same way, stretched along the bone to its length), and every vertex follows its joints by its skin
 * weights. Pieces from different models then all fit the same body and skeleton, so a jacket from one and
 * trousers from another can be worn together, over our own head and hands.
 *
 * `keep` picks the pieces (by "<glTF mesh name> <material name>"); the rest of the model is left out.
 */
export function fitToRest(
  src: THREE.Object3D,
  meshNames: Map<THREE.Object3D, string>,
  pose: THREE.AnimationClip | undefined,
  model: THREE.Object3D,
  bones: THREE.Bone[],
  materialFor: (m: THREE.Material) => THREE.Material,
  keep: (meshName: string) => boolean,
  cacheKey: string,
): THREE.SkinnedMesh[] {
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
  const modelPos = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld));
  const skinned: THREE.SkinnedMesh[] = [];
  src.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const mat = (Array.isArray(sm.material) ? sm.material[0]! : sm.material).name;
    if (keep(`${meshNames.get(o) ?? o.name} ${mat}`)) skinned.push(sm);
  });
  if (!skinned.length) return [];
  // Joints of the whole model (not just the kept pieces), as drawn in this pose.
  const srcBind = new Map<string, THREE.Matrix4>();
  src.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    sm.skeleton.update();
    for (const b of sm.skeleton.bones) {
      const name = MAP[clean(b.name)];
      if (name && !srcBind.has(name)) srcBind.set(name, b.matrixWorld.clone());
    }
  });
  const sp = (name: string) => (srcBind.get(name) ? new THREE.Vector3().setFromMatrixPosition(srcBind.get(name)!) : null);
  // Same similarity transform as rebindToSkeleton: our height, pelvis over pelvis, facing our way.
  const footS = Math.min(sp('foot_l')?.y ?? 0, sp('foot_r')?.y ?? 0);
  const footT = Math.min(modelPos(ours.get('foot_l')!).y, modelPos(ours.get('foot_r')!).y);
  let k = (modelPos(ours.get('Head')!).y - footT) / ((sp('Head')?.y ?? 1) - footS);
  const chain = CHAIN.filter((n) => srcBind.has(n));
  const along = (at: (n: string) => THREE.Vector3) => chain.slice(1).reduce((sum, n, i) => sum + at(n).distanceTo(at(chain[i]!)), 0);
  const chainS = along((n) => sp(n)!);
  const chainT = along((n) => modelPos(ours.get(n)!));
  if (((sp('Head')?.y ?? 1) - footS) / chainS < (0.92 * (modelPos(ours.get('Head')!).y - footT)) / chainT) k = chainT / chainS;
  const pelS = sp('pelvis')!;
  const pelT = modelPos(ours.get('pelvis')!);
  const flip = Math.sign(sp('upperarm_l')!.x - pelS.x) !== Math.sign(modelPos(ours.get('upperarm_l')!).x - pelT.x);
  const T = new THREE.Matrix4()
    .makeTranslation(pelT.x, footT, pelT.z)
    .multiply(new THREE.Matrix4().makeRotationY(flip ? Math.PI : 0))
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-pelS.x, -footS, -pelS.z));
  const want = (name: string) => sp(name)?.applyMatrix4(T) ?? null;

  // Per bone: source joint frame (after T) → our rest frame. Unmapped bones keep the nearest mapped one's.
  const carry = bones.map((b) => {
    const from = want(b.name);
    if (!from) return null;
    const to = modelPos(b);
    const child = AIM[b.name];
    const fc = child ? want(child) : null;
    const tc = child && ours.get(child) ? modelPos(ours.get(child)!) : null;
    const m = new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z);
    if (fc && tc) {
      const ds = fc.clone().sub(from);
      const dt = tc.clone().sub(to);
      if (ds.lengthSq() > 1e-10 && dt.lengthSq() > 1e-10) {
        const q = new THREE.Quaternion().setFromUnitVectors(ds.clone().normalize(), dt.clone().normalize());
        m.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
        // Stretch along the bone only: a longer or shorter limb, the same girth.
        const s = dt.length() / ds.length();
        const a = dt.normalize();
        const S = new THREE.Matrix4().set(
          1 + (s - 1) * a.x * a.x, (s - 1) * a.x * a.y, (s - 1) * a.x * a.z, 0,
          (s - 1) * a.y * a.x, 1 + (s - 1) * a.y * a.y, (s - 1) * a.y * a.z, 0,
          (s - 1) * a.z * a.x, (s - 1) * a.z * a.y, 1 + (s - 1) * a.z * a.z, 0,
          0, 0, 0, 1,
        );
        m.premultiply(S);
      }
    }
    return m.premultiply(new THREE.Matrix4().makeTranslation(to.x, to.y, to.z));
  });
  // The head is carried by its shape, not its joint: heads differ (a longer skull, eyes higher or lower above the
  // neck), so what's on it (a balaclava, a cap) goes from the source head's box onto ours, its eye holes over our
  // eyes. The jaw and neck below stay with the neck's carry.
  const hi = bones.findIndex((b) => b.name === 'Head');
  const srcHead = hi >= 0 ? sourceHeadBox(src, skinned, T) : null;
  const ourHead = hi >= 0 ? ourHeadBox(model, bones, hi, toModel) : null;
  if (srcHead && ourHead) {
    const cs = srcHead.getCenter(new THREE.Vector3());
    const ss = srcHead.getSize(new THREE.Vector3());
    const co = ourHead.getCenter(new THREE.Vector3());
    const so = ourHead.getSize(new THREE.Vector3());
    // One scale (the head keeps its shape), by the axis that needs most and a little loose: what hugged their head
    // would sink into ours where the shapes differ.
    // Only when what was found looks like a whole head (some models split it, or have none to find): otherwise
    // the joint's carry stands.
    const q = [so.x / ss.x, so.y / ss.y, so.z / ss.z];
    const r = Math.max(...q) * 1.16;
    if (Math.min(...q) > 0.6 && Math.max(...q) < 1.6 && Math.max(...q) / Math.min(...q) < 1.35)
      carry[hi] = new THREE.Matrix4()
      .makeTranslation(co.x, co.y, co.z)
      .multiply(new THREE.Matrix4().makeScale(r, r, r))
      .multiply(new THREE.Matrix4().makeTranslation(-cs.x, -cs.y, -cs.z));
  }
  const parentOf = new Map(bones.map((b) => [b, b.parent as THREE.Object3D | null]));
  const carryOf = (i: number): THREE.Matrix4 => {
    let b: THREE.Object3D | null = bones[i]!;
    while (b) {
      const j = bones.indexOf(b as THREE.Bone);
      if (j >= 0 && carry[j]) return carry[j]!;
      b = parentOf.get(b as THREE.Bone) ?? null;
    }
    return new THREE.Matrix4();
  };
  const inverses = bones.map((b) => new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld).invert());

  const out: THREE.SkinnedMesh[] = [];
  let under: BodySkin | null | undefined;
  for (const sm of skinned) {
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
    const key = `fit|${cacheKey}`;
    let g = perMesh.get(key);
    if (!g) {
      g = sm.geometry.clone();
      const si = g.attributes.skinIndex!;
      const sw = g.attributes.skinWeight!;
      const pos = g.attributes.position!;
      const nor = g.attributes.normal;
      const bm = sm.skeleton.boneMatrices!;
      const pre = new THREE.Matrix4().multiplyMatrices(T, sm.matrixWorld).multiply(sm.bindMatrixInverse);
      // Source skinning (as drawn, then T), followed by the carry of the joint each weight maps to.
      const C = sm.skeleton.bones.map((_, i) =>
        carryOf(lut[i]!).clone().multiply(new THREE.Matrix4().fromArray(bm, i * 16).premultiply(pre).multiply(sm.bindMatrix)),
      );
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
          for (let kk = 0; kk < 16; kk++) acc.elements[kk]! += e[kk]! * w;
        }
        if (wsum > 0 && Math.abs(wsum - 1) > 1e-3) for (let kk = 0; kk < 16; kk++) acc.elements[kk]! /= wsum;
        v.fromBufferAttribute(pos, i).applyMatrix4(acc).toArray(P, i * 3);
        if (N && nor) v.fromBufferAttribute(nor, i).applyMatrix3(nm.getNormalMatrix(acc)).normalize().toArray(N, i * 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      const remapped = new Uint16Array(si.count * 4);
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) remapped[i * 4 + c] = lut[si.getComponent(i, c)]!;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(remapped, 4));
      // The upper body follows the body underneath: the source's weights were painted for its own pose (arms often
      // well down) and its own body, and by them the shoulders pinch when our arms come down from rest and our
      // upper back pokes through when it bends. There a piece takes our body's own weights instead.
      under ??= bodySkin(model, bones, toModel);
      if (under) shoulderWeights(g, under, bones);
      const neckB = ours.get('neck_01');
      if (under && neckB && ours.get('Head')) closeNeck(g, under, bones, modelPos(neckB), modelPos(ours.get('Head')!).y);
      // The clone kept the source's bounds (its own units): measure the fitted garment.
      g.computeBoundingBox();
      g.computeBoundingSphere();
      perMesh.set(key, g);
    }
    const mats = Array.isArray(sm.material) ? sm.material.map(materialFor) : materialFor(sm.material);
    const mesh = new THREE.SkinnedMesh(g, mats);
    mesh.name = meshNames.get(sm) ?? sm.name;
    mesh.frustumCulled = false;
    model.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    out.push(mesh);
  }
  return out;
}

interface BodySkin {
  pos: Float32Array;
  nor: Float32Array;
  idx: Uint16Array;
  w: Float32Array;
}

/** Our body's vertices at rest (model space) with their skin weights, by index into `bones`. */
function bodySkin(model: THREE.Object3D, bones: THREE.Bone[], toModel: THREE.Matrix4): BodySkin | null {
  let body: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || sm.userData.worn || !sm.skeleton.bones.includes(bones[0]!)) return;
    if (!body || sm.geometry.attributes.position!.count > body.geometry.attributes.position!.count) body = sm;
  });
  const b = body as THREE.SkinnedMesh | null;
  const si = b?.geometry.attributes.skinIndex;
  const sw = b?.geometry.attributes.skinWeight;
  if (!b || !si || !sw) return null;
  const n = b.geometry.attributes.position!.count;
  const at = b.skeleton.bones.map((x) => bones.indexOf(x));
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const bn = b.geometry.attributes.normal;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  const M = new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld);
  const NM = new THREE.Matrix3().getNormalMatrix(M);
  for (let i = 0; i < n; i++) {
    b.getVertexPosition(i, v).applyMatrix4(M).toArray(pos, i * 3);
    if (bn) v.fromBufferAttribute(bn, i).applyMatrix3(NM).normalize().toArray(nor, i * 3);
    for (let c = 0; c < 4; c++) {
      idx[i * 4 + c] = Math.max(0, at[si.getComponent(i, c)] ?? 0);
      w[i * 4 + c] = sw.getComponent(i, c);
    }
  }
  return { pos, nor, idx, w };
}

/**
 * A fitted piece's vertices on the chest, upper back and shoulders (weighted to the upper spine, neck, clavicles or
 * upper arms) take the weights of the nearest few body vertices, as much as the source weighted them there, so they
 * bend with the body under them and it can't poke through when the back bends or the arms come down. Where the
 * body already pokes through at rest (the top of the back between a collar and the back panel) they're pushed out.
 */
function shoulderWeights(g: THREE.BufferGeometry, under: BodySkin, bones: THREE.Bone[]): void {
  const region = new Set(['spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'].map((n) => bones.findIndex((b) => b.name === n)));
  const head = bones.findIndex((b) => b.name === 'Head');
  const si = g.attributes.skinIndex!;
  const sw = g.attributes.skinWeight!;
  const pos = g.attributes.position!;
  // Headwear (a balaclava's neck) stays as it was fitted: it goes with the head.
  let onHeadN = 0;
  for (let i = 0; i < si.count; i++) if ([0, 1, 2, 3].some((c) => si.getComponent(i, c) === head && sw.getComponent(i, c) > 0.2)) onHeadN++;
  if (onHeadN > 0.25 * si.count) return;
  const NI = new Uint16Array(si.count * 4);
  const NW = new Float32Array(si.count * 4);
  const K = 6;
  const GAP = 0.003;
  const kd = new Float64Array(K);
  const ki = new Int32Array(K);
  const nb = under.pos.length / 3;
  for (let i = 0; i < pos.count; i++) {
    let on = 0;
    let tot = 0;
    let onHead = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      tot += w;
      if (region.has(si.getComponent(i, c))) on += w;
      if (si.getComponent(i, c) === head) onHead += w;
    }
    const f = tot > 0 && !onHead ? Math.min(1, (2.5 * on) / tot) : 0;
    const acc = new Map<number, number>();
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (w) acc.set(si.getComponent(i, c), (acc.get(si.getComponent(i, c)) ?? 0) + (w / (tot || 1)) * (1 - f));
    }
    if (f > 0) {
      kd.fill(Infinity);
      ki.fill(-1);
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      for (let j = 0; j < nb; j++) {
        const dx = under.pos[j * 3]! - x;
        const dy = under.pos[j * 3 + 1]! - y;
        const dz = under.pos[j * 3 + 2]! - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= kd[K - 1]!) continue;
        let k = K - 1;
        while (k > 0 && kd[k - 1]! > d) (kd[k] = kd[k - 1]!), (ki[k] = ki[k - 1]!), k--;
        kd[k] = d;
        ki[k] = j;
      }
      let ws = 0;
      const iw = Array.from(kd, (d) => 1 / (Math.sqrt(d) + 0.01));
      for (let k = 0; k < K; k++) if (ki[k]! >= 0) ws += iw[k]!;
      // How far outside the skin (along its normal, near points weighted): at least a little. Only over the top of
      // the back and shoulders (skin facing back or up): in front, collars and lapels lie in layers over a shirt,
      // and pushing each out by itself would push the one under through the one over it.
      let out = 0;
      for (let k = 0; k < K; k++) {
        const j = ki[k]!;
        if (j < 0) continue;
        out += ((x - under.pos[j * 3]!) * under.nor[j * 3]! + (y - under.pos[j * 3 + 1]!) * under.nor[j * 3 + 1]! + (z - under.pos[j * 3 + 2]!) * under.nor[j * 3 + 2]!) * (iw[k]! / ws);
      }
      const j0 = ki[0]!;
      // Faded in by both (not cut off), or the push leaves a crease across the back where it stops.
      const fade = j0 >= 0 ? THREE.MathUtils.smoothstep(0.1 - under.nor[j0 * 3 + 2]!, 0, 0.2) * THREE.MathUtils.smoothstep(out + 0.06, 0, 0.02) : 0;
      if (fade > 0 && out < GAP) {
        const push = (GAP - out) * f * fade;
        pos.setXYZ(i, x + under.nor[j0 * 3]! * push, y + under.nor[j0 * 3 + 1]! * push, z + under.nor[j0 * 3 + 2]! * push);
      }
      for (let k = 0; k < K; k++) {
        const j = ki[k]!;
        if (j < 0) continue;
        for (let c = 0; c < 4; c++) {
          const w = under.w[j * 4 + c]!;
          if (w) acc.set(under.idx[j * 4 + c]!, (acc.get(under.idx[j * 4 + c]!) ?? 0) + (w * iw[k]! * f) / ws);
        }
      }
    }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = top.reduce((a, t) => a + t[1], 0) || 1;
    top.forEach(([b, w], c) => ((NI[i * 4 + c] = b), (NW[i * 4 + c] = w / s)));
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(NI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(NW, 4));
}

/** The K body vertices nearest a point (squared distances), nearest first. */
function nearestBody(under: BodySkin, x: number, y: number, z: number, kd: Float64Array, ki: Int32Array): void {
  const K = kd.length;
  kd.fill(Infinity);
  ki.fill(-1);
  const nb = under.pos.length / 3;
  for (let j = 0; j < nb; j++) {
    const dx = under.pos[j * 3]! - x;
    const dy = under.pos[j * 3 + 1]! - y;
    const dz = under.pos[j * 3 + 2]! - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d >= kd[K - 1]!) continue;
    let k = K - 1;
    while (k > 0 && kd[k - 1]! > d) (kd[k] = kd[k - 1]!), (ki[k] = ki[k - 1]!), k--;
    kd[k] = d;
    ki[k] = j;
  }
}

/**
 * Close the gap at the back of the neck. A top cut low at the back (a smock, a shirt) leaves our neck and the top of
 * our back bare between its neckline and a balaclava's hem, which ends half way down the neck: the open edge of a
 * top's back neckline is drawn up to the base of our neck, a headwear piece's lower hem down to it (and evened out),
 * each with the cloth around it following smoothly and kept just outside our skin, never further out than it was.
 * A hood's neck is drawn in onto ours.
 */
function closeNeck(g: THREE.BufferGeometry, under: BodySkin, bones: THREE.Bone[], neck: THREE.Vector3, headY: number): void {
  const pos = g.attributes.position!;
  const si = g.attributes.skinIndex!;
  const sw = g.attributes.skinWeight!;
  const n = pos.count;
  const head = bones.findIndex((b) => b.name === 'Head');
  let onHeadN = 0;
  for (let i = 0; i < n; i++) if ([0, 1, 2, 3].some((c) => si.getComponent(i, c) === head && sw.getComponent(i, c) > 0.2)) onHeadN++;
  const headwear = onHeadN > 0.25 * n;
  // Open edges, on positions welded across UV seams.
  const ids = new Map<string, number>();
  const wid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
    const at = ids.get(key);
    if (at === undefined) ids.set(key, i);
    wid[i] = at ?? i;
  }
  const index = g.index;
  const tris = index ? index.count : n;
  const edges = new Map<number, number>();
  for (let t = 0; t + 2 < tris; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = wid[index ? index.getX(t + e) : t + e]!;
      const b = wid[index ? index.getX(t + ((e + 1) % 3)) : t + ((e + 1) % 3)]!;
      if (a === b) continue;
      const key = Math.min(a, b) * n + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const border = new Uint8Array(n);
  for (const [key, c] of edges) if (c === 1) border[Math.floor(key / n)] = border[key % n] = 1;
  // Where the open edge should be: a top's back neckline at the base of the neck, a hood's hem a little below it.
  const UP = (headY - neck.y) * 0.5;
  const DOWN = -0.012;
  const lift: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (wid[i] !== i || !border[i]) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const dx = Math.abs(x - neck.x);
    if (headwear) {
      if (y < headY - 0.01 && y > neck.y + DOWN) lift.push([x, y, z, neck.y + DOWN - y]);
    } else if (z < neck.z && dx < 0.11 && y > neck.y - 0.14 && y < neck.y + UP) {
      const fade = dx < 0.06 ? 1 : 1 - (dx - 0.06) / 0.05;
      lift.push([x, y, z, (neck.y + UP - y) * fade]);
    }
  }
  const R = headwear ? 0.035 : 0.06;
  const K = 6;
  const GAP = 0.003;
  const kd = new Float64Array(K);
  const ki = new Int32Array(K);
  const outAt = (x: number, y: number, z: number, iw: number[]): number => {
    nearestBody(under, x, y, z, kd, ki);
    let ws = 0;
    for (let k = 0; k < K; k++) if (ki[k]! >= 0) ws += (iw[k] = 1 / (Math.sqrt(kd[k]!) + 0.01));
    let out = 0;
    for (let k = 0; k < K; k++) {
      const j = ki[k]!;
      if (j < 0) continue;
      out += ((x - under.pos[j * 3]!) * under.nor[j * 3]! + (y - under.pos[j * 3 + 1]!) * under.nor[j * 3 + 1]! + (z - under.pos[j * 3 + 2]!) * under.nor[j * 3 + 2]!) * (iw[k]! / ws);
    }
    for (let k = 0; k < K; k++) iw[k] = ki[k]! >= 0 ? iw[k]! / ws : 0;
    return out;
  };
  const NI = new Uint16Array(n * 4);
  const NW = new Float32Array(n * 4);
  const iw: number[] = new Array(K).fill(0);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let dy = 0;
    let f = 0;
    for (const [lx, ly, lz, ld] of lift) {
      const d = Math.hypot(x - lx, y - ly, z - lz);
      if (d >= R) continue;
      const s = 1 - d / R;
      const w = s * s * (3 - 2 * s);
      if (Math.abs(ld * w) > Math.abs(dy)) (dy = ld * w), (f = w);
    }
    // A hood's neck hugs ours (it was fitted loose with the head), so a collar closes over it.
    // Up to the base of the skull, so it's inside any collar.
    const hug = headwear ? Math.min(1, Math.max(0, (headY + 0.09 - y) / 0.04)) : 0;
    f = Math.max(f, hug);
    const acc = new Map<number, number>();
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (w) acc.set(si.getComponent(i, c), (acc.get(si.getComponent(i, c)) ?? 0) + w * (1 - f));
    }
    if (Math.abs(dy) > 1e-5 || hug > 0) {
      const before = outAt(x, y, z, iw);
      const ny = y + dy;
      const now = outAt(x, ny, z, iw);
      // Hug the body: out by at least the gap, never further out than before (it rose over the slope of the back).
      const want = THREE.MathUtils.lerp(Math.max(GAP, Math.min(now, Math.max(GAP, before))), 0.004, hug);
      const j0 = ki[0]!;
      const sh = want - now;
      pos.setXYZ(i, x + under.nor[j0 * 3]! * sh, ny + under.nor[j0 * 3 + 1]! * sh, z + under.nor[j0 * 3 + 2]! * sh);
      for (let k = 0; k < K; k++) {
        const j = ki[k]!;
        if (j < 0) continue;
        for (let c = 0; c < 4; c++) {
          const w = under.w[j * 4 + c]!;
          if (w) acc.set(under.idx[j * 4 + c]!, (acc.get(under.idx[j * 4 + c]!) ?? 0) + w * iw[k]! * f);
        }
      }
    }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = top.reduce((a, t) => a + t[1], 0) || 1;
    top.forEach(([b, w], c) => ((NI[i * 4 + c] = b), (NW[i * 4 + c] = w / s)));
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(NI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(NW, 4));
}

/** Not the head's own skin: what's worn on it or stuck in it. */
const NOT_HEAD = /hair|hat|cap|helm|mask|eye|teeth|tongue|brow|lash|beard|glass|goggle|headset|hood/i;

/** Index of the bone that carries most of vertex i. */
function dominant(si: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, sw: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): number {
  let best = 0;
  let bw = -1;
  for (let c = 0; c < 4; c++) {
    const w = sw.getComponent(i, c);
    if (w > bw) (bw = w), (best = si.getComponent(i, c));
  }
  return best;
}

/**
 * The source model's bare head as drawn (after T): the vertices its head joint carries most, on the skinned mesh
 * with the most of them that isn't a kept piece or something worn (hair, a hat, eyes).
 */
function sourceHeadBox(src: THREE.Object3D, kept: THREE.SkinnedMesh[], T: THREE.Matrix4): THREE.Box3 | null {
  let best: THREE.Box3 | null = null;
  let bestN = 0;
  const v = new THREE.Vector3();
  src.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || kept.includes(sm)) return;
    const mat = (Array.isArray(sm.material) ? sm.material[0]! : sm.material).name;
    if (NOT_HEAD.test(`${sm.name} ${mat}`)) return;
    const head = sm.skeleton.bones.map((b) => {
      let x: THREE.Object3D | null = b;
      while (x) {
        const name = MAP[clean(x.name)];
        if (name) return name === 'Head';
        x = x.parent;
      }
      return false;
    });
    const si = sm.geometry.attributes.skinIndex;
    const sw = sm.geometry.attributes.skinWeight;
    const pos = sm.geometry.attributes.position;
    if (!si || !sw || !pos) return;
    const box = new THREE.Box3();
    const M = new THREE.Matrix4().multiplyMatrices(T, sm.matrixWorld);
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (!head[dominant(si, sw, i)]) continue;
      box.expandByPoint(sm.getVertexPosition(i, v).applyMatrix4(M));
      n++;
    }
    if (n > bestN) (bestN = n), (best = box);
  });
  return bestN > 50 ? best : null;
}

/** Our body's head in the model's space: the body mesh's vertices the head bone carries most. */
function ourHeadBox(model: THREE.Object3D, bones: THREE.Bone[], hi: number, toModel: THREE.Matrix4): THREE.Box3 | null {
  let body: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || sm.userData.worn || sm.skeleton.bones[hi] !== bones[hi]) return;
    if (!body || sm.geometry.attributes.position!.count > body.geometry.attributes.position!.count) body = sm;
  });
  const b = body as THREE.SkinnedMesh | null;
  if (!b) return null;
  const si = b.geometry.attributes.skinIndex;
  const sw = b.geometry.attributes.skinWeight;
  const pos = b.geometry.attributes.position!;
  if (!si || !sw) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const M = new THREE.Matrix4().multiplyMatrices(toModel, b.matrixWorld);
  for (let i = 0; i < pos.count; i++) if (dominant(si, sw, i) === hi) box.expandByPoint(b.getVertexPosition(i, v).applyMatrix4(M));
  return box.isEmpty() ? null : box;
}

/** glTF mesh names of a loaded model's nodes (three.js names nodes after the node, which is often Object_N). */
export function gltfMeshNames(gltf: { scene: THREE.Object3D; parser: { associations: Map<unknown, { meshes?: number }>; json: { meshes?: { name?: string }[] } } }): Map<THREE.Object3D, string> {
  const out = new Map<THREE.Object3D, string>();
  gltf.scene.traverse((o) => {
    const i = gltf.parser.associations.get(o)?.meshes;
    if (i !== undefined) out.set(o, String(gltf.parser.json.meshes?.[i]?.name ?? o.name));
  });
  return out;
}
