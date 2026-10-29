import { describe, expect, it } from 'vitest';
import { LruCache, Rng, SpatialHash, angleDiff, clamp, hashString, turnTowards } from '../src/index';
import { MinHeap } from '../src/core/binaryHeap';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      const f = r.range(-1, 1);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThan(1);
    }
  });

  it('forks into independent but reproducible streams', () => {
    expect(new Rng(5).fork('loot').next()).toBe(new Rng(5).fork('loot').next());
    expect(new Rng(5).fork('loot').next()).not.toBe(new Rng(5).fork('ai').next());
  });

  it('hashes strings stably', () => {
    expect(hashString('ashfall')).toBe(hashString('ashfall'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.get('c')).toBe(3);
  });
});

describe('MinHeap', () => {
  it('pops in priority order', () => {
    const h = new MinHeap(4);
    const values = [5, 1, 9, 3, 7, 2, 8];
    values.forEach((p, i) => h.push(i, p));
    const out: number[] = [];
    while (h.size) out.push(values[h.pop()]!);
    expect(out).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('SpatialHash', () => {
  it('finds items within radius only', () => {
    const h = new SpatialHash<{ id: number; pos: { x: number; y: number }; radius: number }>(4);
    const near = { id: 1, pos: { x: 1, y: 1 }, radius: 0.4 };
    const far = { id: 2, pos: { x: 40, y: 40 }, radius: 0.4 };
    h.rebuild([near, far]);
    const out = h.query(0, 0, 3, []);
    expect(out).toContain(near);
    expect(out).not.toContain(far);
  });
});

describe('math', () => {
  it('wraps angle differences', () => {
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 5);
    expect(Math.abs(turnTowards(0, 3, 0.5))).toBeCloseTo(0.5, 5);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});
