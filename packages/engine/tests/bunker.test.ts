import { describe, expect, it } from 'vitest';
import { Raid, floodFill, generateMap, starterKit, type MapId } from '../src/index';

describe('the bunker', () => {
  it('lies under each map, sealed in rock, reached only by its hatches', () => {
    for (const mapId of ['outskirts', 'pinehollow', 'portkirov', 'zavadsk'] as MapId[]) {
      const map = generateMap(1, { mapId, botDensity: 1 });
      const bunker = map.buildings.find((b) => b.kind === 'bunker')!;
      expect(bunker, mapId).toBeTruthy();
      expect(bunker.y).toBeGreaterThanOrEqual(map.surfaceH);
      const types = bunker.rooms.map((r) => r.type);
      expect(types, mapId).toContain('command');
      // Not walkable to from the surface.
      const surface = floodFill(map, map.playerSpawn);
      for (const r of bunker.rooms) expect(surface[map.idx(r.x + 1, r.y + 1)], mapId).toBe(0);
      // Hatches: the base one (needs power) and its ladder, and the emergency pair.
      const up = map.hatches.filter((h) => !h.underground);
      const down = map.hatches.filter((h) => h.underground);
      expect(up.length, mapId).toBeGreaterThanOrEqual(1);
      expect(down.length).toBe(up.length);
      expect(up.some((h) => h.needsPower)).toBe(true);
      for (const h of up) {
        expect(h.y).toBeLessThan(map.surfaceH);
        expect(surface[map.idx(Math.floor(h.x), Math.floor(h.y))], `${mapId} hatch reachable`).toBe(1);
      }
      // Everything in the bunker is reachable from its ladders, with top-tier loot and guards down there.
      const below = floodFill(map, { x: Math.floor(down[0]!.x), y: Math.floor(down[0]!.y) });
      for (const h of down) expect(below[map.idx(Math.floor(h.x), Math.floor(h.y))]).toBe(1);
      const loot = map.containers.filter((c) => c.y >= map.surfaceH);
      expect(loot.length, mapId).toBeGreaterThan(3);
      for (const c of loot) expect(c.tier).toBe(3);
      expect(map.botSpawns.filter((b) => b.y >= map.surfaceH && b.archetype === 'guard').length, mapId).toBeGreaterThan(0);
      // Nothing else spawns or patrols down there.
      expect(map.botSpawns.filter((b) => b.y >= map.surfaceH && b.archetype !== 'guard').length).toBe(0);
      expect(map.pois.filter((p) => p.y >= map.surfaceH).length).toBe(0);
    }
  });

  it('the base hatch needs the power on; the emergency hatch opens from below', () => {
    const r = new Raid({ seed: 2, playerEq: starterKit(), mapId: 'outskirts', botDensity: 0, events: false, timeOfDay: 'day' });
    const p = r.player;
    const top = r.map.hatches.find((h) => h.needsPower)!;
    p.pos.x = top.x;
    p.pos.y = top.y + 0.5;
    expect(r.useHatch(p, top.id)).toBe(false);
    r.powerOn = true;
    expect(r.useHatch(p, top.id)).toBe(true);
    expect(p.pos.y).toBeGreaterThan(r.map.surfaceH);
    expect(r.map.placeAt(p.pos.x, p.pos.y)).toMatch(/^Bunker/);
    // Out through the emergency exit.
    const ladder = r.map.hatches.find((h) => h.underground && r.map.hatches[h.to]!.fromBelowOnly)!;
    const exit = r.map.hatches[ladder.to]!;
    expect(r.hatchBlocked(exit.id)).toMatch(/below/);
    p.pos.x = ladder.x;
    p.pos.y = ladder.y;
    expect(r.useHatch(p, ladder.id)).toBe(true);
    expect(p.pos.y).toBeLessThan(r.map.surfaceH);
    expect(Math.hypot(p.pos.x - exit.x, p.pos.y - exit.y)).toBeLessThan(3);
    // Now it opens from above too.
    expect(r.hatchBlocked(exit.id)).toBeNull();
  });
});
