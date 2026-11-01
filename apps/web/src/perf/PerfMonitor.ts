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

  /**
   * Returns a new resolution scale (or the same one) given the current scale. Every change re-allocates the
   * post-processing buffers, itself a freeze of 0.1-0.4 s, so changes are rare: one jump down to about the scale
   * that fits the budget, and back up only after a long quiet stretch (stepping down a notch every 2 s in a
   * firefight and back up after it was a stutter of its own).
   */
  adapt(scale: number, dt: number): number {
    const avg = this.avgMs;
    if (this.filled < 60) return scale;
    // Floor at 0.75: below that the picture turns to mush; better a few fps less than a blurry game.
    if (avg > 21) {
      this.overT += dt;
      this.underT = 0;
      if (this.overT > 3 && scale > 0.75) {
        this.overT = 0;
        return Math.max(0.75, Math.floor(scale * Math.sqrt(16.7 / avg) * 20) / 20);
      }
    } else if (avg < 12.5) {
      this.underT += dt;
      this.overT = 0;
      if (this.underT > 30 && scale < 1) {
        this.underT = 0;
        return Math.min(1, scale + 0.1);
      }
    } else {
      this.overT = this.underT = 0;
    }
    return scale;
  }
}
