import { describe, expect, it } from 'vitest';
import { generateMap, type MapId } from '../src/index';

const MAPS: MapId[] = ['outskirts', 'pinehollow', 'portkirov', 'zavadsk'];

describe('named places and loot zones', () => {
  it('every map names its places, the army base and its buildings among them', () => {
    for (const mapId of MAPS) {
      const map = generateMap(1, { mapId, botDensity: 0 });
      const names = map.places.map((p) => p.name);
      expect(names, mapId).toContain('Army Base');
      for (const n of ['Barracks', 'Headquarters', 'Armoury', 'Motor Pool', 'Main Gate']) expect(names, `${mapId} ${n}`).toContain(n);
      expect(map.places.filter((p) => p.major).length, mapId).toBeGreaterThanOrEqual(2);
      const hq = map.places.find((p) => p.name === 'Headquarters')!;
      expect(map.placeAt(hq.x, hq.y)).toBe('Army Base · Headquarters');
    }
    expect(generateMap(1, { mapId: 'outskirts' }).places.map((p) => p.name)).toContain('Sawmill');
    expect(generateMap(1, { mapId: 'portkirov' }).places.map((p) => p.name)).toContain('Container Terminal');
    expect(generateMap(1, { mapId: 'zavadsk' }).places.map((p) => p.name)).toContain('Central Square');
  });

  it('loot is richer far from the spawns', () => {
    for (const mapId of MAPS) {
      const map = generateMap(1, { mapId, botDensity: 0 });
      const far = (c: { x: number; y: number }) => Math.min(...map.spawnPoints.map((s) => Math.hypot(s.x - c.x, s.y - c.y)));
      const town = map.containers.filter((c) => ['wardrobe', 'drawer', 'fridge'].includes(c.kind));
      const near = town.filter((c) => far(c) < map.width * 0.2);
      const deep = town.filter((c) => far(c) > map.width * 0.5);
      if (!near.length || !deep.length) continue;
      const avg = (cs: typeof town) => cs.reduce((s, c) => s + c.tier, 0) / cs.length;
      expect(avg(deep), mapId).toBeGreaterThan(avg(near));
    }
  });
});
