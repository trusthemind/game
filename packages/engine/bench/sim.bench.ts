import { it } from 'vitest';
import { Pathfinder, Raid, computeFov, emptyIntent, generateMap, starterKit } from '../src/index';

/** Minimal timing harness: warm up, then report mean / p95 per op. Run with `npm run bench`. */
function measure(name: string, fn: () => void, iterations: number): { name: string; meanMs: number; p95Ms: number; opsPerSec: number } {
  for (let i = 0; i < Math.min(10, iterations); i++) fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { name, meanMs: +mean.toFixed(4), p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(4), opsPerSec: Math.round(1000 / mean) };
}

it('engine hot paths', () => {
  const map = generateMap(42, { mapId: 'outskirts' });
  const pf = new Pathfinder(map);
  const fov = new Uint8Array(map.width * map.height);
  const raid = new Raid({ seed: 42, playerEq: starterKit(), mapId: 'outskirts', timeOfDay: 'day', map });
  const idle = emptyIntent();
  const e = map.extractions[0]!;
  const rows = [
    measure('generateMap outskirts (256²)', () => generateMap(7, { mapId: 'outskirts' }), 10),
    measure('A* spawn → extract (uncached)', () => {
      pf.cache.clear();
      pf.find(Math.floor(map.playerSpawn.x), Math.floor(map.playerSpawn.y), Math.floor(e.x), Math.floor(e.y));
    }, 200),
    measure('FOV radius 24', () => computeFov(map, map.playerSpawn.x, map.playerSpawn.y, { radius: 24 }, fov), 2000),
    measure(`raid tick (${raid.actors.length} actors)`, () => raid.tick(1 / 60, idle), 3000),
  ];
  console.table(rows);
}, 120_000);
