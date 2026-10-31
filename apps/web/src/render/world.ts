import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, Tile, solidBoxes, type Box, type GameMap, type LootContainer, type ContainerKind } from '@ashfall/engine';
import { getTexture, type TexKind } from './textures';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import type { AssetLibrary } from './assets';
import { droppedJacket, jacketFabric, JACKET_COLORS, JACKET_VARIANTS } from './jacket3d';

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
  modbox: { w: 0.8, h: 0.45, d: 0.5, color: 0x3d4a32 },
  airdrop: { w: 0.05, h: 0.05, d: 0.05, color: 0x4c5a3a },
  helicrate: { w: 0.9, h: 0.6, d: 0.7, color: 0x434b3a },
  ground: { w: 0.5, h: 0.1, d: 0.5, color: 0x55503f },
};

/** Containers drawn with a furniture model instead of a box. */
const CONTAINER_MODEL: Partial<Record<ContainerKind, string>> = { wardrobe: 'wardrobe_old', fridge: 'fridge_old', drawer: 'dresser', shelf: 'bookcase_empty' };

export interface WorldMeshes {
  group: THREE.Group;
  containers: THREE.InstancedMesh;
  /** Container index −1 = drawn as a furniture model: these are its instance slots. */
  containerIndex: Map<number, number>;
  containerModels: Map<number, [THREE.InstancedMesh, number][]>;
  extractionBeams: THREE.Mesh[];
  /** Hide the pane of a smashed window (map tile index). */
  breakGlass(idx: number): void;
  materials: THREE.Material[];
  dispose(): void;
}

/**
 * Builds the static world. Everything that repeats is an InstancedMesh or a merged geometry, so the whole
 * town costs a few dozen draw calls regardless of size.
 */
export function buildWorld(map: GameMap, u: WorldUniforms, shadows: boolean, lib: AssetLibrary | null): WorldMeshes {
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
      // Border forest: sparse, the dark outer ground + fog of war sells the density. It opens where an
      // extraction leads out, so the road, trail or pier carries on past the edge.
      else if (t === Tile.Border && (x * 7 + y * 13) % 5 === 0 && !inExitGap(x + 0.5, y + 0.5)) border.push([x, y]);
    }
    function inExitGap(x: number, y: number): boolean {
      return map.extractions.some((e) => {
        const along = (x - e.x) * Math.cos(e.dir) + (y - e.y) * Math.sin(e.dir);
        const across = (x - e.x) * Math.sin(e.dir) - (y - e.y) * Math.cos(e.dir);
        return along > 4 && along < 14 && Math.abs(across) < 10;
      });
    }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();

  // Thin walls (32 cm) built from the same boxes the collision uses: a pillar per tile + arms to neighbours.
  const boxes: Box[] = [];
  type Piece = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; b: number };
  const wallPieces: Piece[] = [];
  const glassPieces: { x: number; z: number; horiz: boolean; idx: number }[] = [];
  let glassMesh: THREE.InstancedMesh | null = null;
  const glassIndex = new Map<number, number>();
  const pushPieces = (x: number, y: number, y0: number, y1: number) => {
    const b = map.buildingAt[map.idx(x, y)]!;
    for (const [bx0, by0, bx1, by1] of solidBoxes(map, x, y, boxes)) wallPieces.push({ x0: bx0, z0: by0, x1: bx1, z1: by1, y0, y1, b });
  };
  for (const [x, y] of walls) pushPieces(x, y, 0, WALL_H);
  for (const [x, y, horiz] of windows) {
    pushPieces(x, y, 0, 0.85);
    pushPieces(x, y, WALL_H - 0.35, WALL_H);
    glassPieces.push({ x: x + 0.5, z: y + 0.5, horiz, idx: map.idx(x, y) });
  }
  // Walls are static: one merged mesh with world-scaled UVs (no stretched texture) and per-building vertex colour.
  const wallMat = mat(new THREE.MeshStandardMaterial({ map: getTexture('plaster'), roughness: 0.95, vertexColors: true }), 'wall');
  const capMat = mat(new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.9 }), 'wall');
  const unitBox = geo(new THREE.BoxGeometry(1, 1, 1));
  const caps = new THREE.InstancedMesh(unitBox, capMat, Math.max(1, wallPieces.length));
  const palette = [0xb8b0a0, 0xa9a89c, 0xc2b49c, 0x9ea295, 0xb6a58e, 0xa4ada8, 0x9c8d7c, 0xb7aa96];
  const TEX_M = 1 / 2.2; // one texture repeat per 2.2 m
  const wallGeos: THREE.BufferGeometry[] = [];
  let capCount = 0;
  for (const pc of wallPieces) {
    const w = pc.x1 - pc.x0;
    const d = pc.z1 - pc.z0;
    const h = pc.y1 - pc.y0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z — 4 vertices each.
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const off = (pc.x0 + pc.z0) * TEX_M;
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f]!;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, off + uv.getX(i) * du * TEX_M, (pc.y0 + uv.getY(i) * h) * TEX_M * (f === 2 || f === 3 ? 0 : 1) + (f === 2 || f === 3 ? uv.getY(i) * dv * TEX_M : 0));
      }
    }
    g.translate((pc.x0 + pc.x1) / 2, pc.y0 + h / 2, (pc.z0 + pc.z1) / 2);
    const bld = map.buildings[pc.b - 1];
    col.setHex(palette[(bld?.id ?? 0) % palette.length]!).offsetHSL(0, 0, rng.range(-0.02, 0.02));
    if (bld?.kind === 'warehouse' || bld?.kind === 'military') col.setHex(bld.kind === 'military' ? 0x7d8270 : 0x8a7f74);
    const colors = new Float32Array(g.attributes.position!.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([col.r, col.g, col.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    wallGeos.push(g);
    // Dark top cap so wall lines read clearly from the top-down camera.
    if (pc.y1 >= WALL_H - 0.01) {
      m4.makeScale(w + 0.02, 0.05, d + 0.02).setPosition((pc.x0 + pc.x1) / 2, WALL_H + 0.02, (pc.z0 + pc.z1) / 2);
      caps.setMatrixAt(capCount++, m4);
    }
  }
  caps.count = capCount;
  if (wallGeos.length) {
    const merged = geo(mergeGeometries(wallGeos));
    for (const g of wallGeos) g.dispose();
    const wallMesh = new THREE.Mesh(merged, wallMat);
    wallMesh.castShadow = wallMesh.receiveShadow = shadows;
    group.add(wallMesh);
  }
  group.add(caps);

  if (glassPieces.length) {
    const glassMat = mat(new THREE.MeshStandardMaterial({ color: 0x9fc3d6, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false }), 'wall');
    const glass = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 0.9, 0.04)), glassMat, glassPieces.length);
    glassPieces.forEach((gp, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), gp.horiz ? 0 : Math.PI / 2);
      m4.compose(v.set(gp.x, 1.3, gp.z), q, sc.set(1, 1, 1));
      glass.setMatrixAt(i, m4);
      glassIndex.set(gp.idx, i);
    });
    group.add(glass);
    glassMesh = glass;
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

  // ── Trees: Stylized Nature MegaKit models, instanced per sub-mesh (a forest is a handful of draw calls).
  const allTrees = [...trees.map((t) => [...t, 0] as const), ...border.map((t) => [...t, 1] as const)];
  if (allTrees.length && lib) {
    const leafyKinds = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'TwistedTree_1', 'DeadTree_1', 'Bush_Common'];
    const pineKinds = ['Pine_1', 'Pine_2', 'Pine_3'];
    // Bucket by model *and* 16×16-tile chunk so each InstancedMesh has a tight bounding sphere and
    // whole chunks get frustum-culled (main and shadow passes).
    const CHUNK = 16;
    const buckets = new Map<string, THREE.Matrix4[]>();
    for (const [x, y, isPine] of allTrees) {
      const kind = isPine ? rng.pick(pineKinds) : rng.weighted(leafyKinds.map((k) => [k, k.startsWith('Common') ? 3 : k === 'Bush_Common' ? 1.5 : 1] as const));
      const h = isPine ? rng.range(4.2, 6) : kind === 'Bush_Common' ? rng.range(0.8, 1.2) : rng.range(3.2, 4.6);
      const t = new THREE.Matrix4().compose(
        new THREE.Vector3(x + 0.5 + rng.range(-0.2, 0.2), 0, y + 0.5 + rng.range(-0.2, 0.2)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2)),
        new THREE.Vector3(h, h, h),
      );
      const bucketKey = `${kind}|${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
      let b = buckets.get(bucketKey);
      if (!b) buckets.set(bucketKey, (b = []));
      b.push(t);
    }
    const sharedMats = new Map<THREE.Material, THREE.Material>();
    for (const [bucketKey, transforms] of buckets) {
      const kind = bucketKey.split('|')[0]!;
      const src = lib.nature.get(kind);
      if (!src) continue;
      src.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(src);
      const unit = 1 / Math.max(0.001, box.max.y - box.min.y);
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const local = new THREE.Matrix4().makeScale(unit, unit, unit).multiply(mesh.matrixWorld);
        const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m0) => {
          const shared = sharedMats.get(m0);
          if (shared) return shared;
          const m = (m0 as THREE.MeshStandardMaterial).clone();
          sharedMats.set(m0, m);
          const leaves = /leaf|leaves/i.test(m.name) || !!m.alphaMap || m.transparent;
          if (leaves) {
            m.alphaTest = 0.5;
            m.transparent = false;
            m.side = THREE.DoubleSide;
            // The twisted-tree leaf texture is hot pink: borrow the green leaf atlas and tint it autumn ochre.
            if (/twisted/i.test(m.name)) {
              const green = findMaterial(lib, /Leaves_NormalTree/);
              if (green?.map) m.map = green.map;
              m.color.setRGB(1.0, 0.72, 0.32);
            }
          }
          return mat(m, leaves ? 'canopy' : undefined);
        });
        materials.forEach((m, i) => sharedMats.set((Array.isArray(mesh.material) ? mesh.material : [mesh.material])[i]!, m));
        const inst = new THREE.InstancedMesh(mesh.geometry, materials.length === 1 ? materials[0]! : materials, transforms.length);
        transforms.forEach((t, i) => inst.setMatrixAt(i, m4.multiplyMatrices(t, local)));
        inst.castShadow = shadows;
        inst.receiveShadow = shadows;
        inst.computeBoundingSphere();
        group.add(inst);
      });
    }
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

  // ── Loot containers: one instanced unit box scaled per kind; colour dims once searched. Wardrobes,
  // drawers and shelves use the furniture models instead (see below).
  const contMat = mat(new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  const containers = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 1, 1)), contMat, Math.max(1, map.containers.length + 64));
  containers.count = 0;
  const containerIndex = new Map<number, number>();
  const containerModels = new Map<number, [THREE.InstancedMesh, number][]>();
  const modelled = lib?.furniture.size ? map.containers.filter((c) => CONTAINER_MODEL[c.kind] && lib.furniture.has(CONTAINER_MODEL[c.kind]!)) : [];
  for (const c of modelled) containerIndex.set(c.id, -1);
  const jackets = map.containers.filter((c) => c.kind === 'jacket');
  for (const c of jackets) containerIndex.set(c.id, -1);
  for (const c of map.containers) addContainerInstance(containers, containerIndex, map, c);
  containers.castShadow = shadows;
  group.add(containers);

  // ── Jackets dropped on the floor: a procedural garment, collar to the wall, each one its own colour.
  if (jackets.length) {
    const jacketMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
    materials.push(patchWorldMaterial(jacketMat, u, { pre: jacketFabric, key: 'jacket' }));
    const meshes = JACKET_VARIANTS.map((v) => {
      const inst = new THREE.InstancedMesh(droppedJacket(v), jacketMat, jackets.length);
      inst.count = 0;
      inst.castShadow = shadows;
      inst.receiveShadow = shadows;
      return inst;
    });
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of jackets) {
      const r = new Rng(c.id * 2654435761);
      const [dx, dy] = map.isSolid(c.x - 1, c.y) ? [-1, 0] : map.isSolid(c.x + 1, c.y) ? [1, 0] : map.isSolid(c.x, c.y - 1) ? [0, -1] : map.isSolid(c.x, c.y + 1) ? [0, 1] : [0, -1];
      // Model collar faces −Z: turn it towards the wall, then let it fall a little askew.
      const yaw = Math.atan2(-dx, -dy) + Math.PI + r.range(-0.45, 0.45);
      const off = 0.08 + r.range(0, 0.06);
      const inst = meshes[r.int(0, meshes.length - 1)]!;
      const i = inst.count++;
      inst.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x + 0.5 + dx * off, 0.004, c.y + 0.5 + dy * off), new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1)));
      inst.setColorAt(i, tmpC.setHex(r.pick(JACKET_COLORS)));
      containerModels.set(c.id, [[inst, i]]);
    }
    for (const inst of meshes) {
      if (!inst.count) continue;
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }

  // ── Furniture (+ furniture-shaped containers): one InstancedMesh per material per model and 32×32
  // chunk, so it culls with the camera. Models face +Z with their back at −Z.
  if (lib && lib.furniture.size) {
    const CHUNK = 32;
    const buckets = new Map<string, { t: THREE.Matrix4; container?: number }[]>();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (kind: string, x: number, y: number, dir: number, container?: number) => {
      // rotation.y = θ turns +Z towards (sin θ, cos θ) in (x, z) = world (x, y).
      const t = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, y), new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(Math.cos(dir), Math.sin(dir))), new THREE.Vector3(1, 1, 1));
      const key = `${kind}|${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push({ t, container });
    };
    for (const f of map.furniture) place(f.kind, f.x, f.y, f.dir);
    const depthOf = new Map<string, number>();
    for (const c of modelled) {
      const kind = CONTAINER_MODEL[c.kind]!;
      let d = depthOf.get(kind);
      if (d === undefined) depthOf.set(kind, (d = new THREE.Box3().setFromObject(lib.furniture.get(kind)!).getSize(new THREE.Vector3()).z));
      // Back against the wall face (the wall pillar is 0.32 m thick, centred on its tile).
      const off = 0.5 + 0.34 - d / 2;
      const [dx, dy] = map.isSolid(c.x - 1, c.y) ? [-1, 0] : map.isSolid(c.x + 1, c.y) ? [1, 0] : map.isSolid(c.x, c.y - 1) ? [0, -1] : map.isSolid(c.x, c.y + 1) ? [0, 1] : [0, -1];
      place(kind, c.x + 0.5 + dx * off, c.y + 0.5 + dy * off, Math.atan2(-dy, -dx), c.id);
    }
    const shared = new Map<THREE.Material, THREE.Material>();
    for (const [key, items] of buckets) {
      const src = lib.furniture.get(key.split('|')[0]!);
      if (!src) continue;
      src.updateMatrixWorld(true);
      const hasContainers = items.some((it) => it.container !== undefined);
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const materials = list.map((m0) => {
          let m = shared.get(m0);
          if (!m) shared.set(m0, (m = mat((m0 as THREE.MeshStandardMaterial).clone())));
          return m;
        });
        const inst = new THREE.InstancedMesh(mesh.geometry, materials.length === 1 ? materials[0]! : materials, items.length);
        items.forEach((it, i) => {
          inst.setMatrixAt(i, m4.multiplyMatrices(it.t, mesh.matrixWorld));
          if (hasContainers) inst.setColorAt(i, tmpC.setRGB(1, 1, 1));
          if (it.container === undefined) return;
          let slots = containerModels.get(it.container);
          if (!slots) containerModels.set(it.container, (slots = []));
          slots.push([inst, i]);
        });
        inst.castShadow = shadows;
        inst.receiveShadow = shadows;
        inst.computeBoundingSphere();
        group.add(inst);
      });
    }
  }

  // ── Extraction zones: glowing ring + soft beam (bloom picks these up).
  const extractionBeams: THREE.Mesh[] = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.85, toneMapped: false, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  materials.push(ringMat, beamMat);
  for (const e of map.extractions) {
    const ring = new THREE.Mesh(geo(new THREE.RingGeometry(e.radius - 0.12, e.radius, 48)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(e.x, 0.03, e.y);
    // A low glow: the place itself (barrier, gate, pier…) now says what it is, the beam only marks the spot.
    const beam = new THREE.Mesh(geo(new THREE.CylinderGeometry(e.radius * 0.95, e.radius, 1.6, 32, 1, true)), beamMat);
    beam.position.set(e.x, 0.8, e.y);
    group.add(ring, beam);
    extractionBeams.push(beam);
  }

  return {
    group,
    containers,
    containerIndex,
    containerModels,
    extractionBeams,
    materials,
    breakGlass(idx) {
      const i = glassIndex.get(idx);
      if (!glassMesh || i === undefined) return;
      glassMesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
      glassMesh.instanceMatrix.needsUpdate = true;
    },
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

export function markContainerSearched(world: WorldMeshes, c: LootContainer): void {
  const { containers: mesh, containerIndex: index } = world;
  const i = index.get(c.id);
  if (i === undefined) return;
  if (i < 0) {
    for (const [inst, k] of world.containerModels.get(c.id) ?? []) {
      if (inst.instanceColor) inst.getColorAt(k, tmpC);
      else tmpC.setScalar(1);
      inst.setColorAt(k, tmpC.multiplyScalar(0.5));
      inst.instanceColor!.needsUpdate = true;
    }
    return;
  }
  mesh.setColorAt(i, tmpC.setHex(CONTAINER_SHAPE[c.kind].color).multiplyScalar(0.45));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function findMaterial(lib: AssetLibrary, re: RegExp): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  for (const obj of lib.nature.values()) {
    obj.traverse((o) => {
      const mm = (o as THREE.Mesh).material;
      if (!mm || found) return;
      for (const m of Array.isArray(mm) ? mm : [mm]) if (re.test(m.name)) found = m as THREE.MeshStandardMaterial;
    });
    if (found) break;
  }
  return found;
}
