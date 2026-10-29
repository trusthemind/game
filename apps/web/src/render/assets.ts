import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loads the CC0 model packs once per session (see tools/assets/build.mjs) and hands out clones.
 * GLBs are meshopt-compressed and served with long-lived cache headers + precached by the service worker,
 * so the second visit loads from disk.
 */
export interface AssetLibrary {
  character: GLTF;
  /** Female body on the same skeleton (mesh only; shares the clips). */
  characterF: GLTF | null;
  /** Modelled human bodies (faces, eyes, eyebrows, PBR skin) + hairstyles, same skeleton. */
  humanM: GLTF | null;
  humanF: GLTF | null;
  hair: Map<string, THREE.SkinnedMesh>;
  clips: Map<string, THREE.AnimationClip>;
  weapons: Map<string, THREE.Object3D>;
  melee: Map<string, THREE.Object3D>;
  /** Weapon attachments (suppressors, scopes, grips, stocks, lights). */
  mods: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  nature: Map<string, THREE.Object3D>;
}

const BASE = `${import.meta.env.BASE_URL}models/`;
let pending: Promise<AssetLibrary> | null = null;
let ready: AssetLibrary | null = null;

export function getAssets(): AssetLibrary | null {
  return ready;
}

export function loadAssets(onProgress?: (p: number) => void): Promise<AssetLibrary> {
  if (pending) return pending;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const load = (name: string) => loader.loadAsync(`${BASE}${name}.glb`);
  const byName = (g: GLTF) => {
    const m = new Map<string, THREE.Object3D>();
    for (const c of g.scene.children) m.set(c.name, c);
    return m;
  };
  pending = Promise.all([load('character'), load('character_f').catch(() => null), load('weapons'), load('melee'), load('props'), load('nature'), load('mods'), load('human_m').catch(() => null), load('human_f').catch(() => null), load('hair').catch(() => null)]).then(
    ([character, characterF, weapons, melee, props, nature, mods, humanM, humanF, hairDoc]) => {
      const hair = new Map<string, THREE.SkinnedMesh>();
      hairDoc?.scene.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        // Style name is on the scene-level ancestor.
        let p: THREE.Object3D | null = sm;
        while (p && p.parent && p.parent !== hairDoc.scene) p = p.parent;
        if (p && !hair.has(p.name)) hair.set(p.name, sm);
      });
      const clips = new Map<string, THREE.AnimationClip>();
      for (const c of character.animations) clips.set(c.name, stripRootMotion(c));
      for (const g of [weapons, melee, props, nature, mods])
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
      ready = { character, characterF, humanM, humanF, hair, clips, weapons: byName(weapons), melee: byName(melee), mods: byName(mods), props: byName(props), nature: byName(nature) };
      return ready;
    },
  );
  pending.catch(() => (pending = null));
  return pending;
}

/**
 * Root-motion clips (`*_RM`) move the hips forward on their own; the sim already moves the actor. Keep the
 * vertical hump of the pelvis (local Z is up on this rig) but remove the net climb, so a window vault
 * goes up and over and lands back on the ground.
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  if (!clip.name.endsWith('_RM')) return clip;
  for (const t of clip.tracks) {
    if (t.name !== 'pelvis.position') continue;
    const v = t.values;
    const n = v.length / 3;
    const x0 = v[0]!;
    const y0 = v[1]!;
    const z0 = v[2]!;
    const rise = v[v.length - 1]! - z0;
    for (let i = 0; i < n; i++) {
      v[i * 3] = x0;
      v[i * 3 + 1] = y0;
      v[i * 3 + 2] -= rise * (i / Math.max(1, n - 1));
    }
  }
  return clip;
}
