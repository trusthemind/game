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
  clips: Map<string, THREE.AnimationClip>;
  weapons: Map<string, THREE.Object3D>;
  melee: Map<string, THREE.Object3D>;
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
  pending = Promise.all([load('character'), load('weapons'), load('melee'), load('props'), load('nature')]).then(
    ([character, weapons, melee, props, nature]) => {
      const clips = new Map<string, THREE.AnimationClip>();
      for (const c of character.animations) clips.set(c.name, c);
      for (const g of [weapons, melee, props, nature])
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
      ready = { character, clips, weapons: byName(weapons), melee: byName(melee), props: byName(props), nature: byName(nature) };
      return ready;
    },
  );
  pending.catch(() => (pending = null));
  return pending;
}
