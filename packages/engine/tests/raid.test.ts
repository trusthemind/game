import { describe, expect, it } from 'vitest';
import { Raid, carryGrids, emptyIntent, starterKit } from '../src/index';

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

  it('pulling the trigger on an empty gun reloads it', () => {
    const r = newRaid();
    for (const a of r.actors) if (a !== r.player) a.alive = false;
    r.tick(1 / 60, { ...emptyIntent(), switchTo: 'secondary' });
    for (let i = 0; i < 60; i++) r.tick(1 / 60, emptyIntent());
    const gun = r.weaponItem(r.player)!;
    expect(gun).toBeTruthy();
    gun.ammo = 0;
    r.tick(1 / 60, { ...emptyIntent(), fire: true, firePressed: true });
    expect(r.player.reloadT).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 4; i++) r.tick(1 / 60, emptyIntent());
    expect(gun.ammo).toBeGreaterThan(0);
  });

  it('auto-treats a bleed once the fighting stops, and only with auto-heal on', () => {
    for (const on of [true, false]) {
      const r = new Raid({ seed: 7, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', autoHeal: on });
      for (const a of r.actors) if (a !== r.player) a.alive = false;
      r.player.health.parts.leftArm.light = true;
      r.player.combatAt = r.time;
      // Still "in combat" for 3 s.
      for (let i = 0; i < 60 * 2; i++) r.tick(1 / 60, emptyIntent());
      expect(r.player.useT).toBe(0);
      for (let i = 0; i < 60 * 12; i++) r.tick(1 / 60, emptyIntent());
      expect(r.player.health.parts.leftArm.light).toBe(!on);
    }
  });

  it('treats while the heal key is held; letting go or firing stops it and spends nothing', () => {
    const r = new Raid({ seed: 7, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', autoHeal: false });
    for (const a of r.actors) if (a !== r.player) a.alive = false;
    const p = r.player;
    p.health.parts.leftArm.light = true;
    const held = { ...emptyIntent(), heal: true };
    r.tick(1 / 60, held);
    expect(p.useT).toBeGreaterThan(0);
    const uid = p.useUid;
    const carried = () => carryGrids(p.eq).flatMap((g) => g.items).find((x) => x.item.uid === uid)?.item;
    const uses = carried()?.uses;
    // Let go half-way: stopped, the med as it was, still bleeding.
    r.tick(1 / 60, emptyIntent());
    expect(p.useT).toBe(0);
    expect(carried()?.uses).toBe(uses);
    expect(p.health.parts.leftArm.light).toBe(true);
    // Hold again and pull the trigger: stopped, and it doesn't start over while firing.
    r.tick(1 / 60, held);
    expect(p.useT).toBeGreaterThan(0);
    r.tick(1 / 60, { ...held, fire: true, firePressed: true });
    expect(p.useT).toBe(0);
    // Held all the way: treated.
    for (let i = 0; i < 60 * 12 && p.health.parts.leftArm.light; i++) r.tick(1 / 60, held);
    expect(p.health.parts.leftArm.light).toBe(false);
  });

  it('automatic treatment waits after you let go of the heal key or fire', () => {
    const r = new Raid({ seed: 7, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', autoHeal: true });
    for (const a of r.actors) if (a !== r.player) a.alive = false;
    const p = r.player;
    p.health.parts.leftArm.light = true;
    r.tick(1 / 60, { ...emptyIntent(), heal: true });
    r.tick(1 / 60, emptyIntent());
    // Let go: it doesn't carry on by itself straight away…
    for (let i = 0; i < 60 * 2; i++) r.tick(1 / 60, emptyIntent());
    expect(p.useT).toBe(0);
    // …only once you've left it alone for a while.
    for (let i = 0; i < 60 * 2; i++) r.tick(1 / 60, emptyIntent());
    expect(p.useT).toBeGreaterThan(0);
  });
});
