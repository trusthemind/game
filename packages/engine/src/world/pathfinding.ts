import { MinHeap } from '../core/binaryHeap';
import { LruCache } from '../core/lru';
import { SOLID } from './tiles';
import type { GameMap } from './map';

export interface PathPoint {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
] as const;

/**
 * Grid A* with octile heuristic, no corner cutting, typed-array buffers reused between searches
 * (generation stamps instead of clearing), and an LRU cache of finished paths.
 * The map is static during a raid, so cached paths never go stale.
 */
export class Pathfinder {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: MinHeap;
  readonly cache = new LruCache<number, PathPoint[] | null>(512);
  /** Total nodes expanded — exposed for perf overlay/benchmarks. */
  expanded = 0;

  constructor(private map: GameMap) {
    const n = map.width * map.height;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(1024);
  }

  /** Path between tile centres. Returns smoothed waypoints (excluding start) or null when unreachable. */
  find(sx: number, sy: number, gx: number, gy: number, maxExpand = 24000): PathPoint[] | null {
    const map = this.map;
    sx |= 0;
    sy |= 0;
    gx |= 0;
    gy |= 0;
    if (!map.isWalkable(gx, gy)) {
      const alt = this.nearestWalkable(gx, gy);
      if (!alt) return null;
      gx = alt.x;
      gy = alt.y;
    }
    if (!map.isWalkable(sx, sy)) {
      const alt = this.nearestWalkable(sx, sy);
      if (!alt) return null;
      sx = alt.x;
      sy = alt.y;
    }
    const W = map.width;
    const start = sy * W + sx;
    const goal = gy * W + gx;
    const key = start * W * map.height + goal;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const gen = ++this.gen;
    const { g, parent, stamp, closed, heap } = this;
    const tiles = map.tiles;
    heap.clear();
    g[start] = 0;
    parent[start] = -1;
    stamp[start] = gen;
    heap.push(start, octile(sx, sy, gx, gy));
    let found = false;
    let expandedHere = 0;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expandedHere > maxExpand) break;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      const cg = g[cur]!;
      for (let d = 0; d < 8; d++) {
        const [dx, dy, cost] = DIRS[d]!;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
        const ni = ny * W + nx;
        if (SOLID[tiles[ni]!]) continue;
        // No diagonal squeezing between two solid tiles.
        if (dx !== 0 && dy !== 0 && (SOLID[tiles[cy * W + nx]!] || SOLID[tiles[ny * W + cx]!])) continue;
        if (closed[ni] === gen) continue;
        const ng = cg + cost;
        if (stamp[ni] === gen && ng >= g[ni]!) continue;
        stamp[ni] = gen;
        g[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + octile(nx, ny, gx, gy) * 1.001);
      }
    }
    this.expanded += expandedHere;

    let result: PathPoint[] | null = null;
    if (found) {
      const raw: PathPoint[] = [];
      for (let c = goal; c !== start; c = parent[c]!) raw.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
      raw.reverse();
      result = this.smooth({ x: sx + 0.5, y: sy + 0.5 }, raw);
    }
    this.cache.set(key, result);
    return result;
  }

  /** String-pulling: drop waypoints that are directly reachable with a clear, padded line. */
  smooth(start: PathPoint, pts: PathPoint[]): PathPoint[] {
    if (pts.length <= 2) return pts;
    const out: PathPoint[] = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.walkLine(anchor, pts[j]!)) j--;
      out.push(pts[j]!);
      anchor = pts[j]!;
      i = j + 1;
    }
    return out;
  }

  /** Clear line for an actor of radius ~0.35: tests the centre line and two offset lines. */
  walkLine(a: PathPoint, b: PathPoint): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 0.38;
    const oy = (dx / len) * 0.38;
    const m = this.map;
    return (
      m.rayClear(a.x, a.y, b.x, b.y, SOLID) &&
      m.rayClear(a.x + ox, a.y + oy, b.x + ox, b.y + oy, SOLID) &&
      m.rayClear(a.x - ox, a.y - oy, b.x - ox, b.y - oy, SOLID)
    );
  }

  nearestWalkable(x: number, y: number, maxR = 4): PathPoint | null {
    for (let r = 1; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.map.isWalkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
    return null;
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}
