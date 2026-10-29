/** Fixed-size ring pool: zero allocations in the hot path; oldest instance is recycled when exhausted. */
export class RingPool<T> {
  private items: T[];
  private cursor = 0;

  constructor(size: number, factory: (i: number) => T) {
    this.items = Array.from({ length: size }, (_, i) => factory(i));
  }

  next(): T {
    const item = this.items[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.items.length;
    return item;
  }

  forEach(fn: (item: T) => void): void {
    for (const it of this.items) fn(it);
  }

  get size(): number {
    return this.items.length;
  }
}
