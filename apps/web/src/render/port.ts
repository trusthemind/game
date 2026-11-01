import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tile, type GameMap, type Structure } from '@ashfall/engine';
import { getTexture } from './textures';

type Mat = <M extends THREE.Material>(m: M, occlude?: 'wall' | 'canopy' | 'tall', fow?: boolean) => M;
type Geo = <G extends THREE.BufferGeometry>(g: G) => G;

/** Sea level below the ground: the quay wall shows between the two. */
export const WATER_Y = -0.45;

/** Shipping-line colours, bright enough to read through the metal texture: rust, blue, green, grey, orange, red, teal. */
const STACK_COLORS = [0xc4522f, 0x3478b4, 0x5a9a50, 0xb4b4aa, 0xe08a34, 0xb23c30, 0x3a9a94];

/**
 * The water, the quay walls round it, rail track, container stacks, quay cranes and moored ships — everything a
 * port has that the tiles alone don't draw (world.ts adds these to the world group).
 */
export function harbourPieces(map: GameMap, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const water = waterAndQuay(map, mat, geo);
  if (water) out.push(...water);
  const rail = railTrack(map, mat, geo, shadows);
  if (rail) out.push(rail);
  const stacks = map.structures.filter((s) => s.kind === 'stack');
  if (stacks.length) out.push(containerStacks(stacks, mat, geo, shadows));
  for (const s of map.structures) {
    if (s.kind === 'crane') out.push(crane(s, mat, geo, shadows));
    if (s.kind === 'ship') out.push(ship(s, mat, geo, shadows));
  }
  return out;
}

/** Water tiles as one sheet below the ground, and a concrete face wherever land meets water. */
function waterAndQuay(map: GameMap, mat: Mat, geo: Geo): THREE.Object3D[] | null {
  const sea: number[] = [];
  const faces: number[] = [];
  const isWater = (x: number, y: number) => map.get(x, y) === Tile.Water;
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (!isWater(x, y)) continue;
      sea.push(x, y, x + 1, y, x + 1, y + 1, x, y + 1);
      // A wall face on each side where the neighbour is land (x0,z0 → x1,z1 along the edge).
      if (!isWater(x, y - 1)) faces.push(x, y, x + 1, y);
      if (!isWater(x, y + 1)) faces.push(x + 1, y + 1, x, y + 1);
      if (!isWater(x - 1, y)) faces.push(x, y + 1, x, y);
      if (!isWater(x + 1, y)) faces.push(x + 1, y, x + 1, y + 1);
    }
  if (!sea.length) return null;
  const quads = (pts: number[], y0: number, vertical: boolean, uvScale = 0) => {
    const n = vertical ? pts.length / 4 : pts.length / 8;
    const pos = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      if (vertical) {
        const [x0, z0, x1, z1] = pts.slice(i * 4, i * 4 + 4) as [number, number, number, number];
        pos.set([x0, 0, z0, x1, 0, z1, x1, y0, z1, x0, y0, z0], i * 12);
      } else
        for (let k = 0; k < 4; k++) {
          pos.set([pts[i * 8 + k * 2]!, y0, pts[i * 8 + k * 2 + 1]!], i * 12 + k * 3);
          uv.set([pts[i * 8 + k * 2]! * uvScale, pts[i * 8 + k * 2 + 1]! * uvScale], i * 8 + k * 2);
        }
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  };
  // The sea: still, rippled blue-green with a sheen.
  const sheet = new THREE.Mesh(quads(sea, WATER_Y, false, 0.12), mat(new THREE.MeshStandardMaterial({ map: getTexture('water'), roughness: 0.18, metalness: 0.05 })));
  const wall = new THREE.Mesh(
    quads(faces, WATER_Y - 0.4, true),
    mat(new THREE.MeshStandardMaterial({ map: getTexture('concrete'), color: 0x8a8a84, roughness: 0.9, side: THREE.DoubleSide })),
  );
  sheet.receiveShadow = true;
  sheet.matrixAutoUpdate = wall.matrixAutoUpdate = false;
  return [sheet, wall, ...quayEdge(faces, mat, geo)];
}

/**
 * What tells a quay from a cliff: white foam where the water laps the wall, a yellow safety line on the
 * paving a little back from the edge, and mooring bollards every few metres.
 */
function quayEdge(faces: number[], mat: Mat, geo: Geo): THREE.Object3D[] {
  const foam: number[] = [];
  const line: number[] = [];
  const bollards: [number, number][] = [];
  const strip = (out: number[], x0: number, z0: number, x1: number, z1: number, from: number, to: number) => {
    // Edge x0,z0 → x1,z1 as faces were recorded; (−dz, dx) points into the water.
    const dx = x1 - x0;
    const dz = z1 - z0;
    const nx = -dz;
    const nz = dx;
    out.push(x0 + nx * from, z0 + nz * from, x1 + nx * from, z1 + nz * from, x1 + nx * to, z1 + nz * to, x0 + nx * to, z0 + nz * to);
  };
  for (let i = 0; i < faces.length; i += 4) {
    const [x0, z0, x1, z1] = faces.slice(i, i + 4) as [number, number, number, number];
    strip(foam, x0, z0, x1, z1, 0, 0.7);
    strip(line, x0, z0, x1, z1, -0.75, -0.6);
    // On the paving, half a metre back from the edge (against the inward normal).
    if ((Math.round(x0) * 7 + Math.round(z0) * 13) % 6 === 0) bollards.push([(x0 + x1) / 2 + (z1 - z0) * 0.45, (z0 + z1) / 2 - (x1 - x0) * 0.45]);
  }
  const sheet = (pts: number[], y: number, m: THREE.Material) => {
    const n = pts.length / 8;
    const pos = new Float32Array(n * 12);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) pos.set([pts[i * 8 + k * 2]!, y, pts[i * 8 + k * 2 + 1]!], i * 12 + k * 3);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  const out: THREE.Object3D[] = [
    sheet(foam, WATER_Y + 0.02, mat(new THREE.MeshStandardMaterial({ color: 0xe8f0f0, roughness: 0.6, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }))),
    sheet(line, 0.012, mat(new THREE.MeshStandardMaterial({ color: 0xd8b030, roughness: 0.8, side: THREE.DoubleSide }))),
  ];
  if (bollards.length) {
    const inst = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 10)), mat(new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.6 })), bollards.length);
    const m = new THREE.Matrix4();
    bollards.forEach(([x, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, 0.25, z)));
    inst.castShadow = true;
    out.push(inst);
  }
  return out;
}

/** Rails and sleepers on every two-tile-wide run of rail tiles along x. */
function railTrack(map: GameMap, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D | null {
  const runs: [number, number, number][] = [];
  for (let y = 1; y < map.height - 1; y++) {
    let start = -1;
    for (let x = 0; x <= map.width; x++) {
      const on = x < map.width && map.get(x, y) === Tile.Rail && map.get(x, y + 1) === Tile.Rail && map.get(x, y - 1) !== Tile.Rail;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push([start, x, y]);
        start = -1;
      }
    }
  }
  if (!runs.length) return null;
  const g = new THREE.Group();
  const steel = mat(new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.4, metalness: 0.8 }));
  const wood = mat(new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 0.95 }));
  const sleepers: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (const [x0, x1, y] of runs) {
    for (const off of [0.24, 1.76]) {
      const r = new THREE.Mesh(geo(new THREE.BoxGeometry(x1 - x0, 0.12, 0.08)), steel);
      r.position.set((x0 + x1) / 2, 0.16, y + off);
      r.castShadow = shadows;
      g.add(r);
    }
    for (let x = x0 + 0.3; x < x1; x += 0.65) sleepers.push(m.clone().makeTranslation(x, 0.05, y + 1));
  }
  const inst = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.24, 0.1, 2.5)), wood, sleepers.length);
  sleepers.forEach((s, i) => inst.setMatrixAt(i, s));
  inst.receiveShadow = shadows;
  g.add(inst);
  return g;
}

/** Shipping containers: one instanced box per level of every stack, corrugated steel in shipping-line colours. */
function containerStacks(stacks: Structure[], mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const levels = stacks.reduce((n, s) => n + (s.levels ?? 1), 0);
  const material = mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), roughness: 0.6, metalness: 0.3 }), 'wall');
  const inst = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 1, 1)), material, levels);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  let i = 0;
  for (const s of stacks)
    for (let l = 0; l < (s.levels ?? 1); l++) {
      m.compose(new THREE.Vector3(s.x + s.w / 2, 1.3 + l * 2.6, s.y + s.h / 2), q, new THREE.Vector3(s.w - 0.12, 2.55, s.h - 0.2));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.setHex(STACK_COLORS[((s.color ?? 0) + l * 3) % STACK_COLORS.length]!));
      i++;
    }
  inst.castShadow = shadows;
  inst.receiveShadow = shadows;
  return inst;
}

/**
 * A quay gantry crane: four legs straddling the crane rails, a portal frame on top, the boom out over the water
 * and the counterweight girder back over the quay, a trolley and the machinery house. Low enough for the raid
 * camera; everything above head height thins out round the player.
 */
function crane(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const paint = mat(new THREE.MeshStandardMaterial({ color: 0xb8502a, roughness: 0.6, metalness: 0.4 }), 'tall');
  const top = paint;
  const house = mat(new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7 }), 'tall');
  const H = 7.5;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    b.position.set(x, y, z);
    b.castShadow = shadows;
    g.add(b);
  };
  const [x0, x1, z0, z1] = [s.x + 0.5, s.x + s.w - 0.5, s.y + 0.5, s.y + s.h - 0.5];
  for (const x of [x0, x1]) for (const z of [z0, z1]) box(0.8, H, 0.8, x, H / 2, z, paint);
  // Sill beams low down along the rails, the portal along the top.
  for (const x of [x0, x1]) {
    box(0.6, 0.6, z1 - z0, x, 1.2, (z0 + z1) / 2, paint);
    box(0.9, 1.0, z1 - z0 + 0.8, x, H, (z0 + z1) / 2, top);
  }
  for (const z of [z0, z1]) box(x1 - x0 + 0.8, 1.0, 0.9, (x0 + x1) / 2, H, z, top);
  // Boom over the water (+z) and the back girder over the quay, the trolley and the machinery house.
  const reach = 20;
  const back = 7;
  for (const x of [x0 + 2, x1 - 2]) box(0.7, 1.2, z1 - z0 + reach + back, x, H + 1.1, (z0 - back + z1 + reach) / 2, top);
  box(x1 - x0 - 3, 0.5, 2.5, (x0 + x1) / 2, H + 1.6, z1 + reach * 0.55, top);
  box(x1 - x0 - 2, 2.2, 4, (x0 + x1) / 2, H + 2.3, z0 - back + 2.5, house);
  return g;
}

/**
 * A moored cargo ship: hull with a pointed bow towards +x, red below the waterline, the bridge house at the stern
 * and rows of containers on deck. Its upper works fade over the player like roofs.
 */
function ship(s: Structure, mat: Mat, geo: Geo, shadows: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const len = s.w;
  const beam = s.h;
  const hullShape = (inset: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(inset, -inset);
    sh.lineTo(len - beam * 0.9, -inset);
    sh.quadraticCurveTo(len - inset, -inset, len - inset, -beam / 2);
    sh.quadraticCurveTo(len - inset, -beam + inset, len - beam * 0.9, -beam + inset);
    sh.lineTo(inset + 1.5, -beam + inset);
    sh.quadraticCurveTo(inset, -beam + inset, inset, -beam + 1.5 + inset);
    sh.lineTo(inset, -inset);
    return sh;
  };
  // Extruded upwards: shape y → −z, extrusion → +y (so the hull lies from z = 0 to `beam`).
  const extrude = (inset: number, depth: number) => geo(new THREE.ExtrudeGeometry(hullShape(inset), { depth, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2));
  const red = new THREE.Mesh(extrude(0.15, 1.1), mat(new THREE.MeshStandardMaterial({ color: 0x6a2420, roughness: 0.8 })));
  red.position.y = -1.0;
  const hull = new THREE.Mesh(extrude(0, 3.4), mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), color: 0x2b3b4a, roughness: 0.65, metalness: 0.3 })));
  hull.position.y = 0.1;
  const deck = new THREE.Mesh(extrude(0.6, 0.05), mat(new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 })));
  deck.position.y = 3.45;
  for (const m of [red, hull, deck]) {
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    g.add(m);
  }
  const upper = mat(new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.7 }), 'tall');
  const glass = mat(new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.2, metalness: 0.5 }), 'tall');
  const bridge = new THREE.Mesh(geo(new THREE.BoxGeometry(9, 6, beam - 2)), upper);
  bridge.position.set(6.5, 6.5, beam / 2);
  const windows = new THREE.Mesh(geo(new THREE.BoxGeometry(0.2, 1.1, beam - 2.4)), glass);
  windows.position.set(11.05, 8.4, beam / 2);
  const funnel = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.1, 1.3, 3, 12)), mat(new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.6 }), 'tall'));
  funnel.position.set(3.5, 10.5, beam / 2);
  for (const m of [bridge, windows, funnel]) {
    m.castShadow = shadows;
    g.add(m);
  }
  // Deck cargo: 20-footers across the beam, a few bays along the length, one or two high.
  const cargo: THREE.BufferGeometry[] = [];
  const colors: number[] = [];
  let k = 0;
  for (let x = 14; x + 6.2 < len - beam * 0.8; x += 6.6)
    for (let z = 1.2; z + 2.5 < beam - 1; z += 2.6) {
      const hgt = 1 + ((k * 7) % 3 === 0 ? 1 : 0);
      for (let l = 0; l < hgt; l++) {
        const b = new THREE.BoxGeometry(6.0, 2.5, 2.4);
        b.translate(x + 3, 4.75 + l * 2.6, z + 1.2);
        cargo.push(b);
        colors.push(STACK_COLORS[(k + l * 2) % STACK_COLORS.length]!);
      }
      k++;
    }
  if (cargo.length) {
    const c = new THREE.Color();
    for (let i = 0; i < cargo.length; i++) {
      const n = cargo[i]!.attributes.position!.count;
      const col = new Float32Array(n * 3);
      c.setHex(colors[i]!);
      for (let v = 0; v < n; v++) col.set([c.r, c.g, c.b], v * 3);
      cargo[i]!.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const merged = geo(mergeGeometries(cargo)!);
    cargo.forEach((b) => b.dispose());
    const m = new THREE.Mesh(merged, mat(new THREE.MeshStandardMaterial({ map: getTexture('metal'), vertexColors: true, roughness: 0.6, metalness: 0.3 }), 'tall'));
    m.castShadow = shadows;
    g.add(m);
  }
  g.position.set(s.x, 0, s.y);
  return g;
}
