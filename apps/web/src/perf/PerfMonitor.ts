/**
 * Rolling frame-time stats + adaptive resolution controller.
 * Budget targets 60 fps; if we consistently miss it we lower the internal resolution in small steps,
 * and claw it back when there's headroom.
 */
export class PerfMonitor {
  private frames = new Float32Array(120);
  private i = 0;
  private filled = 0;
  simMs = 0;
  renderMs = 0;
  private overT = 0;
  private underT = 0;

  push(frameMs: number): void {
    this.frames[this.i] = frameMs;
    this.i = (this.i + 1) % this.frames.length;
    this.filled = Math.min(this.frames.length, this.filled + 1);
  }

  get avgMs(): number {
    let s = 0;
    for (let k = 0; k < this.filled; k++) s += this.frames[k]!;
    return this.filled ? s / this.filled : 0;
  }

  get fps(): number {
    const a = this.avgMs;
    return a > 0 ? 1000 / a : 0;
  }

  /** 99th percentile frame time ("1% low"). */
  get p99(): number {
    if (!this.filled) return 0;
    const arr = Array.from(this.frames.subarray(0, this.filled)).sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.99))]!;
  }

  /** Returns a new resolution scale (or the same one) given the current scale. */
  adapt(scale: number, dt: number): number {
    const avg = this.avgMs;
    if (this.filled < 60) return scale;
    if (avg > 19) {
      this.overT += dt;
      this.underT = 0;
      if (this.overT > 1.5 && scale > 0.55) {
        this.overT = 0;
        return Math.max(0.55, scale - 0.12);
      }
    } else if (avg < 12.5) {
      this.underT += dt;
      this.overT = 0;
      if (this.underT > 4 && scale < 1) {
        this.underT = 0;
        return Math.min(1, scale + 0.08);
      }
    } else {
      this.overT = this.underT = 0;
    }
    return scale;
  }
}
