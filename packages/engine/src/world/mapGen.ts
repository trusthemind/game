import { BOSSES } from '../items/bosses';
import { Rng } from '../core/rng';
import { createGrid } from '../items/inventory';
import { GameMap, extractKind, extractSolids, extractToWorld, ROAD_EXTRACTS, type Building, type BuildingKind, type ContainerKind, type District, type Rect, type BotArchetype, type Site } from './map';
import { Tile } from './tiles';
import { furnish } from './furniture';
import { createVehicle, vehicleBlocked, type Vehicle, type VehicleDefId, type VehicleSpawn } from '../sim/vehicle';

export type MapId = 'outskirts' | 'pinehollow' | 'portkirov' | 'zavadsk' | 'testsite';

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
  /** A container port along the south edge: sea, piers, quay cranes, moored ships, rail and stacks (buildPort). */
  port?: boolean;
  /**
   * A city: a square with a monument in the middle block, a tram line along the middle avenue, panel blocks of
   * five and nine storeys round courtyards, petrol stations on the avenues, car parks and lock-up garages.
   */
  city?: boolean;
  /** A river from the north edge to the south through the west of the map, bridged where roads cross it. */
  river?: boolean;
  /** A railway from west to east with a platform by the town, bridged over the river. */
  railway?: boolean;
  /** A sawmill in the forest: clearing, saw shed, log piles. */
  sawmill?: boolean;
  /**
   * The map's layout, the same every raid (as in Tarkov: you learn it). The raid's own seed only picks the spawn
   * point, the bots, the drivable cars and the loot. Without one, the raid seed lays the map out too.
   */
  layoutSeed?: number;
}

/** Named locations. Sizes are in tiles (≈1 m each); the largest is ~0.07 km² of hand-reachable ground. */
export const MAP_PRESETS: Record<MapId, MapPreset> = {
  outskirts: {
    id: 'outskirts',
    layoutSeed: 71,
    name: 'Zavadsk Outskirts',
    tagline: 'Suburbs on a river, the railway through them, a fenced army depot and a sawmill in the forest.',
    size: 384,
    districts: { town: 4, industrial: 2, military: 1, forest: 5, farm: 3 },
    avenues: 4,
    raidMinutes: 35,
    botDensity: 1,
    extractNames: ['Old Gas Station', 'Rail Bridge', 'Collapsed Tunnel', 'Checkpoint ZB-013', 'Forest Path', 'Cargo Gate', 'Dam Road', 'Outpost Kordon-7'],
    river: true,
    railway: true,
    sawmill: true,
  },
  pinehollow: {
    id: 'pinehollow',
    layoutSeed: 41,
    name: 'Pine Hollow',
    tagline: 'Deep woods, a dying village, hunters’ lodges and a radar outpost.',
    size: 240,
    districts: { forest: 6, town: 1, farm: 3, military: 1 },
    avenues: 2,
    raidMinutes: 35,
    botDensity: 0.8,
    extractNames: ['Logging Camp', 'Ranger Tower', 'Old Mill', 'Rusty Bridge', 'Hunters’ Trail', 'Ferry Pier', 'Forest Outpost'],
    sawmill: true,
  },
  portkirov: {
    id: 'portkirov',
    layoutSeed: 103,
    name: 'Port Kirov',
    tagline: 'A container port on the sea: cranes over the quay, ships at the berths, warehouses and blocks behind.',
    size: 224,
    districts: { town: 4, industrial: 2, docks: 2, military: 1, forest: 1 },
    avenues: 3,
    raidMinutes: 30,
    botDensity: 1.15,
    extractNames: ['Container Gate', 'Smugglers Boat', 'Tram Depot', 'Sewer Outlet', 'Crane Yard', 'North Overpass'],
    port: true,
  },
  zavadsk: {
    id: 'zavadsk',
    layoutSeed: 76,
    name: 'Zavadsk City',
    tagline: 'The city: panel blocks round courtyards, the square with the monument, the tram line, garages and petrol stations.',
    size: 256,
    districts: { town: 8, industrial: 1, military: 1 },
    avenues: 4,
    raidMinutes: 35,
    botDensity: 1.1,
    extractNames: ['Tram Depot', 'Ring Road Checkpoint', 'Old Overpass', 'River Bridge', 'Collapsed Tunnel', 'Railway Gate'],
    city: true,
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
  /** Lay the map out from this seed instead of the preset's fixed one (tests sweep layouts with it). */
  layoutSeed?: number;
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
  const layoutSeed = opts.layoutSeed ?? preset.layoutSeed ?? seed;
  const rng = new Rng(layoutSeed);
  const map = new GameMap(size, size, layoutSeed);
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
  const warp = new Rng(layoutSeed ^ 0x9e3779b9);
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

  // A port: the sea along the south edge, the terminal on the shore, warehouses and yards behind it.
  const shore = size - 40;
  const terminal = shore - 44;
  if (preset.port) {
    const docks = seeds.findIndex((s) => s.kind === 'docks');
    for (let y = terminal - 30; y < size; y++) for (let x = 0; x < size; x++) if (docks >= 0) map.districtAt[map.idx(x, y)] = docks;
  }

  // ── Roads ──
  const roadsX = roadLines(rng, size, preset.avenues);
  // In a port no avenue runs along the terminal; the north–south ones end at its gates.
  const roadsY = roadLines(rng, size, preset.avenues).filter((r) => !preset.port || r < terminal - 34);
  const roadEnd = preset.port ? terminal : size - 2;
  const roadTile = (x: number, y: number) => {
    const d = map.districtOf(x, y);
    return d === 'forest' || d === 'farm' ? Tile.Dirt : Tile.Road;
  };
  // The road network as laid (avenues and streets), as against yards and car parks that are road tiles too.
  const network = new Uint8Array(size * size);
  const lay = (x: number, y: number, t: Tile) => {
    map.set(x, y, t);
    network[map.idx(x, y)] = 1;
  };
  for (const rx of roadsX) for (let y = 2; y < roadEnd; y++) for (let d = 0; d < AVENUE_W; d++) lay(rx + d, y, roadTile(rx + d, y));
  for (const ry of roadsY) for (let x = 2; x < size - 2; x++) for (let d = 0; d < AVENUE_W; d++) lay(x, ry + d, roadTile(x, ry + d));
  // A city's middle avenue carries the tram: a track on its east side, two tiles wide.
  const tramX = preset.city ? roadsX[Math.floor(roadsX.length / 2)]! : -1;
  if (tramX >= 0) for (let y = 2; y < size - 2; y++) for (let d = AVENUE_W; d < AVENUE_W + 2; d++) if (map.get(tramX + d, y) !== Tile.Road) map.set(tramX + d, y, Tile.Rail);

  // Blocks between avenues.
  const xs = [2, ...roadsX.flatMap((r) => [r, r + AVENUE_W + (r === tramX ? 2 : 0)]), size - 2];
  const ys = [2, ...roadsY.flatMap((r) => [r, r + AVENUE_W]), preset.port ? terminal - 1 : size - 2];
  const blocks: Rect[] = [];
  for (let i = 0; i < xs.length; i += 2)
    for (let j = 0; j < ys.length; j += 2) blocks.push({ x: xs[i]! + 1, y: ys[j]! + 1, w: xs[i + 1]! - xs[i]! - 2, h: ys[j + 1]! - ys[j]! - 2 });

  // Outskirts: the river, then the railway (over the river on a bridge); roads they cross become bridges.
  const river = preset.river ? carveRiver(map, rng.fork('river'), roadsX, roadsY) : null;
  const railY = preset.railway ? layRailway(map, rng.fork('rail'), roadsY) : -1;

  // A city's middle block is its square, with the monument.
  const square = preset.city ? blocks.reduce((a, b) => (Math.hypot(b.x + b.w / 2 - size / 2, b.y + b.h / 2 - size / 2) < Math.hypot(a.x + a.w / 2 - size / 2, a.y + a.h / 2 - size / 2) ? b : a)) : null;
  if (square) citySquare(map, square, rng);

  // Urban blocks get secondary streets; then lots.
  const lots: { r: Rect; d: District }[] = [];
  for (const b of blocks) {
    if (b === square) continue;
    for (const sub of urbanSplit(map, b, rng, network)) {
      const d = map.districtOf(Math.floor(sub.x + sub.w / 2), Math.floor(sub.y + sub.h / 2)) ?? 'forest';
      const ls: Rect[] = [];
      splitLots(sub, rng, ls, d === 'town' ? 22 : d === 'military' ? 40 : 30);
      for (const l of ls) lots.push({ r: l, d: map.districtOf(Math.floor(l.x + l.w / 2), Math.floor(l.y + l.h / 2)) ?? d });
    }
  }

  // Military: the biggest lot inside each military district becomes a compound.
  // Lots the river or the railway runs through stay woods, fields or waste ground: nothing gets built on them.
  const wet = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const t = map.get(x, y);
        if (t === Tile.Water || t === Tile.Rail || (railY >= 0 && t === Tile.Concrete)) return true;
      }
    return false;
  };
  let sawmillDone = !preset.sawmill;
  const milLots = new Set<Rect>();
  map.districts.forEach((dist, di) => {
    if (dist.kind !== 'military') return;
    const inDistrict = (r: Rect) =>
      map.districtAt[map.idx(Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2))] === di;
    // A base wants most of a block: the dry window (44 tiles, smaller if need be) that lies most in the district,
    // the lots it covers given up to it.
    // Where the district came out too small for one (the port's docks swallow it, say), the base goes out in
    // the woods, the fields or the yards instead.
    const mineTile = (i: number) => map.districtAt[i] === di;
    const wildTile = (i: number) => ['forest', 'farm', 'industrial'].includes(map.districts[map.districtAt[i]!]!.kind);
    const share = (r: Rect, ok: (i: number) => boolean) => {
      let n = 0;
      let all = 0;
      for (let y = r.y; y < r.y + r.h; y += 2)
        for (let x = r.x; x < r.x + r.w; x += 2, all++) if (ok(map.idx(x, y))) n++;
      return n / all;
    };
    let block: Rect | undefined;
    for (const ok of [mineTile, wildTile]) {
      let best = 0.25;
      for (const b of blocks) {
        if (b === square) continue;
        for (const side of [44, 40, 36, 32]) {
          const w = Math.min(b.w, side);
          const h = Math.min(b.h, side);
          if (w < 30 || h < 26) continue;
          for (let y = b.y; y <= b.y + b.h - h; y += 4)
            for (let x = b.x; x <= b.x + b.w - w; x += 4) {
              // Clear of the map's edge, where the exits clear their own ground.
              if (Math.min(x, y, size - x - w, size - y - h) < 20) continue;
              const r = { x, y, w, h };
              const score = (share(r, ok) * (w * h)) / (44 * 44);
              if (score > best && !wet(r)) {
                best = score;
                block = r;
              }
            }
        }
      }
      if (block) break;
    }
    if (block) {
      const overlaps = (r: Rect) =>
        r.x < block.x + block.w && block.x < r.x + r.w && r.y < block.y + block.h && block.y < r.y + r.h;
      for (let i = lots.length - 1; i >= 0; i--) if (overlaps(lots[i]!.r)) lots.splice(i, 1);
      lots.push({ r: block, d: 'military' });
      milLots.add(block);
      // It's the army's ground, whatever the district map said at its edge.
      for (let y = block.y; y < block.y + block.h; y++)
        for (let x = block.x; x < block.x + block.w; x++) map.districtAt[map.idx(x, y)] = di;
      return;
    }
    const mine = lots.filter((l) => inDistrict(l.r));
    mine.sort((a, b) => Number(wet(a.r)) - Number(wet(b.r)) || b.r.w * b.r.h - a.r.w * a.r.h);
    if (mine[0]) milLots.add(mine[0].r);
  });


  let buildingId = 0;
  const addBuilding = (lot: Rect, kind: BuildingKind, floors?: number, exact = false) => {
    if (lot.w < 7 || lot.h < 7) return;
    const b = placeBuilding(map, lot, kind, buildingId++, rng, exact);
    // Blocks of flats stand three to five storeys in a town, five or nine in the city.
    b.floors = floors ?? (kind === 'apartment' ? rng.int(3, 5) : 1);
    map.buildings.push(b);
  };
  const cityState = { stations: 0, lots: 0 };
  for (const { r: lot, d } of lots) {
    if ((river || railY >= 0) && !milLots.has(lot) && wet(lot)) {
      if (d === 'forest') forest(map, lot, rng);
      else if (d === 'farm') fields(map, lot, rng);
      else decorateLot(map, lot, rng, 0.06);
      continue;
    }
    if (!sawmillDone && d === 'forest' && lot.w >= 26 && lot.h >= 20) {
      sawmillDone = true;
      sawmill(map, lot, rng, addBuilding);
      continue;
    }
    if (milLots.has(lot)) {
      militaryBase(map, lot, rng, (r, k) => addBuilding(r, k, 1, true), addBuilding);
      continue;
    }
    switch (d) {
      case 'town': {
        if (preset.city) {
          cityLot(map, lot, rng, addBuilding, cityState);
          break;
        }
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

  const port = preset.port ? buildPort(map, rng.fork('port'), terminal, shore, roadsX) : null;
  scatterCars(map, rng, roadsX, roadsY);
  scatterTrees(map, rng);

  // Outdoor containers: hidden stashes in the woods.
  const stashes = Math.round((size * size) / 2400);
  for (let k = 0; k < stashes; k++) {
    const p = randomTile(map, rng, (x, y) => map.get(x, y) === Tile.Grass && !map.isIndoors(x, y) && countSolidAround(map, x, y) >= 2);
    if (p) map.containers.push(makeContainer(nextContainerId(map), 'stash', p.x, p.y, 1));
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
  // Not where the rail bridge exit goes (east edge, on the line): its embankment would bury the spawn, and
  // with the spawn walled in every exit counts as unreachable and is dropped.
  const offRail = (p: { x: number; y: number }) => railY < 0 || Math.hypot(p.x - (size - 10), p.y - railY) > 24;
  let spawnCands = edgeTiles(spawnSide, 6).filter((p) => p.road && clear(p.x, p.y, 1) && offRail(p));
  if (!spawnCands.length) spawnCands = edgeTiles(spawnSide, 7).filter((p) => clear(p.x, p.y, 2) && offRail(p));
  if (!spawnCands.length) {
    const p = findOpenTile(map, rng);
    spawnCands = [{ ...p, road: true }];
  }
  const sp = rng.pick(spawnCands);
  map.playerSpawn = { x: sp.x, y: sp.y };
  // The map's spawn points: that one, then one more on each side (two on a big map, none on the little test
  // site), on a road where there is one, well apart.
  map.spawnPoints = [{ x: sp.x, y: sp.y }];
  for (const side of [0, 1, 2, 3]) {
    let cands = edgeTiles(side, 6).filter((p) => p.road && clear(p.x, p.y, 1) && offRail(p));
    if (cands.length < 4) cands = cands.concat(edgeTiles(side, 7).filter((p) => clear(p.x, p.y, 2) && offRail(p)));
    for (let n = 0; n < (size >= 300 ? 2 : size >= 160 ? 1 : 0); n++) {
      const ok = cands.filter((p) => map.spawnPoints.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > size * 0.3));
      if (!ok.length) break;
      const p = rng.pick(ok);
      map.spawnPoints.push({ x: p.x, y: p.y });
    }
  }
  // Guarantee breathing room around each.
  for (const s of map.spawnPoints)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const t = map.get(s.x + dx, s.y + dy);
        if (t === Tile.Tree || t === Tile.Fence) map.set(s.x + dx, s.y + dy, Tile.Grass);
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
  const addExtract = (name: string, x: number, y: number, dir: number) => {
    const ex = { id: extractId++, name, x: x + 0.5, y: y + 0.5, radius: 2.4, kind: extractKind(name), dir };
    for (const box of extractSolids(ex)) {
      map.addBlocker(box);
      map.containers = map.containers.filter((k) => !(k.x + 1 > box[0] && k.x < box[2] && k.y + 1 > box[1] && k.y < box[3]));
    }
    map.extractions.push(ex);
  };
  // The rail bridge where the railway leaves to the east.
  const placeOwn = (own: [string, number, number, number][]) => {
    for (const [name, x, y, dir] of own) {
      if (!names.includes(name)) continue;
      addExtract(name, x, y, dir);
      for (const list of [names, roadNames, wildNames]) list.splice(list.indexOf(name), list.includes(name) ? 1 : 0);
    }
  };
  if (railY >= 0) placeOwn([['Rail Bridge', size - 1 - INSET, railY, 0]]);
  // A port's own exits stand where they belong: the boat at the end of a pier, the crane yard on the quay, the
  // container gate at the side of the terminal. The rest go round the edges as on any map.
  if (port) {
    const own: [string, number, number, number][] = [
      ['Smugglers Boat', port.piers[0]!, shore + 22, Math.PI / 2],
      ['Crane Yard', INSET, shore - 6, Math.PI],
      ['Container Gate', size - 1 - INSET, terminal + 20, 0],
    ];
    for (const [name, x, y, dir] of own) {
      if (!names.includes(name)) continue;
      addExtract(name, x, y, dir);
      for (const list of [names, roadNames, wildNames]) list.splice(list.indexOf(name), list.includes(name) ? 1 : 0);
    }
  }
  const exSides = [(spawnSide + 2) % 4, (spawnSide + 1) % 4, (spawnSide + 3) % 4, (spawnSide + 2) % 4, spawnSide];
  for (const side of exSides.slice(0, size >= 200 ? 5 : 3)) {
    const open = edgeTiles(side, INSET).filter(
      // Not on top of a spawn point (a raid can start at any of them).
      (p) =>
        map.spawnPoints.every((s) => Math.hypot(p.x - s.x, p.y - s.y) > Math.max(20, size * 0.15)) &&
        map.extractions.every((e) => Math.hypot(e.x - p.x, e.y - p.y) > 40),
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

  // Set dressing (exit booths, embankments, crane legs) can wall off a few tiles against the edge: those grow over
  // rather than stay a walkable pocket nobody can get to.
  {
    const withBlockers = floodFill(map, map.playerSpawn);
    const saved = map.furnitureAt.slice();
    map.furnitureAt.fill(0);
    const without = floodFill(map, map.playerSpawn);
    map.furnitureAt.set(saved);
    for (let i = 0; i < without.length; i++)
      if (without[i] && !withBlockers[i] && !saved[i]) map.tiles[i] = map.tiles[i] === Tile.Grass || map.tiles[i] === Tile.Dirt ? Tile.Tree : Tile.Fence;
  }

  // ── Connectivity repair: carve through trees/fences to anything important that's cut off ──
  // Whatever was built over the spawn since it was picked, the player starts on the nearest open tile: from a
  // blocked one nothing is reachable and every exit would be dropped below.
  if (!map.isWalkable(map.playerSpawn.x, map.playerSpawn.y)) map.playerSpawn = nearestWalkable(map, map.playerSpawn);
  let reach = floodFill(map, map.playerSpawn);
  const important = [
    ...map.spawnPoints,
    ...map.extractions.map((e) => ({ x: Math.floor(e.x), y: Math.floor(e.y) })),
    ...map.buildings.map((b) => ({ x: Math.floor(b.x + b.w / 2), y: b.y - 1 })),
  ];
  for (const t of important) {
    if (!map.inBounds(t.x, t.y) || reach[map.idx(t.x, t.y)]) continue;
    // The shortest way through to ground that is reachable, not a line across the map to the spawn (through
    // whatever fence or base wall is in between).
    carveTo(map, t, nearestReached(map, reach, t) ?? map.playerSpawn);
    reach = floodFill(map, map.playerSpawn);
  }

  // Drop anything still unreachable (walled-in containers etc.).
  map.containers = map.containers.filter((c) => reach[map.idx(c.x, c.y)] || neighbourReachable(map, reach, c.x, c.y));
  map.extractions = map.extractions.filter((e) => reach[map.idx(Math.floor(e.x), Math.floor(e.y))]);

  furnish(map);
  map.spawnPoints = map.spawnPoints.map((s) => (map.isWalkable(s.x, s.y) ? s : nearestWalkable(map, s))).filter((s) => reach[map.idx(s.x, s.y)]);

  // ── This raid: where you start, the cars left running, the bots ──
  const raidRng = new Rng((seed ^ 0x52a1d) >>> 0);
  if (map.spawnPoints.length) map.playerSpawn = { ...raidRng.pick(map.spawnPoints) };
  placeVehicles(map, reach, network, seed);

  // POIs for patrols: room centres + road crossings + district centres.
  for (const b of map.buildings) for (const r of b.rooms) map.pois.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  for (const rx of roadsX) for (const ry of roadsY) map.pois.push({ x: rx + AVENUE_W / 2, y: ry + AVENUE_W / 2 });
  for (const d of map.districts) map.pois.push({ x: d.x, y: d.y });
  map.pois = map.pois.filter((p) => map.isWalkable(Math.floor(p.x), Math.floor(p.y)) && reach[map.idx(Math.floor(p.x), Math.floor(p.y))]);

  placeBots(map, raidRng, reach, density);
  return map;
}

/** Shrink a lot towards its centre (keeps buildings from filling huge blocks edge to edge). */
function clampLot(r: Rect, max: number, rng?: Rng): Rect {
  const w = Math.min(r.w, max + (rng ? rng.int(-2, 2) : 0));
  const h = Math.min(r.h, max + (rng ? rng.int(-2, 2) : 0));
  return { x: r.x + Math.floor((r.w - w) / 2), y: r.y + Math.floor((r.h - h) / 2), w, h };
}

/** Town/industrial blocks get 2-wide side streets every ~24 tiles. */
function urbanSplit(map: GameMap, b: Rect, rng: Rng, network: Uint8Array): Rect[] {
  const d = map.districtOf(Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2));
  if (d !== 'town' && d !== 'industrial' && d !== 'docks') return [b];
  const step = d === 'town' ? 24 : 32;
  const out: Rect[] = [];
  const cutsX: number[] = [];
  const cutsY: number[] = [];
  for (let x = b.x + step; x < b.x + b.w - step * 0.6; x += step + rng.int(-3, 3)) cutsX.push(x);
  for (let y = b.y + step; y < b.y + b.h - step * 0.6; y += step + rng.int(-3, 3)) cutsY.push(y);
  // Side streets stop at the river and the railway rather than wading through them.
  const street = (x: number, y: number) => {
    const t = map.get(x, y);
    if (t === Tile.Water || t === Tile.Rail) return;
    map.set(x, y, Tile.Road);
    network[map.idx(x, y)] = 1;
  };
  // One tile past the block on each side: blocks keep a tile of verge from the avenues, and a street that stops
  // short of the avenue doesn't join it.
  for (const cx of cutsX) for (let y = b.y - 1; y < b.y + b.h + 1; y++) for (let k = 0; k < STREET_W; k++) street(cx + k, y);
  for (const cy of cutsY) for (let x = b.x - 1; x < b.x + b.w + 1; x++) for (let k = 0; k < STREET_W; k++) street(x, cy + k);
  const xs = [b.x, ...cutsX.flatMap((c) => [c, c + STREET_W]), b.x + b.w];
  const ys = [b.y, ...cutsY.flatMap((c) => [c, c + STREET_W]), b.y + b.h];
  for (let i = 0; i < xs.length; i += 2) for (let j = 0; j < ys.length; j += 2) out.push({ x: xs[i]!, y: ys[j]!, w: xs[i + 1]! - xs[i]!, h: ys[j + 1]! - ys[j]! });
  return out.filter((r) => r.w > 3 && r.h > 3);
}

/**
 * A river from the north edge to the south: a slow meander through the widest gap between avenues in the west
 * of the map, 9–11 m wide. Roads it crosses stay (bridges, with railings drawn from their records).
 */
function carveRiver(map: GameMap, rng: Rng, roadsX: number[], roadsY: number[]): { at: (y: number) => number } {
  const size = map.width;
  const edges = [2, ...roadsX.flatMap((r) => [r, r + AVENUE_W]), size - 2];
  let gap: [number, number] = [size * 0.2, size * 0.35];
  let best = -1;
  for (let i = 0; i < edges.length; i += 2) {
    const [a, b] = [edges[i]!, edges[i + 1]!];
    const c = (a + b) / 2;
    if (c < size * 0.12 || c > size * 0.5) continue;
    if (b - a > best) {
      best = b - a;
      gap = [a, b];
    }
  }
  const x0 = (gap[0] + gap[1]) / 2;
  const width = rng.int(9, 11);
  const amp = Math.max(0, Math.min(14, (gap[1] - gap[0]) / 2 - width / 2 - 4));
  const ph = rng.range(0, Math.PI * 2);
  const ph2 = rng.range(0, Math.PI * 2);
  const at = (y: number) => x0 + amp * Math.sin(y * 0.025 + ph) + Math.min(3, amp * 0.3) * Math.sin(y * 0.09 + ph2);
  for (let y = 2; y < size - 2; y++) {
    const cx = at(y);
    for (let x = Math.round(cx - width / 2); x < Math.round(cx + width / 2); x++) {
      const t = map.get(x, y);
      if (t !== Tile.Road && t !== Tile.Dirt) map.set(x, y, Tile.Water);
    }
  }
  for (const ry of roadsY) bridge(map, ry, AVENUE_W);
  return { at };
}

/** Record the bridge where a road or track `h` tiles wide along x at `y` crosses water. */
function bridge(map: GameMap, y: number, h: number): void {
  let x0 = -1;
  for (let x = 2; x < map.width - 2; x++) {
    let over = false;
    for (let k = -1; k <= h; k += h + 1) if (map.get(x, y + k) === Tile.Water) over = true;
    if (over && x0 < 0) x0 = x;
    if (!over && x0 >= 0) {
      map.structures.push({ kind: 'bridge', x: x0 - 1, y, w: x - x0 + 2, h });
      x0 = -1;
    }
  }
}

/** The railway west to east between two avenues, over the river on its own bridge, a platform by the town. */
function layRailway(map: GameMap, rng: Rng, roadsY: number[]): number {
  const size = map.width;
  const edges = [2, ...roadsY.flatMap((r) => [r, r + AVENUE_W]), size - 2];
  let y = Math.round(size * 0.6);
  let best = Infinity;
  for (let i = 0; i < edges.length; i += 2) {
    const c = Math.round((edges[i]! + edges[i + 1]!) / 2);
    if (edges[i + 1]! - edges[i]! < 14) continue;
    if (Math.abs(c - size * 0.6) < best) {
      best = Math.abs(c - size * 0.6);
      y = c;
    }
  }
  for (let x = 2; x < size - 2; x++)
    for (let d = 0; d < 2; d++) {
      const t = map.get(x, y + d);
      if (t !== Tile.Road && t !== Tile.Dirt) map.set(x, y + d, Tile.Rail);
    }
  // Over water the track is the bridge (rail tiles are walkable); railings come from the record.
  for (let x = 2; x < size - 2; x++) if (map.get(x, y - 1) === Tile.Water || map.get(x, y + 2) === Tile.Water) {
    bridge(map, y, 2);
    break;
  }
  // The platform: a concrete strip beside the track in town, if the line runs through town.
  const town = [...Array(size - 60).keys()].map((i) => i + 30).filter((x) => map.districtOf(x, y + 3) === 'town' && map.get(x, y + 3) === Tile.Grass);
  const px = town.length ? town[Math.floor(town.length / 2)]! - 14 : Math.round(size * 0.55);
  for (let x = px; x < px + 28; x++) for (let d = 2; d < 5; d++) if (map.get(x, y + d) === Tile.Grass) map.set(x, y + d, Tile.Concrete);
  map.pois.push({ x: px + 14, y: y + 3 });
  void rng;
  return y;
}

/** A sawmill in a forest clearing: the saw shed, a drying shed, piles of logs and sawn boards. */
function sawmill(map: GameMap, lot: Rect, rng: Rng, addBuilding: (r: Rect, k: BuildingKind) => void): void {
  for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) if (map.get(x, y) === Tile.Grass) map.set(x, y, Tile.Dirt);
  addBuilding({ x: lot.x + 1, y: lot.y + 1, w: 16, h: 11 }, 'warehouse');
  addBuilding({ x: lot.x + lot.w - 11, y: lot.y + 1, w: 10, h: 9 }, 'barn');
  for (let i = 0; i < 4; i++) {
    const x = lot.x + 2 + i * 6;
    const y = lot.y + lot.h - 5 - (i % 2) * 3;
    if (x + 5 > lot.x + lot.w - 1) break;
    map.addBlocker([x, y, x + 5, y + 2]);
    map.structures.push({ kind: 'logs', x, y, w: 5, h: 2, levels: rng.int(2, 4) });
  }
  map.pois.push({ x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
  if (rng.chance(0.7)) map.containers.push(makeContainer(nextContainerId(map), 'toolbox', lot.x + 8, lot.y + 13, 1));
}

/**
 * An army base: a fenced square of concrete with one gate (on the side the road comes from), the barracks along
 * the back, the headquarters and the armoury either side, and a motor pool by the gate with a truck and a UAZ
 * (now and then a BTR) still in running order. Too small a lot gets the old single depot building.
 */
function militaryBase(
  map: GameMap,
  lot: Rect,
  rng: Rng,
  addBuilding: (r: Rect, k: BuildingKind) => void,
  depot: (r: Rect, k: BuildingKind) => void,
): void {
  const r = clampLot(lot, 44);
  if (r.w < 30 || r.h < 26) return depot(clampLot(lot, 34), 'military');
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, Tile.Concrete);
  // The gate: on the side nearest a road, else the south side; a dirt track runs out from it to the road.
  const len = (side: number) => (side % 2 === 0 ? r.w : r.h);
  const out = (side: number, k: number, a: number): [number, number] =>
    side === 0 ? [r.x + k, r.y - a] : side === 1 ? [r.x + r.w - 1 + a, r.y + k] : side === 2 ? [r.x + k, r.y + r.h - 1 + a] : [r.x - a, r.y + k];
  const roadAt = (x: number, y: number) => map.get(x, y) === Tile.Road;
  const reach = (side: number) => {
    for (let a = 1; a <= 16; a++) if (roadAt(...out(side, Math.floor(len(side) / 2), a))) return a;
    return Infinity;
  };
  const roadSide = [2, 0, 1, 3].reduce((b, side) => (reach(side) < reach(b) ? side : b));
  const gateAt = Math.floor(len(roadSide) / 2) - 2;
  for (const side of [0, 1, 2, 3])
    for (let k = 0; k < len(side); k++) {
      if (side === roadSide && k >= gateAt && k < gateAt + 5) continue;
      map.set(...out(side, k, 0), Tile.Fence);
    }
  const track = Number.isFinite(reach(roadSide)) ? reach(roadSide) - 1 : 4;
  for (let a = 1; a <= track; a++)
    for (let k = gateAt; k < gateAt + 5; k++) {
      const [x, y] = out(roadSide, k, a);
      const t = map.get(x, y);
      if (t === Tile.Grass || t === Tile.Tree || t === Tile.Fence) map.set(x, y, Tile.Dirt);
    }
  // Buildings, laid out with the gate at the "front" (rotated to whichever side it's on).
  const place = (fx: number, fy: number, w: number, h: number, kind: BuildingKind) => {
    // (fx, fy) from the inside corner opposite the gate; w along the back wall.
    const ix = r.x + 2;
    const iy = r.y + 2;
    const iw = r.w - 4;
    const ih = r.h - 4;
    const rect =
      roadSide === 2
        ? { x: ix + fx, y: iy + fy, w, h }
        : roadSide === 0
          ? { x: ix + iw - fx - w, y: iy + ih - fy - h, w, h }
          : roadSide === 1
            ? { x: ix + fy, y: iy + iw - fx - w, w: h, h: w }
            : { x: ix + ih - fy - h, y: iy + fx, w: h, h: w };
    const before = map.buildings.length;
    addBuilding(rect, kind);
    return map.buildings.length > before ? map.buildings[map.buildings.length - 1]!.id : undefined;
  };
  const back = roadSide % 2 === 0 ? r.w - 4 : r.h - 4;
  const deep = roadSide % 2 === 0 ? r.h - 4 : r.w - 4;
  const site: Site = { kind: 'base', x: r.x, y: r.y, w: r.w, h: r.h, gate: { x: 0, y: 0 }, buildings: {} };
  site.buildings.barracks = place(Math.floor((back - 20) / 2), 0, 20, 9, 'military');
  site.buildings.hq = place(0, 11, 11, 9, 'military');
  site.buildings.armoury = place(back - 9, 11, 9, 8, 'military');
  // Motor pool by the gate: what's parked there runs.
  const pool = [
    { f: back * 0.22, d: deep - 4 },
    { f: back * 0.78, d: deep - 4 },
  ];
  const toWorld = (f: number, d: number) => {
    const ix = r.x + 2;
    const iy = r.y + 2;
    const iw = r.w - 4;
    const ih = r.h - 4;
    return roadSide === 2
      ? { x: ix + f, y: iy + d }
      : roadSide === 0
        ? { x: ix + iw - f, y: iy + ih - d }
        : roadSide === 1
          ? { x: ix + d, y: iy + iw - f }
          : { x: ix + ih - d, y: iy + f };
  };
  const along = roadSide % 2 === 0 ? 0 : Math.PI / 2;
  pool.forEach(({ f, d }, i) => {
    const at = toWorld(f, d);
    const def: VehicleDefId = i === 0 ? (rng.chance(0.3) ? 'btr80' : 'ural4320') : 'uaz469';
    map.vehicleSpawns.push({
      def,
      x: at.x,
      y: at.y,
      heading: along,
      variant: 0,
      wreck: false,
      fuel: rng.range(0.4, 0.8),
    });
  });
  // Storage containers across the middle of the yard (cover between the buildings and the gate), army green
  // and grey.
  if (deep >= 30) {
    const d = Math.round((20 + deep - 7) / 2);
    for (const f of [back * 0.3, back * 0.62]) {
      if (rng.chance(0.2)) continue;
      const a = toWorld(f, d);
      const b = toWorld(f + 6, d + 2);
      const x = Math.round(Math.min(a.x, b.x));
      const y = Math.round(Math.min(a.y, b.y));
      const w = Math.round(Math.abs(b.x - a.x));
      const h = Math.round(Math.abs(b.y - a.y));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) map.set(xx, yy, Tile.Container);
      map.structures.push({ kind: 'stack', x, y, w, h, levels: rng.int(1, 2), color: rng.pick([2, 3]) });
    }
  }
  // Watchtowers in the four corners: legs you can walk between, a cabin up top.
  for (const [cx, cy] of [
    [r.x + 1, r.y + 1],
    [r.x + r.w - 4, r.y + 1],
    [r.x + 1, r.y + r.h - 4],
    [r.x + r.w - 4, r.y + r.h - 4],
  ] as const) {
    for (const [lx, ly] of [
      [cx, cy],
      [cx + 3, cy],
      [cx, cy + 3],
      [cx + 3, cy + 3],
    ] as const)
      map.addBlocker([lx + 0.3, ly + 0.3, lx + 0.7, ly + 0.7]);
    map.structures.push({ kind: 'tower', x: cx, y: cy, w: 3, h: 3 });
  }
  map.pois.push(toWorld(back / 2, 4), toWorld(back / 2, deep - 2), toWorld(4, deep / 2), toWorld(back - 4, deep / 2));
  const g = toWorld(back / 2, deep + 1.5);
  site.gate = g;
  map.sites.push(site);
}

/** The city square: paving, a monument on its plinth in the middle, lime trees at the corners. */
function citySquare(map: GameMap, b: Rect, rng: Rng): void {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) map.set(x, y, Tile.Concrete);
  const cx = Math.floor(b.x + b.w / 2);
  const cy = Math.floor(b.y + b.h / 2);
  map.addBlocker([cx - 1, cy - 1, cx + 2, cy + 2]);
  map.structures.push({ kind: 'monument', x: cx - 1, y: cy - 1, w: 3, h: 3 });
  for (const [x, y] of [[b.x + 2, b.y + 2], [b.x + b.w - 3, b.y + 2], [b.x + 2, b.y + b.h - 3], [b.x + b.w - 3, b.y + b.h - 3]] as const)
    for (let k = 0; k < 3; k++) map.set(x + (k % 2) * (x < cx ? 3 : -3), y + k * (y < cy ? 3 : -3), Tile.Tree);
  map.pois.push({ x: cx + 3, y: cy }, { x: b.x + 4, y: b.y + 4 }, { x: b.x + b.w - 4, y: b.y + b.h - 4 });
  void rng;
}

/**
 * One city lot: a panel block of five or nine storeys with its courtyard, a petrol station if it fronts an
 * avenue (two per city), a car park, a row of lock-up garages, or a small shop or clinic.
 */
function cityLot(map: GameMap, lot: Rect, rng: Rng, addBuilding: (r: Rect, k: BuildingKind, floors?: number) => void, st: { stations: number; lots: number }): void {
  st.lots++;
  const onAvenue = [0, 1, 2, 3].some((side) => {
    const [x, y] = side === 0 ? [lot.x + lot.w / 2, lot.y - 1] : side === 1 ? [lot.x + lot.w, lot.y + lot.h / 2] : side === 2 ? [lot.x + lot.w / 2, lot.y + lot.h] : [lot.x - 1, lot.y + lot.h / 2];
    return map.get(Math.floor(x), Math.floor(y)) === Tile.Road;
  });
  if (st.stations < 2 && onAvenue && lot.w >= 16 && lot.h >= 14 && st.lots % 5 === 2) {
    st.stations++;
    petrolStation(map, lot, rng, addBuilding);
    return;
  }
  const roll = rng.next();
  if (lot.w >= 16 && lot.h >= 12 && roll < 0.55) {
    addBuilding(lot, 'apartment', rng.chance(0.65) ? 5 : 9);
    // The courtyard round it: a few trees and a bench or two in what's left of the lot.
    decorateLot(map, lot, rng, 0.04);
    return;
  }
  if (roll < 0.68 && lot.w >= 12 && lot.h >= 10) return carPark(map, lot, rng);
  if (roll < 0.8 && lot.w >= 12 && lot.h >= 14) return garages(map, lot, rng);
  addBuilding(clampLot(lot, 16), rng.weighted([['shop', 4], ['house', 2], ['clinic', 1]] as const));
}

/** Forecourt, a canopy over two pump islands, and the kiosk at the back. */
function petrolStation(map: GameMap, lot: Rect, rng: Rng, addBuilding: (r: Rect, k: BuildingKind) => void): void {
  for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) map.set(x, y, Tile.Concrete);
  const cw = Math.min(14, lot.w - 4);
  const cx = lot.x + Math.floor((lot.w - cw) / 2);
  const cy = lot.y + 2;
  map.structures.push({ kind: 'canopy', x: cx, y: cy, w: cw, h: 7 });
  for (const [px, py] of [[cx, cy], [cx + cw - 1, cy], [cx, cy + 6], [cx + cw - 1, cy + 6]] as const) map.addBlocker([px + 0.3, py + 0.3, px + 0.7, py + 0.7]);
  for (const k of [0.33, 0.66]) {
    const px = Math.floor(cx + cw * k);
    map.addBlocker([px, cy + 2, px + 1, cy + 5]);
  }
  addBuilding({ x: lot.x + Math.floor((lot.w - 10) / 2), y: lot.y + lot.h - 9, w: 10, h: 9 }, 'shop');
  map.pois.push({ x: cx + cw / 2, y: cy + 3.5 });
  void rng;
}

/** Asphalt with rows of parked cars nose in, an aisle between them; a few left unlocked. */
function carPark(map: GameMap, lot: Rect, rng: Rng): void {
  for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) map.set(x, y, Tile.Road);
  const alongX = lot.w >= lot.h;
  const len = alongX ? lot.w : lot.h;
  const depth = alongX ? lot.h : lot.w;
  const rows = depth >= 16 ? [1.6, depth - 1.6] : [1.6];
  for (const r of rows)
    for (let a = 2; a + 2 < len; a += 2.8) {
      if (rng.chance(0.3)) continue;
      const x = alongX ? lot.x + a : lot.x + r;
      const y = alongX ? lot.y + r : lot.y + a;
      map.vehicleSpawns.push({ def: 'zhiguli', x, y, heading: alongX ? Math.PI / 2 : 0, variant: rng.int(0, 3), wreck: true, fuel: 0 });
      if (rng.chance(0.12)) {
        const tx = Math.floor(alongX ? x : x + 2.6);
        const ty = Math.floor(alongX ? y + 2.6 : y);
        if (map.get(tx, ty) === Tile.Road) map.containers.push(makeContainer(nextContainerId(map), 'carTrunk', tx, ty, 0));
      }
    }
  map.pois.push({ x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
}

/** Lock-up garages: rows of 3×6 m boxes facing a lane, some left open with a crate inside the door. */
function garages(map: GameMap, lot: Rect, rng: Rng): void {
  for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) map.set(x, y, Tile.Dirt);
  const rows: [number, 0 | 1][] = lot.h >= 18 ? [[lot.y + 1, 0], [lot.y + lot.h - 7, 1]] : [[lot.y + 1, 0]];
  for (const [y0, facing] of rows) {
    const n = Math.floor((lot.w - 2) / 3);
    if (n < 2) continue;
    const x0 = lot.x + 1;
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + n * 3; x++) map.set(x, y, Tile.Wall);
    map.structures.push({ kind: 'garages', x: x0, y: y0, w: n * 3, h: 6, color: facing });
    for (let i = 0; i < n; i++)
      if (rng.chance(0.25)) {
        const dx = x0 + i * 3 + 1;
        const dy = facing === 0 ? y0 + 6 : y0 - 1;
        if (map.get(dx, dy) === Tile.Dirt) map.containers.push(makeContainer(nextContainerId(map), rng.chance(0.2) ? 'ammocrate' : 'crate', dx, dy, 1));
      }
  }
  map.pois.push({ x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 });
}

/**
 * The container port along the south edge of the map. From the town down: two rail tracks along the back of the
 * terminal, rows of container stacks with lanes between them, the quay with its gantry cranes, then the sea with
 * two piers and a ship moored at each berth. The avenues from town end at the terminal (its gates).
 */
function buildPort(map: GameMap, rng: Rng, top: number, shore: number, roadsX: number[]): { piers: number[] } {
  const size = map.width;
  for (let y = top; y < size - 2; y++)
    for (let x = 2; x < size - 2; x++) map.set(x, y, y < shore ? Tile.Concrete : Tile.Water);
  // Piers: two jetties out into the sea.
  const piers = [Math.round(size * 0.3), Math.round(size * 0.72)];
  for (const px of piers) for (let y = shore; y < shore + 26; y++) for (let x = px - 6; x < px + 6; x++) map.set(x, y, Tile.Concrete);
  // Rail: two tracks behind the stacks.
  for (const t of [top + 3, top + 7]) for (let x = 2; x < size - 2; x++) for (let d = 0; d < 2; d++) map.set(x, t + d, Tile.Rail);
  // Stacks: rows of 20-footers, two side by side, with lanes; the avenues' lines stay open as main lanes.
  const nearAvenue = (x0: number, x1: number) => roadsX.some((r) => r + AVENUE_W >= x0 - 2 && r <= x1 + 2);
  for (let y0 = top + 11; y0 + 4 <= shore - 14; y0 += 7)
    for (let x0 = 6; x0 + 6 <= size - 6; x0 += 8) {
      if (nearAvenue(x0, x0 + 6) || rng.chance(0.12)) continue;
      for (let k = 0; k < 2; k++) if (rng.chance(0.9)) stack(map, rng, x0, y0 + k * 2, 6, 2);
      if (rng.chance(0.3) && map.get(x0 + 6, y0 + 1) === Tile.Concrete)
        map.containers.push(makeContainer(nextContainerId(map), rng.chance(0.25) ? 'ammocrate' : 'crate', x0 + 6, y0 + 1, 1));
      map.pois.push({ x: x0 + 7, y: y0 + 2 });
    }
  // Quay cranes: legs either side of the crane rails on the quay, the boom out over the water.
  const craneXs = [0.12, 0.42, 0.56, 0.86].map((f) => Math.round(size * f));
  for (const cx of craneXs) {
    const cy = shore - 10;
    for (const [lx, ly] of [[cx, cy], [cx + 9, cy], [cx, cy + 8], [cx + 9, cy + 8]] as const) map.addBlocker([lx, ly, lx + 1, ly + 1]);
    map.structures.push({ kind: 'crane', x: cx, y: cy, w: 10, h: 9 });
    map.pois.push({ x: cx + 5, y: cy + 4 });
  }
  // Ships at the berths: one along the quay between the piers, one beyond the second pier.
  const berth = (x0: number, x1: number) => {
    const len = Math.min(110, x1 - x0);
    if (len < 40) return;
    map.structures.push({ kind: 'ship', x: x0 + Math.round((x1 - x0 - len) / 2), y: shore + 3, w: len, h: 14 });
  };
  berth(piers[0]! + 9, piers[1]! - 9);
  berth(piers[1]! + 9, size - 6);
  return { piers };
}

/** One stack of shipping containers on a `w`×`h` footprint (6×2 is a 20-footer), 1–3 high. */
function stack(map: GameMap, rng: Rng, x: number, y: number, w: number, h: number, maxLevels = 3): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) map.set(xx, yy, Tile.Container);
  map.structures.push({ kind: 'stack', x, y, w, h, levels: rng.int(1, maxLevels), color: rng.int(0, 7) });
}

/** Shipping-container stacks (solid cover) with crates between them. */
function containerYard(map: GameMap, lot: Rect, rng: Rng): void {
  for (let y = lot.y + 1; y < lot.y + lot.h - 1; y += 4)
    for (let x = lot.x + 1; x < lot.x + lot.w - 6; x += rng.int(7, 10)) {
      if (rng.chance(0.25)) continue;
      const len = Math.min(6, lot.x + lot.w - 1 - x);
      if (len < 3) continue;
      stack(map, rng, x, y, len, 2);
      if (rng.chance(0.35)) map.containers.push(makeContainer(nextContainerId(map), rng.chance(0.3) ? 'ammocrate' : 'crate', x + len, y + 1, 1));
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
/** The reachable tile nearest `t` (within 80 tiles), by straight-line distance. */
function nearestReached(map: GameMap, reach: Uint8Array, t: { x: number; y: number }): { x: number; y: number } | null {
  for (let r = 1; r <= 80; r++) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = t.x + dx;
        const y = t.y + dy;
        if (!map.inBounds(x, y) || !reach[map.idx(x, y)] || !map.isWalkable(x, y)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
    if (best) return best;
  }
  return null;
}

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

/** Main avenues: two lanes, room for a car each way past a wreck at the kerb. */
const AVENUE_W = 6;
/** Side streets in town, industry and the docks: a car each way. */
const STREET_W = 4;

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

/** One past the highest container id so far: ids stay unique whoever adds containers, and in whatever order. */
function nextContainerId(map: GameMap): number {
  let id = 0;
  for (const c of map.containers) id = Math.max(id, c.id + 1);
  return id;
}

function placeBuilding(map: GameMap, lot: Rect, kind: BuildingKind, id: number, rng: Rng, exact = false): Building {
  // The lone depot (a military building on its own) fences itself in, with a 3-tile lane between its fence (on
  // the lot edge) and the walls so its gates lead somewhere. `exact` takes the lot as the footprint: a barracks
  // or a headquarters inside a base, which has its own fence.
  const compound = kind === 'military' && !exact;
  const margin = compound ? 4 : exact ? 0 : rng.int(1, 2);
  const maxW = lot.w - margin * 2;
  const maxH = lot.h - margin * 2;
  const w = compound || exact ? maxW : Math.max(7, Math.min(maxW, rng.int(Math.ceil(maxW * 0.65), maxW)));
  const h = compound || exact ? maxH : Math.max(7, Math.min(maxH, rng.int(Math.ceil(maxH * 0.65), maxH)));
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
  // A compound gets a door on every side, facing its gates (the middle of each fence side).
  const doorSides = compound ? [0, 1, 2, 3] : rng.shuffle([0, 1, 2, 3]).slice(0, 2);
  for (const side of doorSides) {
    const along = side % 2 === 0 ? w : h;
    const t =
      compound
        ? side % 2 === 0
          ? Math.floor((lot.x + lot.x + lot.w - 1) / 2) - x
          : Math.floor((lot.y + lot.y + lot.h - 1) / 2) - y
        : rng.int(2, along - 3);
    const [dx, dy] = side === 0 ? [x + t, y] : side === 1 ? [x + w - 1, y + t] : side === 2 ? [x + t, y + h - 1] : [x, y + t];
    map.set(dx, dy, floor);
    if (kind !== 'house') {
      // Double doors for big buildings.
      if (side % 2 === 0) map.set(dx + 1, dy, floor);
      else map.set(dx, dy + 1, floor);
    }
  }
  if (kind !== 'warehouse' && !compound && kind !== 'barn') {
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
  if (compound) {
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
      map.containers.push(makeContainer(nextContainerId(map), ck, spot.x, spot.y, tier));
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
function placeVehicles(map: GameMap, reach: Uint8Array, network: Uint8Array, raidSeed: number): void {
  const rng = new Rng((raidSeed ^ 0x7e41c1e5) >>> 0);
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
  // Drivable ones: on the road network (an avenue or a street, not a yard or a car park), parked along it,
  // reachable, and clear of everything.
  const roadHeading = (x: number, y: number) => {
    const t = (dx: number, dy: number) => {
      const k = map.get(x + dx, y + dy);
      return (k === Tile.Road || k === Tile.Dirt) && map.inBounds(x + dx, y + dy) && network[map.idx(x + dx, y + dy)] === 1;
    };
    // A street or an avenue across (with the tram, 8 wide), not a crossing.
    const road = (ax: number, ay: number) => {
      let w = 1;
      for (const sg of [1, -1]) for (let k = 1; k <= AVENUE_W + 2 && t(ax * k * sg, ay * k * sg); k++) w++;
      return w >= STREET_W && w <= AVENUE_W + 2;
    };
    const horiz = t(-2, 0) && t(2, 0) && road(0, 1);
    const vert = t(0, -2) && t(0, 2) && road(1, 0);
    if (!horiz && !vert) return null;
    const h = horiz && (!vert || rng.chance(0.5)) ? 0 : Math.PI / 2;
    // Nose towards the middle of the map, not into a dead end at its edge.
    const inward = Math.cos(h) * (map.width / 2 - x) + Math.sin(h) * (map.height / 2 - y) >= 0;
    return h + (inward ? 0 : Math.PI);
  };
  const sp = { x: map.playerSpawn.x + 0.5, y: map.playerSpawn.y + 0.5 };
  // What's left running depends on where it stands: army trucks and the odd BTR at the base, vans and lorries
  // round the warehouses and the port, cars in town, 4x4s and motorcycles out at the farms and in the woods.
  const POOLS: Record<District, [VehicleDefId, number][]> = {
    military: [['ural4320', 3], ['uaz469', 3], ['btr80', 1]],
    industrial: [['ural4320', 2], ['uaz452', 3], ['vaz2107', 2], ['uaz469', 1]],
    docks: [['ural4320', 2], ['uaz452', 3], ['vaz2107', 2]],
    town: [['vaz2107', 4], ['niva', 2], ['uaz452', 2], ['izh', 2], ['uaz469', 1]],
    farm: [['niva', 3], ['uaz469', 2], ['izh', 2], ['uaz452', 1]],
    forest: [['niva', 3], ['uaz469', 3], ['izh', 2]],
  };
  const pickDef = (x: number, y: number): VehicleDefId => {
    const pool = POOLS[map.districtOf(x, y) ?? 'town'];
    let r = rng.range(0, pool.reduce((n, [, w]) => n + w, 0));
    for (const [id, w] of pool) if ((r -= w) < 0) return id;
    return pool[0]![0];
  };
  const tryPark = (ok: (x: number, y: number) => boolean, around?: { x: number; y: number; r: number }): boolean => {
    for (let t = 0; t < 1500; t++) {
      const x = around ? Math.round(around.x + rng.range(-around.r, around.r)) : rng.int(4, map.width - 5);
      const y = around ? Math.round(around.y + rng.range(-around.r, around.r)) : rng.int(4, map.height - 5);
      if (x < 4 || y < 4 || x > map.width - 5 || y > map.height - 5) continue;
      const tile = map.get(x, y);
      if ((tile !== Tile.Road && tile !== Tile.Dirt) || !network[map.idx(x, y)] || !reach[map.idx(x, y)] || !ok(x, y) || map.isIndoors(x, y)) continue;
      const h = roadHeading(x, y);
      if (h === null) continue;
      const s: VehicleSpawn = { def: pickDef(x, y), x: x + 0.5, y: y + 0.5, heading: h + rng.range(-0.1, 0.1), variant: 0, wreck: false, fuel: rng.range(0.35, 0.8) };
      const v = createVehicle(kept.length + 1, s);
      if (vehicleBlocked(v, map, kept) || map.extractions.some((e) => near(s.x, s.y, 12, e))) continue;
      // Room to pull away: a car length clear ahead, not nose to tail with a wreck.
      const ahead = createVehicle(0, { ...s, x: s.x + Math.cos(s.heading) * 4.5, y: s.y + Math.sin(s.heading) * 4.5 });
      if (vehicleBlocked(ahead, map, kept)) continue;
      kept.push(v);
      spawns.push(s);
      return true;
    }
    return false;
  };
  // Near the spawn: on a road if there's one close by, else on open ground close by, else on a road further out.
  if (!tryPark((x, y) => near(x, y, 28, sp) && !near(x, y, 6, sp), { ...sp, r: 28 }) && !parkOffRoad(sp))
    tryPark((x, y) => near(x, y, 50, sp) && !near(x, y, 6, sp), { ...sp, r: 50 });
  function parkOffRoad(c: { x: number; y: number }, r = 26): boolean {
    for (let t = 0; t < 1500; t++) {
      const x = Math.round(c.x + rng.range(-r, r));
      const y = Math.round(c.y + rng.range(-r, r));
      if (!map.inBounds(x, y) || !reach[map.idx(x, y)] || map.isIndoors(x, y) || near(x, y, 6, sp)) continue;
      const s: VehicleSpawn = { def: pickDef(x, y), x: x + 0.5, y: y + 0.5, heading: rng.range(-Math.PI, Math.PI), variant: 0, wreck: false, fuel: rng.range(0.35, 0.8) };
      const v = createVehicle(kept.length + 1, s);
      if (vehicleBlocked(v, map, kept) || map.extractions.some((e) => near(s.x, s.y, 12, e))) continue;
      kept.push(v);
      spawns.push(s);
      return true;
    }
    return false;
  }
  const apart = (x: number, y: number, r: number) => spawns.every((o) => o.wreck || !near(x, y, r, o));
  // One at the army base and at a couple of farms or patches of woods (the vehicles that belong there), off the
  // road if need be: three at most, the base first.
  const rural = map.districts
    .filter((d) => d.kind === 'military' || d.kind === 'farm' || d.kind === 'forest')
    .sort((a, b) => (a.kind === 'military' ? 0 : 1) - (b.kind === 'military' ? 0 : 1));
  let placed = 0;
  for (const d of rural) {
    if (placed >= 3) break;
    // A base has its motor pool already.
    if (d.kind === 'military' && map.sites.some((s) => s.kind === 'base')) continue;
    if (near(d.x, d.y, 40, sp) || !apart(d.x, d.y, 30)) continue;
    if (tryPark((x, y) => near(x, y, 24, d) && apart(x, y, 30), { x: d.x, y: d.y, r: 24 }) || parkOffRoad(d, 16)) placed++;
  }
  // Then along the roads across the map, well spread out: 4 to 8 in all, by the map's size.
  const total = map.width >= 300 ? 8 : map.width >= 200 ? 6 : 4;
  for (let i = 0, n = spawns.filter((o) => !o.wreck).length; i < 20 && n < total; i++)
    if (tryPark((x, y) => !near(x, y, 50, sp) && apart(x, y, 45))) n++;
  map.vehicleSpawns = spawns;
}

function scatterCars(map: GameMap, rng: Rng, roadsX: number[], roadsY: number[]): void {
  let id = 10000;
  // Abandoned cars are wrecks (sim/vehicle.ts), not tiles: a real 4 m body pulled to the kerb, the middle of the
  // avenue left clear. Not in a crossing (it would stand across the other avenue's lanes) and not across the
  // mouth of a street that joins the avenue on its side.
  const crossing = (x: number, y: number, horizontal: boolean) =>
    horizontal ? roadsX.some((rx) => x + 3 >= rx - 1 && x <= rx + AVENUE_W) : roadsY.some((ry) => y + 3 >= ry - 1 && y <= ry + AVENUE_W);
  /** `out`: which side the kerb is on (−1 the low side, +1 the high side). */
  const tryCar = (x: number, y: number, horizontal: boolean, out: -1 | 1) => {
    const cells = horizontal ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
    if (!cells.every(([cx, cy]) => map.get(cx!, cy!) === Tile.Road) || crossing(x, y, horizontal)) return;
    for (let k = -2; k < 6; k++) if (horizontal ? map.get(x + k, y + out) === Tile.Road : map.get(x + out, y + k) === Tile.Road) return;
    const tx = horizontal ? x + 2 : x;
    const ty = horizontal ? y : y + 2;
    const trunk = map.get(tx, ty) === Tile.Road && rng.chance(0.6);
    const kerb = -out * 0.35;
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
  for (const rx of roadsX)
    for (let y = 6; y < map.height - 6; y += rng.int(9, 18)) {
      const low = rng.chance(0.5);
      tryCar(rx + (low ? 0 : AVENUE_W - 1), y, false, low ? -1 : 1);
    }
  for (const ry of roadsY)
    for (let x = 6; x < map.width - 6; x += rng.int(9, 18)) {
      const low = rng.chance(0.5);
      tryCar(x, ry + (low ? 0 : AVENUE_W - 1), true, low ? -1 : 1);
    }
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

/** The walkable tile closest to `p` (rings outwards), or `p` itself if there's none. */
function nearestWalkable(map: GameMap, p: { x: number; y: number }): { x: number; y: number } {
  for (let r = 1; r < Math.max(map.width, map.height); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (map.isWalkable(p.x + dx, p.y + dy) && map.get(p.x + dx, p.y + dy) !== Tile.Water) return { x: p.x + dx, y: p.y + dy };
      }
  return p;
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
    // Indoors, they stay in that building (not out past its wall).
    const home = map.inBounds(Math.floor(near.x), Math.floor(near.y)) ? map.buildingAt[map.idx(Math.floor(near.x), Math.floor(near.y))]! : 0;
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 30; t++) {
        const x = Math.round(near.x + rng.range(-3, 3));
        const y = Math.round(near.y + rng.range(-3, 3));
        if (ok(x, y) && (!home || t >= 20 || map.buildingAt[map.idx(x, y)] === home)) {
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
    // A warlord holds court in the base's headquarters.
    const hq = def.building === 'military' ? map.sites.flatMap((s) => map.buildings.filter((b) => b.id === s.buildings.hq && inDistrict(b.x + b.w / 2, b.y + b.h / 2))) : [];
    const homes = hq.length ? hq : map.buildings.filter((b) => b.kind === def.building && inDistrict(b.x + b.w / 2, b.y + b.h / 2));
    const any = map.buildings.filter((b) => b.kind === def.building);
    const pois = map.pois.filter((p) => inDistrict(p.x, p.y));
    const home = homes.length ? centre(bossRng.pick(homes)) : any.length ? centre(bossRng.pick(any)) : pois.length ? bossRng.pick(pois) : null;
    if (!home || !farFromPlayer(home.x, home.y)) continue;
    const g = group++;
    spawnGroup('boss', 1, home, g, def.id);
    if (def.guards) spawnGroup('guard', def.guards, home, g);
  }
  // Military compounds always have a guard detail: a lone depot one, a base one in the barracks and a pair on
  // the gate.
  const inBase = new Set(map.sites.flatMap((s) => Object.values(s.buildings)));
  map.buildings
    .filter((b) => b.kind === 'military' && !inBase.has(b.id))
    .forEach((mil) => spawnGroup('guard', 2 + Math.round(density), centre(mil)));
  for (const s of map.sites) {
    const barracks = map.buildings.find((b) => b.id === s.buildings.barracks);
    if (barracks) spawnGroup('guard', 2 + Math.round(density), centre(barracks));
    spawnGroup('guard', 2, s.gate);
  }
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
