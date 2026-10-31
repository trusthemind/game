import { BOSSES } from '../items/bosses';
import { Rng } from '../core/rng';
import { createGrid } from '../items/inventory';
import { GameMap, extractKind, extractSolids, extractToWorld, ROAD_EXTRACTS, type Building, type BuildingKind, type ContainerKind, type District, type Rect, type BotArchetype } from './map';
import { Tile } from './tiles';
import { furnish } from './furniture';
import { createVehicle, vehicleBlocked, type Vehicle, type VehicleSpawn } from '../sim/vehicle';

export type MapId = 'outskirts' | 'pinehollow' | 'portkirov' | 'testsite';

export interface MapPreset {
  id: MapId;
  name: string;
  tagline: string;
  size: number;
  /** District mix (kind → count of Voronoi seeds). */
  districts: Partial<Record<District, number>>;
  /** Number of main avenues per axis. */
  avenues: number;
  raidMinutes: number;
  botDensity: number;
  extractNames: string[];
}

/** Named locations. Sizes are in tiles (≈1 m each); the largest is ~0.07 km² of hand-reachable ground. */
export const MAP_PRESETS: Record<MapId, MapPreset> = {
  outskirts: {
    id: 'outskirts',
    name: 'Zavadsk Outskirts',
    tagline: 'Suburbs, a fenced army depot and the forest that swallowed the motorway.',
    size: 384,
    districts: { town: 4, industrial: 2, military: 1, forest: 5, farm: 3 },
    avenues: 4,
    raidMinutes: 35,
    botDensity: 1,
    extractNames: ['Old Gas Station', 'Rail Bridge', 'Collapsed Tunnel', 'Checkpoint ZB-013', 'Forest Path', 'Cargo Gate', 'Dam Road', 'Outpost Kordon-7'],
  },
  pinehollow: {
    id: 'pinehollow',
    name: 'Pine Hollow',
    tagline: 'Deep woods, a dying village, hunters’ lodges and a radar outpost.',
    size: 240,
    districts: { forest: 6, town: 1, farm: 3, military: 1 },
    avenues: 2,
    raidMinutes: 35,
    botDensity: 0.8,
    extractNames: ['Logging Camp', 'Ranger Tower', 'Old Mill', 'Rusty Bridge', 'Hunters’ Trail', 'Ferry Pier', 'Forest Outpost'],
  },
  portkirov: {
    id: 'portkirov',
    name: 'Port Kirov',
    tagline: 'Dense blocks, warehouses and container stacks on the shore. Close quarters.',
    size: 224,
    districts: { town: 4, industrial: 2, docks: 2, military: 1, forest: 1 },
    avenues: 3,
    raidMinutes: 30,
    botDensity: 1.15,
    extractNames: ['Container Gate', 'Smugglers Boat', 'Tram Depot', 'Sewer Outlet', 'Crane Yard', 'North Overpass'],
  },
  testsite: {
    id: 'testsite',
    name: 'Test Site',
    tagline: 'Small map for tests.',
    size: 112,
    districts: { town: 2, military: 1, forest: 1 },
    avenues: 2,
    raidMinutes: 25,
    botDensity: 1,
    extractNames: ['North Gate', 'South Gate', 'Checkpoint East', 'West Outpost'],
  },
};

export interface MapGenOptions {
  /** Named preset (defaults to the small test site so unit tests stay fast). */
  mapId?: MapId;
  /** Overrides the preset size (tests). */
  size?: number;
  /** Bot density multiplier (tests use 0 for an empty map). */
  botDensity?: number;
}

const ROOM_CONTAINERS: Record<BuildingKind, readonly (readonly [ContainerKind, number])[]> = {
  house: [['wardrobe', 4], ['fridge', 3], ['drawer', 5], ['jacket', 3], ['safe', 0.3]],
  apartment: [['wardrobe', 3], ['fridge', 3], ['drawer', 5], ['jacket', 3], ['safe', 0.4], ['medcabinet', 0.6]],
  shop: [['shelf', 6], ['register', 2], ['fridge', 2], ['crate', 1]],
  clinic: [['medcabinet', 6], ['drawer', 2], ['safe', 0.4]],
  warehouse: [['crate', 6], ['toolbox', 4], ['ammocrate', 1], ['jacket', 1], ['modbox', 1]],
  military: [['weaponbox', 4], ['ammocrate', 4], ['modbox', 2], ['crate', 2], ['safe', 1.2], ['medcabinet', 1]],
  barn: [['crate', 4], ['toolbox', 3], ['jacket', 1], ['stash', 0.5]],
  cabin: [['drawer', 3], ['jacket', 3], ['ammocrate', 1.5], ['weaponbox', 0.6], ['stash', 1]],
};

const KIND_TIER: Record<BuildingKind, number> = { house: 0, apartment: 0, shop: 0, clinic: 1, warehouse: 1, military: 3, barn: 0, cabin: 1 };
const DISTRICT_NAMES: Record<District, string[]> = {
  town: ['Lenin Square', 'Old Town', 'Sadova Street', 'Microdistrict 7', 'Market Quarter'],
  industrial: ['Tractor Plant', 'Concrete Works', 'Bus Depot', 'Pumping Station'],
  military: ['Army Depot', 'Radar Post', 'Garrison'],
  forest: ['Black Woods', 'Birch Grove', 'Wolf Ravine', 'Pine Ridge', 'Swamp Edge', 'Old Clearing'],
  farm: ['Kolkhoz Fields', 'Sunflower Farm', 'Grain Elevator', 'Dairy'],
  docks: ['North Pier', 'Container Terminal', 'Dry Dock'],
};

/**
 * District-based procedural map generator.
 *
 * 1. Voronoi districts (town / industrial / military / forest / farm / docks) from the preset's recipe.
 * 2. A grid of main avenues; town & industrial blocks get extra streets; country roads become dirt.
 * 3. Each block is filled according to its district: houses & apartment blocks, warehouses & container yards,
 *    a fenced army compound (boss), dense forest with hunters’ cabins, fields with barns.
 * 4. Spawns, extractions and bots, then connectivity repair so everything important is reachable.
 */
export function generateMap(seed: number, opts: MapGenOptions = {}): GameMap {
  const preset = MAP_PRESETS[opts.mapId ?? 'testsite'];
  const size = opts.size ?? preset.size;
  const density = (opts.botDensity ?? 1) * preset.botDensity;
  const rng = new Rng(seed);
  const map = new GameMap(size, size, seed);
  map.mapId = preset.id;
  map.name = preset.name;
  map.tiles.fill(Tile.Grass);

  // Border: impassable treeline.
  for (let i = 0; i < size; i++)
    for (let b = 0; b < 2; b++) {
      map.set(i, b, Tile.Border);
      map.set(i, size - 1 - b, Tile.Border);
      map.set(b, i, Tile.Border);
      map.set(size - 1 - b, i, Tile.Border);
    }

  // ── Districts ──
  const seeds: { kind: District; x: number; y: number }[] = [];
  for (const [kind, n] of Object.entries(preset.districts) as [District, number][])
    for (let i = 0; i < n; i++) {
      // Keep district seeds apart so every district gets real estate.
      let best = { x: size / 2, y: size / 2 };
      let bestD = -1;
      for (let t = 0; t < 30; t++) {
        const c = { x: rng.range(size * 0.12, size * 0.88), y: rng.range(size * 0.12, size * 0.88) };
        const d = Math.min(...seeds.map((s) => Math.hypot(s.x - c.x, s.y - c.y)), Infinity);
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      seeds.push({ kind, ...best });
    }
  const usedNames = new Set<string>();
  map.districts = seeds.map((s) => {
    const name = rng.pick(DISTRICT_NAMES[s.kind].filter((n) => !usedNames.has(n))) ?? DISTRICT_NAMES[s.kind][0]!;
    usedNames.add(name);
    return { ...s, name };
  });
  const warp = new Rng(seed ^ 0x9e3779b9);
  const wx = Array.from({ length: 8 }, () => [warp.range(0, Math.PI * 2), warp.range(0.02, 0.05), warp.range(4, 9)] as const);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Domain-warped Voronoi for organic district borders.
      let ox = 0;
      let oy = 0;
      for (const [ph, fr, amp] of wx) {
        ox += Math.sin(y * fr + ph) * amp * 0.5;
        oy += Math.cos(x * fr + ph) * amp * 0.5;
      }
      let bi = 0;
      let bd = Infinity;
      seeds.forEach((s, i) => {
        const d = (s.x - x - ox) ** 2 + (s.y - y - oy) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      map.districtAt[map.idx(x, y)] = bi;
    }

  // ── Roads ──
  const roadsX = roadLines(rng, size, preset.avenues);
  const roadsY = roadLines(rng, size, preset.avenues);
  const roadTile = (x: number, y: number) => {
    const d = map.districtOf(x, y);
    return d === 'forest' || d === 'farm' ? Tile.Dirt : Tile.Road;
  };
  for (const rx of roadsX) for (let y = 2; y < size - 2; y++) for (let d = 0; d < 3; d++) map.set(rx + d, y, roadTile(rx + d, y));
  for (const ry of roadsY) for (let x = 2; x < size - 2; x++) for (let d = 0; d < 3; d++) map.set(x, ry + d, roadTile(x, ry + d));

  // Blocks between avenues.
  const xs = [2, ...roadsX.flatMap((r) => [r, r + 3]), size - 2];
  const ys = [2, ...roadsY.flatMap((r) => [r, r + 3]), size - 2];
  const blocks: Rect[] = [];
  for (let i = 0; i < xs.length; i += 2)
    for (let j = 0; j < ys.length; j += 2) blocks.push({ x: xs[i]! + 1, y: ys[j]! + 1, w: xs[i + 1]! - xs[i]! - 2, h: ys[j + 1]! - ys[j]! - 2 });

  // Urban blocks get secondary streets; then lots.
  const lots: { r: Rect; d: District }[] = [];
  for (const b of blocks) {
    for (const sub of urbanSplit(map, b, rng)) {
      const d = map.districtOf(Math.floor(sub.x + sub.w / 2), Math.floor(sub.y + sub.h / 2)) ?? 'forest';
      const ls: Rect[] = [];
      splitLots(sub, rng, ls, d === 'town' ? 22 : d === 'military' ? 40 : 30);
      for (const l of ls) lots.push({ r: l, d: map.districtOf(Math.floor(l.x + l.w / 2), Math.floor(l.y + l.h / 2)) ?? d });
    }
  }

  // Military: the biggest lot inside each military district becomes a compound.
  const milLots = new Set<Rect>();
  map.districts.forEach((dist, di) => {
    if (dist.kind !== 'military') return;
    const mine = lots.filter((l) => map.districtAt[map.idx(Math.floor(l.r.x + l.r.w / 2), Math.floor(l.r.y + l.r.h / 2))] === di);
    mine.sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h);
    if (mine[0]) milLots.add(mine[0].r);
  });

  let buildingId = 0;
  const addBuilding = (lot: Rect, kind: BuildingKind) => {
    if (lot.w < 7 || lot.h < 7) return;
    map.buildings.push(placeBuilding(map, lot, kind, buildingId++, rng));
  };
  for (const { r: lot, d } of lots) {
    if (milLots.has(lot)) {
      addBuilding(clampLot(lot, 34), 'military');
      continue;
    }
    switch (d) {
      case 'town': {
        if (rng.chance(0.12)) decorateLot(map, lot, rng, 0.09);
        else if (lot.w >= 16 && lot.h >= 12 && rng.chance(0.35)) addBuilding(lot, 'apartment');
        else addBuilding(clampLot(lot, 16), rng.weighted([['house', 6], ['shop', 2], ['clinic', 0.8]] as const));
        break;
      }
      case 'industrial':
      case 'docks':
        if (rng.chance(d === 'docks' ? 0.45 : 0.25)) containerYard(map, lot, rng);
        else addBuilding(clampLot(lot, 26), 'warehouse');
        break;
      case 'military':
        if (rng.chance(0.5)) addBuilding(clampLot(lot, 14), 'warehouse');
        else decorateLot(map, lot, rng, 0.05);
        break;
      case 'farm': {
        const yard = lot.w >= 12 && lot.h >= 12 && rng.chance(0.55);
        if (yard) addBuilding(clampLot(lot, 13, rng), rng.chance(0.5) ? 'barn' : 'house');
        if (rng.chance(0.6)) fields(map, lot, rng);
        else decorateLot(map, lot, rng, 0.03);
        break;
      }
      case 'forest':
      default:
        if (lot.w >= 9 && lot.h >= 9 && rng.chance(0.3)) addBuilding(clampLot(lot, 9, rng), 'cabin');
        forest(map, lot, rng);
        break;
    }
  }

  scatterCars(map, rng, roadsX, roadsY);
  scatterTrees(map, rng);

  // Outdoor containers: hidden stashes in the woods.
  let containerId = map.containers.length + 1;
  const stashes = Math.round((size * size) / 2400);
  for (let k = 0; k < stashes; k++) {
    const p = randomTile(map, rng, (x, y) => map.get(x, y) === Tile.Grass && !map.isIndoors(x, y) && countSolidAround(map, x, y) >= 2);
    if (p) map.containers.push(makeContainer(containerId++, 'stash', p.x, p.y, 1));
  }

  // ── Spawn & extractions ──
  const clear = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (map.isSolid(x + dx, y + dy)) return false;
    return true;
  };
  const edgeTiles = (side: number, inset: number) => {
    const out: { x: number; y: number; road: boolean }[] = [];
    for (let i = 8; i < size - 8; i++) {
      const p = [
        { x: i, y: inset },
        { x: size - 1 - inset, y: i },
        { x: i, y: size - 1 - inset },
        { x: inset, y: i },
      ][side]!;
      if (!map.isWalkable(p.x, p.y)) continue;
      const t = map.get(p.x, p.y);
      out.push({ ...p, road: t === Tile.Road || t === Tile.Dirt });
    }
    return out;
  };
  // Player spawn: on a road at the map edge if possible, otherwise an open clearing — never in a bush.
  const spawnSide = rng.int(0, 3);
  let spawnCands = edgeTiles(spawnSide, 6).filter((p) => p.road && clear(p.x, p.y, 1));
  if (!spawnCands.length) spawnCands = edgeTiles(spawnSide, 7).filter((p) => clear(p.x, p.y, 2));
  if (!spawnCands.length) {
    const p = findOpenTile(map, rng);
    spawnCands = [{ ...p, road: true }];
  }
  const sp = rng.pick(spawnCands);
  map.playerSpawn = { x: sp.x, y: sp.y };
  // Guarantee breathing room around the spawn.
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const t = map.get(sp.x + dx, sp.y + dy);
      if (t === Tile.Tree || t === Tile.Fence) map.set(sp.x + dx, sp.y + dy, Tile.Grass);
    }

  // Extractions: the name decides what the place is, and so where it can be — a checkpoint, gate or overpass
  // stands where a road actually runs out of the map (so the barrier crosses it), a trail, pier or watchtower
  // off the road. Each sits far enough in for its set dressing, faces out of the map, and gets its ground
  // cleared of trees and fences; spots next to buildings are skipped.
  const names = rng.shuffle([...preset.extractNames]);
  const roadNames = names.filter((n) => ROAD_EXTRACTS.has(extractKind(n)));
  const wildNames = names.filter((n) => !ROAD_EXTRACTS.has(extractKind(n)));
  const OUT: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // top, right, bottom, left edge
  const INSET = 9;
  const isRoad = (x: number, y: number) => map.get(x, y) === Tile.Road || map.get(x, y) === Tile.Dirt;
  const roadLeaves = (x: number, y: number, side: number) => {
    const [ox, oy] = OUT[side]!;
    for (let k = 1; k <= INSET - 3; k++) if (!isRoad(x + ox * k, y + oy * k)) return false;
    return true;
  };
  // The set dressing reaches ~10 m to either side and 7 m in: keep that footprint off buildings (a tighter one
  // if a crowded edge has no room for the full one).
  const nearBuilding = (x: number, y: number, side: number, half: number, back: number) => {
    const a = extractToWorld({ x, y, dir: Math.atan2(OUT[side]![1], OUT[side]![0]) }, -half, -back);
    const b = extractToWorld({ x, y, dir: Math.atan2(OUT[side]![1], OUT[side]![0]) }, half, INSET);
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    return map.buildings.some((bl) => x1 > bl.x - 1 && x0 < bl.x + bl.w + 1 && y1 > bl.y - 1 && y0 < bl.y + bl.h + 1);
  };
  let extractId = 0;
  const exSides = [(spawnSide + 2) % 4, (spawnSide + 1) % 4, (spawnSide + 3) % 4, (spawnSide + 2) % 4, spawnSide];
  for (const side of exSides.slice(0, size >= 200 ? 5 : 3)) {
    const open = edgeTiles(side, INSET).filter(
      (p) => Math.hypot(p.x - sp.x, p.y - sp.y) > size * 0.35 && map.extractions.every((e) => Math.hypot(e.x - p.x, e.y - p.y) > 40),
    );
    let c = open.filter((p) => !nearBuilding(p.x, p.y, side, 10, 8));
    if (!c.length) c = open.filter((p) => !nearBuilding(p.x, p.y, side, 6, 4));
    if (!c.length) continue;
    const roads = c.filter((q) => q.road && roadLeaves(q.x, q.y, side));
    const wild = c.filter((q) => !q.road);
    // Alternate so a map gets both kinds, as long as a name of that kind is left. A road exit with no road
    // leaving the map here gets one: a dirt track from the edge in, past the barrier.
    const wantRoad = (extractId % 2 === 0 || !wildNames.length) && roadNames.length > 0;
    const pool = wantRoad ? (roads.length ? roads : c) : wild.length ? wild : c;
    const p = rng.pick(pool);
    const name = (wantRoad ? roadNames.shift() : wildNames.shift()) ?? roadNames.shift() ?? wildNames.shift() ?? `Exit ${extractId + 1}`;
    const [ox, oy] = OUT[side]!;
    // Clear the footprint (10 m to either side, from 8 m inside out to the edge) of trees, fences and wrecks.
    for (let a = -8; a <= INSET; a++)
      for (let b = -10; b <= 10; b++) {
        const x = p.x + ox * a + (oy !== 0 ? b : 0);
        const y = p.y + oy * a + (ox !== 0 ? b : 0);
        const t = map.get(x, y);
        if (t === Tile.Tree || t === Tile.Fence || t === Tile.Car) map.set(x, y, Tile.Grass);
      }
    if (ROAD_EXTRACTS.has(extractKind(name)) && !roadLeaves(p.x, p.y, side))
      for (let a = -12; a <= INSET; a++)
        for (const b of [-1, 0, 1]) {
          const x = p.x + ox * a + (oy !== 0 ? b : 0);
          const y = p.y + oy * a + (ox !== 0 ? b : 0);
          if (map.inBounds(x, y) && !map.isSolid(x, y) && !isRoad(x, y)) map.set(x, y, Tile.Dirt);
        }
    const ex = { id: extractId, name, x: p.x + 0.5, y: p.y + 0.5, radius: 2.4, kind: extractKind(name), dir: Math.atan2(oy, ox) };
    // A trail is a worn footpath that wanders out through the trees.
    if (ex.kind === 'path')
      for (let a = -8; a <= INSET; a++) {
        const w = Math.round(Math.sin(a * 0.45 + p.x * 0.3) * 1.2);
        for (const b of [w, w + 1]) {
          const t = extractToWorld(ex, b - 0.5, a);
          const tx = Math.floor(t.x);
          const ty = Math.floor(t.y);
          if (map.get(tx, ty) === Tile.Grass) map.set(tx, ty, Tile.Dirt);
        }
      }
    // Booths, towers, water and embankments are solid; loot that ended up under them goes.
    for (const box of extractSolids(ex)) {
      map.addBlocker(box);
      map.containers = map.containers.filter((k) => !(k.x + 1 > box[0] && k.x < box[2] && k.y + 1 > box[1] && k.y < box[3]));
    }
    map.extractions.push(ex);
    extractId++;
  }

  // ── Connectivity repair: carve through trees/fences to anything important that's cut off ──
  let reach = floodFill(map, map.playerSpawn);
  const important = [
    ...map.extractions.map((e) => ({ x: Math.floor(e.x), y: Math.floor(e.y) })),
    ...map.buildings.map((b) => ({ x: Math.floor(b.x + b.w / 2), y: b.y - 1 })),
  ];
  for (const t of important) {
    if (!map.inBounds(t.x, t.y) || reach[map.idx(t.x, t.y)]) continue;
    carveTo(map, t, map.playerSpawn);
    reach = floodFill(map, map.playerSpawn);
  }

  // Drop anything still unreachable (walled-in containers etc.).
  map.containers = map.containers.filter((c) => reach[map.idx(c.x, c.y)] || neighbourReachable(map, reach, c.x, c.y));
  map.extractions = map.extractions.filter((e) => reach[map.idx(Math.floor(e.x), Math.floor(e.y))]);

  furnish(map);
  placeVehicles(map, reach);

  // POIs for patrols: room centres + road crossings + district centres.
  for (const b of map.buildings) for (const r of b.rooms) map.pois.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  for (const rx of roadsX) for (const ry of roadsY) map.pois.push({ x: rx + 1.5, y: ry + 1.5 });
  for (const d of map.districts) map.pois.push({ x: d.x, y: d.y });
  map.pois = map.pois.filter((p) => map.isWalkable(Math.floor(p.x), Math.floor(p.y)) && reach[map.idx(Math.floor(p.x), Math.floor(p.y))]);

  placeBots(map, rng, reach, density);
  return map;
}

/** Shrink a lot towards its centre (keeps buildings from filling huge blocks edge to edge). */
function clampLot(r: Rect, max: number, rng?: Rng): Rect {
  const w = Math.min(r.w, max + (rng ? rng.int(-2, 2) : 0));
  const h = Math.min(r.h, max + (rng ? rng.int(-2, 2) : 0));
  return { x: r.x + Math.floor((r.w - w) / 2), y: r.y + Math.floor((r.h - h) / 2), w, h };
}

/** Town/industrial blocks get 2-wide side streets every ~24 tiles. */
function urbanSplit(map: GameMap, b: Rect, rng: Rng): Rect[] {
  const d = map.districtOf(Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2));
  if (d !== 'town' && d !== 'industrial' && d !== 'docks') return [b];
  const step = d === 'town' ? 24 : 32;
  const out: Rect[] = [];
  const cutsX: number[] = [];
  const cutsY: number[] = [];
  for (let x = b.x + step; x < b.x + b.w - step * 0.6; x += step + rng.int(-3, 3)) cutsX.push(x);
  for (let y = b.y + step; y < b.y + b.h - step * 0.6; y += step + rng.int(-3, 3)) cutsY.push(y);
  for (const cx of cutsX) for (let y = b.y; y < b.y + b.h; y++) for (let k = 0; k < 2; k++) map.set(cx + k, y, Tile.Road);
  for (const cy of cutsY) for (let x = b.x; x < b.x + b.w; x++) for (let k = 0; k < 2; k++) map.set(x, cy + k, Tile.Road);
  const xs = [b.x, ...cutsX.flatMap((c) => [c, c + 2]), b.x + b.w];
  const ys = [b.y, ...cutsY.flatMap((c) => [c, c + 2]), b.y + b.h];
  for (let i = 0; i < xs.length; i += 2) for (let j = 0; j < ys.length; j += 2) out.push({ x: xs[i]!, y: ys[j]!, w: xs[i + 1]! - xs[i]!, h: ys[j + 1]! - ys[j]! });
  return out.filter((r) => r.w > 3 && r.h > 3);
}

/** Shipping-container stacks (solid cover) with crates between them. */
function containerYard(map: GameMap, lot: Rect, rng: Rng): void {
  for (let y = lot.y + 1; y < lot.y + lot.h - 1; y += 4)
    for (let x = lot.x + 1; x < lot.x + lot.w - 6; x += rng.int(7, 10)) {
      if (rng.chance(0.25)) continue;
      const len = rng.int(4, 6);
      for (let k = 0; k < len && x + k < lot.x + lot.w - 1; k++) {
        map.set(x + k, y, Tile.Car);
        map.set(x + k, y + 1, Tile.Car);
      }
      if (rng.chance(0.35)) map.containers.push(makeContainer(map.containers.length + 1, rng.chance(0.3) ? 'ammocrate' : 'crate', x + len, y + 1, 1));
    }
}

function fields(map: GameMap, lot: Rect, rng: Rng): void {
  const horizontal = rng.chance(0.5);
  for (let y = lot.y; y < lot.y + lot.h; y++)
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      const stripe = horizontal ? y : x;
      if (stripe % 3 !== 0) map.set(x, y, Tile.Dirt);
    }
  // Fence line on one edge.
  if (rng.chance(0.6))
    for (let x = lot.x; x < lot.x + lot.w; x++) if (map.get(x, lot.y) === Tile.Dirt || map.get(x, lot.y) === Tile.Grass) if (x % 9 !== 4) map.set(x, lot.y, Tile.Fence);
}

function forest(map: GameMap, lot: Rect, rng: Rng): void {
  // Clustered trees via a cheap value-noise threshold, leaving natural clearings.
  const ph = rng.range(0, 100);
  for (let y = lot.y; y < lot.y + lot.h; y++)
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      const n = Math.sin(x * 0.21 + ph) * Math.cos(y * 0.17 - ph) + Math.sin((x + y) * 0.07 + ph * 0.3);
      const p = n > 0.4 ? 0.34 : n > -0.2 ? 0.18 : 0.03;
      if (rng.chance(p)) map.set(x, y, Tile.Tree);
      else if (rng.chance(0.03)) map.set(x, y, Tile.Dirt);
    }
}

/** Bresenham corridor from `a` towards `b`, clearing trees/fences (never building walls). */
function carveTo(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }): void {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]] as const) {
      const t = map.get(x + ox, y + oy);
      if (t === Tile.Tree || t === Tile.Fence || t === Tile.Car) map.set(x + ox, y + oy, Tile.Dirt);
    }
    if (x === b.x && y === b.y) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function roadLines(rng: Rng, size: number, n: number): number[] {
  const out: number[] = [];
  const seg = (size - 8) / (n + 1);
  for (let i = 1; i <= n; i++) out.push(Math.round(4 + seg * i + rng.range(-seg * 0.18, seg * 0.18)));
  return out;
}

function splitLots(r: Rect, rng: Rng, out: Rect[], min = 22): void {
  const canSplitW = r.w >= min;
  const canSplitH = r.h >= min;
  if ((!canSplitW && !canSplitH) || (r.w < min + 8 && r.h < min + 8 && rng.chance(0.25))) {
    out.push(r);
    return;
  }
  const vertical = canSplitW && (!canSplitH || r.w > r.h || (r.w === r.h && rng.chance(0.5)));
  if (vertical) {
    const cut = Math.floor(r.w * rng.range(0.38, 0.62));
    splitLots({ x: r.x, y: r.y, w: cut - 1, h: r.h }, rng, out, min);
    splitLots({ x: r.x + cut + 1, y: r.y, w: r.w - cut - 1, h: r.h }, rng, out, min);
  } else {
    const cut = Math.floor(r.h * rng.range(0.38, 0.62));
    splitLots({ x: r.x, y: r.y, w: r.w, h: cut - 1 }, rng, out, min);
    splitLots({ x: r.x, y: r.y + cut + 1, w: r.w, h: r.h - cut - 1 }, rng, out, min);
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
  const floor = kind === 'house' || kind === 'shop' || kind === 'cabin' || kind === 'apartment' ? Tile.Wood : kind === 'barn' ? Tile.Dirt : Tile.Concrete;

  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const edge = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
      map.set(xx, yy, edge ? Tile.Wall : floor);
      map.buildingAt[map.idx(xx, yy)] = id + 1;
    }

  // Rooms via BSP on the interior.
  const interior: Rect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
  const minRoom = kind === 'warehouse' || kind === 'barn' ? 7 : 4;
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
  if (kind !== 'warehouse' && kind !== 'military' && kind !== 'barn') {
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

/** A straight stretch of exterior wall with open ground on both sides (so a window can be climbed through). */
function isStraightWall(map: GameMap, x: number, y: number, horizontal: boolean): boolean {
  return horizontal
    ? map.get(x - 1, y) === Tile.Wall && map.get(x + 1, y) === Tile.Wall && !map.isSolid(x, y - 1) && !map.isSolid(x, y + 1)
    : map.get(x, y - 1) === Tile.Wall && map.get(x, y + 1) === Tile.Wall && !map.isSolid(x - 1, y) && !map.isSolid(x + 1, y);
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

function decorateLot(map: GameMap, lot: Rect, rng: Rng, trees = 0.07): void {
  // Parks / overgrown lots: dirt patches and trees.
  for (let y = lot.y; y < lot.y + lot.h; y++)
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      if (rng.chance(0.08)) map.set(x, y, Tile.Dirt);
      else if (rng.chance(trees)) map.set(x, y, Tile.Tree);
    }
}

function scatterTrees(map: GameMap, rng: Rng): void {
  for (let y = 3; y < map.height - 3; y++)
    for (let x = 3; x < map.width - 3; x++) {
      if (map.get(x, y) !== Tile.Grass) continue;
      const nearEdge = Math.min(x, y, map.width - x, map.height - y) < 6;
      const d = map.districtOf(x, y);
      const base = d === 'town' || d === 'industrial' || d === 'docks' ? 0.006 : d === 'farm' ? 0.01 : 0.02;
      if (rng.chance(nearEdge ? 0.14 : base)) map.set(x, y, Tile.Tree);
    }
}

/**
 * Settle the cars: wrecks that ended up in a tree, a wall, each other or an exit's clearing are towed away;
 * then a drivable UAZ stands on a road within a short walk of the spawn, and a couple more further out.
 * Own RNG stream, so it never shifts anything else on the map.
 */
function placeVehicles(map: GameMap, reach: Uint8Array): void {
  const rng = new Rng((map.seed ^ 0x7e41c1e5) >>> 0);
  const kept: Vehicle[] = [];
  const spawns: VehicleSpawn[] = [];
  const near = (x: number, y: number, r: number, p: { x: number; y: number }) => Math.hypot(x - p.x, y - p.y) < r;
  for (const s of map.vehicleSpawns) {
    const v = createVehicle(kept.length + 1, { ...s, heading: s.heading + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.06, 0.06), variant: rng.int(0, 3) });
    const exitBlocked = map.extractions.some((e) => near(v.pos.x, v.pos.y, 13, e)) || near(v.pos.x, v.pos.y, 5, { x: map.playerSpawn.x + 0.5, y: map.playerSpawn.y + 0.5 });
    if (exitBlocked || vehicleBlocked(v, map, kept)) {
      // Its trunk goes with it.
      map.containers = map.containers.filter((c) => c.kind !== 'carTrunk' || Math.hypot(c.x + 0.5 - v.pos.x, c.y + 0.5 - v.pos.y) > 3);
      continue;
    }
    kept.push(v);
    spawns.push({ ...s, heading: v.heading, variant: v.variant });
  }
  // Drivable ones: on a road (or a dirt track), parked along it, reachable, and clear of everything.
  const roadHeading = (x: number, y: number) => {
    const t = (dx: number, dy: number) => {
      const k = map.get(x + dx, y + dy);
      return k === Tile.Road || k === Tile.Dirt;
    };
    const horiz = t(-2, 0) && t(2, 0);
    const vert = t(0, -2) && t(0, 2);
    if (!horiz && !vert) return null;
    return (horiz && (!vert || rng.chance(0.5)) ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0);
  };
  const sp = { x: map.playerSpawn.x + 0.5, y: map.playerSpawn.y + 0.5 };
  const tryPark = (ok: (x: number, y: number) => boolean, around?: { x: number; y: number; r: number }): boolean => {
    for (let t = 0; t < 1500; t++) {
      const x = around ? Math.round(around.x + rng.range(-around.r, around.r)) : rng.int(4, map.width - 5);
      const y = around ? Math.round(around.y + rng.range(-around.r, around.r)) : rng.int(4, map.height - 5);
      if (x < 4 || y < 4 || x > map.width - 5 || y > map.height - 5) continue;
      const tile = map.get(x, y);
      if ((tile !== Tile.Road && tile !== Tile.Dirt) || !reach[map.idx(x, y)] || !ok(x, y) || map.isIndoors(x, y)) continue;
      const h = roadHeading(x, y);
      if (h === null) continue;
      const s: VehicleSpawn = { def: 'uaz469', x: x + 0.5, y: y + 0.5, heading: h + rng.range(-0.1, 0.1), variant: 0, wreck: false, fuel: rng.range(0.35, 0.8) };
      const v = createVehicle(kept.length + 1, s);
      if (vehicleBlocked(v, map, kept) || map.extractions.some((e) => near(s.x, s.y, 12, e))) continue;
      kept.push(v);
      spawns.push(s);
      return true;
    }
    return false;
  };
  // Near the spawn first; failing a road, any open ground will do for that one.
  if (!tryPark((x, y) => near(x, y, 28, sp) && !near(x, y, 6, sp), { ...sp, r: 28 })) parkOffRoad(sp);
  function parkOffRoad(c: { x: number; y: number }): void {
    for (let t = 0; t < 1500; t++) {
      const x = Math.round(c.x + rng.range(-26, 26));
      const y = Math.round(c.y + rng.range(-26, 26));
      if (!map.inBounds(x, y) || !reach[map.idx(x, y)] || map.isIndoors(x, y) || near(x, y, 6, c)) continue;
      const s: VehicleSpawn = { def: 'uaz469', x: x + 0.5, y: y + 0.5, heading: rng.range(-Math.PI, Math.PI), variant: 0, wreck: false, fuel: rng.range(0.35, 0.8) };
      const v = createVehicle(kept.length + 1, s);
      if (vehicleBlocked(v, map, kept) || map.extractions.some((e) => near(s.x, s.y, 12, e))) continue;
      kept.push(v);
      spawns.push(s);
      return;
    }
  }
  const extra = map.width >= 300 ? 3 : map.width >= 200 ? 2 : 1;
  for (let i = 0; i < extra; i++) tryPark((x, y) => !near(x, y, 60, sp) && spawns.every((o) => o.wreck || !near(x, y, 70, o)));
  map.vehicleSpawns = spawns;
}

function scatterCars(map: GameMap, rng: Rng, roadsX: number[], roadsY: number[]): void {
  let id = 10000;
  // Abandoned cars are wrecks (sim/vehicle.ts), not tiles: a real 4 m body pulled to the kerb. The RNG calls
  // are the same as when they were 2-tile blocks, so the rest of the map doesn't change.
  const tryCar = (x: number, y: number, horizontal: boolean) => {
    const cells = horizontal ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
    if (!cells.every(([cx, cy]) => map.get(cx!, cy!) === Tile.Road)) return;
    const tx = horizontal ? x + 2 : x;
    const ty = horizontal ? y : y + 2;
    const trunk = map.get(tx, ty) === Tile.Road && rng.chance(0.6);
    // Outer lane of the avenue: hug the kerb.
    const kerb = horizontal ? (map.get(x, y - 1) === Tile.Road ? -0.35 : 0.35) : map.get(x - 1, y) === Tile.Road ? -0.35 : 0.35;
    const cx = horizontal ? x + 1 : x + 0.5 + kerb;
    const cy = horizontal ? y + 0.5 + kerb : y + 1;
    map.vehicleSpawns.push({ def: 'zhiguli', x: cx, y: cy, heading: horizontal ? 0 : Math.PI / 2, variant: 0, wreck: true, fuel: 0 });
    // Trunk is searchable from just behind the rear bumper.
    if (trunk) {
      const bx = horizontal ? x + 3 : x;
      const by = horizontal ? y : y + 3;
      if (map.get(bx, by) === Tile.Road) map.containers.push(makeContainer(id++, 'carTrunk', bx, by, 0));
    }
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
  const farFromPlayer = (x: number, y: number) => Math.hypot(x - map.playerSpawn.x, y - map.playerSpawn.y) > 40;
  // Populations scale with map area (reference: 112×112).
  const area = (map.width * map.height) / (112 * 112);
  const scale = density * Math.min(4.2, Math.sqrt(area) * 1.15);
  const ok = (x: number, y: number) => map.isWalkable(x, y) && reach[map.idx(x, y)] === 1 && farFromPlayer(x, y);
  let group = 0;
  // Hostile groups start well apart so the map doesn't turn into a bloodbath in the first seconds.
  const clear = (arch: BotArchetype, p: { x: number; y: number }) =>
    map.botSpawns.every((s) => s.archetype === arch || (s.archetype === 'guard' && arch === 'boss') || Math.hypot(s.x - p.x, s.y - p.y) > 16);
  const spawnGroup = (arch: BotArchetype, count: number, near: { x: number; y: number }, g = group++, boss?: string) => {
    if (arch !== 'guard' && arch !== 'boss' && !clear(arch, near)) return;
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 30; t++) {
        const x = Math.round(near.x + rng.range(-3, 3));
        const y = Math.round(near.y + rng.range(-3, 3));
        if (ok(x, y)) {
          map.botSpawns.push({ archetype: arch, x: x + 0.5, y: y + 0.5, group: g, ...(boss ? { boss } : {}) });
          break;
        }
      }
    }
  };

  // Named boss of this location (with escort, sharing one group so they move and fight together).
  const centre = (b: { rooms: { x: number; y: number; w: number; h: number }[] }) => {
    const r = b.rooms.reduce((a, c) => (a.w * a.h > c.w * c.h ? a : c));
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const bossRng = rng.fork('boss');
  for (const def of BOSSES.filter((b) => b.map === map.mapId)) {
    if (!bossRng.chance(def.chance)) continue;
    const inDistrict = (x: number, y: number) => map.districtOf(Math.floor(x), Math.floor(y)) === def.district;
    const homes = map.buildings.filter((b) => b.kind === def.building && inDistrict(b.x + b.w / 2, b.y + b.h / 2));
    const any = map.buildings.filter((b) => b.kind === def.building);
    const pois = map.pois.filter((p) => inDistrict(p.x, p.y));
    const home = homes.length ? centre(bossRng.pick(homes)) : any.length ? centre(bossRng.pick(any)) : pois.length ? bossRng.pick(pois) : null;
    if (!home || !farFromPlayer(home.x, home.y)) continue;
    const g = group++;
    spawnGroup('boss', 1, home, g, def.id);
    if (def.guards) spawnGroup('guard', def.guards, home, g);
  }
  // Military compounds always have a guard detail.
  map.buildings
    .filter((b) => b.kind === 'military')
    .forEach((mil) => spawnGroup('guard', 2 + Math.round(density), centre(mil)));
  const scavGroups = Math.round(7 * scale);
  const urbanPois = map.pois.filter((p) => {
    const d = map.districtOf(Math.floor(p.x), Math.floor(p.y));
    return d === 'town' || d === 'industrial' || d === 'docks' || d === 'farm';
  });
  for (let i = 0; i < scavGroups; i++) {
    const poi = rng.pick(urbanPois.length ? urbanPois : map.pois.length ? map.pois : [map.playerSpawn]);
    spawnGroup('scav', rng.int(1, 3), poi);
  }
  const raiderGroups = Math.round(2 * scale);
  for (let i = 0; i < raiderGroups; i++) {
    const p = randomTile(map, rng, (x, y) => ok(x, y) && clear('raider', { x, y }));
    if (p) spawnGroup('raider', rng.int(2, 3), p);
  }
  const hordes = Math.round(5 * scale);
  for (let i = 0; i < hordes; i++) {
    const p = randomTile(map, rng, (x, y) => ok(x, y) && clear('infected', { x, y }));
    if (p) spawnGroup('infected', rng.int(2, 5), p);
  }
}
