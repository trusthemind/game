import { addItem, createItem, removeItem, type GridContainer } from './items/inventory';
import { getDef } from './items/defs';
import type { Profile } from './profile';
import type { RaidResult } from './sim/raid';

/**
 * Tasks (Tarkov/Duckov-style quests) handed out by the hideout NPCs. They give every raid a purpose:
 * hunt a boss, find medicine, reach a crash site, survive a map. Progress from raids is applied
 * automatically; "find in raid" items are handed over from the stash.
 */
export type Objective =
  | { kind: 'kill'; archetype?: string; boss?: string; map?: string; count: number; text: string }
  | { kind: 'extract'; map?: string; count: number; text: string }
  | { kind: 'extractEach'; maps: string[]; text: string }
  | { kind: 'loot'; container: string; count: number; text: string }
  | { kind: 'visit'; site: 'heli' | 'airdrop'; extract: boolean; text: string }
  | { kind: 'handover'; item: string; count: number; text: string };

export interface TaskDef {
  id: string;
  giver: 'mykola' | 'vera' | 'lena';
  title: string;
  brief: string;
  objectives: Objective[];
  reward: { money?: number; xp?: number; items?: [string, number][]; affinity?: number };
  requires?: { level?: number; tasks?: string[] };
}

export interface TaskState {
  /** Progress per objective (counts; for extractEach a bitmask of maps). */
  progress: number[];
  claimed: boolean;
}

export const TASKS: TaskDef[] = [
  // ── Mykola: survival basics ───────────────────────────────────────────
  {
    id: 'first_steps',
    giver: 'mykola',
    title: 'First Steps',
    brief: 'Go out, grab whatever you can and come back alive. That is the whole job — the coming back part matters most.',
    objectives: [{ kind: 'extract', count: 1, text: 'Extract from any location' }],
    reward: { money: 15000, xp: 300, items: [['ifak', 1]], affinity: 3 },
  },
  {
    id: 'patch_up',
    giver: 'mykola',
    title: 'Patch Me Up',
    brief: 'Our med box is empty. Bring bandages and a kit — found out there, not bought from Vera.',
    objectives: [
      { kind: 'handover', item: 'bandage', count: 2, text: 'Hand over found-in-raid Army bandages' },
      { kind: 'handover', item: 'ai2', count: 1, text: 'Hand over a found-in-raid AI-2 medkit' },
    ],
    reward: { money: 20000, xp: 400, items: [['splint', 2], ['esmarch', 1]], affinity: 5 },
    requires: { tasks: ['first_steps'] },
  },
  {
    id: 'pest_control',
    giver: 'mykola',
    title: 'Pest Control',
    brief: 'The infected are spreading towards the village. Thin them out.',
    objectives: [{ kind: 'kill', archetype: 'infected', count: 6, text: 'Kill infected' }],
    reward: { money: 25000, xp: 500, items: [['saiga12', 1], ['a_12buck', 20]], affinity: 4 },
    requires: { tasks: ['first_steps'] },
  },
  {
    id: 'lights_out',
    giver: 'mykola',
    title: 'Lights Out',
    brief: 'The generator needs a battery and wiring if we want light at night.',
    objectives: [
      { kind: 'handover', item: 'battery', count: 1, text: 'Hand over a found-in-raid car battery' },
      { kind: 'handover', item: 'wires', count: 2, text: 'Hand over found-in-raid bundles of wires' },
    ],
    reward: { money: 40000, xp: 700, items: [['mag_ak45', 1], ['tac_light', 1]], affinity: 6 },
    requires: { tasks: ['patch_up'] },
  },
  // ── Vera: business ─────────────────────────────────────────────────────
  {
    id: 'scav_problem',
    giver: 'vera',
    title: 'Scav Problem',
    brief: 'Scavengers keep robbing my couriers on the Outskirts. Make them reconsider.',
    objectives: [{ kind: 'kill', archetype: 'scav', map: 'outskirts', count: 8, text: 'Kill scavs on Zavadsk Outskirts' }],
    reward: { money: 40000, xp: 600, items: [['red_dot', 1]], affinity: 6 },
    requires: { tasks: ['first_steps'] },
  },
  {
    id: 'golden',
    giver: 'vera',
    title: 'All That Glitters',
    brief: 'A buyer wants gold. Real gold, from the zone.',
    objectives: [{ kind: 'handover', item: 'chain', count: 2, text: 'Hand over found-in-raid golden chains' }],
    reward: { money: 60000, xp: 600, affinity: 6 },
    requires: { tasks: ['scav_problem'] },
  },
  {
    id: 'supply_run',
    giver: 'vera',
    title: 'Supply Run',
    brief: 'Someone is still dropping supplies over the zone. Get to a crate before the others do.',
    objectives: [{ kind: 'loot', container: 'airdrop', count: 1, text: 'Search an airdrop crate' }],
    reward: { money: 80000, xp: 900, items: [['scope_4x', 1]], affinity: 8 },
    requires: { level: 3 },
  },
  {
    id: 'wreckage',
    giver: 'vera',
    title: 'Wreckage',
    brief: 'A helicopter went down. Find the site, see what was on board, and get out with it.',
    objectives: [{ kind: 'visit', site: 'heli', extract: true, text: 'Reach a helicopter crash site and extract' }],
    reward: { money: 60000, xp: 800, items: [['holo', 1], ['fgrip', 1]], affinity: 6 },
    requires: { level: 2 },
  },
  {
    id: 'warlord',
    giver: 'vera',
    title: 'The Warlord',
    brief: 'Kostia holds the army depot on the Outskirts and taxes everyone who passes. End it.',
    objectives: [{ kind: 'kill', boss: 'kostia', count: 1, text: 'Kill Warlord Kostia' }],
    reward: { money: 250000, xp: 3000, items: [['sc_beta', 1]], affinity: 12 },
    requires: { level: 5, tasks: ['scav_problem'] },
  },
  {
    id: 'smuggler',
    giver: 'vera',
    title: "Smuggler's End",
    brief: 'Rina runs the docks at Port Kirov and undercuts my prices. Bring me her ledger — I will know.',
    objectives: [
      { kind: 'kill', boss: 'rina', count: 1, text: 'Kill Smuggler Rina' },
      { kind: 'handover', item: 'rina_ledger', count: 1, text: "Hand over the smuggler's ledger" },
    ],
    reward: { money: 220000, xp: 2600, items: [['vector', 1], ['sup_9', 1]], affinity: 12 },
    requires: { level: 5 },
  },
  // ── Lena: the people at camp ──────────────────────────────────────────
  {
    id: 'camp_meds',
    giver: 'lena',
    title: 'Medicine for the Camp',
    brief: 'Two of ours have fever. A proper first aid kit would save them.',
    objectives: [
      { kind: 'handover', item: 'salewa', count: 1, text: 'Hand over a found-in-raid Salewa kit' },
      { kind: 'handover', item: 'ifak', count: 1, text: 'Hand over a found-in-raid IFAK' },
    ],
    reward: { money: 30000, xp: 700, affinity: 10 },
    requires: { tasks: ['first_steps'] },
  },
  {
    id: 'raiders',
    giver: 'lena',
    title: 'Raider Trouble',
    brief: 'Raiders shot at our water party. They will do it again unless someone stops them.',
    objectives: [{ kind: 'kill', archetype: 'raider', count: 4, text: 'Kill raiders' }],
    reward: { money: 70000, xp: 1200, items: [['trooper', 1]], affinity: 8 },
    requires: { level: 3 },
  },
  {
    id: 'hunter',
    giver: 'lena',
    title: 'The Hunter',
    brief: 'Bohdan shoots anyone who walks into "his" woods at Pine Hollow. My brother was one of them.',
    objectives: [{ kind: 'kill', boss: 'bohdan', count: 1, text: 'Kill Hunter Bohdan' }],
    reward: { money: 200000, xp: 2400, items: [['scope_8x', 1], ['mosin', 1]], affinity: 15 },
    requires: { level: 4, tasks: ['raiders'] },
  },
  {
    id: 'explorer',
    giver: 'lena',
    title: 'Cartographer',
    brief: 'We need to know every road out of here. Walk them all — and come back from each.',
    objectives: [{ kind: 'extractEach', maps: ['outskirts', 'pinehollow', 'portkirov'], text: 'Extract from Outskirts, Pine Hollow and Port Kirov' }],
    reward: { money: 100000, xp: 1500, items: [['b_attack', 1]], affinity: 8 },
    requires: { tasks: ['first_steps'] },
  },
];

export const taskById = (id: string) => TASKS.find((t) => t.id === id) ?? null;

function state(p: Profile, t: TaskDef): TaskState {
  p.tasks ??= {};
  return (p.tasks[t.id] ??= { progress: t.objectives.map(() => 0), claimed: false });
}

export function objectiveTarget(o: Objective): number {
  return o.kind === 'extractEach' ? o.maps.length : o.kind === 'visit' ? 1 : o.count;
}

export function objectiveProgress(o: Objective, v: number): number {
  return o.kind === 'extractEach' ? popcount(v) : v;
}

const popcount = (v: number) => {
  let n = 0;
  while (v) {
    n += v & 1;
    v >>= 1;
  }
  return n;
};

export function taskUnlocked(p: Profile, t: TaskDef, level: number): boolean {
  if (t.requires?.level && level < t.requires.level) return false;
  return (t.requires?.tasks ?? []).every((id) => p.tasks?.[id]?.claimed);
}

export function taskComplete(p: Profile, t: TaskDef): boolean {
  const s = state(p, t);
  return t.objectives.every((o, i) => objectiveProgress(o, s.progress[i] ?? 0) >= objectiveTarget(o));
}

/** Fold one raid into task progress. Returns human-readable progress notes. */
export function applyRaidToTasks(p: Profile, r: RaidResult, level: number): string[] {
  const notes: string[] = [];
  const extracted = r.status === 'extracted';
  for (const t of TASKS) {
    const s = state(p, t);
    if (s.claimed || !taskUnlocked(p, t, level)) continue;
    t.objectives.forEach((o, i) => {
      const before = s.progress[i] ?? 0;
      let v = before;
      switch (o.kind) {
        case 'kill':
          if (o.map && o.map !== r.mapId) break;
          v += (r.killLog ?? []).filter((k) => (o.boss ? k.bossId === o.boss : k.archetype === o.archetype)).length;
          break;
        case 'extract':
          if (extracted && (!o.map || o.map === r.mapId)) v += 1;
          break;
        case 'extractEach': {
          const bit = o.maps.indexOf(r.mapId ?? '');
          if (extracted && bit >= 0) v |= 1 << bit;
          break;
        }
        case 'loot':
          v += (r.lootedKinds ?? []).filter((k) => k === o.container).length;
          break;
        case 'visit':
          if ((r.visited ?? []).includes(o.site) && (!o.extract || extracted)) v = 1;
          break;
        case 'handover':
          break;
      }
      v = o.kind === 'extractEach' ? v : Math.min(v, objectiveTarget(o));
      if (v !== before) {
        s.progress[i] = v;
        notes.push(`${t.title}: ${o.text} ${objectiveProgress(o, v)}/${objectiveTarget(o)}`);
      }
    });
  }
  return notes;
}

/** Found-in-raid copies of `item` in the stash (stack-aware). */
export function firCount(stash: GridContainer, item: string): number {
  return stash.items.reduce((n, pl) => n + (pl.item.def === item && pl.item.fir ? pl.item.stack : 0), 0);
}

/** Hand over found-in-raid items from the stash for a handover objective. Returns how many were given. */
export function handOver(p: Profile, taskId: string, objIndex: number): number {
  const t = taskById(taskId);
  const o = t?.objectives[objIndex];
  if (!t || !o || o.kind !== 'handover') return 0;
  const s = state(p, t);
  let need = o.count - (s.progress[objIndex] ?? 0);
  let given = 0;
  for (const pl of [...p.stash.items]) {
    if (need <= 0) break;
    if (pl.item.def !== o.item || !pl.item.fir) continue;
    const n = Math.min(need, pl.item.stack);
    pl.item.stack -= n;
    if (pl.item.stack <= 0) removeItem(p.stash, pl.item.uid);
    need -= n;
    given += n;
  }
  s.progress[objIndex] = (s.progress[objIndex] ?? 0) + given;
  return given;
}

/** Pay out a completed task. Items that don't fit in the stash are lost, so callers check space first. */
export function claimTask(p: Profile, taskId: string, level: number): boolean {
  const t = taskById(taskId);
  if (!t || !taskUnlocked(p, t, level) || !taskComplete(p, t)) return false;
  const s = state(p, t);
  if (s.claimed) return false;
  s.claimed = true;
  p.money += t.reward.money ?? 0;
  p.xp += t.reward.xp ?? 0;
  for (const [id, n] of t.reward.items ?? []) {
    const d = getDef(id);
    const it = createItem(id, d.stackMax ? { stack: n } : {});
    addItem(p.stash, it);
    for (let i = 1; !d.stackMax && i < n; i++) addItem(p.stash, createItem(id));
  }
  const rel = p.npcs[t.giver];
  if (rel && t.reward.affinity) rel.affinity = Math.min(100, rel.affinity + t.reward.affinity);
  return true;
}

/** Authoring check used by tests: items, bosses and prerequisite ids must exist. */
export function validateTasks(): string[] {
  const errs: string[] = [];
  const ids = new Set(TASKS.map((t) => t.id));
  for (const t of TASKS) {
    for (const r of t.requires?.tasks ?? []) if (!ids.has(r)) errs.push(`${t.id}: unknown prerequisite ${r}`);
    for (const [id] of t.reward.items ?? []) {
      try {
        getDef(id);
      } catch {
        errs.push(`${t.id}: unknown reward ${id}`);
      }
    }
    for (const o of t.objectives) {
      if (o.kind === 'handover') {
        try {
          getDef(o.item);
        } catch {
          errs.push(`${t.id}: unknown item ${o.item}`);
        }
      }
      if (o.kind === 'kill' && o.boss && !['kostia', 'bohdan', 'rina'].includes(o.boss)) errs.push(`${t.id}: unknown boss ${o.boss}`);
    }
  }
  return errs;
}
