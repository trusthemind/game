import { describe, expect, it } from 'vitest';
import { Raid, Tile, VAULT_TIME, emptyIntent, starterKit } from '../src/index';

describe('window vaulting', () => {
  it('climbs through a window to the other side and smashes the glass', () => {
    const r = new Raid({ seed: 5, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', events: false });
    const m = r.map;
    // Find a window with walkable tiles on both sides along one axis.
    let found: { x: number; y: number; dx: number; dy: number } | null = null;
    for (let y = 1; y < m.height - 1 && !found; y++)
      for (let x = 1; x < m.width - 1 && !found; x++) {
        if (m.get(x, y) !== Tile.Window) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]] as const)
          if (m.isWalkable(x - dx, y - dy) && m.isWalkable(x + dx, y + dy)) found = { x, y, dx, dy };
      }
    expect(found).not.toBeNull();
    const w = found!;
    for (const a of r.actors) if (a !== r.player) a.alive = false;
    r.player.pos.x = w.x - w.dx + 0.5;
    r.player.pos.y = w.y - w.dy + 0.5;
    r.player.facing = Math.atan2(w.dy, w.dx);
    const target = r.windowNear(r.player);
    expect(target?.kind).toBe('window');
    expect(r.vault(r.player, target!.id)).toBe(true);
    expect(r.brokenGlass.has(target!.id)).toBe(true);
    for (let i = 0; i < Math.ceil(VAULT_TIME * 60) + 2; i++) r.tick(1 / 60, emptyIntent());
    expect(Math.floor(r.player.pos.x)).toBe(w.x + w.dx);
    expect(Math.floor(r.player.pos.y)).toBe(w.y + w.dy);
  });
});
