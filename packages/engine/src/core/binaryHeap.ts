/** Min-heap of integer ids keyed by a float priority, backed by typed arrays (no GC churn in A*). */
export class MinHeap {
  private ids: Int32Array;
  private pri: Float32Array;
  size = 0;

  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.pri = new Float32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(id: number, priority: number): void {
    if (this.size >= this.ids.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.pri[p]! <= priority) break;
      this.ids[i] = this.ids[p]!;
      this.pri[i] = this.pri[p]!;
      i = p;
    }
    this.ids[i] = id;
    this.pri[i] = priority;
  }

  pop(): number {
    const top = this.ids[0]!;
    const n = --this.size;
    if (n > 0) {
      const id = this.ids[n]!;
      const pr = this.pri[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && this.pri[r]! < this.pri[l]! ? r : l;
        if (this.pri[c]! >= pr) break;
        this.ids[i] = this.ids[c]!;
        this.pri[i] = this.pri[c]!;
        i = c;
      }
      this.ids[i] = id;
      this.pri[i] = pr;
    }
    return top;
  }

  private grow(): void {
    const ids = new Int32Array(this.ids.length * 2);
    const pri = new Float32Array(this.pri.length * 2);
    ids.set(this.ids);
    pri.set(this.pri);
    this.ids = ids;
    this.pri = pri;
  }
}
