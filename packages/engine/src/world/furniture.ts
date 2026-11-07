import { Rng } from '../core/rng';
import type { Building, BuildingKind, GameMap, Rect, RoomType } from './map';
import { Tile } from './tiles';

/**
 * Decorative furniture. Big pieces (beds, sofas, wardrobes, tables) block movement and pathing but not
 * sight or bullets; small ones (chairs, lamps, plants) are pure set dressing. Placement never cuts a room
 * off: every piece is checked against a flood fill of the building before it's committed.
 */
export type FurnitureKind =
  | 'bed'
  | 'bed_double'
  | 'bookcase'
  | 'bookcase_empty'
  | 'shelf_large'
  | 'chair'
  | 'armchair'
  | 'closet'
  | 'dresser'
  | 'coffee_table'
  | 'lamp'
  | 'plant'
  | 'sofa'
  | 'stool'
  | 'table'
  | 'vase'
  // Soviet household pieces (Sketchfab, CC BY): kitchens, bathrooms, living rooms.
  | 'gas_stove'
  | 'fridge_old'
  | 'bathtub'
  | 'toilet'
  | 'tv'
  | 'radiator'
  | 'wardrobe_old'
  | 'chair_old'
  // The second Sketchfab set (CC BY): barracks, offices, the clinic, stores, the radio room and the armoury.
  | 'bunk_bed'
  | 'locker'
  | 'metal_cabinet'
  | 'metal_table'
  | 'office_chair'
  | 'metal_shelf'
  | 'store_shelf'
  | 'gun_rack'
  | 'filing_cabinet'
  | 'server_rack'
  | 'hospital_bed'
  | 'med_cupboard'
  | 'sofa_soviet'
  | 'armchair_soviet'
  | 'table_wood'
  | 'rifle_box'
  | 'generator'
  | 'school_desk'
  | 'bookshelf_soviet';

/** Footprint in metres: w across the front, d front-to-back. */
export const FURNITURE_SIZE: Record<FurnitureKind, { w: number; d: number; blocks: boolean }> = {
  bed: { w: 1.2, d: 1.95, blocks: true },
  bed_double: { w: 1.85, d: 2.0, blocks: true },
  bookcase: { w: 0.9, d: 0.55, blocks: true },
  bookcase_empty: { w: 0.9, d: 0.55, blocks: true },
  shelf_large: { w: 1.95, d: 0.56, blocks: true },
  chair: { w: 0.42, d: 0.41, blocks: false },
  armchair: { w: 0.42, d: 0.41, blocks: false },
  closet: { w: 0.87, d: 0.46, blocks: true },
  dresser: { w: 0.76, d: 0.53, blocks: true },
  coffee_table: { w: 1.0, d: 0.58, blocks: true },
  lamp: { w: 0.35, d: 0.37, blocks: false },
  plant: { w: 0.34, d: 0.8, blocks: false },
  sofa: { w: 1.85, d: 1.0, blocks: true },
  stool: { w: 0.37, d: 0.36, blocks: false },
  table: { w: 1.35, d: 1.24, blocks: true },
  vase: { w: 0.33, d: 0.33, blocks: false },
  gas_stove: { w: 0.59, d: 0.43, blocks: true },
  fridge_old: { w: 0.85, d: 0.75, blocks: true },
  bathtub: { w: 1.6, d: 0.76, blocks: true },
  toilet: { w: 0.43, d: 0.67, blocks: true },
  tv: { w: 0.6, d: 0.46, blocks: false },
  radiator: { w: 0.9, d: 0.1, blocks: false },
  wardrobe_old: { w: 0.98, d: 0.56, blocks: true },
  chair_old: { w: 0.45, d: 0.47, blocks: false },
  bunk_bed: { w: 1.5, d: 2.04, blocks: true },
  locker: { w: 1.97, d: 0.48, blocks: true },
  metal_cabinet: { w: 1.02, d: 0.58, blocks: true },
  metal_table: { w: 1.73, d: 0.87, blocks: true },
  office_chair: { w: 0.71, d: 0.75, blocks: false },
  metal_shelf: { w: 1.42, d: 0.53, blocks: true },
  store_shelf: { w: 1.47, d: 0.66, blocks: true },
  gun_rack: { w: 1.17, d: 0.46, blocks: true },
  filing_cabinet: { w: 0.37, d: 0.72, blocks: true },
  server_rack: { w: 0.65, d: 0.65, blocks: true },
  hospital_bed: { w: 1.3, d: 2.0, blocks: true },
  med_cupboard: { w: 0.51, d: 0.26, blocks: true },
  sofa_soviet: { w: 2.11, d: 0.92, blocks: true },
  armchair_soviet: { w: 0.69, d: 0.65, blocks: true },
  table_wood: { w: 1.43, d: 0.77, blocks: true },
  rifle_box: { w: 1.3, d: 0.43, blocks: true },
  generator: { w: 1.07, d: 0.6, blocks: true },
  school_desk: { w: 1.37, d: 1.06, blocks: true },
  bookshelf_soviet: { w: 1.04, d: 0.78, blocks: true },
};

export interface Furniture {
  id: number;
  kind: FurnitureKind;
  /** Centre in world units. */
  x: number;
  y: number;
  /** Direction the front faces (radians, world x/y). */
  dir: number;
  /** Axis-aligned world box [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  blocks: boolean;
}

/** How far a wall's face sits from the edge of the room tiles (wall pillar half-thickness is 0.16). */
const WALL_GAP = 0.5 - 0.16;
/** A tile counts as blocked when the box covers at least this much of it on both axes. */
const BLOCK_COVER = 0.2;

type Side = 0 | 1 | 2 | 3; // wall on the north, east, south, west of the room

interface Theme {
  wall: [FurnitureKind, number][];
  /** Each wall piece at most once (a bathroom has one tub). */
  unique?: boolean;
  centre?: FurnitureKind;
  decor: FurnitureKind[];
  /**
   * Rows first: one piece after another along the walls (`long`: the room's two long walls; `all`: every wall),
   * `gap` metres apart, `max` in all: bunks down a dormitory, lockers, gun racks, ward beds, server racks.
   */
  rows?: { kind: FurnitureKind; walls: 'long' | 'one' | 'all'; gap: number; max?: number }[];
  /** Shelving in back-to-back runs down the middle of a big room, with aisles between (a shop, a store). */
  aisles?: FurnitureKind;
  /** Desks against the walls, each with its chair in front (none for a school desk with its bench). */
  desks?: { desk: FurnitureKind; chair?: FurnitureKind; n: number };
}

const HOME_THEMES: Theme[] = [
  { wall: [['bed', 1], ['wardrobe_old', 1], ['dresser', 1]], decor: ['lamp', 'radiator'] },
  { wall: [['bed_double', 1], ['closet', 1], ['wardrobe_old', 1]], decor: ['lamp', 'vase', 'radiator'] },
  { wall: [['sofa', 1], ['bookcase', 2], ['dresser', 1]], centre: 'coffee_table', decor: ['armchair', 'tv', 'plant', 'radiator'] },
  // Kitchen: stove, fridge and a cupboard along the walls, a table with chairs in the middle.
  { wall: [['gas_stove', 1], ['fridge_old', 1], ['dresser', 1]], unique: true, centre: 'table', decor: ['chair_old', 'chair_old', 'chair_old', 'radiator'] },
];

/** The smallest room of a home with two or more rooms is its bathroom (when it's bathroom-sized). */
const BATHROOM: Theme = { wall: [['bathtub', 1], ['toilet', 1]], unique: true, decor: ['radiator'] };

const THEMES: Record<BuildingKind, Theme[]> = {
  house: HOME_THEMES,
  apartment: HOME_THEMES,
  cabin: [
    { wall: [['bed', 1], ['bookcase_empty', 1]], centre: 'table', decor: ['stool', 'chair', 'lamp'] },
    { wall: [['bed', 2]], decor: ['stool', 'vase'] },
  ],
  shop: [{ wall: [['shelf_large', 3], ['bookcase_empty', 2]], decor: ['plant', 'stool'] }],
  clinic: [
    { wall: [['bed', 3], ['dresser', 1]], decor: ['chair', 'plant'] },
    { wall: [['bookcase', 1], ['closet', 1]], centre: 'table', decor: ['chair', 'chair', 'lamp'] },
  ],
  warehouse: [{ wall: [['shelf_large', 4], ['bookcase_empty', 1]], centre: 'table', decor: ['stool', 'stool'] }],
  military: [
    { wall: [['bed', 4], ['closet', 2]], decor: ['stool'] },
    { wall: [['shelf_large', 2], ['closet', 1]], centre: 'table', decor: ['chair', 'chair', 'chair'] },
  ],
  barn: [{ wall: [['shelf_large', 1]], decor: ['stool'] }],
  bunker: [{ wall: [['metal_shelf', 3], ['generator', 1]], decor: ['stool'] }],
};

/**
 * Furniture by what a room is for (see assignRoomTypes in mapGen): a kitchen gets its stove and fridge and a
 * table with chairs, a dormitory its rows of bunks, the commander's office a desk with chairs round it, the
 * weapon storage racks and nothing to sleep on. A room without a type falls back to its building's themes.
 */
const ROOM_THEMES: Record<RoomType, Theme[]> = {
  kitchen: [
    { wall: [['gas_stove', 1], ['fridge_old', 1], ['dresser', 1], ['metal_cabinet', 1]], unique: true, centre: 'table_wood', decor: ['chair_old', 'chair_old', 'chair_old', 'radiator'] },
  ],
  living: [
    { wall: [['sofa_soviet', 1], ['bookshelf_soviet', 1], ['tv', 1], ['dresser', 1]], unique: true, centre: 'coffee_table', decor: ['armchair_soviet', 'armchair_soviet', 'plant', 'radiator'] },
    { wall: [['sofa', 1], ['bookshelf_soviet', 1], ['bookcase', 1], ['tv', 1]], unique: true, centre: 'coffee_table', decor: ['armchair_soviet', 'lamp', 'radiator'] },
  ],
  bedroom: [
    { wall: [['bed', 1], ['wardrobe_old', 1], ['dresser', 1], ['bookshelf_soviet', 1]], unique: true, decor: ['lamp', 'radiator'] },
    { wall: [['bed_double', 1], ['wardrobe_old', 1], ['closet', 1]], unique: true, decor: ['lamp', 'radiator', 'chair_old'] },
  ],
  bathroom: [BATHROOM],
  hall: [{ wall: [['closet', 1], ['wardrobe_old', 1]], unique: true, decor: ['radiator'] }],
  salesfloor: [{ aisles: 'store_shelf', rows: [{ kind: 'store_shelf', walls: 'long', gap: 0.05 }], wall: [], decor: ['plant'] }],
  storeroom: [{ aisles: 'metal_shelf', rows: [{ kind: 'metal_shelf', walls: 'long', gap: 0.1 }], wall: [], decor: [] }],
  office: [
    { desks: { desk: 'metal_table', chair: 'office_chair', n: 2 }, wall: [['filing_cabinet', 2], ['bookshelf_soviet', 1], ['metal_cabinet', 1]], decor: ['plant', 'radiator'] },
    { desks: { desk: 'school_desk', n: 2 }, wall: [['filing_cabinet', 2], ['bookcase', 1]], decor: ['plant'] },
  ],
  ward: [{ rows: [{ kind: 'hospital_bed', walls: 'long', gap: 0.7, max: 6 }], wall: [['med_cupboard', 1]], decor: ['chair', 'radiator'] }],
  exam: [{ wall: [['hospital_bed', 1], ['med_cupboard', 1], ['metal_cabinet', 1]], unique: true, desks: { desk: 'metal_table', chair: 'chair_old', n: 1 }, decor: ['lamp'] }],
  pharmacy: [{ rows: [{ kind: 'med_cupboard', walls: 'all', gap: 0.1, max: 6 }], wall: [['metal_cabinet', 1]], decor: ['stool'] }],
  storage: [
    { aisles: 'metal_shelf', rows: [{ kind: 'metal_shelf', walls: 'long', gap: 0.1 }], wall: [], decor: ['rifle_box'] },
    { rows: [{ kind: 'metal_shelf', walls: 'all', gap: 0.1 }], wall: [], decor: ['rifle_box', 'stool'] },
  ],
  dorm: [{ rows: [{ kind: 'bunk_bed', walls: 'long', gap: 0.35 }], wall: [['locker', 2]], decor: ['stool', 'radiator'] }],
  washroom: [{ rows: [{ kind: 'toilet', walls: 'one', gap: 0.35, max: 4 }], wall: [], decor: ['radiator'] }],
  lockers: [{ rows: [{ kind: 'locker', walls: 'all', gap: 0.02, max: 14 }], wall: [], centre: 'metal_table', decor: ['stool', 'stool'] }],
  command: [
    { desks: { desk: 'metal_table', chair: 'office_chair', n: 1 }, wall: [['bookshelf_soviet', 1], ['filing_cabinet', 1], ['sofa_soviet', 1]], unique: true, centre: 'table', decor: ['office_chair', 'office_chair', 'office_chair', 'plant'] },
  ],
  radio: [{ rows: [{ kind: 'server_rack', walls: 'one', gap: 0.08, max: 5 }], desks: { desk: 'metal_table', chair: 'office_chair', n: 1 }, wall: [['filing_cabinet', 1]], decor: ['tv'] }],
  armoury: [{ rows: [{ kind: 'gun_rack', walls: 'all', gap: 0.15, max: 8 }], wall: [], decor: ['rifle_box', 'rifle_box'] }],
};

/** Furnish every building. Uses its own RNG stream so the rest of map generation is unaffected. */
export function furnish(map: GameMap): void {
  for (const b of map.buildings) furnishBuilding(map, b, new Rng((map.seed ^ Math.imul(b.id + 1, 0x9e3779b1)) >>> 0));
}

function furnishBuilding(map: GameMap, b: Building, rng: Rng): void {
  for (const room of b.rooms) {
    if (room.w < 3 || room.h < 3) continue;
    const area = room.w * room.h;
    const theme = rng.pick(room.type ? ROOM_THEMES[room.type] : THEMES[b.kind]);
    // The big things in order first: rows along the walls, aisles down the middle, desks with their chairs.
    // The room's loot boxes step aside for them and go back by a wall once they're in.
    const inRoom = (c: { x: number; y: number }) => c.x >= room.x && c.y >= room.y && c.x < room.x + room.w && c.y < room.y + room.h;
    const laidOut = !!(theme.rows || theme.aisles || theme.desks);
    const boxes = laidOut ? map.containers.filter(inRoom) : [];
    if (boxes.length) map.containers = map.containers.filter((c) => !boxes.includes(c));
    let placed = 0;
    for (const row of theme.rows ?? []) placed += placeRows(map, b, room, row, rng);
    if (theme.aisles && Math.min(room.w, room.h) >= 6) placed += placeAisles(map, b, room, theme.aisles);
    for (let k = 0; k < (theme.desks?.n ?? 0); k++)
      for (let t = 0; t < 10; t++) if (placeDesk(map, b, room, theme.desks!.desk, theme.desks!.chair, rng)) break;
    for (const c of boxes) {
      const spot = freeSpot(map, room, rng);
      if (!spot) continue;
      c.x = spot.x;
      c.y = spot.y;
      map.containers.push(c);
    }
    const wallPieces = Math.max(placed ? 1 : 2, Math.min(7, Math.round(area / 9)) - placed);
    const pool = [...theme.wall];
    for (let i = 0; i < wallPieces && pool.length; i++) {
      const kind = rng.weighted(pool);
      if (theme.unique) pool.splice(pool.findIndex(([k]) => k === kind), 1);
      for (let tries = 0; tries < 14; tries++) if (placeAgainstWall(map, b, room, kind, rng)) break;
    }
    if (theme.centre && room.w >= 4 && room.h >= 4) placeCentre(map, b, room, theme.centre, theme.decor, rng);
    else for (const k of theme.decor) if (rng.chance(0.6)) for (let t = 0; t < 6; t++) if (placeAgainstWall(map, b, room, k, rng)) break;
  }
}

/**
 * A floor tile in the room for a loot box once the furniture is in: open, not a doorway, nothing else on it
 * or beside it, backed by a wall or a piece of furniture if possible.
 */
function freeSpot(map: GameMap, room: Rect, rng: Rng): { x: number; y: number } | null {
  let fallback: { x: number; y: number } | null = null;
  for (let t = 0; t < 60; t++) {
    const x = room.x + rng.int(0, room.w - 1);
    const y = room.y + rng.int(0, room.h - 1);
    if (!map.isWalkable(x, y) || map.containers.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < 2)) continue;
    if (map.furniture.some((f) => overlaps([x + 0.05, y + 0.05, x + 0.95, y + 0.95], f.box))) continue;
    const solid = (dx: number, dy: number) => !map.isWalkable(x + dx, y + dy);
    if ((solid(-1, 0) && solid(1, 0)) || (solid(0, -1) && solid(0, 1))) continue;
    if (solid(-1, 0) || solid(1, 0) || solid(0, -1) || solid(0, 1)) return { x, y };
    fallback ??= { x, y };
  }
  return fallback;
}

/** The walls of a room by side, longest first. */
function sidesOf(room: Rect, which: 'long' | 'one' | 'all', rng: Rng): Side[] {
  const longX = room.w >= room.h;
  const long: Side[] = longX ? [0, 2] : [1, 3];
  const short: Side[] = longX ? [1, 3] : [0, 2];
  if (which === 'one') return [rng.pick(long)];
  return which === 'long' ? rng.shuffle(long) : [...rng.shuffle(long), ...rng.shuffle(short)];
}

/** Pieces in a row along walls, from one end, `gap` apart; skips doorways and windows. */
function placeRows(map: GameMap, b: Building, room: Rect, row: NonNullable<Theme['rows']>[number], rng: Rng): number {
  const { w } = FURNITURE_SIZE[row.kind];
  let n = 0;
  for (const side of sidesOf(room, row.walls, rng)) {
    const span = side === 0 || side === 2 ? room.w : room.h;
    for (let along = 0.15; along + w <= span - 0.1 && n < (row.max ?? 99); along += 0.25) {
      if (!placeAt(map, b, room, row.kind, side, along)) continue;
      n++;
      along += w + row.gap - 0.25;
    }
  }
  return n;
}

/**
 * Free-standing runs of shelving down the middle of a big room, parallel to its long side, back to back in
 * pairs with a 1.3 m aisle between pairs, a metre and a half clear of the walls (and the rows on them).
 */
function placeAisles(map: GameMap, b: Building, room: Rect, kind: FurnitureKind): number {
  const { w, d } = FURNITURE_SIZE[kind];
  const longX = room.w >= room.h;
  const len = longX ? room.w : room.h;
  const across = longX ? room.h : room.w;
  let n = 0;
  for (let off = 1.6; off + d * 2 <= across - 1.6; off += d * 2 + 1.3) {
    for (const back of [0, 1]) {
      const o = off + back * d;
      for (let a = 1.3; a + w <= len - 1.3; a += w + 0.02) {
        const box: [number, number, number, number] = longX ? [room.x + a, room.y + o, room.x + a + w, room.y + o + d] : [room.x + o, room.y + a, room.x + o + d, room.y + a + w];
        // Each half faces its own aisle.
        const dir = longX ? (back ? Math.PI / 2 : -Math.PI / 2) : back ? 0 : Math.PI;
        if (commit(map, b, kind, box, dir)) n++;
      }
    }
  }
  return n;
}

/** A desk against a wall with its chair pulled up in front of it. */
function placeDesk(map: GameMap, b: Building, room: Rect, desk: FurnitureKind, chair: FurnitureKind | undefined, rng: Rng): boolean {
  const side = rng.int(0, 3) as Side;
  const span = side === 0 || side === 2 ? room.w : room.h;
  const { w, d } = FURNITURE_SIZE[desk];
  if (span < w + 0.4) return false;
  const f = placeAt(map, b, room, desk, side, rng.int(0, Math.max(0, Math.floor(span - w))) + (Math.ceil(w) - w) / 2);
  if (!f) return false;
  if (!chair) return true;
  const front = FRONT[side];
  const c = FURNITURE_SIZE[chair];
  // Clear of the desk's padding (pieces keep 12 cm apart).
  const cx = f.x + Math.cos(front) * (d / 2 + c.d / 2 + 0.15);
  const cy = f.y + Math.sin(front) * (d / 2 + c.d / 2 + 0.15);
  commit(map, b, chair, [cx - c.w / 2, cy - c.d / 2, cx + c.w / 2, cy + c.d / 2], front + Math.PI);
  return true;
}

/** Front direction for a piece backed against the given wall. */
const FRONT: Record<Side, number> = { 0: Math.PI / 2, 1: Math.PI, 2: -Math.PI / 2, 3: 0 };

function placeAgainstWall(map: GameMap, b: Building, room: Rect, kind: FurnitureKind, rng: Rng): boolean {
  const { w } = FURNITURE_SIZE[kind];
  const side = rng.int(0, 3) as Side;
  const span = side === 0 || side === 2 ? room.w : room.h;
  if (span < w + 0.4) return false;
  // Position along the wall (metres from the room edge), snapped so pieces line up with tiles.
  const along = rng.int(0, Math.max(0, Math.floor(span - w))) + (Math.ceil(w) - w) / 2;
  return !!placeAt(map, b, room, kind, side, along);
}

/** Pieces that can stand under a window (a bed, a sofa, a table): rows of them would be few otherwise. */
const UNDER_WINDOW = new Set<FurnitureKind>(['bunk_bed', 'hospital_bed', 'bed', 'bed_double', 'sofa', 'sofa_soviet', 'table_wood', 'metal_table', 'radiator']);

/** A piece backed against one wall of the room, `along` metres from that wall's start. */
function placeAt(map: GameMap, b: Building, room: Rect, kind: FurnitureKind, side: Side, along: number): Furniture | null {
  const { w, d } = FURNITURE_SIZE[kind];
  const horizontal = side === 0 || side === 2;
  let x0: number, y0: number, x1: number, y1: number;
  if (horizontal) {
    x0 = room.x + along;
    x1 = x0 + w;
    if (side === 0) {
      y0 = room.y - WALL_GAP;
      y1 = y0 + d;
    } else {
      y1 = room.y + room.h + WALL_GAP;
      y0 = y1 - d;
    }
  } else {
    y0 = room.y + along;
    y1 = y0 + w;
    if (side === 3) {
      x0 = room.x - WALL_GAP;
      x1 = x0 + d;
    } else {
      x1 = room.x + room.w + WALL_GAP;
      x0 = x1 - d;
    }
  }
  // The wall behind must be a plain wall — no windows (vault spots) or doorways.
  const wallTiles: [number, number][] = [];
  if (horizontal) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) wallTiles.push([x, side === 0 ? room.y - 1 : room.y + room.h]);
  else for (let y = Math.floor(y0); y < Math.ceil(y1); y++) wallTiles.push([side === 3 ? room.x - 1 : room.x + room.w, y]);
  const behind = (t: Tile) => t === Tile.Wall || (t === Tile.Window && UNDER_WINDOW.has(kind));
  if (wallTiles.some(([x, y]) => !behind(map.get(x, y)))) return null;
  return commit(map, b, kind, [x0, y0, x1, y1], FRONT[side]) ? map.furniture[map.furniture.length - 1]! : null;
}

function placeCentre(map: GameMap, b: Building, room: Rect, kind: FurnitureKind, decor: FurnitureKind[], rng: Rng): void {
  const { w, d } = FURNITURE_SIZE[kind];
  const cx = room.x + room.w / 2 + (rng.chance(0.5) ? 0 : 0.5) * (room.w % 2 === 0 ? 1 : 0);
  const cy = room.y + room.h / 2;
  const dir = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
  if (!commit(map, b, kind, [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2], dir)) return;
  // Chairs round a dining table, an armchair facing the coffee table, etc.: each pulled up just clear of the
  // table's edge, however deep the seat.
  const seats: [number, number, number][] = [
    [0, -1, Math.PI / 2],
    [0, 1, -Math.PI / 2],
    [-1, 0, 0],
    [1, 0, Math.PI],
  ];
  for (const k of decor) {
    const s = FURNITURE_SIZE[k];
    if (k === 'chair' || k === 'chair_old' || k === 'armchair' || k === 'stool' || k === 'office_chair' || k === 'armchair_soviet') {
      const seat = seats.splice(rng.int(0, seats.length - 1), 1)[0];
      if (!seat) continue;
      const [ux, uy, sd] = seat;
      const sx = cx + ux * (w / 2 + s.d / 2 + 0.15);
      const sy = cy + uy * (d / 2 + s.d / 2 + 0.15);
      commit(map, b, k, [sx - s.w / 2, sy - s.d / 2, sx + s.w / 2, sy + s.d / 2], sd);
    } else for (let t = 0; t < 6; t++) if (placeAgainstWall(map, b, room, k, rng)) break;
  }
}

function overlaps(a: readonly number[], c: readonly number[]): boolean {
  return a[0]! < c[2]! && c[0]! < a[2]! && a[1]! < c[3]! && c[1]! < a[3]!;
}

/** Tiles a box blocks for pathing. */
function blockedTiles(box: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.floor(box[1]!); y < Math.ceil(box[3]!); y++)
    for (let x = Math.floor(box[0]!); x < Math.ceil(box[2]!); x++) {
      const cw = Math.min(box[2]!, x + 1) - Math.max(box[0]!, x);
      const ch = Math.min(box[3]!, y + 1) - Math.max(box[1]!, y);
      if (cw >= BLOCK_COVER && ch >= BLOCK_COVER) out.push([x, y]);
    }
  return out;
}

function commit(map: GameMap, b: Building, kind: FurnitureKind, box: [number, number, number, number], dir: number): boolean {
  const size = FURNITURE_SIZE[kind];
  const pad = 0.12;
  const padded = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  if (map.furniture.some((f) => overlaps(padded, f.box))) return false;
  // Keep loot containers reachable and visible: nothing on top of or hard against them.
  if (map.containers.some((c) => overlaps(padded, [c.x + 0.05, c.y + 0.05, c.x + 0.95, c.y + 0.95]))) return false;
  // Nor in front of a ladder.
  if (map.hatches.some((h) => overlaps(padded, [h.x - 0.9, h.y - 0.9, h.x + 0.9, h.y + 0.9]))) return false;
  const tiles = size.blocks ? blockedTiles(box) : [];
  // Reaching into a wall or window tile is fine (that's the gap behind the wall face); every other tile must be
  // free floor of this building.
  const inside = tiles.filter(([x, y]) => map.get(x, y) !== Tile.Wall && map.get(x, y) !== Tile.Window);
  if (inside.some(([x, y]) => map.buildingAt[map.idx(x, y)] !== b.id + 1 || !map.isWalkable(x, y))) return false;
  if (inside.length && !staysConnected(map, b, inside)) return false;
  const id = map.furniture.length;
  const f: Furniture = { id, kind, x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, dir, box, blocks: size.blocks };
  map.furniture.push(f);
  if (!size.blocks) return true;
  for (const [x, y] of inside) map.furnitureAt[map.idx(x, y)] = id + 1;
  for (let y = Math.floor(box[1]); y < Math.ceil(box[3]); y++)
    for (let x = Math.floor(box[0]); x < Math.ceil(box[2]); x++) {
      const k = map.idx(x, y);
      const cell = map.furnitureCells.get(k);
      if (cell) cell.push(f);
      else map.furnitureCells.set(k, [f]);
    }
  return true;
}

/** True if blocking `tiles` leaves every other walkable tile of the building in one piece with its neighbours. */
function staysConnected(map: GameMap, b: Building, tiles: [number, number][]): boolean {
  const pad = 1;
  const bx0 = b.x - pad;
  const by0 = b.y - pad;
  const W = b.w + pad * 2;
  const H = b.h + pad * 2;
  const blocked = new Set(tiles.map(([x, y]) => (y - by0) * W + (x - bx0)));
  const open = (x: number, y: number) => {
    const lx = x - bx0;
    const ly = y - by0;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) return false;
    return map.isWalkable(x, y) && !blocked.has(ly * W + lx);
  };
  // Every open neighbour of the new piece must still reach every other one (within the building + 1-tile apron).
  const ring: [number, number][] = [];
  for (const [x, y] of tiles)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (open(x + dx, y + dy)) ring.push([x + dx, y + dy]);
  if (ring.length <= 1) return ring.length === 1;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [ring[0]![0], ring[0]![1]];
  seen[(ring[0]![1] - by0) * W + (ring[0]![0] - bx0)] = 1;
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny)) continue;
      const k = (ny - by0) * W + (nx - bx0);
      if (seen[k]) continue;
      seen[k] = 1;
      stack.push(nx, ny);
    }
  }
  return ring.every(([x, y]) => seen[(y - by0) * W + (x - bx0)]);
}
