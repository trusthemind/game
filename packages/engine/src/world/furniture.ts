import { Rng } from '../core/rng';
import type { Building, BuildingKind, GameMap, Rect } from './map';
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
  | 'vase';

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
  centre?: FurnitureKind;
  decor: FurnitureKind[];
}

const HOME_THEMES: Theme[] = [
  { wall: [['bed', 1], ['closet', 1], ['dresser', 1]], decor: ['lamp', 'plant'] },
  { wall: [['bed_double', 1], ['closet', 1], ['dresser', 1]], decor: ['lamp', 'vase'] },
  { wall: [['sofa', 1], ['bookcase', 2], ['dresser', 1]], centre: 'coffee_table', decor: ['armchair', 'lamp', 'plant'] },
  { wall: [['bookcase', 2], ['dresser', 1]], centre: 'table', decor: ['chair', 'chair', 'chair', 'plant'] },
];

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
};

/** Furnish every building. Uses its own RNG stream so the rest of map generation is unaffected. */
export function furnish(map: GameMap): void {
  for (const b of map.buildings) furnishBuilding(map, b, new Rng((map.seed ^ Math.imul(b.id + 1, 0x9e3779b1)) >>> 0));
}

function furnishBuilding(map: GameMap, b: Building, rng: Rng): void {
  const themes = THEMES[b.kind];
  for (const room of b.rooms) {
    if (room.w < 3 || room.h < 3) continue;
    const theme = rng.pick(themes);
    const area = room.w * room.h;
    const wallPieces = Math.min(7, Math.max(2, Math.round(area / 9)));
    for (let i = 0; i < wallPieces; i++) {
      const kind = rng.weighted(theme.wall);
      for (let tries = 0; tries < 14; tries++) if (placeAgainstWall(map, b, room, kind, rng)) break;
    }
    if (theme.centre && room.w >= 4 && room.h >= 4) placeCentre(map, b, room, theme.centre, theme.decor, rng);
    else for (const k of theme.decor) if (rng.chance(0.6)) for (let t = 0; t < 6; t++) if (placeAgainstWall(map, b, room, k, rng)) break;
  }
}

/** Front direction for a piece backed against the given wall. */
const FRONT: Record<Side, number> = { 0: Math.PI / 2, 1: Math.PI, 2: -Math.PI / 2, 3: 0 };

function placeAgainstWall(map: GameMap, b: Building, room: Rect, kind: FurnitureKind, rng: Rng): boolean {
  const { w, d } = FURNITURE_SIZE[kind];
  const side = rng.int(0, 3) as Side;
  const horizontal = side === 0 || side === 2;
  const span = horizontal ? room.w : room.h;
  if (span < w + 0.4) return false;
  // Position along the wall (metres from the room edge), snapped so pieces line up with tiles.
  const along = rng.int(0, Math.max(0, Math.floor(span - w))) + (Math.ceil(w) - w) / 2;
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
  if (wallTiles.some(([x, y]) => map.get(x, y) !== Tile.Wall)) return false;
  return commit(map, b, kind, [x0, y0, x1, y1], FRONT[side]);
}

function placeCentre(map: GameMap, b: Building, room: Rect, kind: FurnitureKind, decor: FurnitureKind[], rng: Rng): void {
  const { w, d } = FURNITURE_SIZE[kind];
  const cx = room.x + room.w / 2 + (rng.chance(0.5) ? 0 : 0.5) * (room.w % 2 === 0 ? 1 : 0);
  const cy = room.y + room.h / 2;
  const dir = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
  if (!commit(map, b, kind, [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2], dir)) return;
  // Chairs round a dining table, an armchair facing the coffee table, etc.
  const seats: [number, number, number][] = [
    [cx, cy - d / 2 - 0.35, Math.PI / 2],
    [cx, cy + d / 2 + 0.35, -Math.PI / 2],
    [cx - w / 2 - 0.35, cy, 0],
    [cx + w / 2 + 0.35, cy, Math.PI],
  ];
  for (const k of decor) {
    const s = FURNITURE_SIZE[k];
    if (k === 'chair' || k === 'armchair' || k === 'stool') {
      const seat = seats.splice(rng.int(0, seats.length - 1), 1)[0];
      if (!seat) continue;
      const [sx, sy, sd] = seat;
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
  const tiles = size.blocks ? blockedTiles(box) : [];
  // Reaching into a wall tile is fine (that's the gap behind the wall face); every other tile must be free floor of this building.
  const inside = tiles.filter(([x, y]) => map.get(x, y) !== Tile.Wall);
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
