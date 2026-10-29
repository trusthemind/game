import { describe, expect, it } from 'vitest';
import { Raid, emptyIntent, starterKit } from '../src/index';

const newRaid = (seed = 7) => new Raid({ seed, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day' });

describe('raid simulation', () => {
  it('is deterministic for the same seed and inputs', () => {
    const a = newRaid();
    const b = newRaid();
    for (let i = 0; i < 600; i++) {
      a.tick(1 / 60, emptyIntent());
      b.tick(1 / 60, emptyIntent());
    }
    expect(a.actors.map((x) => [x.pos.x.toFixed(4), x.pos.y.toFixed(4), x.hp])).toEqual(b.actors.map((x) => [x.pos.x.toFixed(4), x.pos.y.toFixed(4), x.hp]));
  });

  it('moves the player with input and blocks walking through walls', () => {
    const r = newRaid();
    const start = { ...r.player.pos };
    const intent = { ...emptyIntent(), moveX: 1, aimX: start.x + 5, aimY: start.y };
    for (let i = 0; i < 60; i++) r.tick(1 / 60, intent);
    expect(Math.hypot(r.player.pos.x - start.x, r.player.pos.y - start.y)).toBeGreaterThan(1);
    for (let i = 0; i < 60 * 30; i++) {
      r.tick(1 / 60, intent);
      expect(r.map.isSolid(Math.floor(r.player.pos.x), Math.floor(r.player.pos.y)) && r.map.get(Math.floor(r.player.pos.x), Math.floor(r.player.pos.y)) !== 6).toBe(false);
    }
  });

  it('bots act on their own and the raid stays stable for two minutes', () => {
    const r = newRaid(11);
    const bots = r.actors.filter((a) => a !== r.player);
    const start = bots.map((b) => ({ ...b.pos }));
    for (let i = 0; i < 60 * 120 && r.status === 'active'; i++) r.tick(1 / 60, emptyIntent());
    const moved = bots.filter((b, i) => Math.hypot(b.pos.x - start[i]!.x, b.pos.y - start[i]!.y) > 0.5).length;
    expect(moved).toBeGreaterThan(0);
    for (const a of r.actors) {
      expect(Number.isFinite(a.pos.x) && Number.isFinite(a.pos.y)).toBe(true);
    }
  });

  it('produces a result the profile can consume', () => {
    const r = newRaid();
    r.abandon();
    const res = r.result();
    expect(res.status).toBe('mia');
    expect(res.playerEq).toBeNull();
  });

  it('player can reload and fire the sidearm', () => {
    const r = newRaid();
    r.tick(1 / 60, { ...emptyIntent(), switchTo: 'secondary' });
    for (let i = 0; i < 120; i++) r.tick(1 / 60, { ...emptyIntent(), reload: i === 0 });
    const gun = r.weaponItem(r.player);
    const before = gun?.ammo ?? 0;
    expect(before).toBeGreaterThan(0);
    r.tick(1 / 60, { ...emptyIntent(), aim: true, fire: true, firePressed: true, aimX: r.player.pos.x + 5, aimY: r.player.pos.y });
    for (let i = 0; i < 10; i++) r.tick(1 / 60, emptyIntent());
    expect(r.weaponItem(r.player)?.ammo).toBe(before - 1);
  });
});
