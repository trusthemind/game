import { OPAQUE, SOLID, COVER, Tile } from './tiles';
import type { GridContainer } from '../items/inventory';
import type { Furniture } from './furniture';
import type { VehicleSpawn } from '../sim/vehicle';

/**
 * A set piece the renderer builds from its record. Tiles carry what matters to play (container stacks are
 * Tile.Container, the sea Tile.Water, a crane's legs blockers); this says what to draw there. Rects in tiles.
 * - stack: shipping containers, `levels` high (1–3), `color` index; long side along x if w > h.
 * - crane: a quay gantry crane straddling the quay edge; its boom reaches out over the water towards +y.
 * - ship: a moored cargo ship lying in the water; bow towards +x if w > h.
 * - monument: a statue on a plinth in the middle of a square.
 * - canopy: a petrol station's canopy over its pumps (pillars at the corners are blockers).
 * - garages: a row of lock-up garages (the boxes are wall tiles), doors facing +y if `color` is 0, −y if 1.
 * - bridge: a road or railway over water; railings along both long sides (along x if w > h).
 * - logs: a pile of sawn logs at a sawmill (a blocker), lying along x if w > h.
 */
export interface Structure {
  kind: 'stack' | 'crane' | 'ship' | 'monument' | 'canopy' | 'garages' | 'bridge' | 'logs' | 'tower' | 'silo' | 'hay' | 'lighthouse';
  x: number;
  y: number;
  w: number;
  h: number;
  levels?: number;
  color?: number;
}

export type BuildingKind = 'house' | 'shop' | 'clinic' | 'warehouse' | 'military' | 'apartment' | 'barn' | 'cabin' | 'bunker';

/**
 * A hatch: on the surface, a concrete collar with a steel lid; underground, the ladder up to it. Using one puts
 * you at its pair. The base's hatch needs the power on; the emergency hatch out in the woods only opens from
 * below (and stays open once it has been).
 */
export interface Hatch {
  id: number;
  x: number;
  y: number;
  /** The hatch at the other end. */
  to: number;
  underground: boolean;
  needsPower?: boolean;
  fromBelowOnly?: boolean;
  label: string;
}

export type District = 'town' | 'industrial' | 'military' | 'forest' | 'farm' | 'docks';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a room is for: decides its loot, its furniture and what the HUD calls it. */
export type RoomType =
  | 'kitchen'
  | 'living'
  | 'bedroom'
  | 'bathroom'
  | 'hall'
  | 'salesfloor'
  | 'storeroom'
  | 'office'
  | 'ward'
  | 'exam'
  | 'pharmacy'
  | 'storage'
  | 'dorm'
  | 'washroom'
  | 'lockers'
  | 'command'
  | 'radio'
  | 'armoury';

export const ROOM_NAMES: Record<RoomType, string> = {
  kitchen: 'Kitchen',
  living: 'Living room',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  hall: 'Hallway',
  salesfloor: 'Shop floor',
  storeroom: 'Stockroom',
  office: 'Office',
  ward: 'Ward',
  exam: 'Exam room',
  pharmacy: 'Pharmacy',
  storage: 'Storage',
  dorm: 'Dormitory',
  washroom: 'Washroom',
  lockers: 'Locker room',
  command: "Commander's office",
  radio: 'Radio room',
  armoury: 'Weapon storage',
};

export interface Room extends Rect {
  type?: RoomType;
}

export interface Building extends Rect {
  id: number;
  kind: BuildingKind;
  rooms: Room[];
  /** Storeys drawn (the ground floor is the one you walk in; the rest is the block above it). Default 1. */
  floors?: number;
}

export type ContainerKind =
  | 'wardrobe'
  | 'fridge'
  | 'drawer'
  | 'shelf'
  | 'register'
  | 'medcabinet'
  | 'crate'
  | 'toolbox'
  | 'weaponbox'
  | 'ammocrate'
  | 'safe'
  | 'jacket'
  | 'carTrunk'
  | 'stash'
  | 'modbox'
  | 'airdrop'
  | 'helicrate'
  | 'ground';

export interface LootContainer {
  id: number;
  kind: ContainerKind;
  x: number;
  y: number;
  grid: GridContainer;
  /** Items revealed so far by searching (Tarkov-style progressive search). */
  revealedUids: string[];
  /** Seconds accumulated towards revealing the next item. */
  searchT: number;
  searched: boolean;
  /** Not generated yet — loot rolls lazily on first open to keep raid start fast. */
  generated: boolean;
  tier: number;
  /** Item defs that are always in it on top of what it rolls (a key in the headquarters safe). */
  extra?: string[];
}

/** What an extraction point physically is: decides where it can stand and how it's drawn. */
export type ExtractKind =
  | 'checkpoint'
  | 'outpost'
  | 'gate'
  | 'bridge'
  | 'tunnel'
  | 'station'
  | 'path'
  | 'pier'
  | 'boat'
  | 'tower'
  | 'camp'
  | 'mill'
  | 'dam'
  | 'depot'
  | 'outlet'
  | 'crane'
  | 'overpass';

export interface Extraction {
  id: number;
  name: string;
  x: number;
  y: number;
  radius: number;
  kind: ExtractKind;
  /** Direction out of the map from here (radians, world x/y): the way you leave. */
  dir: number;
  /** A condition on leaving this way (none: anyone can). */
  rule?: ExtractRule;
}

/**
 * What an exit asks of you, Tarkov-style: the power back on (a switch somewhere on the map), the driver paid in
 * credits, or no backpack (a crawl through a tunnel).
 */
export type ExtractRule = { kind: 'power' } | { kind: 'fee'; amount: number } | { kind: 'noBackpack' };

/** A locked door: its tiles are LockedDoor until the key opens them (then `floor`). */
export interface Door {
  id: number;
  /** Tile indices it covers (a double door is two). */
  tiles: number[];
  /** Middle of the doorway. */
  x: number;
  y: number;
  /** Runs along x (in a wall along x). */
  alongX: boolean;
  /** Item def id of the key that opens it. */
  key: string;
  label: string;
  floor: Tile;
}

/** The base's power switch: thrown, it brings the power back on (and the exits that need it). */
export interface PowerSwitch {
  id: number;
  x: number;
  y: number;
  /** Which way the wall it hangs on faces (radians, world x/y). */
  facing: number;
  label: string;
}

/** Name → kind. Unknown names fall back by keyword, then to a gate. */
export function extractKind(name: string): ExtractKind {
  const n = name.toLowerCase();
  const rules: [RegExp, ExtractKind][] = [
    [/outpost|kordon|post\b/, 'outpost'],
    [/checkpoint|кпп/, 'checkpoint'],
    [/gas station/, 'station'],
    [/tunnel/, 'tunnel'],
    [/overpass/, 'overpass'],
    [/bridge/, 'bridge'],
    [/boat/, 'boat'],
    [/pier|ferry/, 'pier'],
    [/tower/, 'tower'],
    [/camp/, 'camp'],
    [/mill/, 'mill'],
    [/dam/, 'dam'],
    [/depot/, 'depot'],
    [/sewer|outlet/, 'outlet'],
    [/crane/, 'crane'],
    [/path|trail/, 'path'],
    [/gate/, 'gate'],
  ];
  return rules.find(([re]) => re.test(n))?.[1] ?? 'gate';
}

/** Kinds that belong on a road at the map edge (the rest stand off-road: trails, piers, towers). */
export const ROAD_EXTRACTS: ReadonlySet<ExtractKind> = new Set(['checkpoint', 'outpost', 'gate', 'bridge', 'tunnel', 'station', 'dam', 'depot', 'overpass']);

/** Axis-aligned box [x0, z0, x1, z1]. */
export type Box4 = readonly [number, number, number, number];

/**
 * The solid parts of each kind's set dressing (booths, towers, water, embankments), in the extraction's local
 * frame: origin at the extraction circle, +z out of the map (the edge treeline starts at z ≈ 7.5), x across.
 * The lane |x| < 2.5 from the circle out to the edge always stays open. The renderer draws to these footprints.
 */
export const EXTRACT_SOLIDS: Record<ExtractKind, readonly Box4[]> = {
  checkpoint: [[-5.8, -0.8, -3.4, 2.0], [2.9, 2.6, 3.5, 7.4], [-3.5, 2.6, -2.9, 7.4], [2.7, -4.4, 5.2, -3.8], [-5.2, -6.4, -2.7, -5.8], [4.4, -1.4, 6.6, 1.6]],
  outpost: [[-6.4, 1.0, -4.0, 3.4], [3.1, -0.6, 3.7, 3.6], [3.1, 3.6, 6.8, 4.2], [-3.7, -2.6, -3.1, 0.4], [3.8, -6.0, 7.2, -2.6], [2.8, 6.0, 8.5, 6.8], [-8.5, 6.0, -2.8, 6.8]],
  gate: [[3.0, 2.2, 8.5, 2.6], [-8.5, 2.2, -3.0, 2.6], [4.0, -2.8, 7.2, 0.6]],
  bridge: [[-9.5, 2.6, -2.4, 9.5], [2.4, 2.6, 9.5, 9.5]],
  tunnel: [[-9.5, 3.0, -2.6, 9.5], [2.6, 3.0, 9.5, 9.5]],
  station: [[3.0, -1.6, 4.2, 2.0], [-4.2, -1.6, -3.0, 2.0], [-8.4, -6.0, -4.8, -2.0], [5.4, -5.6, 6.2, -4.8], [4.7, -0.7, 6.5, 3.5]],
  path: [[-5.0, -1.4, -2.4, -0.8]],
  pier: [[-9.5, 1.6, -1.6, 9.5], [1.6, 1.6, 9.5, 9.5], [-5.6, -3.4, -3.0, -0.8]],
  boat: [[-9.5, 1.2, -1.3, 9.5], [1.3, 1.2, 9.5, 9.5], [-4.8, -1.8, -3.0, -0.4], [3.2, -3.8, 6.4, -1.0]],
  tower: [[-6.6, -0.6, -3.4, 2.6], [3.4, -3.4, 7.0, -0.2], [3.4, 0.4, 5.8, 1.3]],
  camp: [[-7.6, -1.4, -3.2, 1.4], [3.2, 1.4, 7.6, 3.8], [3.4, -5.0, 8.0, -2.4]],
  mill: [[-9.5, 2.2, -1.1, 4.4], [1.1, 2.2, 9.5, 4.4], [-8.4, -2.4, -4.0, 2.2]],
  dam: [[-9.5, -7.0, -2.6, 9.5], [2.6, -7.0, 9.5, 9.5]],
  depot: [[3.0, 0.4, 9.5, 9.5], [-5.8, -4.8, -3.2, 4.8]],
  outlet: [[-9.5, 3.4, -1.7, 9.5], [1.7, 3.4, 9.5, 9.5]],
  crane: [[-7.2, -1.6, -3.8, 1.6], [3.2, -4.2, 5.8, 2.4], [-8.8, 3.6, -2.8, 6.2]],
  overpass: [[-4.8, 0.2, -3.6, 1.8], [3.6, 0.2, 4.8, 1.8], [8.2, -2.4, 10.5, 4.4], [-10.5, -2.4, -8.2, 4.4], [2.2, -3.2, 3.6, -2.4], [-7.1, -3.7, -5.3, 0.5]],
};

/** Local frame → world: local +z points along `dir`, local +x 90° clockwise of it. */
export function extractToWorld(e: Pick<Extraction, 'x' | 'y' | 'dir'>, lx: number, lz: number): { x: number; y: number } {
  const c = Math.round(Math.cos(e.dir));
  const s = Math.round(Math.sin(e.dir));
  return { x: e.x + lx * s + lz * c, y: e.y - lx * c + lz * s };
}

/** World-space boxes of an extraction's solid set dressing. */
export function extractSolids(e: Extraction): [number, number, number, number][] {
  return EXTRACT_SOLIDS[e.kind].map(([x0, z0, x1, z1]) => {
    const a = extractToWorld(e, x0, z0);
    const b = extractToWorld(e, x1, z1);
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  });
}

export type BotArchetype = 'scav' | 'raider' | 'infected' | 'boss' | 'guard';

export interface BotSpawn {
  archetype: BotArchetype;
  x: number;
  y: number;
  group: number;
  /** Named boss id (see BOSSES) for the boss itself. */
  boss?: string;
}

/**
 * A named place (callout), as players would call it: the Sawmill, the Army Base and its Barracks, the Gas
 * Station. `major` places are labelled large on the map; the rest are the spots inside them.
 */
export interface Place {
  name: string;
  x: number;
  y: number;
  /** Rough radius it covers. */
  r: number;
  major: boolean;
}

export interface Site {
  kind: 'base';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Middle of the gap in the fence. */
  gate: { x: number; y: number };
  /** Building ids by role. */
  buildings: Partial<Record<'barracks' | 'hq' | 'armoury', number>>;
}

export class GameMap {
  readonly tiles: Uint8Array;
  /** Per-tile building id + 1 (0 = outdoors). */
  readonly buildingAt: Uint16Array;
  buildings: Building[] = [];
  containers: LootContainer[] = [];
  extractions: Extraction[] = [];
  botSpawns: BotSpawn[] = [];
  playerSpawn = { x: 0, y: 0 };
  /** Where a raid can start (the map's fixed spawn points round its edges); each raid picks one. */
  spawnPoints: { x: number; y: number }[] = [];
  /** Outdoor / indoor points of interest used by patrolling AI. */
  pois: { x: number; y: number }[] = [];
  mapId = 'custom';
  name = 'Unknown';
  /** District index per tile (into `districts`). */
  districtAt: Uint8Array;
  districts: { kind: District; x: number; y: number; name: string }[] = [];
  furniture: Furniture[] = [];
  /** Drivable cars and roadside wrecks (sim/vehicle.ts). */
  vehicleSpawns: VehicleSpawn[] = [];
  /** Laid-out places (an army base, later bunkers and blocks of flats): their fence line, gate and buildings. */
  sites: Site[] = [];
  /** Locked doors (the armoury's). */
  doors: Door[] = [];
  /** Named places (callouts) for the map screen and the HUD. */
  places: Place[] = [];
  /** Power switches. */
  switches: PowerSwitch[] = [];
  /** Hatches between the surface and the bunker. */
  hatches: Hatch[] = [];
  /** Big set pieces drawn from these records (their footprint is already in the tiles): cranes, ships, stacks. */
  structures: Structure[] = [];
  /** Per-tile furniture id + 1 for pieces that block movement (0 = free; 0xffff = other set dressing). */
  readonly furnitureAt: Uint16Array;
  readonly furnitureCells = new Map<number, Pick<Furniture, 'box'>[]>();

  /**
   * Rows from here down are underground (a bunker's strip below the map's south edge, walled off and reached
   * only by its hatches). The surface is everything above.
   */
  surfaceH: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly seed: number,
  ) {
    this.surfaceH = height;
    this.tiles = new Uint8Array(width * height);
    this.buildingAt = new Uint16Array(width * height);
    this.districtAt = new Uint8Array(width * height);
    this.furnitureAt = new Uint16Array(width * height);
  }

  /** What players would call where (x, y) is: "Army Base · Barracks", "Sawmill", or the district's name. */
  placeAt(x: number, y: number): string {
    let major: Place | null = null;
    let spot: Place | null = null;
    for (const p of this.places) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > p.r) continue;
      if (p.major && (!major || p.r < major.r)) major = p;
      if (!p.major && (!spot || d < Math.hypot(spot.x - x, spot.y - y))) spot = p;
    }
    const district = this.inBounds(Math.floor(x), Math.floor(y)) ? this.districts[this.districtAt[this.idx(Math.floor(x), Math.floor(y))]!]?.name : undefined;
    const top = major?.name ?? district ?? '';
    const where = spot ? `${top} · ${spot.name}` : top;
    // Indoors: which room, too.
    const room = this.roomAt(x, y);
    return room?.type ? `${where} · ${ROOM_NAMES[room.type]}` : where;
  }

  /** The room (x, y) is in, if it's inside a building. */
  roomAt(x: number, y: number): Room | null {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inBounds(tx, ty)) return null;
    const b = this.buildingAt[this.idx(tx, ty)];
    if (!b) return null;
    const bl = this.buildings[b - 1];
    return bl?.rooms.find((r) => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) ?? null;
  }

  districtOf(x: number, y: number): District | null {
    if (!this.inBounds(x, y)) return null;
    return this.districts[this.districtAt[this.idx(x, y)]!]?.kind ?? null;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  get(x: number, y: number): Tile {
    if (!this.inBounds(x, y)) return Tile.Border;
    return this.tiles[y * this.width + x] as Tile;
  }

  set(x: number, y: number, t: Tile): void {
    if (this.inBounds(x, y)) this.tiles[y * this.width + x] = t;
  }

  isSolid(x: number, y: number): boolean {
    return SOLID[this.get(x, y)] === 1;
  }

  isOpaque(x: number, y: number): boolean {
    return OPAQUE[this.get(x, y)] === 1;
  }

  blocksBullets(x: number, y: number): boolean {
    return COVER[this.get(x, y)] === 1;
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    return SOLID[this.tiles[i]!] === 0 && this.furnitureAt[i] === 0;
  }

  /** Blocking furniture whose box reaches into this tile, for collision. */
  furnitureTouching(x: number, y: number): readonly Pick<Furniture, 'box'>[] | undefined {
    return this.furnitureCells.get(y * this.width + x);
  }

  /**
   * A solid box of outdoor set dressing (a guard booth, water): collides like furniture, and tiles it mostly
   * covers drop out of pathing. Doesn't stop sight or bullets.
   */
  addBlocker(box: [number, number, number, number]): void {
    const b = { box };
    for (let y = Math.floor(box[1]); y < Math.ceil(box[3]); y++)
      for (let x = Math.floor(box[0]); x < Math.ceil(box[2]); x++) {
        if (!this.inBounds(x, y)) continue;
        const k = this.idx(x, y);
        const cell = this.furnitureCells.get(k);
        if (cell) cell.push(b);
        else this.furnitureCells.set(k, [b]);
        const cw = Math.min(box[2], x + 1) - Math.max(box[0], x);
        const ch = Math.min(box[3], y + 1) - Math.max(box[1], y);
        if (cw >= 0.5 && ch >= 0.5 && !this.furnitureAt[k]) this.furnitureAt[k] = 0xffff;
      }
  }

  isIndoors(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.buildingAt[y * this.width + x]! > 0;
  }

  /** Cast a ray over the tile grid (DDA). Returns true when nothing blocking (per `blocks`) lies between a and b. */
  rayClear(ax: number, ay: number, bx: number, by: number, blocks: Uint8Array = OPAQUE): boolean {
    return this.raycast(ax, ay, bx, by, blocks) < 0;
  }

  /**
   * Amanatides–Woo voxel traversal. Returns the distance at which the ray hits a blocking tile, or -1 if it reaches (bx,by).
   */
  raycast(ax: number, ay: number, bx: number, by: number, blocks: Uint8Array = OPAQUE): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return -1;
    const dirX = dx / len;
    const dirY = dy / len;
    let x = Math.floor(ax);
    let y = Math.floor(ay);
    const endX = Math.floor(bx);
    const endY = Math.floor(by);
    const stepX = dirX > 0 ? 1 : -1;
    const stepY = dirY > 0 ? 1 : -1;
    const tDeltaX = dirX !== 0 ? Math.abs(1 / dirX) : Infinity;
    const tDeltaY = dirY !== 0 ? Math.abs(1 / dirY) : Infinity;
    let tMaxX = dirX !== 0 ? (dirX > 0 ? x + 1 - ax : ax - x) * tDeltaX : Infinity;
    let tMaxY = dirY !== 0 ? (dirY > 0 ? y + 1 - ay : ay - y) * tDeltaY : Infinity;
    let t: number;
    for (let guard = 0; guard < 1024; guard++) {
      if (x === endX && y === endY) return -1;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
      }
      if (t > len) return -1;
      if (blocks[this.get(x, y)] === 1) return t;
    }
    return -1;
  }
}
