import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createItem, getDef, socketTree, type ItemInstance, type Preset } from '@ashfall/engine';

/**
 * Guns built from parts (tools/assets/weapons.mjs). Each platform glb holds its parts as root nodes named by
 * item id, already in the platform's frame (metres, bore on Z with the muzzle towards +Z, up +Y), so a gun is
 * its receiver plus every part in its tree added at the identity. Bolt-on parts (attach.glb, mounting point at
 * the origin) go on the empty `socket_<id>` node of the part that carries the socket.
 */
const PLATFORMS = ['ak', 'ar', 'attach'];
const BASE = `${import.meta.env.BASE_URL}models/`;
/**
 * Bump whenever tools/assets/weapons.mjs writes new glb files: the models are cached for a week (vercel.json) and
 * the code reads their sockets, so old files with new code put sights in mid-air.
 */
const VERSION = 3;

let pending: Promise<Map<string, THREE.Object3D>> | null = null;
let ready: Map<string, THREE.Object3D> | null = null;

/** The parts if they've loaded (starting the load if not): guns draw from the whole-gun models until then. */
export function weaponParts(): Map<string, THREE.Object3D> | null {
  if (!ready) void loadWeaponParts();
  return ready;
}

/** Is this gun drawn from parts (its receiver has a model and the parts have loaded)? */
export const drawnFromParts = (def: string) => !!weaponParts()?.has(def);

export function loadWeaponParts(): Promise<Map<string, THREE.Object3D>> {
  if (pending) return pending;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  pending = Promise.all(PLATFORMS.map((p) => loader.loadAsync(`${BASE}${p}.glb?v=${VERSION}`).catch(() => null))).then((docs) => {
    const parts = new Map<string, THREE.Object3D>();
    docs.forEach((g, i) => {
      for (const c of g?.scene.children ?? []) {
        // attach.glb parts have their mounting point at the origin; the platforms' sit in the gun's frame.
        c.userData.boltOn = PLATFORMS[i] === 'attach';
        c.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        parts.set(c.name, c);
      }
    });
    ready = parts;
    return parts;
  });
  return pending;
}

const centres = new Map<string, THREE.Vector3>();

/**
 * The gun as its parts, laid out like the whole-gun models it replaces: muzzle towards +Z, and centred where the
 * factory gun's middle is (the same for every build of that gun, so a suppressor doesn't shift the grip in the
 * hand). Null until the parts have loaded, or for a gun with no receiver model.
 */
export function partsGun(item: ItemInstance): THREE.Object3D | null {
  const parts = weaponParts();
  const g = parts && assembleGun(parts, item);
  if (!g) return null;
  let c = centres.get(item.def);
  if (!c) {
    c = new THREE.Box3().setFromObject(assembleGun(parts, createItem(item.def))!).getCenter(new THREE.Vector3());
    centres.set(item.def, c);
  }
  g.position.sub(c);
  const w = new THREE.Group();
  w.add(g);
  // How it's held (character.ts): the right palm round the top of the pistol grip, the left under the handguard a
  // little ahead of its middle, the butt in the shoulder; and the magazine, which comes out during a reload.
  w.updateMatrixWorld(true);
  const part = (socket: string) => g.children.find((o) => o.userData.socket === socket);
  const all = new THREE.Box3().setFromObject(w);
  const pg = part('pgrip');
  const gb = pg ? new THREE.Box3().setFromObject(pg) : null;
  w.userData.grip = gb ? new THREE.Vector3((gb.min.x + gb.max.x) / 2, gb.max.y - 0.03, (gb.min.z + gb.max.z) / 2) : null;
  const hg = part('handguard');
  const hb = hg ? new THREE.Box3().setFromObject(hg) : all;
  const len = hb.max.z - hb.min.z;
  w.userData.support = new THREE.Vector3(0, hg ? hb.min.y : -0.03, hg ? hb.min.z + len * 0.55 : all.max.z - (all.max.z - all.min.z) * 0.3);
  w.userData.mag = part('mag') ?? null;
  // The heel of the stock, on the bore line: it goes into the shoulder.
  w.userData.butt = new THREE.Vector3(-c.x, -c.y, all.min.z);
  return w;
}

/** The gun as its parts: null when its receiver has no model yet (the caller falls back to the whole-gun model). */
export function assembleGun(parts: Map<string, THREE.Object3D>, item: ItemInstance): THREE.Group | null {
  const receiver = parts.get(item.def);
  if (!receiver) return null;
  const g = new THREE.Group();
  g.name = item.def;
  // What each item in the tree became, to find the socket a part bolts onto.
  const drawn = new Map<ItemInstance, THREE.Object3D>([[item, receiver.clone()]]);
  g.add(drawn.get(item)!);
  const v = new THREE.Vector3();
  for (const r of socketTree(item)) {
    if (!r.part) continue;
    // A part without a model yet (a 45-round mag, a drum) is drawn as the factory one in that socket.
    const node = parts.get(r.part.def) ?? parts.get(factoryPart(item.def, r.path) ?? '');
    let obj: THREE.Object3D | null = null;
    if (node && !node.userData.boltOn) obj = node.clone();
    else if (BARRELS[r.part.def]) obj = barrel(receiver, BARRELS[r.part.def]!);
    else if (node) {
      // A bolt-on part: its mounting point goes on the host's socket.
      const host = drawn.get(r.host);
      const socket = host && findSocket(host, r.socket.id);
      if (!socket) continue;
      g.updateMatrixWorld(true);
      g.worldToLocal(socket.getWorldPosition(v));
      obj = node.clone();
      obj.position.copy(v);
    }
    if (!obj) continue;
    obj.userData.socket = r.path.join('/');
    g.add(obj);
    drawn.set(r.part, obj);
  }
  return g;
}

/** AR barrels by length from the receiver face (the kit models have none): 10.3", 14.5", 20". */
const BARRELS: Record<string, number> = { ar_barrel_103: 0.262, ar_barrel_145: 0.368, ar_barrel_20: 0.508 };
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1c, metalness: 0.7, roughness: 0.45 });

/** A plain barrel with a gas block, from the receiver's `barrel` socket forwards. */
function barrel(receiver: THREE.Object3D, length: number): THREE.Object3D {
  const at = findSocket(receiver, 'barrel')?.position ?? new THREE.Vector3();
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, length, 16), barrelMat);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(at.x, at.y, at.z + length / 2);
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.03), barrelMat);
  block.position.set(at.x, at.y + 0.004, at.z + length * 0.62);
  g.add(tube, block);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'socket_muzzle';
  muzzle.position.set(at.x, at.y, at.z + length);
  g.add(muzzle);
  return g;
}

/** The factory part at `path` in a gun's preset, if it has one. */
function factoryPart(gunDef: string, path: string[]): string | null {
  let p: Preset | undefined = getDef(gunDef).weapon?.preset;
  for (let i = 0; p && i < path.length; i++) {
    const e: Preset[string] | undefined = p[path[i]!];
    if (!e) return null;
    if (i === path.length - 1) return typeof e === 'string' ? e : e[0];
    p = typeof e === 'string' ? undefined : e[1];
  }
  return null;
}

/** A part's socket node. GLTFLoader makes names unique per file, so a second `socket_side` comes as `socket_side_2`. */
function findSocket(part: THREE.Object3D, id: string): THREE.Object3D | undefined {
  const re = new RegExp(`^socket_${id}(_\\d+)?$`);
  return part.children.find((c) => re.test(c.name));
}
