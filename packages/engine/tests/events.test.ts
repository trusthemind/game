import { describe, expect, it } from 'vitest';
import { AIRDROP_FALL, BOSSES, MAP_PRESETS, Raid, emptyIntent, generateMap, starterKit, type MapId } from '../src/index';

describe('bosses', () => {
  for (const def of BOSSES) {
    it(`${def.name} spawns on ${MAP_PRESETS[def.map].name} with an escort and a trophy`, () => {
      // Try a few seeds: bosses have a spawn chance.
      for (let seed = 1; seed < 12; seed++) {
        const map = generateMap(seed, { mapId: def.map as MapId });
        const spawn = map.botSpawns.find((s) => s.boss === def.id);
        if (!spawn) continue;
        expect(map.botSpawns.filter((s) => s.group === spawn.group && s.archetype === 'guard').length).toBe(def.guards);
        const raid = new Raid({ seed, playerEq: starterKit(), map, timeOfDay: 'day', events: false });
        const boss = raid.actors.find((a) => a.bossId === def.id)!;
        expect(boss.name).toBe(def.name);
        // Tougher than a regular human, but not a sponge.
        expect(boss.maxHp).toBeGreaterThan(raid.player.maxHp * 1.3);
        expect(boss.maxHp).toBeLessThan(raid.player.maxHp * 2);
        const carried = JSON.stringify(boss.eq);
        expect(carried).toMatch(/kostia_ring|bohdan_claw|rina_ledger/);
        expect(raid.bossesPresent).toContain(def.id);
        return;
      }
      throw new Error('boss never spawned in 11 seeds');
    });
  }
});

describe('map events', () => {
  it('drops an airdrop crate that lands after the fall time and makes noise', () => {
    let tested = false;
    for (let seed = 1; seed < 10 && !tested; seed++) {
      const r = new Raid({ seed, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day' });
      const at = (r as unknown as { airdropAt: number }).airdropAt;
      if (at < 0) continue;
      tested = true;
      const before = r.map.containers.length;
      for (let t = 0; t < (at + AIRDROP_FALL + 1) * 60; t++) r.tick(1 / 60, emptyIntent());
      const drop = r.mapEvents.find((e) => e.kind === 'airdrop');
      expect(drop?.landed).toBe(true);
      expect(r.map.containers.length).toBeGreaterThan(before);
      expect(r.map.containers.some((c) => c.kind === 'airdrop')).toBe(true);
    }
    expect(tested).toBe(true);
  }, 60_000);

  it('helicopter crash sites come with cargo and a raider team', () => {
    for (let seed = 1; seed < 12; seed++) {
      const r = new Raid({ seed, playerEq: starterKit(), mapId: 'outskirts', timeOfDay: 'day' });
      const heli = r.mapEvents.find((e) => e.kind === 'heli');
      if (!heli) continue;
      expect(r.map.containers.filter((c) => c.kind === 'helicrate').length).toBeGreaterThan(0);
      expect(r.actors.filter((a) => a.archetype === 'raider' && Math.hypot(a.pos.x - heli.x, a.pos.y - heli.y) < 8).length).toBeGreaterThanOrEqual(2);
      return;
    }
    throw new Error('no heli crash in 11 seeds');
  });
});
