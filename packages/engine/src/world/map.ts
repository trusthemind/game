import { OPAQUE, SOLID, COVER, Tile } from './tiles';
import type { GridContainer } from '../items/inventory';

export type BuildingKind = 'house' | 'shop' | 'clinic' | 'warehouse' | 'military' | 'apartment' | 'barn' | 'cabin';

export type District = 'town' | 'industrial' | 'military' | 'forest' | 'farm' | 'docks';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Building extends Rect {
  id: number;
  kind: BuildingKind;
  rooms: Rect[];
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
}

export interface Extraction {
  id: number;
  name: string;
  x: number;
  y: number;
  radius: number;
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

export class GameMap {
  readonly tiles: Uint8Array;
  /** Per-tile building id + 1 (0 = outdoors). */
  readonly buildingAt: Uint16Array;
  buildings: Building[] = [];
  containers: LootContainer[] = [];
  extractions: Extraction[] = [];
  botSpawns: BotSpawn[] = [];
  playerSpawn = { x: 0, y: 0 };
  /** Outdoor / indoor points of interest used by patrolling AI. */
  pois: { x: number; y: number }[] = [];
  mapId = 'custom';
  name = 'Unknown';
  /** District index per tile (into `districts`). */
  districtAt: Uint8Array;
  districts: { kind: District; x: number; y: number; name: string }[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly seed: number,
  ) {
    this.tiles = new Uint8Array(width * height);
    this.buildingAt = new Uint16Array(width * height);
    this.districtAt = new Uint8Array(width * height);
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
    return this.inBounds(x, y) && SOLID[this.tiles[y * this.width + x]!] === 0;
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
