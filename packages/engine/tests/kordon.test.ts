import { describe, expect, it } from 'vitest';
import { Raid, emptyIntent, generateMap, starterKit } from '../src/index';

describe('Kordon-47', () => {
  it('two bases, a bunker, the rail depot and every exit asking for something', () => {
    const m = generateMap(1, { mapId: 'kordon' });
    expect(m.sites.length).toBe(2);
    expect(m.buildings.some((b) => b.kind === 'bunker')).toBe(true);
    expect(m.extractions.length).toBeGreaterThanOrEqual(4);
    for (const e of m.extractions) expect(e.rule, e.name).toBeTruthy();
    const train = m.extractions.find((e) => e.rule?.kind === 'train');
    expect(train?.name).toBe('Rail Depot');
    expect(m.structures.filter((s) => s.kind === 'stack').length).toBeGreaterThanOrEqual(3);
  });

  it('the train exit opens when the train is in and shuts when it goes', () => {
    const r = new Raid({ seed: 5, playerEq: starterKit(), mapId: 'kordon', botDensity: 0, events: false, timeOfDay: 'day' });
    const ex = r.map.extractions.find((e) => e.rule?.kind === 'train')!;
    expect(r.trainAt).toBeGreaterThan(0);
    expect(r.extractBlocked(ex)).toMatch(/isn't in/);
    r.time = r.trainAt + 1;
    expect(r.extractBlocked(ex)).toBeNull();
    expect(r.trainLabel()).toMatch(/train ✓/);
    r.time = r.trainGone + 1;
    expect(r.extractBlocked(ex)).toMatch(/gone/);
    r.tick(1 / 60, emptyIntent());
  });
});
