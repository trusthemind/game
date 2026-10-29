import * as THREE from 'three';
import { Rng, Tile, type GameMap, type LootContainer, type ContainerKind } from '@ashfall/engine';
import { getTexture, type TexKind } from './textures';
import { patchWorldMaterial, type WorldUniforms } from './patches';

export const WALL_H = 2.1;

const FLOOR_OF: Partial<Record<Tile, TexKind>> = {
  [Tile.Grass]: 'grass',
  [Tile.Road]: 'asphalt',
  [Tile.Wood]: 'wood',
  [Tile.Concrete]: 'concrete',
  [Tile.Dirt]: 'dirt',
  [Tile.Tree]: 'grass',
  [Tile.Car]: 'asphalt',
  [Tile.Fence]: 'dirt',
  [Tile.Border]: 'grass',
  [Tile.Wall]: 'concrete',
  [Tile.Window]: 'concrete',
};

const CONTAINER_SHAPE: Record<ContainerKind, { w: number; h: number; d: number; color: number }> = {
  wardrobe: { w: 0.85, h: 1.7, d: 0.5, color: 0x5a4330 },
  fridge: { w: 0.7, h: 1.6, d: 0.65, color: 0xb8b8b0 },
  drawer: { w: 0.8, h: 0.75, d: 0.5, color: 0x6a4d33 },
  shelf: { w: 0.9, h: 1.5, d: 0.45, color: 0x707468 },
  register: { w: 0.6, h: 0.9, d: 0.5, color: 0x3a3d3a },
  medcabinet: { w: 0.8, h: 1.4, d: 0.4, color: 0xd0d4cc },
  crate: { w: 0.8, h: 0.7, d: 0.8, color: 0x7a6040 },
  toolbox: { w: 0.7, h: 0.4, d: 0.4, color: 0xa03a2a },
  weaponbox: { w: 0.95, h: 0.5, d: 0.55, color: 0x3d4a32 },
  ammocrate: { w: 0.7, h: 0.5, d: 0.5, color: 0x4a5a38 },
  safe: { w: 0.65, h: 0.8, d: 0.6, color: 0x2a2e30 },
  jacket: { w: 0.6, h: 0.18, d: 0.5, color: 0x3e4a3a },
  carTrunk: { w: 0.5, h: 0.12, d: 0.5, color: 0x6a5a3a },
  stash: { w: 0.6, h: 0.35, d: 0.6, color: 0x4a4030 },
  ground: { w: 0.5, h: 0.1, d: 0.5, color: 0x55503f },
};

export interface WorldMeshes {
  group: THREE.Group;
  containers: THREE.InstancedMesh;
  containerIndex: Map<number, number>;
  extractionBeams: THREE.Mesh[];
  materials: THREE.Material[];
  dispose(): void;
}

/**
 * Builds the static world. Everything that repeats is an InstancedMesh or a merged geometry, so the whole
 * town costs a few dozen draw calls regardless of size.
 */
export function buildWorld(map: GameMap, u: WorldUniforms, shadows: boolean): WorldMeshes {
  const group = new THREE.Group();
  const rng = new Rng(map.seed ^ 0x5eed);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const mat = <M extends THREE.Material>(m: M, occlude?: 'wall' | 'canopy', fow = true) => {
    materials.push(patchWorldMaterial(m, u, { occlude, fow }));
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G) => (geometries.push(g), g);

  // ── Floors: one merged mesh per surface type, world-space UVs so textures flow across tiles.
  const floorBuckets = new Map<TexKind, number[]>();
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      let kind = FLOOR_OF[map.get(x, y)] ?? 'grass';
      if (map.isIndoors(x, y) && (kind === 'concrete' || map.get(x, y) === Tile.Window)) {
        const b = map.buildings[map.buildingAt[map.idx(x, y)]! - 1];
        kind = b && (b.kind === 'house' || b.kind === 'shop') ? 'wood' : 'concrete';
      }
      let arr = floorBuckets.get(kind);
      if (!arr) floorBuckets.set(kind, (arr = []));
      arr.push(x, y);
    }
  const uvScale: Partial<Record<TexKind, number>> = { grass: 0.25, asphalt: 0.2, wood: 0.5, concrete: 0.33, dirt: 0.3 };
  for (const [kind, cells] of floorBuckets) {
    const n = cells.length / 2;
    const pos = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const nor = new Float32Array(n * 12);
    const idx = new Uint32Array(n * 6);
    const s = uvScale[kind] ?? 0.3;
    for (let i = 0; i < n; i++) {
      const x = cells[i * 2]!;
      const z = cells[i * 2 + 1]!;
      const quad = [x, z, x + 1, z, x + 1, z + 1, x, z + 1];
      for (let k = 0; k < 4; k++) {
        pos.set([quad[k * 2]!, 0, quad[k * 2 + 1]!], i * 12 + k * 3);
        nor.set([0, 1, 0], i * 12 + k * 3);
        uv.set([quad[k * 2]! * s, quad[k * 2 + 1]! * s], i * 8 + k * 2);
      }
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = mat(new THREE.MeshStandardMaterial({ map: getTexture(kind), roughness: kind === 'asphalt' ? 0.75 : 0.95, metalness: 0 }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ── Ground beyond the map edge so the camera never sees the void (fog of war keeps it black).
  {
    const g = geo(new THREE.PlaneGeometry(map.width + 120, map.height + 120).rotateX(-Math.PI / 2));
    const outer = new THREE.Mesh(g, mat(new THREE.MeshStandardMaterial({ color: 0x1a2016, roughness: 1 })));
    outer.position.set(map.width / 2, -0.02, map.height / 2);
    group.add(outer);
  }

  // ── Walls & windows.
  const walls: [number, number][] = [];
  const windows: [number, number, boolean][] = [];
  const fences: [number, number, boolean][] = [];
  const trees: [number, number][] = [];
  const border: [number, number][] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = map.get(x, y);
      if (t === Tile.Wall) walls.push([x, y]);
      else if (t === Tile.Window) windows.push([x, y, map.isSolid(x - 1, y) && map.isSolid(x + 1, y)]);
      else if (t === Tile.Fence) fences.push([x, y, map.get(x - 1, y) === Tile.Fence || map.get(x + 1, y) === Tile.Fence]);
      else if (t === Tile.Tree) trees.push([x, y]);
      else if (t === Tile.Border && (x % 2 === 0) === (y % 2 === 0)) border.push([x, y]);
    }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();

  const wallMat = mat(new THREE.MeshStandardMaterial({ map: getTexture('plaster'), roughness: 0.92 }), 'wall');
  const wallGeo = geo(new THREE.BoxGeometry(1, WALL_H, 1));
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, walls.length));
  const palette = [0x9a9484, 0x8a8a80, 0xa39886, 0x7f8478, 0x9c8f7d, 0x868f8a];
  walls.forEach(([x, y], i) => {
    m4.makeTranslation(x + 0.5, WALL_H / 2, y + 0.5);
    wallMesh.setMatrixAt(i, m4);
    const b = map.buildings[map.buildingAt[map.idx(x, y)]! - 1];
    col.setHex(palette[(b?.id ?? 0) % palette.length]!).offsetHSL(0, 0, rng.range(-0.03, 0.03));
    wallMesh.setColorAt(i, col);
  });
  wallMesh.castShadow = wallMesh.receiveShadow = shadows;
  group.add(wallMesh);

  if (windows.length) {
    const sill = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 0.85, 1)), wallMat, windows.length);
    const lintel = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 0.35, 1)), wallMat, windows.length);
    const glassMat = mat(new THREE.MeshStandardMaterial({ color: 0x9fc3d6, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false }), 'wall');
    const glass = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 0.9, 0.06)), glassMat, windows.length);
    windows.forEach(([x, y, horiz], i) => {
      m4.makeTranslation(x + 0.5, 0.425, y + 0.5);
      sill.setMatrixAt(i, m4);
      m4.makeTranslation(x + 0.5, WALL_H - 0.175, y + 0.5);
      lintel.setMatrixAt(i, m4);
      q.setFromAxisAngle(v.set(0, 1, 0), horiz ? 0 : Math.PI / 2);
      m4.compose(v.set(x + 0.5, 1.3, y + 0.5), q, sc.set(1, 1, 1));
      glass.setMatrixAt(i, m4);
    });
    sill.castShadow = lintel.castShadow = shadows;
    sill.receiveShadow = shadows;
    group.add(sill, lintel, glass);
  }

  // ── Fences.
  if (fences.length) {
    const fenceMat = mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), roughness: 0.6, metalness: 0.4 }));
    const fence = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 1.4, 0.08)), fenceMat, fences.length);
    fences.forEach(([x, y, horiz], i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), horiz ? 0 : Math.PI / 2);
      m4.compose(v.set(x + 0.5, 0.7, y + 0.5), q, sc.set(1, 1, 1));
      fence.setMatrixAt(i, m4);
    });
    fence.castShadow = shadows;
    group.add(fence);
  }

  // ── Trees: trunk + low-poly canopy (canopy dithers out around the player).
  const allTrees = [...trees.map((t) => [...t, 0] as const), ...border.map((t) => [...t, 1] as const)];
  if (allTrees.length) {
    const trunkMat = mat(new THREE.MeshStandardMaterial({ map: getTexture('bark'), roughness: 1 }));
    const canopyMat = mat(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 'canopy');
    const trunk = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6)), trunkMat, allTrees.length);
    const canopyGeo = geo(new THREE.IcosahedronGeometry(1, 0));
    const pineGeo = geo(new THREE.ConeGeometry(1, 2.6, 7));
    const leafy = allTrees.filter((t) => t[2] === 0);
    const pines = allTrees.filter((t) => t[2] === 1);
    const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, Math.max(1, leafy.length));
    const pine = new THREE.InstancedMesh(pineGeo, canopyMat, Math.max(1, pines.length));
    let li = 0;
    let pi = 0;
    allTrees.forEach(([x, y, isPine], i) => {
      const s = rng.range(0.8, 1.25);
      const ox = rng.range(-0.15, 0.15);
      const oz = rng.range(-0.15, 0.15);
      m4.compose(v.set(x + 0.5 + ox, 0.8 * s, y + 0.5 + oz), q.identity(), sc.set(s, s, s));
      trunk.setMatrixAt(i, m4);
      q.setFromEuler(new THREE.Euler(rng.range(0, 0.3), rng.range(0, Math.PI * 2), 0));
      if (isPine) {
        const ps = s * rng.range(0.6, 0.85);
        m4.compose(v.set(x + 0.5 + ox, 2.2 * ps, y + 0.5 + oz), q.setFromAxisAngle(v.set(0, 1, 0), rng.range(0, 6)), sc.set(ps * 0.95, ps * 1.1, ps * 0.95));
        m4.setPosition(x + 0.5 + ox, 2.4 * ps, y + 0.5 + oz);
        pine.setMatrixAt(pi, m4);
        pine.setColorAt(pi++, col.setHSL(0.3 + rng.range(-0.03, 0.03), 0.35, 0.16 + rng.range(-0.03, 0.03)));
      } else {
        const cs = s * rng.range(0.7, 0.95);
        m4.compose(v.set(x + 0.5 + ox, 1.7 * s + 0.45, y + 0.5 + oz), q, sc.set(cs, cs * 0.85, cs));
        canopy.setMatrixAt(li, m4);
        canopy.setColorAt(li++, col.setHSL(0.22 + rng.range(-0.05, 0.06), 0.4, 0.2 + rng.range(-0.04, 0.05)));
      }
    });
    canopy.count = leafy.length;
    pine.count = pines.length;
    trunk.castShadow = canopy.castShadow = pine.castShadow = shadows;
    group.add(trunk, canopy, pine);
  }

  // ── Cars: pair adjacent car tiles into one vehicle.
  const cars: { x: number; y: number; horiz: boolean }[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (map.get(x, y) !== Tile.Car) continue;
      if (map.get(x + 1, y) === Tile.Car && map.get(x - 1, y) !== Tile.Car) cars.push({ x: x + 1, y: y + 0.5, horiz: true });
      else if (map.get(x, y + 1) === Tile.Car && map.get(x, y - 1) !== Tile.Car) cars.push({ x: x + 0.5, y: y + 1, horiz: false });
    }
  if (cars.length) {
    const carMat = mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), roughness: 0.55, metalness: 0.35 }));
    const glassMat = mat(new THREE.MeshStandardMaterial({ color: 0x1c2428, roughness: 0.15, metalness: 0.6 }));
    const body = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.95, 0.62, 0.95)), carMat, cars.length);
    const cabin = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.05, 0.45, 0.85)), glassMat, cars.length);
    const carColors = [0x5b2a22, 0x2c3a4a, 0x4a4a3a, 0x6a6458, 0x2a3a2a, 0x7a5a2a];
    cars.forEach((c, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), (c.horiz ? 0 : Math.PI / 2) + rng.range(-0.08, 0.08));
      m4.compose(v.set(c.x, 0.45, c.y), q, sc.set(1, 1, 1));
      body.setMatrixAt(i, m4);
      body.setColorAt(i, col.setHex(rng.pick(carColors)));
      m4.compose(v.set(c.x, 0.98, c.y), q, sc.set(1, 1, 1));
      cabin.setMatrixAt(i, m4);
    });
    body.castShadow = cabin.castShadow = shadows;
    body.receiveShadow = shadows;
    group.add(body, cabin);
  }

  // ── Loot containers: one instanced unit box scaled per kind; colour dims once searched.
  const contMat = mat(new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  const containers = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 1, 1)), contMat, Math.max(1, map.containers.length + 64));
  containers.count = 0;
  const containerIndex = new Map<number, number>();
  for (const c of map.containers) addContainerInstance(containers, containerIndex, map, c);
  containers.castShadow = shadows;
  group.add(containers);

  // ── Extraction zones: glowing ring + soft beam (bloom picks these up).
  const extractionBeams: THREE.Mesh[] = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.85, toneMapped: false, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  materials.push(ringMat, beamMat);
  for (const e of map.extractions) {
    const ring = new THREE.Mesh(geo(new THREE.RingGeometry(e.radius - 0.12, e.radius, 48)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(e.x, 0.03, e.y);
    const beam = new THREE.Mesh(geo(new THREE.CylinderGeometry(e.radius * 0.9, e.radius, 6, 32, 1, true)), beamMat);
    beam.position.set(e.x, 3, e.y);
    group.add(ring, beam);
    extractionBeams.push(beam);
  }

  return {
    group,
    containers,
    containerIndex,
    extractionBeams,
    materials,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

export function addContainerInstance(mesh: THREE.InstancedMesh, index: Map<number, number>, map: GameMap, c: LootContainer): void {
  if (index.has(c.id) || mesh.count >= mesh.instanceMatrix.count) return;
  const s = CONTAINER_SHAPE[c.kind];
  // Hug the nearest wall.
  let ox = 0;
  let oz = 0;
  if (map.isSolid(c.x - 1, c.y)) ox = -(0.5 - s.d / 2 - 0.02);
  else if (map.isSolid(c.x + 1, c.y)) ox = 0.5 - s.d / 2 - 0.02;
  else if (map.isSolid(c.x, c.y - 1)) oz = -(0.5 - s.d / 2 - 0.02);
  else if (map.isSolid(c.x, c.y + 1)) oz = 0.5 - s.d / 2 - 0.02;
  const alongZ = ox !== 0;
  tmpM.makeScale(alongZ ? s.d : s.w, s.h, alongZ ? s.w : s.d);
  tmpM.setPosition(c.x + 0.5 + ox, s.h / 2, c.y + 0.5 + oz);
  const i = mesh.count++;
  mesh.setMatrixAt(i, tmpM);
  mesh.setColorAt(i, tmpC.setHex(s.color));
  index.set(c.id, i);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function markContainerSearched(mesh: THREE.InstancedMesh, index: Map<number, number>, c: LootContainer): void {
  const i = index.get(c.id);
  if (i === undefined) return;
  mesh.setColorAt(i, tmpC.setHex(CONTAINER_SHAPE[c.kind].color).multiplyScalar(0.45));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
