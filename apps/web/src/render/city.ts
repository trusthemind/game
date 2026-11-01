import * as THREE from 'three';
import type { GameMap, Structure } from '@ashfall/engine';
import { getTexture } from './textures';
import { WALL_H } from './world';

type Mat = <M extends THREE.Material>(m: M, occlude?: 'wall' | 'canopy' | 'tall', fow?: boolean) => M;
type Geo = <G extends THREE.BufferGeometry>(g: G) => G;

/**
 * Town and country set pieces from map.structures: the monument on the square, petrol station canopies,
 * lock-up garages, bridge railings, the sawmill's log piles.
 */
export function cityPieces(map: GameMap, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const s of map.structures) {
    if (s.kind === 'monument') out.push(monument(s, mat, geo, shadows));
    if (s.kind === 'canopy') out.push(canopy(s, mat, geo, shadows));
    if (s.kind === 'garages') out.push(garages(s, mat, geo, shadows));
    if (s.kind === 'bridge') out.push(railings(s, mat, geo, shadows));
    if (s.kind === 'logs') out.push(logs(s, mat, geo, shadows));
  }
  return out;
}

/** Steel railings along both sides of a bridge: posts every 2 m and a top rail, plus the deck's edge beam. */
function railings(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const steel = mat(new THREE.MeshStandardMaterial({ color: 0x6a6e70, roughness: 0.5, metalness: 0.6 }));
  const beam = mat(new THREE.MeshStandardMaterial({ map: getTexture('concrete'), color: 0x9a968e, roughness: 0.9 }));
  const alongX = s.w >= s.h;
  const len = alongX ? s.w : s.h;
  for (const side of [0, alongX ? s.h : s.w]) {
    const at = (a: number, y: number, w: number, h: number, d: number, m: THREE.Material) =>
      alongX ? box(g, geo, m, w, h, d, s.x + a, y, s.y + side, shadows) : box(g, geo, m, d, h, w, s.x + side, y, s.y + a, shadows);
    at(len / 2, -0.25, len, 0.5, 0.35, beam);
    at(len / 2, 1.0, len, 0.08, 0.08, steel);
    for (let a = 0.2; a <= len; a += 2) at(a, 0.5, 0.08, 1.0, 0.08, steel);
  }
  return g;
}

/** A pile of sawn logs lying along the pile's length, `levels` high, the ends showing pale wood. */
function logs(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const bark = mat(new THREE.MeshStandardMaterial({ map: getTexture('bark'), color: 0x8a7458, roughness: 0.95 }));
  const alongX = s.w >= s.h;
  const len = (alongX ? s.w : s.h) - 0.2;
  const across = alongX ? s.h : s.w;
  const r = 0.22;
  const per = Math.floor(across / (r * 2));
  const levels = s.levels ?? 3;
  const n = Array.from({ length: levels }, (_, l) => Math.max(1, per - l)).reduce((a, b) => a + b, 0);
  const inst = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(r, r, len, 10).rotateZ(Math.PI / 2)), bark, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2);
  let i = 0;
  for (let l = 0; l < levels; l++) {
    const count = Math.max(1, per - l);
    for (let k = 0; k < count; k++) {
      const off = (k - (count - 1) / 2) * r * 2;
      const p = alongX ? new THREE.Vector3(s.x + s.w / 2, r + l * r * 1.75, s.y + s.h / 2 + off) : new THREE.Vector3(s.x + s.w / 2 + off, r + l * r * 1.75, s.y + s.h / 2);
      inst.setMatrixAt(i++, m.compose(p, q, new THREE.Vector3(1, 1, 1)));
    }
  }
  inst.castShadow = shadows;
  inst.receiveShadow = shadows;
  return inst;
}

const box = (g: THREE.Group, geo: Geo, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadows: boolean) => {
  const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
  b.position.set(x, y, z);
  b.castShadow = shadows;
  b.receiveShadow = shadows;
  g.add(b);
  return b;
};

/** A stepped granite plinth and a bronze figure with an arm raised towards the future. */
function monument(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const stone = mat(new THREE.MeshStandardMaterial({ map: getTexture('concrete'), color: 0x8a8682, roughness: 0.8 }));
  const bronze = mat(new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.45, metalness: 0.75 }), 'canopy');
  const cx = s.x + s.w / 2;
  const cz = s.y + s.h / 2;
  box(g, geo, stone, s.w + 1.2, 0.3, s.h + 1.2, cx, 0.15, cz, shadows);
  box(g, geo, stone, s.w, 0.5, s.h, cx, 0.55, cz, shadows);
  box(g, geo, stone, s.w * 0.6, 2.2, s.h * 0.6, cx, 1.9, cz, shadows);
  const body = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.42, 0.55, 2.1, 10)), bronze);
  body.position.set(cx, 4.05, cz);
  const head = new THREE.Mesh(geo(new THREE.SphereGeometry(0.32, 12, 10)), bronze);
  head.position.set(cx, 5.4, cz);
  const arm = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.11, 0.13, 1.4, 8)), bronze);
  arm.position.set(cx + 0.55, 5.2, cz + 0.2);
  arm.rotation.z = -0.9;
  const coat = new THREE.Mesh(geo(new THREE.ConeGeometry(0.75, 1.3, 10, 1, true)), bronze);
  coat.position.set(cx, 3.6, cz);
  for (const m of [body, head, arm, coat]) {
    m.castShadow = shadows;
    g.add(m);
  }
  return g;
}

/** A petrol station canopy: a white slab with a red fascia on four posts, two pump islands under it. */
function canopy(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const white = mat(new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 }), 'canopy');
  const red = mat(new THREE.MeshStandardMaterial({ color: 0xb02a22, roughness: 0.6 }), 'canopy');
  const post = mat(new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.6, metalness: 0.3 }));
  const pump = mat(new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.6 }));
  const island = mat(new THREE.MeshStandardMaterial({ map: getTexture('concrete'), color: 0xa8a49c, roughness: 0.9 }));
  const H = 4.4;
  const cx = s.x + s.w / 2;
  const cz = s.y + s.h / 2;
  box(g, geo, white, s.w, 0.35, s.h, cx, H, cz, shadows);
  box(g, geo, red, s.w + 0.1, 0.5, 0.12, cx, H - 0.05, s.y, false);
  box(g, geo, red, s.w + 0.1, 0.5, 0.12, cx, H - 0.05, s.y + s.h, false);
  for (const [px, pz] of [[s.x + 0.5, s.y + 0.5], [s.x + s.w - 0.5, s.y + 0.5], [s.x + 0.5, s.y + s.h - 0.5], [s.x + s.w - 0.5, s.y + s.h - 0.5]] as const)
    box(g, geo, post, 0.35, H, 0.35, px, H / 2, pz, shadows);
  for (const k of [0.33, 0.66]) {
    const px = Math.floor(s.x + s.w * k) + 0.5;
    box(g, geo, island, 1, 0.2, 3, px, 0.1, s.y + 3.5, shadows);
    box(g, geo, pump, 0.6, 1.5, 0.45, px, 0.95, s.y + 2.8, shadows);
    box(g, geo, pump, 0.6, 1.5, 0.45, px, 0.95, s.y + 4.2, shadows);
  }
  return g;
}

/** A row of lock-up garages: flat tarred roofs over the boxes and a steel door in each 3 m bay. */
function garages(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const roof = mat(new THREE.MeshStandardMaterial({ map: getTexture('tar'), color: 0x6a6862, roughness: 0.95 }), 'wall');
  const door = mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), roughness: 0.6, metalness: 0.4 }));
  box(g, geo, roof, s.w + 0.4, 0.15, s.h + 0.3, s.x + s.w / 2, WALL_H + 0.08, s.y + s.h / 2, shadows);
  const front = s.color === 1 ? s.y - 0.02 : s.y + s.h + 0.02;
  const doors = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(2.4, 1.9, 0.06)), door, Math.floor(s.w / 3));
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const tints = [0x5a6a5a, 0x6a5a4a, 0x4a5a6a, 0x7a6a4a, 0x5a5a5a];
  for (let i = 0; i < doors.count; i++) {
    doors.setMatrixAt(i, m.makeTranslation(s.x + i * 3 + 1.5, 0.95, front));
    doors.setColorAt(i, c.setHex(tints[(i * 7 + s.x) % tints.length]!));
  }
  g.add(doors);
  return g;
}
