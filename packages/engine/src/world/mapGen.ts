import { Rng } from '../core/rng';
import { createGrid } from '../items/inventory';
import { GameMap, type Building, type BuildingKind, type ContainerKind, type Rect, type BotArchetype } from './map';
import { Tile } from './tiles';

export interface MapGenOptions {
  size?: number;
  /** Bot density multiplier (tests use 0 for an empty map). */
  botDensity?: number;
}

const ROOM_CONTAINERS: Record<BuildingKind, readonly (readonly [ContainerKind, number])[]> = {
  house: [['wardrobe', 4], ['fridge', 3], ['drawer', 5], ['jacket', 3], ['safe', 0.3]],
  shop: [['shelf', 6], ['register', 2], ['fridge', 2], ['crate', 1]],
  clinic: [['medcabinet', 6], ['drawer', 2], ['safe', 0.4]],
  warehouse: [['crate', 6], ['toolbox', 4], ['ammocrate', 1], ['jacket', 1]],
  military: [['weaponbox', 4], ['ammocrate', 4], ['crate', 2], ['safe', 1.2], ['medcabinet', 1]],
};

const KIND_TIER: Record<BuildingKind, number> = { house: 0, shop: 0, clinic: 1, warehouse: 1, military: 3 };

const EXTRACT_NAMES = ['Old Gas Station', 'Rail Bridge', 'Collapsed Tunnel', 'Smugglers Boat', 'Checkpoint ZB-013', 'Forest Path', 'Cargo Gate'];

/**
 * Procedural town generator.
 * Roads split the map into blocks → each block gets lots → each lot gets a building (BSP-divided rooms)
 * or a park. The single biggest lot becomes the military compound where the boss lives.
 */
export function generateMap(seed: number, opts: MapGenOptions = {}): GameMap {
  const size = opts.size ?? 112;
  const density = opts.botDensity ?? 1;
  const rng = new Rng(seed);
  const map = new GameMap(size, size, seed);
  map.tiles.fill(Tile.Grass);

  // Border: impassable treeline.
  for (let i = 0; i < size; i++) {
    for (let b = 0; b < 2; b++) {
      map.set(i, b, Tile.Border);
      map.set(i, size - 1 - b, Tile.Border);
      map.set(b, i, Tile.Border);
      map.set(size - 1 - b, i, Tile.Border);
    }
  }

  // Roads.
  const roadsX = roadLines(rng, size);
  const roadsY = roadLines(rng, size);
  for (const rx of roadsX) for (let y = 2; y < size - 2; y++) for (let d = 0; d < 3; d++) map.set(rx + d, y, Tile.Road);
  for (const ry of roadsY) for (let x = 2; x < size - 2; x++) for (let d = 0; d < 3; d++) map.set(x, ry + d, Tile.Road);

  // Blocks between roads.
  const xs = [2, ...roadsX.flatMap((r) => [r, r + 3]), size - 2];
  const ys = [2, ...roadsY.flatMap((r) => [r, r + 3]), size - 2];
  const blocks: Rect[] = [];
  for (let i = 0; i < xs.length; i += 2)
    for (let j = 0; j < ys.length; j += 2) blocks.push({ x: xs[i]! + 1, y: ys[j]! + 1, w: xs[i + 1]! - xs[i]! - 2, h: ys[j + 1]! - ys[j]! - 2 });

  const lots: Rect[] = [];
  for (const b of blocks) splitLots(b, rng, lots);
  lots.sort((a, b) => b.w * b.h - a.w * a.h);

  let buildingId = 0;
  lots.forEach((lot, i) => {
    if (lot.w < 7 || lot.h < 7) return void decorateLot(map, lot, rng);
    const kind: BuildingKind =
      i === 0 ? 'military' : rng.weighted([['house', 6], ['shop', 2], ['warehouse', 2], ['clinic', 1.2]] as const);
    if (kind !== 'military' && rng.chance(0.15)) return void decorateLot(map, lot, rng);
    const b = placeBuilding(map, lot, kind, buildingId++, rng);
    map.buildings.push(b);
  });

  scatterCars(map, rng, roadsX, roadsY);
  scatterTrees(map, rng);

  // Outdoor containers: car trunks next to cars + a few hidden stashes in the woods.
  let containerId = map.containers.length;
  for (let k = 0; k < 6; k++) {
    const p = randomTile(map, rng, (x, y) => map.get(x, y) === Tile.Grass && !map.isIndoors(x, y) && countSolidAround(map, x, y) >= 2);
    if (p) map.containers.push(makeContainer(containerId++, 'stash', p.x, p.y, 1));
  }

  // Spawns & extractions.
  const reachable = floodFill(map, findOpenTile(map, rng));
  const edgeTiles = (side: number) => {
    const out: { x: number; y: number }[] = [];
    for (let i = 4; i < size - 4; i++) {
      const p = [
        { x: i, y: 3 },
        { x: size - 4, y: i },
        { x: i, y: size - 4 },
        { x: 3, y: i },
      ][side]!;
      if (map.isWalkable(p.x, p.y) && reachable[map.idx(p.x, p.y)]) out.push(p);
    }
    return out;
  };
  const spawnSide = rng.int(0, 3);
  const spawnCandidates = edgeTiles(spawnSide);
  map.playerSpawn = rng.pick(spawnCandidates.length ? spawnCandidates : [findOpenTile(map, rng)]);

  const names = rng.shuffle([...EXTRACT_NAMES]);
  let extractId = 0;
  for (const side of [(spawnSide + 2) % 4, (spawnSide + 1) % 4, (spawnSide + 3) % 4]) {
    const c = edgeTiles(side);
    if (!c.length) continue;
    const p = rng.pick(c);
    map.extractions.push({ id: extractId++, name: names[extractId % names.length]!, x: p.x + 0.5, y: p.y + 0.5, radius: 2.2 });
  }

  // Drop anything unreachable from the player's spawn (walled-in containers etc.).
  const fromSpawn = floodFill(map, map.playerSpawn);
  map.containers = map.containers.filter((c) => fromSpawn[map.idx(c.x, c.y)] || neighbourReachable(map, fromSpawn, c.x, c.y));
  map.extractions = map.extractions.filter((e) => fromSpawn[map.idx(Math.floor(e.x), Math.floor(e.y))]);

  // POIs for patrols: room centres + road crossings.
  for (const b of map.buildings) for (const r of b.rooms) map.pois.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  for (const rx of roadsX) for (const ry of roadsY) map.pois.push({ x: rx + 1.5, y: ry + 1.5 });
  map.pois = map.pois.filter((p) => fromSpawn[map.idx(Math.floor(p.x), Math.floor(p.y))]);

  placeBots(map, rng, fromSpawn, density);
  return map;
}

function roadLines(rng: Rng, size: number): number[] {
  const n = size >= 96 ? 2 : 1;
  const out: number[] = [];
  const seg = (size - 8) / (n + 1);
  for (let i = 1; i <= n; i++) out.push(Math.round(4 + seg * i + rng.range(-seg * 0.18, seg * 0.18)));
  return out;
}

function splitLots(r: Rect, rng: Rng, out: Rect[]): void {
  const canSplitW = r.w >= 22;
  const canSplitH = r.h >= 22;
  if ((!canSplitW && !canSplitH) || (r.w < 30 && r.h < 30 && rng.chance(0.25))) {
    out.push(r);
    return;
  }
  const vertical = canSplitW && (!canSplitH || r.w > r.h || (r.w === r.h && rng.chance(0.5)));
  if (vertical) {
    const cut = Math.floor(r.w * rng.range(0.38, 0.62));
    splitLots({ x: r.x, y: r.y, w: cut - 1, h: r.h }, rng, out);
    splitLots({ x: r.x + cut + 1, y: r.y, w: r.w - cut - 1, h: r.h }, rng, out);
  } else {
    const cut = Math.floor(r.h * rng.range(0.38, 0.62));
    splitLots({ x: r.x, y: r.y, w: r.w, h: cut - 1 }, rng, out);
    splitLots({ x: r.x, y: r.y + cut + 1, w: r.w, h: r.h - cut - 1 }, rng, out);
  }
}

function placeBuilding(map: GameMap, lot: Rect, kind: BuildingKind, id: number, rng: Rng): Building {
  const margin = kind === 'military' ? 1 : rng.int(1, 2);
  const maxW = lot.w - margin * 2;
  const maxH = lot.h - margin * 2;
  const w = kind === 'military' ? maxW : Math.max(7, Math.min(maxW, rng.int(Math.ceil(maxW * 0.65), maxW)));
  const h = kind === 'military' ? maxH : Math.max(7, Math.min(maxH, rng.int(Math.ceil(maxH * 0.65), maxH)));
  const x = lot.x + margin + rng.int(0, maxW - w);
  const y = lot.y + margin + rng.int(0, maxH - h);
  const b: Building = { id, kind, x, y, w, h, rooms: [] };
  const floor = kind === 'house' || kind === 'shop' ? Tile.Wood : Tile.Concrete;

  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const edge = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
      map.set(xx, yy, edge ? Tile.Wall : floor);
      map.buildingAt[map.idx(xx, yy)] = id + 1;
    }

  // Rooms via BSP on the interior.
  const interior: Rect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
  const minRoom = kind === 'warehouse' ? 7 : 4;
  splitRooms(map, interior, rng, b.rooms, minRoom, floor);

  // Exterior doors (2 on each building so you can't be trapped) + windows.
  const doorSides = rng.shuffle([0, 1, 2, 3]).slice(0, kind === 'military' ? 3 : 2);
  for (const side of doorSides) {
    const along = side % 2 === 0 ? w : h;
    const t = rng.int(2, along - 3);
    const [dx, dy] = side === 0 ? [x + t, y] : side === 1 ? [x + w - 1, y + t] : side === 2 ? [x + t, y + h - 1] : [x, y + t];
    map.set(dx, dy, floor);
    if (kind !== 'house') {
      // Double doors for big buildings.
      if (side % 2 === 0) map.set(dx + 1, dy, floor);
      else map.set(dx, dy + 1, floor);
    }
  }
  if (kind !== 'warehouse' && kind !== 'military') {
    for (let xx = x + 2; xx < x + w - 2; xx += rng.int(3, 4)) {
      if (map.get(xx, y) === Tile.Wall && isStraightWall(map, xx, y, true)) map.set(xx, y, Tile.Window);
      if (map.get(xx, y + h - 1) === Tile.Wall && isStraightWall(map, xx, y + h - 1, true)) map.set(xx, y + h - 1, Tile.Window);
    }
    for (let yy = y + 2; yy < y + h - 2; yy += rng.int(3, 4)) {
      if (map.get(x, yy) === Tile.Wall && isStraightWall(map, x, yy, false)) map.set(x, yy, Tile.Window);
      if (map.get(x + w - 1, yy) === Tile.Wall && isStraightWall(map, x + w - 1, yy, false)) map.set(x + w - 1, yy, Tile.Window);
    }
  }

  // Military compound: fence ring with gates.
  if (kind === 'military') {
    const fx0 = lot.x;
    const fy0 = lot.y;
    const fx1 = lot.x + lot.w - 1;
    const fy1 = lot.y + lot.h - 1;
    for (let xx = fx0; xx <= fx1; xx++) {
      if (map.get(xx, fy0) === Tile.Grass) map.set(xx, fy0, Tile.Fence);
      if (map.get(xx, fy1) === Tile.Grass) map.set(xx, fy1, Tile.Fence);
    }
    for (let yy = fy0; yy <= fy1; yy++) {
      if (map.get(fx0, yy) === Tile.Grass) map.set(fx0, yy, Tile.Fence);
      if (map.get(fx1, yy) === Tile.Grass) map.set(fx1, yy, Tile.Fence);
    }
    const gx = Math.floor((fx0 + fx1) / 2);
    const gy = Math.floor((fy0 + fy1) / 2);
    for (const [ax, ay] of [[gx, fy0], [gx + 1, fy0], [gx, fy1], [gx + 1, fy1], [fx0, gy], [fx0, gy + 1], [fx1, gy], [fx1, gy + 1]] as const)
      if (map.get(ax, ay) === Tile.Fence) map.set(ax, ay, Tile.Dirt);
  }

  // Containers along room walls.
  const tier = KIND_TIER[kind];
  for (const room of b.rooms) {
    const n = Math.max(1, Math.round((room.w * room.h) / 14)) + (kind === 'military' ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spot = wallHuggingSpot(map, room, rng);
      if (!spot) continue;
      const ck = rng.weighted(ROOM_CONTAINERS[kind]);
      map.containers.push(makeContainer(map.containers.length, ck, spot.x, spot.y, tier));
    }
  }
  return b;
}

function isStraightWall(map: GameMap, x: number, y: number, horizontal: boolean): boolean {
  return horizontal
    ? map.get(x - 1, y) === Tile.Wall && map.get(x + 1, y) === Tile.Wall && !map.isSolid(x, y - 1) !== !map.isSolid(x, y + 1)
    : map.get(x, y - 1) === Tile.Wall && map.get(x, y + 1) === Tile.Wall && !map.isSolid(x - 1, y) !== !map.isSolid(x + 1, y);
}

function splitRooms(map: GameMap, r: Rect, rng: Rng, out: Rect[], min: number, floor: Tile): void {
  const canW = r.w >= min * 2 + 1;
  const canH = r.h >= min * 2 + 1;
  if ((!canW && !canH) || (r.w * r.h < 50 && rng.chance(0.4))) {
    out.push(r);
    return;
  }
  const vertical = canW && (!canH || r.w >= r.h);
  if (vertical) {
    const cx = r.x + rng.int(min, r.w - min - 1);
    for (let y = r.y; y < r.y + r.h; y++) map.set(cx, y, Tile.Wall);
    map.set(cx, r.y + rng.int(1, r.h - 2), floor);
    splitRooms(map, { x: r.x, y: r.y, w: cx - r.x, h: r.h }, rng, out, min, floor);
    splitRooms(map, { x: cx + 1, y: r.y, w: r.x + r.w - cx - 1, h: r.h }, rng, out, min, floor);
  } else {
    const cy = r.y + rng.int(min, r.h - min - 1);
    for (let x = r.x; x < r.x + r.w; x++) map.set(x, cy, Tile.Wall);
    map.set(r.x + rng.int(1, r.w - 2), cy, floor);
    splitRooms(map, { x: r.x, y: r.y, w: r.w, h: cy - r.y }, rng, out, min, floor);
    splitRooms(map, { x: r.x, y: cy + 1, w: r.w, h: r.y + r.h - cy - 1 }, rng, out, min, floor);
  }
}

function wallHuggingSpot(map: GameMap, room: Rect, rng: Rng): { x: number; y: number } | null {
  for (let tries = 0; tries < 20; tries++) {
    const x = room.x + rng.int(0, room.w - 1);
    const y = room.y + rng.int(0, room.h - 1);
    if (map.isSolid(x, y)) continue;
    if (map.containers.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < 2)) continue;
    const walls = +map.isSolid(x - 1, y) + +map.isSolid(x + 1, y) + +map.isSolid(x, y - 1) + +map.isSolid(x, y + 1);
    // Don't block doorways: a doorway tile has walls on two opposite sides.
    const corridor = (map.isSolid(x - 1, y) && map.isSolid(x + 1, y)) || (map.isSolid(x, y - 1) && map.isSolid(x, y + 1));
    if (walls >= 1 && !corridor) return { x, y };
  }
  return null;
}

function makeContainer(id: number, kind: ContainerKind, x: number, y: number, tier: number) {
  return { id, kind, x, y, grid: createGrid(1, 1), revealedUids: [], searchT: 0, searched: false, generated: false, tier };
}

function decorateLot(map: GameMap, lot: Rect, rng: Rng): void {
  // Parks / overgrown lots: dirt patches and dense trees.
  for (let y = lot.y; y < lot.y + lot.h; y++)
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      if (rng.chance(0.08)) map.set(x, y, Tile.Dirt);
      else if (rng.chance(0.07)) map.set(x, y, Tile.Tree);
    }
}

function scatterTrees(map: GameMap, rng: Rng): void {
  for (let y = 3; y < map.height - 3; y++)
    for (let x = 3; x < map.width - 3; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      const nearEdge = Math.min(x, y, map.width - x, map.height - y) < 7;
      if (rng.chance(nearEdge ? 0.16 : 0.018)) map.set(x, y, Tile.Tree);
    }
}

function scatterCars(map: GameMap, rng: Rng, roadsX: number[], roadsY: number[]): void {
  let id = 10000;
  const tryCar = (x: number, y: number, horizontal: boolean) => {
    const cells = horizontal ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
    if (!cells.every(([cx, cy]) => map.get(cx!, cy!) === Tile.Road)) return;
    for (const [cx, cy] of cells) map.set(cx!, cy!, Tile.Car);
    // Trunk is searchable from the road next to the car.
    const tx = horizontal ? x + 2 : x;
    const ty = horizontal ? y : y + 2;
    if (map.get(tx, ty) === Tile.Road && rng.chance(0.6)) map.containers.push(makeContainer(id++, 'carTrunk', tx, ty, 0));
  };
  for (const rx of roadsX) for (let y = 6; y < map.height - 6; y += rng.int(9, 18)) tryCar(rx + (rng.chance(0.5) ? 0 : 2), y, false);
  for (const ry of roadsY) for (let x = 6; x < map.width - 6; x += rng.int(9, 18)) tryCar(x, ry + (rng.chance(0.5) ? 0 : 2), true);
}

function countSolidAround(map: GameMap, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && map.isSolid(x + dx, y + dy)) n++;
  return n;
}

function randomTile(map: GameMap, rng: Rng, pred: (x: number, y: number) => boolean): { x: number; y: number } | null {
  for (let i = 0; i < 400; i++) {
    const x = rng.int(3, map.width - 4);
    const y = rng.int(3, map.height - 4);
    if (pred(x, y)) return { x, y };
  }
  return null;
}

function findOpenTile(map: GameMap, rng: Rng): { x: number; y: number } {
  return randomTile(map, rng, (x, y) => map.get(x, y) === Tile.Road) ?? { x: map.width >> 1, y: map.height >> 1 };
}

export function floodFill(map: GameMap, start: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  if (!map.isWalkable(start.x, start.y)) return seen;
  const stack = [map.idx(start.x, start.y)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % map.width;
    const y = (i / map.width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!map.isWalkable(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

function neighbourReachable(map: GameMap, reach: Uint8Array, x: number, y: number): boolean {
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const)
    if (map.inBounds(nx, ny) && reach[map.idx(nx, ny)]) return true;
  return false;
}

function placeBots(map: GameMap, rng: Rng, reach: Uint8Array, density: number): void {
  if (density <= 0) return;
  const farFromPlayer = (x: number, y: number) => Math.hypot(x - map.playerSpawn.x, y - map.playerSpawn.y) > 28;
  const ok = (x: number, y: number) => map.isWalkable(x, y) && reach[map.idx(x, y)] === 1 && farFromPlayer(x, y);
  let group = 0;
  // Hostile groups start well apart so the map doesn't turn into a bloodbath in the first seconds.
  const clear = (arch: BotArchetype, p: { x: number; y: number }) =>
    map.botSpawns.every((s) => s.archetype === arch || (s.archetype === 'guard' && arch === 'boss') || Math.hypot(s.x - p.x, s.y - p.y) > 16);
  const spawnGroup = (arch: BotArchetype, count: number, near: { x: number; y: number }) => {
    if (arch !== 'guard' && !clear(arch, near)) return;
    const g = group++;
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 30; t++) {
        const x = Math.round(near.x + rng.range(-3, 3));
        const y = Math.round(near.y + rng.range(-3, 3));
        if (ok(x, y)) {
          map.botSpawns.push({ archetype: arch, x: x + 0.5, y: y + 0.5, group: g });
          break;
        }
      }
    }
  };

  // Boss + guards in the military compound.
  const mil = map.buildings.find((b) => b.kind === 'military');
  if (mil) {
    const r = mil.rooms.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
    spawnGroup('boss', 1, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    spawnGroup('guard', 2 + Math.round(density), { x: r.x + r.w / 2, y: r.y + r.h / 2 });
  }
  const scavGroups = Math.round(7 * density);
  for (let i = 0; i < scavGroups; i++) {
    const poi = rng.pick(map.pois.length ? map.pois : [map.playerSpawn]);
    spawnGroup('scav', rng.int(1, 3), poi);
  }
  const raiderGroups = Math.round(2 * density);
  for (let i = 0; i < raiderGroups; i++) {
    const p = randomTile(map, rng, (x, y) => ok(x, y) && clear('raider', { x, y }));
    if (p) spawnGroup('raider', rng.int(2, 3), p);
  }
  const hordes = Math.round(5 * density);
  for (let i = 0; i < hordes; i++) {
    const p = randomTile(map, rng, (x, y) => ok(x, y) && clear('infected', { x, y }));
    if (p) spawnGroup('infected', rng.int(2, 5), p);
  }
}
