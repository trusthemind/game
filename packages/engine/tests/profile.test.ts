import { describe, expect, it } from 'vitest';
import {
  addItem,
  applyRaidResult,
  buy,
  buyPrice,
  createItem,
  createProfile,
  ITEMS,
  levelFromXp,
  migrateProfile,
  sellPrice,
  starterKit,
  traderCatalog,
  type RaidResult,
} from '../src/index';

const result = (over: Partial<RaidResult>): RaidResult => ({
  status: 'extracted',
  duration: 600,
  kills: { scav: 2 },
  playerEq: starterKit(),
  valueIn: 1000,
  valueOut: 5000,
  xp: 300,
  companion: null,
  metNpcs: [],
  deadNpcs: [],
  secure: null,
  deathAt: null,
  graveVisited: false,
  ...over,
});

describe('profile', () => {
  it('survives a JSON round-trip and migration', () => {
    const p = createProfile('Tester');
    const back = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(back.name).toBe('Tester');
    expect(back.money).toBe(p.money);
  });

  it('migrates garbage to a fresh profile', () => {
    expect(migrateProfile(null).stats.raids).toBe(0);
    expect(migrateProfile({ version: -1 }).stats.raids).toBe(0);
  });

  it('keeps gear on extraction, loses it on death', () => {
    const p = createProfile();
    applyRaidResult(p, result({}));
    expect(p.stats.survived).toBe(1);
    expect(p.equipment.slots.secondary).not.toBeNull();
    expect(p.stats.kills).toBe(2);
    applyRaidResult(p, result({ status: 'dead', playerEq: null }));
    expect(p.stats.deaths).toBe(1);
    expect(p.equipment.slots.secondary).toBeNull();
  });

  it('levels up from xp', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(100000).level).toBeGreaterThan(5);
  });

  it('deposits looted money automatically', () => {
    const p = createProfile();
    const eq = starterKit();
    const cashId = Object.values(ITEMS).find((d) => d.category === 'money')!.id;
    addItem(eq.pockets, createItem(cashId, { stack: 500 }));
    const before = p.money;
    applyRaidResult(p, result({ playerEq: eq }));
    expect(p.money).toBe(before + 500);
  });
});

describe('trader', () => {
  it('buys into the stash and charges money', () => {
    const p = createProfile();
    p.money = 1_000_000;
    const price = buyPrice(ITEMS.bandage!, p);
    expect(buy(p, 'bandage').ok).toBe(true);
    expect(p.money).toBe(1_000_000 - price);
  });

  it('refuses when broke', () => {
    const p = createProfile();
    p.money = 0;
    expect(buy(p, 'ak74m').ok).toBe(false);
  });

  it('never buys for more than it sells', () => {
    const p = createProfile();
    for (const e of traderCatalog(p)) expect(sellPrice(createItem(e.def.id), p)).toBeLessThanOrEqual(buyPrice(e.def, p));
  });

  it('a better relationship with Vera gives a discount', () => {
    const p = createProfile();
    const base = buyPrice(ITEMS.ak74m!, p);
    p.npcs.vera!.affinity = 60;
    expect(buyPrice(ITEMS.ak74m!, p)).toBeLessThan(base);
  });
});

describe('extraction loot', () => {
  it('moves found-in-raid items into the stash and keeps the kit', async () => {
    const { Raid, emptyIntent } = await import('../src/index');
    const p = createProfile();
    const eq = starterKit();
    const r = new Raid({ seed: 4, playerEq: eq, mapId: 'testsite', timeOfDay: 'day' });
    const found = createItem('ai2');
    if (!addItem(r.player.eq.pockets, found)) addItem(r.player.eq.slots.rig!.grid!, found);
    r.status = 'extracted';
    r.tick(1 / 60, emptyIntent());
    const res = r.result();
    expect(res.loot).toContain(found.uid);
    const kitBefore = res.playerEq!.slots.secondary!.uid;
    const summary = applyRaidResult(p, res);
    expect(summary.toStash.map((i) => i.uid)).toContain(found.uid);
    expect(p.stash.items.some((s) => s.item.uid === found.uid)).toBe(true);
    expect(p.equipment.slots.secondary!.uid).toBe(kitBefore);
  });
});

describe('secure container + death grave', () => {
  it('the secure container and its contents survive death', async () => {
    const { Raid } = await import('../src/index');
    const p = createProfile();
    const r = new Raid({ seed: 2, playerEq: p.equipment, mapId: 'testsite', timeOfDay: 'day' });
    const sc = r.player.eq.slots.secure!;
    const gold = createItem('ai2');
    expect(addItem(sc.grid!, gold)).toBe(true);
    r.status = 'dead';
    applyRaidResult(p, r.result());
    expect(p.equipment.slots.secondary).toBeNull();
    expect(p.equipment.slots.secure?.grid?.items.map((i) => i.item.uid)).toContain(gold.uid);
  });

  it('secure containers refuse backpacks and other containers', () => {
    const sc = createItem('sc_gamma');
    expect(addItem(sc.grid!, createItem('b_sling'))).toBe(false);
    expect(addItem(sc.grid!, createItem('sc_alpha'))).toBe(false);
    expect(addItem(sc.grid!, createItem('bandage'))).toBe(true);
  });

  it('Normal leaves a grave for one recovery raid on that map; Hard does not', async () => {
    const { Raid } = await import('../src/index');
    const p = createProfile();
    const r = new Raid({ seed: 2, playerEq: p.equipment, mapId: 'testsite', timeOfDay: 'day' });
    r.status = 'dead';
    applyRaidResult(p, r.result());
    expect(p.grave?.mapId).toBe('testsite');
    expect(p.grave?.eq.slots.secondary).not.toBeNull();
    const r2 = new Raid({ seed: 3, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day', grave: p.grave });
    expect(r2.corpses.some((c) => c.name === 'Your body')).toBe(true);
    r2.abandon();
    applyRaidResult(p, r2.result());
    expect(p.grave).toBeNull();

    const h = createProfile();
    h.settings.difficulty = 'hard';
    const r3 = new Raid({ seed: 2, playerEq: h.equipment, mapId: 'testsite', timeOfDay: 'day', difficulty: 'hard' });
    r3.status = 'dead';
    applyRaidResult(h, r3.result());
    expect(h.grave).toBeNull();
  });

  it('migrates v2 profiles: adds an Alpha container and difficulty', () => {
    const p = createProfile() as unknown as Record<string, unknown> & { equipment: { slots: Record<string, unknown> }; settings: Record<string, unknown> };
    p.version = 2;
    delete p.equipment.slots.secure;
    delete p.settings.difficulty;
    delete p.grave;
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(m.equipment.slots.secure?.def).toBe('sc_alpha');
    expect(m.settings.difficulty).toBe('normal');
    expect(m.version).toBe(3);
  });
});
