import { describe, expect, it } from 'vitest';
import { Raid, Tile, addItem, createItem, emptyIntent, starterKit, type Actor } from '../src/index';

const raid = () => new Raid({ seed: 3, playerEq: starterKit(), mapId: 'outskirts', botDensity: 0, events: false, timeOfDay: 'day' });
const stand = (_r: Raid, a: Actor, x: number, y: number) => {
  a.pos.x = x;
  a.pos.y = y;
};

describe('locks, the power switch and exits with conditions', () => {
  it('the armoury opens with its key, not without', () => {
    const r = raid();
    const p = r.player;
    const door = r.map.doors.find((d) => d.label === 'Armoury')!;
    expect(door).toBeTruthy();
    stand(r, p, door.x, door.y + 1);
    expect(r.unlockDoor(p, door.id)).toBe(false);
    expect(r.map.tiles[door.tiles[0]!]).toBe(Tile.LockedDoor);
    addItem(p.eq.pockets, createItem('key_armoury'));
    expect(r.unlockDoor(p, door.id)).toBe(true);
    for (const i of door.tiles) expect(r.map.tiles[i]).not.toBe(Tile.LockedDoor);
    expect(r.map.isWalkable(Math.floor(door.x), Math.floor(door.y))).toBe(true);
    // The racks inside are weapon crates.
    const inside = r.map.containers.filter((c) => {
      const b = r.map.buildings.find((o) => o.id === r.map.sites[0]!.buildings.armoury)!;
      return c.x >= b.x && c.y >= b.y && c.x < b.x + b.w && c.y < b.y + b.h;
    });
    expect(inside.filter((c) => c.kind === 'weaponbox').length).toBeGreaterThan(0);
  });

  it('Kostia carries the armoury key', () => {
    for (let seed = 1; seed < 8; seed++) {
      const r = new Raid({ seed, playerEq: starterKit(), mapId: 'outskirts', events: false, timeOfDay: 'day' });
      const boss = r.actors.find((a) => a.archetype === 'boss');
      if (!boss) continue;
      const grids = [boss.eq.pockets, boss.eq.slots.rig?.grid, boss.eq.slots.backpack?.grid];
      expect(grids.some((g) => g?.items.some((x) => x.item.def === 'key_armoury'))).toBe(true);
      return;
    }
    throw new Error('no boss in 7 raids');
  });

  it('a power exit opens when the switch is thrown', () => {
    const r = raid();
    const p = r.player;
    const ex = r.map.extractions.find((e) => e.rule?.kind === 'power')!;
    expect(ex).toBeTruthy();
    expect(r.extractBlocked(ex)).toMatch(/power/i);
    stand(r, p, ex.x, ex.y);
    for (let i = 0; i < 60 * 12; i++) r.tick(1 / 60, emptyIntent());
    expect(r.status).toBe('active');
    const sw = r.map.switches[0]!;
    stand(r, p, sw.x, sw.y);
    expect(r.flipSwitch(p, sw.id)).toBe(true);
    expect(r.extractBlocked(ex)).toBeNull();
    stand(r, p, ex.x, ex.y);
    for (let i = 0; i < 60 * 12 && r.status === 'active'; i++) r.tick(1 / 60, emptyIntent());
    expect(r.status).toBe('extracted');
  });

  it('a paid exit takes the fee in credits; a crawl turns back a backpack', () => {
    const r = raid();
    const p = r.player;
    const paid = r.map.extractions.find((e) => e.rule?.kind === 'fee')!;
    expect(paid).toBeTruthy();
    stand(r, p, paid.x, paid.y);
    expect(r.payExtract(p, paid.id)).toBe(false);
    addItem(p.eq.pockets, createItem('roubles', { stack: 8000 }));
    expect(r.payExtract(p, paid.id)).toBe(true);
    expect(r.creditsCarried(p)).toBe(8000 - (paid.rule as { amount: number }).amount);
    expect(r.extractBlocked(paid)).toBeNull();
    const crawl = r.map.extractions.find((e) => e.rule?.kind === 'noBackpack');
    if (crawl) {
      p.eq.slots.backpack = createItem('b_pilgrim');
      expect(r.extractBlocked(crawl)).toMatch(/backpack/i);
      p.eq.slots.backpack = null;
      expect(r.extractBlocked(crawl)).toBeNull();
    }
    // Two exits stay open to anyone.
    expect(r.map.extractions.filter((e) => !e.rule).length).toBeGreaterThanOrEqual(2);
  });
});
