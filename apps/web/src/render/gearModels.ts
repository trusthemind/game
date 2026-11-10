import * as THREE from 'three';
import type { AssetLibrary } from './assets';

/**
 * Which real model each helmet / body armour / rig item is: a root of gear.glb (licensed models, credited in
 * models/CREDITS.txt), or one piece of it. Items not listed here still use the built ones (gear3d.ts, armorShell.ts).
 *
 * `part`: a pack holds several vests, this picks one by node name. `turn`: radians about Y that bring its front to
 * +Z (ours); `tilt` about X the same way for one exported lying down.
 */
export interface GearSpec {
  model: string;
  part?: string;
  turn?: number;
  tilt?: number;
  /** Helmets: bounds to fit to the head, as a fraction of the model's height from its top (chin straps and
   * headsets hang below the shell and mustn't squash it). Default 1: the whole model. */
  shell?: number;
  /** Vests: width and depth multipliers over the usual fit (shoulder guards widen the bounds, front pouches
   * deepen them, and the vest itself would come out too small). */
  fit?: [number, number];
}

export const GEAR_MODEL: Record<string, GearSpec> = {
  // Helmets
  altyn: { model: 'altyn' },
  ssh68: { model: 'ssh40' },
  ssh36: { model: 'ssh36' },
  h_kevlar: { model: 'wz2005', shell: 0.6 },
  h_fast: { model: 'fast', shell: 0.62 },
  h_fast_headset: { model: 'helmet_headset', shell: 0.7 },
  // Body armour
  paca: { model: 'vest_pack', part: '^Vest_1_T1' },
  '6b23': { model: 'vest_pack', part: '^Vest_1_T2' },
  trooper: { model: 'plate_carrier', fit: [1, 1.12] },
  pc_tan: { model: 'vest_danly', fit: [1.04, 1.3] },
  gzhel: { model: 'vest_pack', part: '^Vest_1_Prem', fit: [1.42, 1.1] },
  slick6: { model: 'vest_pack', part: '^Vest$|^Vest_Vest' },
  // Rigs
  r_mbss: { model: 'vest_pack', part: '^Vest_T0' },
};

const made = new Map<string, THREE.Object3D | null>();

/**
 * The model for an item, turned to face +Z and centred on its bounds, or null when it has none. A fresh clone each
 * call (materials shared).
 */
export function wornGear(lib: AssetLibrary, itemId: string): THREE.Object3D | null {
  const spec = GEAR_MODEL[itemId];
  if (!spec) return null;
  let proto = made.get(itemId);
  if (proto === undefined) {
    const src = lib.gear.get(spec.model);
    proto = null;
    if (src) {
      const o = src.clone(true);
      if (spec.part) {
        const re = new RegExp(spec.part);
        // Keep the nodes under a matching one; everything else in the pack goes.
        const keep = new Set<THREE.Object3D>();
        o.traverse((n) => {
          if (re.test(n.name)) n.traverse((c) => keep.add(c));
        });
        const drop: THREE.Object3D[] = [];
        o.traverse((n) => {
          if ((n as THREE.Mesh).isMesh && !keep.has(n)) drop.push(n);
        });
        for (const n of drop) n.parent?.remove(n);
      }
      const turned = new THREE.Group();
      turned.add(o);
      turned.rotation.set(spec.tilt ?? 0, spec.turn ?? 0, 0);
      turned.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(turned);
      if (!b.isEmpty()) {
        o.position.sub(turned.worldToLocal(b.getCenter(new THREE.Vector3())));
        proto = new THREE.Group();
        proto.add(turned);
        proto.userData.shellFrac = spec.shell ?? 1;
        proto.userData.fit = spec.fit ?? [1, 1];
        // Some shells are modelled one-sided (a helmet seen from below would show only its rim).
        const twoSided = new Map<THREE.Material, THREE.Material>();
        proto.traverse((n) => {
          const m = n as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          const src = m.material as THREE.Material;
          let mat = twoSided.get(src);
          if (!mat) {
            mat = src.clone();
            mat.side = THREE.DoubleSide;
            twoSided.set(src, mat);
          }
          m.material = mat;
        });
      }
    }
    made.set(itemId, proto);
  }
  return proto ? proto.clone(true) : null;
}

export const hasGearModel = (itemId: string) => itemId in GEAR_MODEL;
