import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, type Building, type GameMap } from '@ashfall/engine';
import { getTexture } from './textures';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import { WALL_H } from './world';

const GABLE = new Set(['house', 'cabin', 'barn']);
const ROOF_COLORS = [0x9a4a36, 0x7a6048, 0x6a7278, 0x5f7258, 0x8a7448, 0x56687a];

export interface RoofSet {
  group: THREE.Group;
  roofs: { building: Building; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; perimeter: number[] }[];
  dispose(): void;
}

/** Gable or flat roofs per building. Hidden while you're inside (Project Zomboid style), dimmed by fog of war. */
export function buildRoofs(map: GameMap, u: WorldUniforms, shadows: boolean): RoofSet {
  const group = new THREE.Group();
  const rng = new Rng(map.seed ^ 0x7007);
  const roofs: RoofSet['roofs'] = [];
  const geos: THREE.BufferGeometry[] = [];
  for (const b of map.buildings) {
    const x0 = b.x + 0.34 - 0.25;
    const x1 = b.x + b.w - 0.34 + 0.25;
    const z0 = b.y + 0.34 - 0.25;
    const z1 = b.y + b.h - 0.34 + 0.25;
    const gable = GABLE.has(b.kind);
    const g = gable ? gableGeometry(x0, x1, z0, z1, Math.min(2.2, Math.min(b.w, b.h) * 0.28)) : flatGeometry(x0, x1, z0, z1);
    geos.push(g);
    const mat = patchWorldMaterial(
      new THREE.MeshStandardMaterial({
        map: getTexture(gable ? 'roof' : 'tar'),
        color: gable ? rng.pick(ROOF_COLORS) : 0x9c9a92,
        roughness: 0.9,
        transparent: true,
        opacity: 1,
      }),
      u,
      { fow: false, occlude: 'wall' },
    );
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
    const perimeter: number[] = [];
    for (let x = b.x; x < b.x + b.w; x++) perimeter.push(map.idx(x, b.y), map.idx(x, b.y + b.h - 1));
    for (let y = b.y; y < b.y + b.h; y++) perimeter.push(map.idx(b.x, y), map.idx(b.x + b.w - 1, y));
    roofs.push({ building: b, mesh, mat, perimeter });
  }
  return {
    group,
    roofs,
    dispose() {
      for (const g of geos) g.dispose();
      for (const r of roofs) r.mat.dispose();
    },
  };
}

function gableGeometry(x0: number, x1: number, z0: number, z1: number, rise: number): THREE.BufferGeometry {
  const alongX = x1 - x0 >= z1 - z0;
  const y0 = WALL_H;
  const y1 = WALL_H + rise;
  const p: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], len: number, slope: number) => {
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, len / 3, 0, len / 3, slope / 3, 0, 0, len / 3, slope / 3, 0, slope / 3);
  };
  if (alongX) {
    const zm = (z0 + z1) / 2;
    const slope = Math.hypot(zm - z0, rise);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, zm], [x0, y1, zm], x1 - x0, slope);
    quad([x1, y0, z1], [x0, y0, z1], [x0, y1, zm], [x1, y1, zm], x1 - x0, slope);
    p.push(x0, y0, z1, x0, y0, z0, x0, y1, zm, x1, y0, z0, x1, y0, z1, x1, y1, zm);
  } else {
    const xm = (x0 + x1) / 2;
    const slope = Math.hypot(xm - x0, rise);
    quad([x0, y0, z1], [x0, y0, z0], [xm, y1, z0], [xm, y1, z1], z1 - z0, slope);
    quad([x1, y0, z0], [x1, y0, z1], [xm, y1, z1], [xm, y1, z0], z1 - z0, slope);
    p.push(x0, y0, z0, x1, y0, z0, xm, y1, z0, x1, y0, z1, x0, y0, z1, xm, y1, z1);
  }
  uv.push(0, 0, 1, 0, 0.5, 0.5, 0, 0, 1, 0, 0.5, 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function flatGeometry(x0: number, x1: number, z0: number, z1: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const slab = new THREE.BoxGeometry(x1 - x0, 0.16, z1 - z0);
  slab.translate((x0 + x1) / 2, WALL_H + 0.08, (z0 + z1) / 2);
  parts.push(slab);
  const pt = 0.18;
  const ph = 0.4;
  for (const [cx, cz, w, d] of [
    [(x0 + x1) / 2, z0 + pt / 2, x1 - x0, pt],
    [(x0 + x1) / 2, z1 - pt / 2, x1 - x0, pt],
    [x0 + pt / 2, (z0 + z1) / 2, pt, z1 - z0],
    [x1 - pt / 2, (z0 + z1) / 2, pt, z1 - z0],
  ] as const) {
    const p = new THREE.BoxGeometry(w, ph, d);
    p.translate(cx, WALL_H + 0.16 + ph / 2, cz);
    parts.push(p);
  }
  // A couple of rooftop units (vents / AC) for silhouette.
  const vent = new THREE.BoxGeometry(1.2, 0.6, 0.9);
  vent.translate(x0 + (x1 - x0) * 0.3, WALL_H + 0.46, z0 + (z1 - z0) * 0.4);
  parts.push(vent);
  for (const p of parts) p.deleteAttribute('normal');
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Per-frame: hide the roof of the building you're in; tint the rest by how much of their outline you've seen. */
export function updateRoofs(set: RoofSet, map: GameMap, px: number, py: number, fov: Uint8Array, explored: Uint8Array, dt: number): void {
  const inside = map.buildingAt[map.idx(Math.floor(px), Math.floor(py))]! - 1;
  const k = Math.min(1, dt * 10);
  for (const r of set.roofs) {
    const b = r.building;
    const near = px > b.x - 0.6 && px < b.x + b.w + 0.6 && py > b.y - 0.6 && py < b.y + b.h + 0.6;
    const target = b.id === inside || near ? 0 : 1;
    r.mat.opacity += (target - r.mat.opacity) * k;
    r.mesh.visible = r.mat.opacity > 0.02;
    r.mat.depthWrite = r.mat.opacity > 0.95;
    let seen = 0;
    let vis = 0;
    for (const i of r.perimeter) {
      if (fov[i]) vis++;
      if (explored[i]) seen++;
    }
    const n = r.perimeter.length || 1;
    const light = vis > 0 ? 1 : seen / n > 0.2 ? 0.8 : 0.55;
    r.mat.emissiveIntensity = 0;
    const c = r.mat.userData.base ?? (r.mat.userData.base = r.mat.color.clone());
    r.mat.color.copy(c).multiplyScalar(light);
  }
}
