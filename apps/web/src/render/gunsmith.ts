import * as THREE from 'three';
import { getDef, type ItemInstance, type ModSlot } from '@ashfall/engine';
import type { AssetLibrary } from './assets';

/** Which attachment model represents each mod item. */
const MOD_MODEL: Record<string, { model: string; scale?: number }> = {
  sup_9: { model: 'sup_short' },
  sup_545: { model: 'sup_mid' },
  sup_556: { model: 'sup_mid' },
  sup_762: { model: 'sup_mid', scale: 1.05 },
  sup_54r: { model: 'sup_long' },
  brake: { model: 'brake' },
  red_dot: { model: 'scope_dot', scale: 0.85 },
  holo: { model: 'scope_dot', scale: 1.1 },
  scope_4x: { model: 'scope_mid' },
  scope_8x: { model: 'scope_long' },
  fgrip: { model: 'grip' },
  stock_tac: { model: 'stock' },
  tac_light: { model: 'light' },
};

interface Anchors {
  len: number;
  muzzle: THREE.Vector3;
  top: THREE.Vector3;
  under: THREE.Vector3;
  rear: THREE.Vector3;
  side: THREE.Vector3;
}

const anchorCache = new Map<string, Anchors>();

/** Find mounting points from the gun's own geometry (models are centred, muzzle on +Z). */
function anchorsFor(id: string, gun: THREE.Object3D): Anchors {
  const hit = anchorCache.get(id);
  if (hit) return hit;
  gun.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(gun.matrixWorld).invert();
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  gun.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position!;
    const step = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts);
  const len = box.max.z - box.min.z;
  const slice = (z0: number, z1: number) => pts.filter((p) => p.z >= z0 && p.z <= z1);
  const avgY = (ps: THREE.Vector3[], fallback: number) => (ps.length ? ps.reduce((s, p) => s + p.y, 0) / ps.length : fallback);
  const front = slice(box.max.z - len * 0.05, box.max.z);
  const mid = slice(box.min.z + len * 0.35, box.min.z + len * 0.65);
  const fore = slice(box.min.z + len * 0.55, box.min.z + len * 0.8);
  const back = slice(box.min.z, box.min.z + len * 0.06);
  const a: Anchors = {
    len,
    muzzle: new THREE.Vector3(0, avgY(front, 0), box.max.z),
    top: new THREE.Vector3(0, mid.length ? Math.max(...mid.map((p) => p.y)) : box.max.y, box.min.z + len * 0.5),
    under: new THREE.Vector3(0, fore.length ? Math.min(...fore.map((p) => p.y)) : box.min.y, box.min.z + len * 0.68),
    rear: new THREE.Vector3(0, avgY(back, 0), box.min.z),
    side: new THREE.Vector3(box.max.x, avgY(front, 0), box.max.z - len * 0.22),
  };
  anchorCache.set(id, a);
  return a;
}

const SLOT_ORDER: ModSlot[] = ['muzzle', 'scope', 'grip', 'stock', 'light'];

/** The gun model with its installed attachments mounted. Pistols get compact rail versions. */
export function buildGun(lib: AssetLibrary, item: ItemInstance): THREE.Object3D | null {
  const src = lib.weapons.get(item.def);
  if (!src) return null;
  const gun = src.clone();
  if (!item.mods) return gun;
  const a = anchorsFor(item.def, src);
  const pistol = getDef(item.def).weapon?.cls === 'pistol';
  for (const slot of SLOT_ORDER) {
    const mod = item.mods[slot];
    const spec = mod && MOD_MODEL[mod.def];
    const model = spec && lib.mods.get(spec.model);
    if (!model) continue;
    const m = model.clone();
    const k = (spec.scale ?? 1) * (pistol ? 0.75 : 1);
    m.scale.multiplyScalar(k);
    const b = new THREE.Box3().setFromObject(m);
    const size = b.getSize(new THREE.Vector3());
    switch (slot) {
      case 'muzzle':
        m.position.set(a.muzzle.x, a.muzzle.y, a.muzzle.z + size.z / 2 - 0.005);
        break;
      case 'scope':
        m.position.set(0, a.top.y + size.y / 2 - 0.004, pistol ? a.top.z - a.len * 0.1 : a.top.z);
        break;
      case 'grip':
        m.rotation.x = Math.PI / 2;
        m.position.set(0, a.under.y - size.z / 2 + 0.01, a.under.z);
        break;
      case 'stock':
        // Replaces the factory stock: sits over it rather than bolted on behind.
        m.position.set(0, a.rear.y, a.rear.z + size.z * 0.42);
        break;
      case 'light':
        m.position.set(a.side.x + size.x / 2, a.side.y, a.side.z);
        break;
    }
    gun.add(m);
  }
  return gun;
}

/** Cache key for a gun's look. */
export function gunKey(item: ItemInstance | null | undefined): string {
  if (!item) return '';
  return item.mods ? `${item.def}[${Object.values(item.mods).map((m) => m?.def).join(',')}]` : item.def;
}
