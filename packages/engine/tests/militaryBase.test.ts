import { describe, expect, it } from 'vitest';
import { floodFill, generateMap, Tile, type MapId } from '../src/index';

const MAPS: MapId[] = ['outskirts', 'pinehollow', 'portkirov', 'zavadsk'];

describe('army bases', () => {
  it('every map has one: fenced, with a gate you can walk in through', () => {
    for (const mapId of MAPS)
      for (const seed of [1, 2, 3, 4]) {
        const map = generateMap(seed, { layoutSeed: seed, mapId, botDensity: 0 });
        expect(map.sites.length, `${mapId}#${seed}`).toBeGreaterThan(0);
        const reach = floodFill(map, map.playerSpawn);
        for (const s of map.sites) {
          // The fence runs all the way round but for the gate (five tiles).
          let gaps = 0;
          for (let x = s.x; x < s.x + s.w; x++) for (const y of [s.y, s.y + s.h - 1]) if (map.get(x, y) !== Tile.Fence) gaps++;
          for (let y = s.y + 1; y < s.y + s.h - 1; y++) for (const x of [s.x, s.x + s.w - 1]) if (map.get(x, y) !== Tile.Fence) gaps++;
          expect(gaps, `${mapId}#${seed} fence gaps`).toBe(5);
          const gate = { x: Math.floor(s.gate.x), y: Math.floor(s.gate.y) };
          expect(map.get(gate.x, gate.y)).not.toBe(Tile.Fence);
          expect(reach[map.idx(gate.x, gate.y)], `${mapId}#${seed} gate reachable`).toBe(1);
          // Barracks, headquarters and armoury, all inside the fence and all reachable.
          for (const role of ['barracks', 'hq', 'armoury'] as const) {
            const b = map.buildings.find((o) => o.id === s.buildings[role]);
            expect(b, `${mapId}#${seed} ${role}`).toBeTruthy();
            expect(b!.kind).toBe('military');
            expect(b!.x > s.x && b!.y > s.y && b!.x + b!.w < s.x + s.w && b!.y + b!.h < s.y + s.h).toBe(true);
            let inside = 0;
            for (const r of b!.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inside += reach[map.idx(x, y)]!;
            expect(inside, `${mapId}#${seed} ${role} reachable`).toBeGreaterThan(0);
          }
          expect(map.structures.filter((t) => t.kind === 'tower' && t.x > s.x && t.x < s.x + s.w && t.y > s.y && t.y < s.y + s.h).length).toBe(4);
        }
      }
  });

  it('keeps a running truck or UAZ in the motor pool', () => {
    let bases = 0;
    let withCars = 0;
    for (const mapId of MAPS)
      for (const seed of [1, 2, 3, 4]) {
        const map = generateMap(seed, { layoutSeed: seed, mapId, botDensity: 0 });
        for (const s of map.sites) {
          bases++;
          const cars = map.vehicleSpawns.filter((v) => !v.wreck && v.x > s.x && v.x < s.x + s.w && v.y > s.y && v.y < s.y + s.h);
          for (const c of cars) expect(['ural4320', 'uaz469', 'btr80']).toContain(c.def);
          if (cars.length) withCars++;
        }
      }
    expect(withCars).toBeGreaterThanOrEqual(bases * 0.9);
  });

  it('puts the warlord in the headquarters and guards at the barracks and the gate', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const map = generateMap(seed, { layoutSeed: seed, mapId: 'outskirts', botDensity: 1 });
      const boss = map.botSpawns.find((b) => b.boss === 'kostia');
      if (!boss) continue;
      seen++;
      const hqs = map.sites.map((s) => map.buildings.find((b) => b.id === s.buildings.hq)!);
      expect(hqs.some((b) => boss.x > b.x && boss.x < b.x + b.w && boss.y > b.y && boss.y < b.y + b.h), `seed ${seed}`).toBe(true);
      for (const s of map.sites)
        expect(map.botSpawns.filter((b) => b.archetype === 'guard' && Math.hypot(b.x - s.gate.x, b.y - s.gate.y) < 6).length).toBeGreaterThan(0);
    }
    expect(seen).toBeGreaterThan(2);
  });
});
