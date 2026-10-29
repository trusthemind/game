import { describe, expect, it } from 'vitest';
import { MAP_PRESETS, floodFill, generateMap, type MapId } from '../src/index';

describe('furniture', () => {
  for (const id of Object.keys(MAP_PRESETS) as MapId[]) {
    it(`furnishes "${id}" without cutting anything off`, () => {
      const map = generateMap(31, { mapId: id });
      expect(map.furniture.length).toBeGreaterThan(map.buildings.length);
      const start = { x: Math.floor(map.playerSpawn.x), y: Math.floor(map.playerSpawn.y) };
      const withFurniture = floodFill(map, start);
      const saved = map.furnitureAt.slice();
      map.furnitureAt.fill(0);
      const without = floodFill(map, start);
      map.furnitureAt.set(saved);
      let lost = 0;
      for (let i = 0; i < without.length; i++) if (without[i] && !saved[i] && !withFurniture[i]) lost++;
      expect(lost).toBe(0);
      for (const s of map.botSpawns) expect(map.isWalkable(Math.floor(s.x), Math.floor(s.y))).toBe(true);
      for (const c of map.containers) expect(saved[map.idx(c.x, c.y)]).toBe(0);
      // Pieces never overlap each other.
      const boxes = map.furniture.map((f) => f.box);
      for (let a = 0; a < boxes.length; a++)
        for (let b = a + 1; b < boxes.length; b++) {
          const p = boxes[a]!;
          const q = boxes[b]!;
          expect(p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]).toBe(false);
        }
    });
  }

  it('blocks movement into a bed', () => {
    const map = generateMap(31, { mapId: 'outskirts' });
    const bed = map.furniture.find((f) => f.kind === 'bed' && f.blocks)!;
    expect(bed).toBeTruthy();
    expect(map.isWalkable(Math.floor(bed.x), Math.floor(bed.y))).toBe(false);
    expect(map.furnitureTouching(Math.floor(bed.x), Math.floor(bed.y))).toContain(bed);
  });
});
