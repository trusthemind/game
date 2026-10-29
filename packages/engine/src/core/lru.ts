/**
 * Least-recently-used cache backed by Map insertion order (O(1) get/set).
 * Tracks hit/miss counts so the perf overlay can show cache effectiveness.
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  hits = 0;
  misses = 0;

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new Error('LRU capacity must be >= 1');
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) this.map.delete(this.map.keys().next().value as K);
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }
}
