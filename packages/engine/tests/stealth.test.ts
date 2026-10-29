import { describe, expect, it } from 'vitest';
import { Raid, emptyIntent, starterKit, type Actor } from '../src/index';

/** Put one scav in an open patch facing a direction, everyone else far away, and see if it spots the player. */
function setup(distance: number, facingAway: boolean) {
  const r = new Raid({ seed: 3, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day' });
  const bots = r.actors.filter((a) => a !== r.player && !a.companion);
  const scav = bots.find((b) => b.archetype === 'scav') ?? bots[0]!;
  for (const b of bots) if (b !== scav) b.alive = false;
  // Find an open straight line long enough.
  const m = r.map;
  outer: for (let y = 4; y < m.height - 4; y++)
    for (let x = 4; x < m.width - distance - 6; x++) {
      let ok = true;
      for (let k = -3; k <= distance + 3 && ok; k++) ok = m.isWalkable(x + k, y) && !m.isOpaque(x + k, y);
      if (ok) {
        scav.pos.x = x + 0.5;
        scav.pos.y = y + 0.5;
        r.player.pos.x = x + distance + 0.5;
        r.player.pos.y = y + 0.5;
        break outer;
      }
    }
  scav.facing = facingAway ? Math.PI : 0;
  const brain = scav.brain!;
  brain.state = 'idle';
  return { r, scav };
}

function spotted(r: Raid, scav: Actor, seconds: number, sprint: boolean): boolean {
  for (let i = 0; i < seconds * 60; i++) {
    // A sprinting player shuffles back and forth to keep velocity up without leaving the line.
    const t = Math.floor(i / 30) % 2 ? 1 : -1;
    r.tick(1 / 60, { ...emptyIntent(), moveY: sprint ? t : 0, sprint, aimX: r.player.pos.x + 1, aimY: r.player.pos.y });
    if (scav.brain!.targetId === r.player.id) return true;
  }
  return false;
}

describe('stealth', () => {
  it('a bot looking the other way does not see you at 10 m', () => {
    const { r, scav } = setup(10, true);
    expect(spotted(r, scav, 3, false)).toBe(false);
  });

  it('a bot does not spot a still player at 25 m in daylight', () => {
    const { r, scav } = setup(25, false);
    expect(spotted(r, scav, 4, false)).toBe(false);
  });

  it('a bot facing you up close notices you quickly', () => {
    const { r, scav } = setup(6, false);
    expect(spotted(r, scav, 2, false)).toBe(true);
  });
});
