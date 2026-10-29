import type { GameMap } from './map';
import { SOLID, Tile } from './tiles';

/** Axis-aligned collision boxes (x0, y0, x1, y1) inside one solid tile. */
export type Box = readonly [number, number, number, number];

const WALL_T = 0.16;
const FENCE_T = 0.07;
const TREE_T = 0.24;

const isWallish = (t: Tile) => t === Tile.Wall || t === Tile.Window;

/**
 * Real-world thickness for walls/fences/trees: a wall tile is a 32 cm pillar plus arms towards connected
 * neighbours, a tree is just its trunk. Movement uses these boxes; vision and bullets keep the tile grid.
 */
export function solidBoxes(map: GameMap, x: number, y: number, out: Box[]): Box[] {
  out.length = 0;
  const t = map.get(x, y);
  if (!SOLID[t]) return out;
  const cx = x + 0.5;
  const cy = y + 0.5;
  if (isWallish(t) || t === Tile.Fence) {
    const h = t === Tile.Fence ? FENCE_T : WALL_T;
    const connects = (nx: number, ny: number) => {
      const n = map.get(nx, ny);
      return t === Tile.Fence ? n === Tile.Fence || isWallish(n) : isWallish(n) || n === Tile.Border;
    };
    out.push([cx - h, cy - h, cx + h, cy + h]);
    if (connects(x + 1, y)) out.push([cx, cy - h, x + 1, cy + h]);
    if (connects(x - 1, y)) out.push([x, cy - h, cx, cy + h]);
    if (connects(x, y + 1)) out.push([cx - h, cy, cx + h, y + 1]);
    if (connects(x, y - 1)) out.push([cx - h, y, cx + h, cy]);
    return out;
  }
  if (t === Tile.Tree) {
    out.push([cx - TREE_T, cy - TREE_T, cx + TREE_T, cy + TREE_T]);
    return out;
  }
  out.push([x, y, x + 1, y + 1]);
  return out;
}

export { WALL_T };
