import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';
import { takeIdentityMorphs } from './faceIdentity';

export interface HumanParts {
  model: THREE.Object3D;
  body: THREE.SkinnedMesh;
  eyes: THREE.SkinnedMesh | null;
  brows: THREE.SkinnedMesh | null;
  /** Eyelash cards (MPFB bodies; the old ones have none). */
  lashes: THREE.SkinnedMesh | null;
  /** The `underwear` group (MPFB bodies): shown by default (nevernude), each piece hidden under what covers it
   * (userData.covers: 'top' a bra, 'pants' briefs / trunks). */
  underwear: THREE.SkinnedMesh[];
  /** The `anatomy` group (MPFB bodies): hidden by default; drawn in the body's skin when shown. */
  anatomy: THREE.SkinnedMesh[];
  /** Every skinned mesh that belongs to the body (for material swaps). */
  meshes: THREE.SkinnedMesh[];
  /** The pack's original body material (texture source for re-tinting). */
  srcMaterial: THREE.MeshStandardMaterial;
}

/**
 * The bodies' pelvis rest position (root space) the clips were keyed for: the old (Universal Base Characters)
 * bodies, per sex. A body whose pelvis rests elsewhere (MPFB: lower hips on the female) plays them retargeted
 * (pelvisRetarget).
 */
const CLIP_PELVIS = { m: new THREE.Vector3(0, 0.043, 0.9491), f: new THREE.Vector3(0, 0.0457, 0.9318) };

/**
 * How a clip's pelvis.position track maps onto this body: [offset x, offset y, height scale] (root space, Z up):
 * horizontal offsets kept relative to the rest pose, the height scaled with the leg length. Null when it's the
 * clips' own body.
 */
export function pelvisRetarget(body: THREE.SkinnedMesh, sex: 'm' | 'f'): [number, number, number] | null {
  const p = body.skeleton.getBoneByName('pelvis');
  if (!p) return null;
  const c = CLIP_PELVIS[sex];
  const r: [number, number, number] = [p.position.x - c.x, p.position.y - c.y, p.position.z / c.z];
  return Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2] - 1) < 0.002 ? null : r;
}

/** Clone a modelled human body (own skeleton per instance). Null when the pack isn't available. */
export function cloneHuman(lib: AssetLibrary, sex: 'm' | 'f'): HumanParts | null {
  const src = sex === 'f' ? lib.humanF : lib.humanM;
  if (!src) return null;
  // Face identities are baked on the CPU (faceIdentity.ts): their morph targets off the source, once.
  takeIdentityMorphs(src.scene);
  const model = SkeletonUtils.clone(src.scene);
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  // Material names: the old bodies' MI_Superhero_* / MI_Eyes / MI_Hair_* (brows); MPFB's skin / eyes_wet / brows /
  // lashes / underwear_fabric, with the mesh groups as node names (body, eyes, brows, underwear, anatomy).
  const matName = (m: THREE.SkinnedMesh) => (m.material as THREE.Material).name;
  // A node's name is on its mesh, or on the Group a multi-primitive mesh comes in as.
  const inGroup = (name: string) => meshes.filter((m) => m.name === name || m.parent?.name === name);
  const underwear = inGroup('underwear').flatMap(splitUnderwear);
  const anatomy = inGroup('anatomy');
  const rest = meshes.filter((m) => !underwear.includes(m) && !anatomy.includes(m));
  const byMat = (re: RegExp) => rest.find((m) => re.test(matName(m))) ?? null;
  const body =
    rest.find((m) => m.name === 'body') ??
    byMat(/Superhero/) ??
    [...rest].sort((a, b) => b.geometry.attributes.position!.count - a.geometry.attributes.position!.count)[0]!;
  for (const m of anatomy) m.visible = false;
  meshes.length = 0;
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  for (const m of underwear) m.visible = true;
  return {
    model,
    body,
    eyes: byMat(/eye/i),
    // (Blender's "brows.001" on a body built second: missed, her brows kept the source's dark blended card.)
    brows: byMat(/Hair|^brows(\.\d+)?$/),
    lashes: byMat(/lashes/),
    underwear,
    anatomy,
    meshes,
    srcMaterial: body.material as THREE.MeshStandardMaterial,
  };
}

const SPLIT = new WeakMap<THREE.BufferGeometry, [THREE.BufferGeometry | null, THREE.BufferGeometry | null]>();
/**
 * The underwear as its upper piece (a bra: over the waist) and its lower one (briefs, trunks), so each can go
 * under its own garment: a woman in a top and no trousers still shows her briefs. Triangles are split at the
 * height between the spine's first two joints (bind space).
 */
function splitUnderwear(mesh: THREE.SkinnedMesh): THREE.SkinnedMesh[] {
  const geo = mesh.geometry;
  let hit = SPLIT.get(geo);
  if (!hit) {
    const bones = mesh.skeleton.bones;
    const at = (n: string) => {
      const i = bones.findIndex((b) => b.name === n);
      return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i]!.clone().invert());
    };
    const s1 = at('spine_01');
    const s2 = at('spine_02');
    const pos = geo.attributes.position!;
    const idx = geo.index;
    const parts: number[][] = [[], []];
    if (s1 && s2 && idx) {
      const cut = (s1.y + s2.y) / 2;
      for (let t = 0; t < idx.count; t += 3) {
        const y = (pos.getY(idx.getX(t)) + pos.getY(idx.getX(t + 1)) + pos.getY(idx.getX(t + 2))) / 3;
        parts[y > cut ? 0 : 1]!.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
      }
    } else for (let t = 0; t < (idx ? idx.count : pos.count); t++) parts[1]!.push(idx ? idx.getX(t) : t);
    const sub = (ix: number[]) => {
      if (!ix.length) return null;
      const g = geo.clone();
      g.setIndex(ix);
      return g;
    };
    SPLIT.set(geo, (hit = [sub(parts[0]!), sub(parts[1]!)]));
  }
  const out: THREE.SkinnedMesh[] = [];
  hit.forEach((g, i) => {
    if (!g) return;
    const m = i === 1 && !hit![0] ? mesh : new THREE.SkinnedMesh(g, mesh.material);
    if (m !== mesh) {
      m.name = `${mesh.name}_${i ? 'pants' : 'top'}`;
      m.bind(mesh.skeleton, mesh.bindMatrix);
      mesh.parent!.add(m);
    }
    m.userData.covers = i ? 'pants' : 'top';
    out.push(m);
  });
  if (!out.includes(mesh)) mesh.removeFromParent();
  return out;
}

/** Re-skin a hair/beard mesh onto the body's skeleton (matched by bone name) and mount it next to the body. */
export function attachSkinned(src: THREE.SkinnedMesh, body: THREE.SkinnedMesh, material?: THREE.Material): THREE.SkinnedMesh {
  const m = new THREE.SkinnedMesh(src.geometry, material ?? src.material);
  m.name = src.name;
  // GLTFLoader de-duplicates node names across a file (several hairstyles share one skeleton layout), so
  // "Head" may come through as "Head_3": fall back to the name without the numeric suffix.
  const find = (name: string) => body.skeleton.getBoneByName(name) ?? body.skeleton.getBoneByName(name.replace(/_\d+$/, '')) ?? body.skeleton.bones[0]!;
  const bones = src.skeleton.bones.map((b) => find(b.name));
  m.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
  m.frustumCulled = false;
  body.parent!.add(m);
  return m;
}
