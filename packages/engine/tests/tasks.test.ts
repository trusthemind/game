import { describe, expect, it } from 'vitest';
import {
  addItem,
  applyRaidResult,
  claimTask,
  createItem,
  createProfile,
  firCount,
  handOver,
  levelFromXp,
  starterKit,
  taskById,
  taskComplete,
  taskUnlocked,
  TASKS,
  validateTasks,
  type RaidResult,
} from '../src/index';

const raid = (over: Partial<RaidResult>): RaidResult => ({
  status: 'extracted',
  duration: 300,
  kills: {},
  playerEq: starterKit(),
  secure: null,
  deathAt: null,
  graveVisited: false,
  valueIn: 0,
  valueOut: 0,
  xp: 0,
  companion: null,
  metNpcs: [],
  deadNpcs: [],
  mapId: 'outskirts',
  ...over,
});

describe('tasks', () => {
  it('authored tasks reference real items, bosses and prerequisites', () => {
    expect(validateTasks()).toEqual([]);
  });

  it('first extraction completes First Steps and unlocks follow-ups', () => {
    const p = createProfile();
    expect(taskUnlocked(p, taskById('patch_up')!, 1)).toBe(false);
    const sum = applyRaidResult(p, raid({}));
    expect(sum.taskNotes.some((n) => n.startsWith('First Steps'))).toBe(true);
    expect(taskComplete(p, taskById('first_steps')!)).toBe(true);
    const money = p.money;
    expect(claimTask(p, 'first_steps', levelFromXp(p.xp).level)).toBe(true);
    expect(p.money).toBe(money + 15000);
    expect(p.stash.items.some((s) => s.item.def === 'ifak')).toBe(true);
    expect(claimTask(p, 'first_steps', 1)).toBe(false);
    expect(taskUnlocked(p, taskById('patch_up')!, 1)).toBe(true);
  });

  it('kills count per archetype and map; bosses by id', () => {
    const p = createProfile();
    applyRaidResult(p, raid({}));
    claimTask(p, 'first_steps', 1);
    applyRaidResult(p, raid({ mapId: 'pinehollow', killLog: [{ archetype: 'scav' }, { archetype: 'scav' }] }));
    expect(p.tasks.scav_problem!.progress[0]).toBe(0); // wrong map
    applyRaidResult(p, raid({ status: 'dead', playerEq: null, killLog: Array.from({ length: 8 }, () => ({ archetype: 'scav' })) }));
    expect(taskComplete(p, taskById('scav_problem')!)).toBe(true); // kills count even if you die
  });

  it('only found-in-raid items can be handed over', () => {
    const p = createProfile();
    applyRaidResult(p, raid({}));
    claimTask(p, 'first_steps', 1);
    addItem(p.stash, createItem('bandage'));
    expect(handOver(p, 'patch_up', 0)).toBe(0);
    addItem(p.stash, createItem('bandage', { fir: true }));
    addItem(p.stash, createItem('bandage', { fir: true }));
    expect(firCount(p.stash, 'bandage')).toBe(2);
    expect(handOver(p, 'patch_up', 0)).toBe(2);
    expect(firCount(p.stash, 'bandage')).toBe(0);
  });

  it('loot carried out of a raid becomes found-in-raid', () => {
    const p = createProfile();
    const eq = starterKit();
    const chain = createItem('chain');
    addItem(eq.pockets, chain);
    applyRaidResult(p, raid({ playerEq: eq, loot: [chain.uid] }));
    expect(firCount(p.stash, 'chain')).toBe(1);
  });

  it('cartographer needs an extraction from each map', () => {
    const p = createProfile();
    applyRaidResult(p, raid({}));
    claimTask(p, 'first_steps', 1);
    for (const m of ['outskirts', 'pinehollow', 'portkirov']) applyRaidResult(p, raid({ mapId: m }));
    expect(taskComplete(p, taskById('explorer')!)).toBe(true);
    expect(TASKS.length).toBeGreaterThanOrEqual(12);
  });
});
