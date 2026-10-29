import { addItem, createItem, removeItem, type GridContainer } from './items/inventory';
import { getDef } from './items/defs';
import type { Profile } from './profile';
import { TASKS } from './tasks';

/**
 * The base between raids (Tarkov hideout / Duckov bunker): stations you build with loot and credits.
 * Each level unlocks crafts or a passive bonus. Crafting and the bitcoin farm run on real time, so the
 * base keeps working while you're out in a raid.
 */
export type StationId = 'stash' | 'generator' | 'medstation' | 'workbench' | 'intel' | 'farm';

export interface StationLevel {
  money: number;
  items: [string, number][];
  requires?: Partial<Record<StationId, number>>;
  bonus: string;
}

export interface StationDef {
  id: StationId;
  name: string;
  blurb: string;
  levels: StationLevel[];
}

export const STATIONS: StationDef[] = [
  {
    id: 'stash',
    name: 'Stash',
    blurb: 'Shelving and crates for everything you drag home.',
    levels: [
      { money: 40000, items: [['bolts', 2], ['wires', 1]], bonus: 'Stash 10×52' },
      { money: 120000, items: [['tools', 1], ['bolts', 4]], requires: { generator: 1 }, bonus: 'Stash 10×66' },
      { money: 300000, items: [['tools', 2], ['tank', 1], ['wires', 4]], requires: { generator: 1 }, bonus: 'Stash 10×84' },
    ],
  },
  {
    id: 'generator',
    name: 'Generator',
    blurb: 'Power for the workbench, the med station and the farm.',
    levels: [{ money: 60000, items: [['tank', 1], ['battery', 1], ['wires', 2]], bonus: 'Powers other stations' }],
  },
  {
    id: 'medstation',
    name: 'Med station',
    blurb: 'A clean table, a kettle and a shelf of supplies. Turns scraps into medkits.',
    levels: [
      { money: 30000, items: [['bandage', 2]], bonus: 'Craft bandages, splints and AI-2 kits' },
      { money: 140000, items: [['salewa', 1], ['ifak', 1], ['tools', 1]], requires: { generator: 1 }, bonus: 'Craft IFAKs, Grizzly kits and surgical kits' },
    ],
  },
  {
    id: 'workbench',
    name: 'Workbench',
    blurb: 'Vices, files and a reloading press.',
    levels: [
      { money: 50000, items: [['tools', 1], ['bolts', 2]], bonus: 'Craft common ammo and muzzle brakes' },
      { money: 180000, items: [['tools', 2], ['cpu', 1], ['wires', 3]], requires: { generator: 1 }, bonus: 'Craft AP ammo, grips, stocks, suppressors' },
    ],
  },
  {
    id: 'intel',
    name: 'Intelligence center',
    blurb: 'Radios, maps and a laptop. Knowing prices makes Vera friendlier.',
    levels: [
      { money: 90000, items: [['flash', 1], ['wires', 2]], requires: { generator: 1 }, bonus: 'Trader prices −5%' },
      { money: 260000, items: [['intel', 1], ['cpu', 1]], requires: { generator: 1 }, bonus: 'Trader prices −10%' },
    ],
  },
  {
    id: 'farm',
    name: 'Bitcoin farm',
    blurb: 'Graphics cards humming in a cold room. Mines while you raid.',
    levels: [
      { money: 150000, items: [['gpu', 1], ['wires', 2]], requires: { generator: 1 }, bonus: '1 bitcoin every 6 h (holds 3)' },
      { money: 300000, items: [['gpu', 2], ['cpu', 1]], requires: { generator: 1 }, bonus: '1 bitcoin every 3 h (holds 6)' },
    ],
  },
];

export const STASH_ROWS = [40, 52, 66, 84];

export interface Recipe {
  id: string;
  station: StationId;
  level: number;
  inputs: [string, number][];
  output: [string, number];
  minutes: number;
}

export const RECIPES: Recipe[] = [
  { id: 'r_bandage', station: 'medstation', level: 1, inputs: [['juice', 1]], output: ['bandage', 2], minutes: 4 },
  { id: 'r_splint', station: 'medstation', level: 1, inputs: [['bolts', 1], ['bandage', 1]], output: ['splint', 1], minutes: 5 },
  { id: 'r_ai2', station: 'medstation', level: 1, inputs: [['bandage', 2], ['water', 1]], output: ['ai2', 1], minutes: 8 },
  { id: 'r_ifak', station: 'medstation', level: 2, inputs: [['ai2', 1], ['esmarch', 1], ['bandage', 1]], output: ['ifak', 1], minutes: 15 },
  { id: 'r_grizzly', station: 'medstation', level: 2, inputs: [['salewa', 1], ['ifak', 1], ['splint', 1]], output: ['grizzly', 1], minutes: 30 },
  { id: 'r_cms', station: 'medstation', level: 2, inputs: [['tools', 1], ['bandage', 2]], output: ['cms', 1], minutes: 25 },
  { id: 'r_545', station: 'workbench', level: 1, inputs: [['bolts', 2], ['wires', 1]], output: ['a_545ps', 60], minutes: 10 },
  { id: 'r_762', station: 'workbench', level: 1, inputs: [['bolts', 2], ['wires', 1]], output: ['a_762ps', 60], minutes: 10 },
  { id: 'r_9mm', station: 'workbench', level: 1, inputs: [['bolts', 1], ['wires', 1]], output: ['a_9x19', 50], minutes: 8 },
  { id: 'r_buck', station: 'workbench', level: 1, inputs: [['bolts', 1]], output: ['a_12buck', 20], minutes: 6 },
  { id: 'r_brake', station: 'workbench', level: 1, inputs: [['bolts', 3], ['tools', 1]], output: ['brake', 1], minutes: 20 },
  { id: 'r_545bs', station: 'workbench', level: 2, inputs: [['a_545ps', 60], ['cpu', 1]], output: ['a_545bs', 60], minutes: 30 },
  { id: 'r_556ap', station: 'workbench', level: 2, inputs: [['a_556m855', 60], ['cpu', 1]], output: ['a_556m995', 60], minutes: 35 },
  { id: 'r_grip', station: 'workbench', level: 2, inputs: [['bolts', 2], ['tools', 1]], output: ['fgrip', 1], minutes: 20 },
  { id: 'r_stock', station: 'workbench', level: 2, inputs: [['bolts', 3], ['tools', 1]], output: ['stock_tac', 1], minutes: 25 },
  { id: 'r_sup9', station: 'workbench', level: 2, inputs: [['tank', 1], ['tools', 1], ['bolts', 2]], output: ['sup_9', 1], minutes: 45 },
];

export interface CraftJob {
  recipe: string;
  readyAt: number;
}

export interface HideoutState {
  levels: Partial<Record<StationId, number>>;
  crafts: Partial<Record<StationId, CraftJob>>;
  farmT: number;
}

export function newHideout(now = Date.now()): HideoutState {
  return { levels: {}, crafts: {}, farmT: now };
}

const H = (p: Profile) => (p.hideout ??= newHideout());
export const stationLevel = (p: Profile, id: StationId) => H(p).levels[id] ?? 0;

/** Total count of `id` in the stash (stacks summed), any provenance. */
export function stashCount(stash: GridContainer, id: string): number {
  return stash.items.reduce((n, pl) => n + (pl.item.def === id ? pl.item.stack : 0), 0);
}

function take(stash: GridContainer, id: string, n: number): void {
  for (const pl of [...stash.items]) {
    if (n <= 0) return;
    if (pl.item.def !== id) continue;
    const k = Math.min(n, pl.item.stack);
    pl.item.stack -= k;
    n -= k;
    if (pl.item.stack <= 0) removeItem(stash, pl.item.uid);
  }
}

/** Why the next level can't be built right now (null = it can). */
export function upgradeBlocker(p: Profile, id: StationId): string | null {
  const def = STATIONS.find((s) => s.id === id)!;
  const lvl = def.levels[stationLevel(p, id)];
  if (!lvl) return 'Fully upgraded';
  for (const [st, need] of Object.entries(lvl.requires ?? {}) as [StationId, number][])
    if (stationLevel(p, st) < need) return `Needs ${STATIONS.find((s) => s.id === st)!.name} level ${need}`;
  if (p.money < lvl.money) return 'Not enough credits';
  for (const [it, n] of lvl.items) if (stashCount(p.stash, it) < n) return `Missing ${getDef(it).name}`;
  return null;
}

export function upgradeStation(p: Profile, id: StationId): boolean {
  if (upgradeBlocker(p, id)) return false;
  const def = STATIONS.find((s) => s.id === id)!;
  const lvl = def.levels[stationLevel(p, id)]!;
  p.money -= lvl.money;
  for (const [it, n] of lvl.items) take(p.stash, it, n);
  H(p).levels[id] = stationLevel(p, id) + 1;
  if (id === 'stash') p.stash.h = Math.max(p.stash.h, STASH_ROWS[stationLevel(p, 'stash')] ?? p.stash.h);
  if (id === 'farm') H(p).farmT = Date.now();
  return true;
}

export function canCraft(p: Profile, r: Recipe): string | null {
  if (stationLevel(p, r.station) < r.level) return `Needs ${STATIONS.find((s) => s.id === r.station)!.name} level ${r.level}`;
  if (H(p).crafts[r.station]) return 'Station busy';
  for (const [it, n] of r.inputs) if (stashCount(p.stash, it) < n) return `Missing ${getDef(it).name}`;
  return null;
}

export function startCraft(p: Profile, recipeId: string, now = Date.now()): boolean {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r || canCraft(p, r)) return false;
  for (const [it, n] of r.inputs) take(p.stash, it, n);
  H(p).crafts[r.station] = { recipe: r.id, readyAt: now + r.minutes * 60_000 };
  return true;
}

/** Take a finished craft into the stash. False if it isn't ready or the stash is full. */
export function collectCraft(p: Profile, station: StationId, now = Date.now()): boolean {
  const job = H(p).crafts[station];
  const r = job && RECIPES.find((x) => x.id === job.recipe);
  if (!job || !r || now < job.readyAt) return false;
  const [id, n] = r.output;
  const d = getDef(id);
  if (!addItem(p.stash, createItem(id, d.stackMax ? { stack: n } : {}))) return false;
  delete H(p).crafts[station];
  return true;
}

/** Bitcoins waiting at the farm (accrued since the last collection, capped). */
export function farmReady(p: Profile, now = Date.now()): number {
  const lvl = stationLevel(p, 'farm');
  if (!lvl) return 0;
  const period = (lvl >= 2 ? 3 : 6) * 3600_000;
  return Math.min(lvl >= 2 ? 6 : 3, Math.floor((now - H(p).farmT) / period));
}

export function collectFarm(p: Profile, now = Date.now()): number {
  const n = farmReady(p, now);
  let got = 0;
  for (let i = 0; i < n; i++) if (addItem(p.stash, createItem('bitcoin', { fir: true }))) got++;
  if (got) {
    const lvl = stationLevel(p, 'farm');
    const period = (lvl >= 2 ? 3 : 6) * 3600_000;
    const cap = lvl >= 2 ? 6 : 3;
    // A full farm stops mining, so the clock restarts at collection.
    H(p).farmT = n >= cap ? now : Math.min(now, H(p).farmT + got * period);
  }
  return got;
}

/** Trader price cut from the intelligence center. */
export const intelDiscount = (p: Profile) => stationLevel(p, 'intel') * 0.05;

export interface ItemNeed {
  /** Where it's needed, e.g. "Task · Wired" or "Workbench L2". */
  label: string;
  count: number;
  /** Tasks only take found-in-raid items. */
  fir: boolean;
}

/**
 * Everything still waiting for this item: open task hand-overs, the next level of each station and the
 * crafts you can run. Shown in the item inspector so loot decisions mean something.
 */
export function itemNeeds(p: Profile, id: string): ItemNeed[] {
  const out: ItemNeed[] = [];
  for (const t of TASKS) {
    const st = p.tasks?.[t.id];
    if (st?.claimed) continue;
    t.objectives.forEach((o, i) => {
      if (o.kind !== 'handover' || o.item !== id) return;
      const left = o.count - (st?.progress[i] ?? 0);
      if (left > 0) out.push({ label: `Task · ${t.title}`, count: left, fir: true });
    });
  }
  for (const s of STATIONS) {
    const lvl = s.levels[stationLevel(p, s.id)];
    const n = lvl?.items.find(([it]) => it === id)?.[1];
    if (n) out.push({ label: `${s.name} L${stationLevel(p, s.id) + 1}`, count: n, fir: false });
  }
  for (const r of RECIPES) {
    const n = r.inputs.find(([it]) => it === id)?.[1];
    if (n && stationLevel(p, r.station) >= r.level) out.push({ label: `Craft · ${getDef(r.output[0]).name}`, count: n, fir: false });
  }
  return out;
}
