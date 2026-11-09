import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addSketchfabFurniture } from './furnitureSf';
import { cleanModel } from './cleanModel';

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
  /** Clothing on the shared skeleton: outfit name ("m_ranger", "f_peasant"…) → its skinned pieces. */
  outfits: Map<string, THREE.SkinnedMesh[]>;
  /** Room furniture (beds, sofas, shelves…), front facing +Z, standing on y=0. */
  furniture: Map<string, THREE.Object3D>;
  /** Rigged Sketchfab bodies on their own skeleton (rebound onto ours per character, see rebind.ts). */
  bodies: Map<string, GLTF>;
  /** Sketchfab vehicles (render/vehicle.ts normalises them): id → raw root node. */
  vehicles: Map<string, THREE.Object3D>;
}

/** Bodies that ship in models/bodies/ (CC BY, credited in models/CREDITS.txt). */
export const BODY_IDS = [
  'pmc_a',
  'fsb',
  'pmc_heavy',
  'swat',
  'swat_mc',
  'ukr_a',
  'ukr_b',
  'rus_a',
  'fem_w2',
  'fem_ops',
  'fem_police',
  'fem_jacket',
  'fem_leather',
] as const;
export type BodyId = (typeof BODY_IDS)[number];
/** Rigged models kept only for their clothes (models/bodies/cl_*.glb, see CLOTH_KIT). */
export const CLOTH_SOURCES = ['cl_man', 'cl_civ', 'cl_soldier', 'cl_tim', 'cl_alan'] as const;
/** Female bodies are the fem_* ones (their wearer gets female voice, proportions and portrait). */
export const bodySex = (id: string): 'm' | 'f' => (id.startsWith('fem') ? 'f' : 'm');

const BASE = `${import.meta.env.BASE_URL}models/`;
let pending: Promise<AssetLibrary> | null = null;
let ready: AssetLibrary | null = null;

const bodyLoads = new Map<string, Promise<void>>();
const failedBodies = new Set<string>();

/**
 * Rigged bodies load on demand (all 14 weigh 17 MB): resolves once every id is in `lib.bodies`, or has failed
 * to load, in which case its wearer falls back to the modelled body and outfit.
 */
export function loadBodies(lib: AssetLibrary, ids: Iterable<string | undefined>): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const waits: Promise<void>[] = [];
  for (const id of new Set(ids)) {
    if (!id || lib.bodies.has(id) || failedBodies.has(id)) continue;
    let p = bodyLoads.get(id);
    if (!p) {
      p = loader.loadAsync(`${BASE}bodies/${id}.glb`).then(
        (g) => {
          cleanModel(g.scene);
          lib.bodies.set(id, g);
        },
        (e) => {
          console.warn(`body ${id} failed to load`, e);
          failedBodies.add(id);
        },
      );
      bodyLoads.set(id, p);
    }
    waits.push(p);
  }
  return Promise.all(waits).then(() => {});
}

/** Whether a character wearing this body can be built now (loaded, failed, or none asked for). */
export const bodySettled = (lib: AssetLibrary, id: string | undefined) => !id || lib.bodies.has(id) || failedBodies.has(id);

export function getAssets(): AssetLibrary | null {
  return ready;
}

export function loadAssets(onProgress?: (p: number) => void): Promise<AssetLibrary> {
  if (pending) return pending;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const load = (name: string) =>
    loader.loadAsync(`${BASE}${name}.glb`).then((g) => {
      cleanModel(g.scene);
      return g;
    });
  const byName = (g: GLTF) => {
    const m = new Map<string, THREE.Object3D>();
    for (const c of g.scene.children) m.set(c.name, c);
    return m;
  };
  pending = Promise.all([load('character'), load('character_f').catch(() => null), load('weapons'), load('melee'), load('props'), load('nature'), load('mods'), load('human_m').catch(() => null), load('human_f').catch(() => null), load('hair').catch(() => null), load('furniture').catch(() => null), load('outfits').catch(() => null), load('vehicles').catch(() => null), load('furniture_sf').catch(() => null)]).then(
    ([character, characterF, weapons, melee, props, nature, mods, humanM, humanF, hairDoc, furniture, outfitDoc, vehicleDoc, furnitureSf]) => {
      const hair = new Map<string, THREE.SkinnedMesh>();
      hairDoc?.scene.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        // Style name is on the scene-level ancestor.
        let p: THREE.Object3D | null = sm;
        while (p && p.parent && p.parent !== hairDoc.scene) p = p.parent;
        if (p && !hair.has(p.name)) hair.set(p.name, sm);
      });
      const outfits = new Map<string, THREE.SkinnedMesh[]>();
      for (const root of outfitDoc?.scene.children ?? []) {
        const list: THREE.SkinnedMesh[] = [];
        root.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) list.push(o as THREE.SkinnedMesh);
        });
        outfits.set(root.name, list);
      }
      const clips = new Map<string, THREE.AnimationClip>();
      for (const c of character.animations) clips.set(c.name, stripRootMotion(c));
      for (const g of [weapons, melee, props, nature, mods])
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
      // The packs are flat-shaded low-poly, so every facet shows. Smooth across shallow angles (rounded
      // barrels, grips, pouches) and keep real edges sharp.
      for (const g of [weapons, melee, props, mods, furniture])
        g?.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) m.geometry = toCreasedNormals(m.geometry, (40 * Math.PI) / 180);
        });
      ready = { character, characterF, humanM, humanF, hair, clips, weapons: byName(weapons), melee: byName(melee), mods: byName(mods), props: byName(props), nature: byName(nature), furniture: furniture ? byName(furniture) : new Map(), outfits, bodies: new Map(), vehicles: vehicleDoc ? byName(vehicleDoc) : new Map() };
      addSketchfabFurniture(ready.furniture, furnitureSf);
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
