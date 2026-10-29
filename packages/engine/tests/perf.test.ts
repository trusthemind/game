import { describe, expect, it } from 'vitest';
import { Raid, emptyIntent, generateMap, starterKit } from '../src/index';

// Loose budgets (CI machines are slow) that still catch accidental O(n²) regressions.
describe('performance budgets', () => {
  it('generates the biggest map in under 1.5 s', () => {
    const t = performance.now();
    generateMap(99, { mapId: 'outskirts' });
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('a full-map raid ticks in under 4 ms on average', () => {
    const raid = new Raid({ seed: 99, playerEq: starterKit(), mapId: 'outskirts', timeOfDay: 'day' });
    const idle = emptyIntent();
    for (let i = 0; i < 60; i++) raid.tick(1 / 60, idle);
    const t = performance.now();
    for (let i = 0; i < 600; i++) raid.tick(1 / 60, idle);
    expect((performance.now() - t) / 600).toBeLessThan(4);
  });
});
