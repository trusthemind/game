import { describe, expect, it } from 'vitest';
import {
  applyRaidResult,
  canDeploy,
  companionLevel,
  companionLoadout,
  createProfile,
  migrateProfile,
  muleKg,
  Raid,
  reviveCompanion,
  reviveCost,
  starterKit,
  type RaidResult,
} from '../src/index';

const result = (over: Partial<RaidResult>): RaidResult => ({
  status: 'extracted',
  duration: 600,
  kills: {},
  playerEq: starterKit(),
  valueIn: 1000,
  valueOut: 1000,
  xp: 100,
  companion: null,
  metNpcs: [],
  deadNpcs: [],
  secure: null,
  deathAt: null,
  graveVisited: false,
  ...over,
});

describe('companions', () => {
  it('level up from raids, faster with kills and extraction', () => {
    const p = createProfile();
    p.companion = 'taras';
    const eq = companionLoadout(p, 'taras');
    applyRaidResult(p, result({ companion: { npcId: 'taras', alive: true, eq, kills: 3 } }));
    // 80 alive + 120 extracted + 3 × 45
    expect(p.companions.taras!.xp).toBe(335);
    expect(companionLevel(p.companions.taras!.xp).level).toBe(2);
    expect(companionLevel(1e9).level).toBe(10);
  });

  it('a fallen companion comes back wounded, sits out one raid, or is treated for a fee', () => {
    const p = createProfile();
    p.companion = 'lena';
    applyRaidResult(p, result({ status: 'dead', playerEq: null, companion: { npcId: 'lena', alive: false, eq: null, kills: 0 }, deadNpcs: ['lena'] }));
    expect(p.npcs.lena!.dead).toBe(false);
    expect(p.companions.lena!.wounded).toBe(1);
    expect(canDeploy(p, 'lena')).toBe(false);
    expect(p.companion).toBeNull();

    // Pay the medic.
    const money = p.money;
    expect(reviveCompanion(p, 'lena')).toBe(true);
    expect(p.money).toBe(money - reviveCost(1));
    expect(canDeploy(p, 'lena')).toBe(true);
    expect(reviveCompanion(p, 'lena')).toBe(false); // nothing to treat

    // Or wait one raid.
    applyRaidResult(p, result({ status: 'dead', playerEq: null, companion: { npcId: 'lena', alive: false, eq: null, kills: 0 }, deadNpcs: ['lena'] }));
    expect(canDeploy(p, 'lena')).toBe(false);
    applyRaidResult(p, result({}));
    expect(canDeploy(p, 'lena')).toBe(true);
  });

  it('companions who died before levels existed come back wounded after migration', () => {
    const p = createProfile();
    p.npcs.mykola!.dead = true;
    const old = JSON.parse(JSON.stringify(p));
    old.version = 3;
    delete old.companions;
    const m = migrateProfile(old);
    expect(m.npcs.mykola!.dead).toBe(false);
    expect(m.companions.mykola!.wounded).toBe(1);
  });

  it('perks work in the raid: forager searches faster, mule carries more, level gives more health', () => {
    const base = new Raid({ seed: 5, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day' });
    const p = createProfile();
    const raid = (npcId: string, level: number) =>
      new Raid({ seed: 5, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', companion: { npcId, name: npcId, eq: companionLoadout(p, npcId), level } });
    const ostap = raid('ostap', 1);
    expect(ostap.squadPerk()?.perk).toBe('forager');
    expect(base.squadPerk()).toBeNull();
    const lvl1 = raid('mykola', 1).actors.find((a) => a.companion)!;
    const lvl10 = raid('mykola', 10).actors.find((a) => a.companion)!;
    expect(lvl10.maxHp).toBeGreaterThan(lvl1.maxHp);
    expect(muleKg(10)).toBeGreaterThan(muleKg(1));
  });

  it('the medic patches you up when you bleed', () => {
    const p = createProfile();
    const r = new Raid({ seed: 5, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', companion: { npcId: 'lena', name: 'Lena', eq: companionLoadout(p, 'lena'), level: 1 } });
    const lena = r.actors.find((a) => a.companion)!;
    lena.pos.x = r.player.pos.x + 1;
    lena.pos.y = r.player.pos.y;
    r.player.health.parts.thorax.light = true;
    r.player.health.parts.thorax.hp -= 20;
    for (let i = 0; i < 10; i++) r.tick(1 / 30);
    expect(r.player.health.parts.thorax.light).toBe(false);
  });
});
