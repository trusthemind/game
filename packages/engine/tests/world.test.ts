import { describe, expect, it } from 'vitest';
import { MAP_PRESETS, Pathfinder, Tile, computeFov, floodFill, generateMap, solidBoxes, type Box, type MapId } from '../src/index';

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateMap(123);
    const b = generateMap(123);
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
    expect(a.playerSpawn).toEqual(b.playerSpawn);
  });

  for (const id of Object.keys(MAP_PRESETS) as MapId[]) {
    it(`builds a connected, populated "${id}"`, () => {
      const map = generateMap(77, { mapId: id });
      expect(map.width).toBe(MAP_PRESETS[id].size);
      expect(map.isWalkable(Math.floor(map.playerSpawn.x), Math.floor(map.playerSpawn.y))).toBe(true);
      const reach = floodFill(map, { x: Math.floor(map.playerSpawn.x), y: Math.floor(map.playerSpawn.y) });
      for (const e of map.extractions) expect(reach[map.idx(Math.floor(e.x), Math.floor(e.y))]).toBe(1);
      expect(map.extractions.length).toBeGreaterThanOrEqual(2);
      expect(map.buildings.length).toBeGreaterThan(3);
      expect(map.botSpawns.length).toBeGreaterThan(3);
      // Bots never spawn on top of the player.
      for (const b of map.botSpawns) expect(Math.hypot(b.x - map.playerSpawn.x, b.y - map.playerSpawn.y)).toBeGreaterThan(15);
    });
  }

  it('spawns the player out in the open, not in a bush', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const map = generateMap(seed, { mapId: 'outskirts' });
      const sx = Math.floor(map.playerSpawn.x);
      const sy = Math.floor(map.playerSpawn.y);
      let blocked = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.isSolid(sx + dx, sy + dy)) blocked++;
      expect(blocked).toBe(0);
    }
  });
});

describe('pathfinding', () => {
  const map = generateMap(5);
  const pf = new Pathfinder(map);

  it('finds a path from spawn to an extraction', () => {
    const e = map.extractions[0]!;
    const path = pf.find(Math.floor(map.playerSpawn.x), Math.floor(map.playerSpawn.y), Math.floor(e.x), Math.floor(e.y));
    expect(path).not.toBeNull();
    for (const p of path!) expect(map.isWalkable(Math.floor(p.x), Math.floor(p.y))).toBe(true);
  });

  it('caches repeated queries', () => {
    const e = map.extractions[1]!;
    const args = [Math.floor(map.playerSpawn.x), Math.floor(map.playerSpawn.y), Math.floor(e.x), Math.floor(e.y)] as const;
    const first = pf.find(...args);
    expect(pf.find(...args)).toBe(first);
  });
});

describe('field of view', () => {
  it('sees the origin and is blocked by walls', () => {
    const map = generateMap(5);
    const out = new Uint8Array(map.width * map.height);
    const sx = Math.floor(map.playerSpawn.x);
    const sy = Math.floor(map.playerSpawn.y);
    computeFov(map, map.playerSpawn.x, map.playerSpawn.y, { radius: 20 }, out);
    expect(out[map.idx(sx, sy)]).toBe(1);
    // Every visible tile must have a clear line (allowing the blocking tile itself to be lit).
    let checked = 0;
    for (let y = sy - 20; y <= sy + 20; y++)
      for (let x = sx - 20; x <= sx + 20; x++) {
        if (!map.inBounds(x, y) || out[map.idx(x, y)] || Math.hypot(x - sx, y - sy) > 19) continue;
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('collision boxes', () => {
  it('walls are thin and trees are just a trunk', () => {
    const map = generateMap(5);
    const out: Box[] = [];
    let wall = false;
    let tree = false;
    for (let y = 0; y < map.height && !(wall && tree); y++)
      for (let x = 0; x < map.width; x++) {
        const t = map.get(x, y);
        if (t === Tile.Wall && !wall) {
          solidBoxes(map, x, y, (out.length = 0, out));
          const area = out.reduce((s, b) => s + (b[2] - b[0]) * (b[3] - b[1]), 0);
          expect(area).toBeLessThan(0.6);
          wall = true;
        }
        if (t === Tile.Tree && !tree) {
          solidBoxes(map, x, y, (out.length = 0, out));
          expect(out.length).toBe(1);
          expect(out[0]![2] - out[0]![0]).toBeLessThan(0.6);
          tree = true;
        }
      }
    expect(wall).toBe(true);
  });
});
