/**
 * Uniform-grid spatial hash for broad-phase neighbour queries (AI perception, bullets, separation).
 * Turns O(n²) "who is near me" checks into ~O(n).
 */
export interface SpatialItem {
  id: number;
  pos: { x: number; y: number };
}

export class SpatialHash<T extends SpatialItem> {
  private cells = new Map<number, T[]>();
  private readonly inv: number;

  constructor(readonly cellSize: number) {
    this.inv = 1 / cellSize;
  }

  private key(cx: number, cy: number): number {
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  /** Rebuild from scratch — cheaper than incremental updates when nearly everything moves every tick. */
  rebuild(items: Iterable<T>): void {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const it of items) {
      const k = this.key(Math.floor(it.pos.x * this.inv), Math.floor(it.pos.y * this.inv));
      let bucket = this.cells.get(k);
      if (!bucket) this.cells.set(k, (bucket = []));
      bucket.push(it);
    }
  }

  /** Items whose position is within `radius` of (x, y). Results are appended to `out`, which is returned. */
  query(x: number, y: number, radius: number, out: T[] = []): T[] {
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) * this.inv);
    const x1 = Math.floor((x + radius) * this.inv);
    const y0 = Math.floor((y - radius) * this.inv);
    const y1 = Math.floor((y + radius) * this.inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const it of bucket) {
          const dx = it.pos.x - x;
          const dy = it.pos.y - y;
          if (dx * dx + dy * dy <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}
