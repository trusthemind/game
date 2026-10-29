import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';

export interface HumanParts {
  model: THREE.Object3D;
  body: THREE.SkinnedMesh;
  eyes: THREE.SkinnedMesh | null;
  brows: THREE.SkinnedMesh | null;
  /** Every skinned mesh that belongs to the body (for material swaps). */
  meshes: THREE.SkinnedMesh[];
  /** The pack's original body material (texture source for re-tinting). */
  srcMaterial: THREE.MeshStandardMaterial;
}

/** Clone a modelled human body (own skeleton per instance). Null when the pack isn't available. */
export function cloneHuman(lib: AssetLibrary, sex: 'm' | 'f'): HumanParts | null {
  const src = sex === 'f' ? lib.humanF : lib.humanM;
  if (!src) return null;
  const model = SkeletonUtils.clone(src.scene);
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const byMat = (re: RegExp) => meshes.find((m) => re.test((m.material as THREE.Material).name)) ?? null;
  const body = byMat(/Superhero/) ?? meshes.sort((a, b) => b.geometry.attributes.position!.count - a.geometry.attributes.position!.count)[0]!;
  return { model, body, eyes: byMat(/Eye/), brows: byMat(/Hair/), meshes, srcMaterial: body.material as THREE.MeshStandardMaterial };
}

/** Re-skin a hair/beard mesh onto the body's skeleton (matched by bone name) and mount it next to the body. */
export function attachSkinned(src: THREE.SkinnedMesh, body: THREE.SkinnedMesh, material?: THREE.Material): THREE.SkinnedMesh {
  const m = new THREE.SkinnedMesh(src.geometry, material ?? src.material);
  // GLTFLoader de-duplicates node names across a file (several hairstyles share one skeleton layout), so
  // "Head" may come through as "Head_3": fall back to the name without the numeric suffix.
  const find = (name: string) => body.skeleton.getBoneByName(name) ?? body.skeleton.getBoneByName(name.replace(/_\d+$/, '')) ?? body.skeleton.bones[0]!;
  const bones = src.skeleton.bones.map((b) => find(b.name));
  m.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
  m.frustumCulled = false;
  body.parent!.add(m);
  return m;
}
