import type { GameMap } from './map';

/**
 * Recursive shadowcasting FOV (Björn Bergström's algorithm), 8 octants.
 * Writes 1 into `out` for each visible tile. Walls themselves are marked visible so their faces render lit.
 * Optionally restricted to a view cone (Project Zomboid–style): tiles outside the cone are only
 * visible within `nearRadius` (peripheral awareness).
 */
export interface FovOptions {
  radius: number;
  facing?: number;
  coneHalf?: number;
  nearRadius?: number;
}

const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
] as const;

export function computeFov(map: GameMap, ox: number, oy: number, opts: FovOptions, out: Uint8Array): void {
  out.fill(0);
  const cx = Math.floor(ox);
  const cy = Math.floor(oy);
  if (!map.inBounds(cx, cy)) return;
  out[map.idx(cx, cy)] = 1;
  const r = opts.radius;
  const cone = opts.facing !== undefined && opts.coneHalf !== undefined;
  const near2 = (opts.nearRadius ?? 0) ** 2;
  const cosHalf = cone ? Math.cos(opts.coneHalf!) : -1;
  const fx = cone ? Math.cos(opts.facing!) : 0;
  const fy = cone ? Math.sin(opts.facing!) : 0;

  const mark = (x: number, y: number) => {
    if (!map.inBounds(x, y)) return;
    if (cone) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 > near2) {
        const d = Math.sqrt(d2);
        if ((dx * fx + dy * fy) / d < cosHalf) return;
      }
    }
    out[map.idx(x, y)] = 1;
  };

  for (let oct = 0; oct < 8; oct++)
    castLight(map, cx, cy, 1, 1.0, 0.0, r, MULT[0][oct]!, MULT[1][oct]!, MULT[2][oct]!, MULT[3][oct]!, mark);
}

function castLight(
  map: GameMap,
  cx: number,
  cy: number,
  row: number,
  start: number,
  end: number,
  radius: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  mark: (x: number, y: number) => void,
): void {
  if (start < end) return;
  const r2 = radius * radius;
  let newStart = 0;
  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    while (dx <= 0) {
      dx++;
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      if (dx * dx + dy * dy < r2) mark(X, Y);
      const opaque = map.isOpaque(X, Y);
      if (blocked) {
        if (opaque) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (opaque && j < radius) {
        blocked = true;
        castLight(map, cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, mark);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}
