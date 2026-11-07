import { describe, expect, it } from 'vitest';
import { COVER, Raid, addItem, createItem, damagePart, emptyIntent, starterKit } from '../src/index';

/** A scav hurt by someone it can't see (the player, far off in the dark), meds in its pockets. */
function setup() {
  const r = new Raid({ seed: 3, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'night' });
  const bots = r.actors.filter((a) => a !== r.player && !a.companion);
  const bot = bots.find((b) => b.archetype === 'scav') ?? bots[0]!;
  for (const b of bots) if (b !== bot) b.alive = false;
  const m = r.map;
  const span = 20;
  outer: for (let y = 6; y < m.height - 6; y++)
    for (let x = 6; x < m.width - span - 6; x++) {
      let ok = true;
      for (let k = -3; k <= span + 3 && ok; k++) ok = m.isWalkable(x + k, y) && !m.isOpaque(x + k, y);
      if (ok) {
        bot.pos.x = x + 0.5;
        bot.pos.y = y + 0.5;
        r.player.pos.x = x + span + 0.5;
        r.player.pos.y = y + 0.5;
        break outer;
      }
    }
  bot.facing = Math.PI;
  for (const id of ['bandage', 'bandage', 'ai2']) addItem(bot.eq.pockets, createItem(id));
  damagePart(bot.health, 'leftArm', 25, null);
  bot.health.parts.leftArm.light = true;
  (r as unknown as { syncHealth(a: typeof bot): void }).syncHealth(bot);
  bot.brain!.onDamaged(r, bot, r.player);
  return { r, bot };
}

describe('bots treat their wounds in cover', () => {
  it('a bot shot from out of sight gets out of the line of fire before it bandages', () => {
    const { r, bot } = setup();
    const threat = { ...r.player.pos };
    const from = Math.hypot(bot.pos.x - threat.x, bot.pos.y - threat.y);
    let healedAt: { exposed: boolean; backed: number } | null = null;
    for (let i = 0; i < 60 * 15 && !healedAt; i++) {
      r.tick(1 / 60, emptyIntent());
      if (bot.useT > 0)
        healedAt = {
          // Cover as bullets see it (a tree, a car, a wall between them).
          exposed: r.map.rayClear(r.player.pos.x, r.player.pos.y, bot.pos.x, bot.pos.y, COVER),
          backed: Math.hypot(bot.pos.x - threat.x, bot.pos.y - threat.y) - from,
        };
    }
    expect(healedAt).not.toBeNull();
    // Behind something, or (open ground, nothing to hide behind) backed well off from the shooter.
    expect(!healedAt!.exposed || healedAt!.backed > 4).toBe(true);
  });

  it('a hit while bandaging stops the bandaging (nothing spent) and sends it for cover', () => {
    const { r, bot } = setup();
    for (let i = 0; i < 60 * 15 && bot.useT <= 0; i++) r.tick(1 / 60, emptyIntent());
    expect(bot.useT).toBeGreaterThan(0);
    const meds = bot.eq.pockets.items.length;
    bot.brain!.onDamaged(r, bot, r.player);
    expect(bot.useT).toBe(0);
    expect(bot.brain!.state).toBe('cover');
    expect(bot.eq.pockets.items.length).toBe(meds);
  });
});
