import { describe, expect, it } from 'vitest';
import {
  addItem,
  canCraft,
  collectCraft,
  collectFarm,
  createItem,
  createProfile,
  farmReady,
  itemNeeds,
  RECIPES,
  STATIONS,
  TASKS,
  stashCount,
  startCraft,
  stationLevel,
  traderDiscount,
  upgradeBlocker,
  upgradeStation,
} from '../src/index';

const give = (p: ReturnType<typeof createProfile>, items: [string, number][]) => {
  for (const [id, n] of items) for (let i = 0; i < n; i++) addItem(p.stash, createItem(id));
};

describe('hideout', () => {
  it('every station and recipe references real items', () => {
    for (const s of STATIONS) for (const l of s.levels) for (const [id] of l.items) expect(() => createItem(id)).not.toThrow();
    for (const r of RECIPES) {
      for (const [id] of r.inputs) expect(() => createItem(id)).not.toThrow();
      expect(() => createItem(r.output[0])).not.toThrow();
    }
  });

  it('upgrades cost credits and items, and respect prerequisites', () => {
    const p = createProfile();
    p.stash.items = [];
    p.money = 1_000_000;
    expect(upgradeBlocker(p, 'medstation')).toMatch(/Missing/);
    give(p, [['bandage', 2]]);
    expect(upgradeStation(p, 'medstation')).toBe(true);
    expect(stationLevel(p, 'medstation')).toBe(1);
    expect(stashCount(p.stash, 'bandage')).toBe(0);
    expect(upgradeBlocker(p, 'medstation')).toMatch(/Generator/);
  });

  it('stash upgrade grows the stash', () => {
    const p = createProfile();
    p.money = 1_000_000;
    give(p, [['bolts', 2], ['wires', 1]]);
    const h = p.stash.h;
    upgradeStation(p, 'stash');
    expect(p.stash.h).toBeGreaterThan(h);
  });

  it('crafts take real time and deliver to the stash', () => {
    const p = createProfile();
    p.money = 1_000_000;
    give(p, [['bandage', 2]]);
    upgradeStation(p, 'medstation');
    give(p, [['bandage', 2], ['water', 1]]);
    const r = RECIPES.find((x) => x.id === 'r_ai2')!;
    expect(canCraft(p, r)).toBeNull();
    const t0 = 1_000_000;
    expect(startCraft(p, 'r_ai2', t0)).toBe(true);
    expect(canCraft(p, r)).toBe('Station busy');
    const before = stashCount(p.stash, 'ai2');
    expect(collectCraft(p, 'medstation', t0 + 1000)).toBe(false);
    expect(collectCraft(p, 'medstation', t0 + r.minutes * 60_000)).toBe(true);
    expect(stashCount(p.stash, 'ai2')).toBe(before + 1);
  });

  it('bitcoin farm mines over time, capped', () => {
    const p = createProfile();
    p.money = 10_000_000;
    give(p, [['tank', 1], ['battery', 1], ['wires', 4], ['gpu', 1]]);
    expect(upgradeStation(p, 'generator')).toBe(true);
    expect(upgradeStation(p, 'farm')).toBe(true);
    const t = p.hideout.farmT;
    expect(farmReady(p, t + 5 * 3600_000)).toBe(0);
    expect(farmReady(p, t + 13 * 3600_000)).toBe(2);
    expect(farmReady(p, t + 100 * 3600_000)).toBe(3);
    expect(collectFarm(p, t + 13 * 3600_000)).toBe(2);
  });

  it('intelligence center lowers trader prices', () => {
    const p = createProfile();
    const base = traderDiscount(p);
    p.hideout.levels.intel = 2;
    expect(traderDiscount(p)).toBeCloseTo(base + 0.1, 5);
  });

  it('lists what an item is still needed for', () => {
    const p = createProfile('T');
    const wires = itemNeeds(p, 'wires');
    // A task hand-over (found in raid only) and several level-1 stations.
    expect(wires.some((n) => n.label.startsWith('Task') && n.fir && n.count === 2)).toBe(true);
    expect(wires.some((n) => n.label === 'Stash L1' && !n.fir)).toBe(true);
    expect(wires.some((n) => n.label.startsWith('Craft'))).toBe(false);
    // Once a task is claimed it stops asking.
    const task = TASKS.find((t) => t.objectives.some((o) => o.kind === 'handover' && o.item === 'wires'))!;
    p.tasks[task.id] = { progress: task.objectives.map(() => 0), claimed: true };
    expect(itemNeeds(p, 'wires').some((n) => n.label.startsWith('Task'))).toBe(false);
    // Crafts show up only for built stations.
    p.hideout.levels.workbench = 1;
    expect(itemNeeds(p, 'bolts').some((n) => n.label.startsWith('Craft'))).toBe(true);
    expect(itemNeeds(p, 'pm')).toEqual([]);
  });
});
