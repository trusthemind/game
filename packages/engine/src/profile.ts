import { addItem, carryGrids, removeItem, type ItemInstance, createEquipment, createGrid, createItem, type Equipment, type GridContainer, SLOTS } from './items/inventory';
import { generateLoadout, starterKit } from './items/loadouts';
import { getDef } from './items/defs';
import { Rng } from './core/rng';
import { INITIAL_AFFINITY, NPCS } from './dialogue/npcs';
import { newRelationship, type Relationship } from './dialogue/types';
import type { Difficulty, Grave, RaidResult } from './sim/raid';
import { applyRaidToTasks, type TaskState } from './tasks';
import { newHideout, type HideoutState } from './hideout';

export const PROFILE_VERSION = 3;

export interface ProfileStats {
  raids: number;
  survived: number;
  kills: number;
  deaths: number;
  mia: number;
  bestHaul: number;
  timePlayed: number;
}

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  showPerf: boolean;
  volume: number;
  difficulty: Difficulty;
}

/** Player character look (rendering only; persisted so you see the same survivor everywhere). */
export interface PlayerLook {
  sex: 'm' | 'f';
  skin: number;
  hair: string;
  hairColor: number;
  beard: boolean;
}

export const DEFAULT_LOOK: PlayerLook = { sex: 'm', skin: 0xe3b08e, hair: 'short', hairColor: 0x3a281b, beard: true };

export interface Profile {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Monotonic revision used for server sync (optimistic concurrency). */
  rev: number;
  money: number;
  xp: number;
  stash: GridContainer;
  equipment: Equipment;
  stats: ProfileStats;
  npcs: Record<string, Relationship>;
  /** NPC currently set to join the next raid. */
  companion: string | null;
  companionEq: Record<string, Equipment>;
  lastFreeKit: number;
  settings: Settings;
  look: PlayerLook;
  /** Your body + gear from the last death, waiting on that map for one recovery raid (Easy/Normal). */
  grave: Grave | null;
  /** Task progress by task id. */
  tasks: Record<string, TaskState>;
  /** Base stations, running crafts, bitcoin farm clock. */
  hideout: HideoutState;
}

export function createProfile(name = 'Survivor', id = randomId(), look: PlayerLook = DEFAULT_LOOK): Profile {
  const stash = createGrid(10, 40, true);
  for (const [def, n] of [['a_9x18', 50], ['bandage', 1], ['crackers', 1], ['b_sling', 1], ['crowbar', 1]] as const) addItem(stash, createItem(def, { stack: n }));
  const npcs: Record<string, Relationship> = {};
  for (const id of Object.keys(NPCS)) npcs[id] = { ...newRelationship(), affinity: INITIAL_AFFINITY[id] ?? 0 };
  const now = Date.now();
  return {
    version: PROFILE_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    rev: 0,
    money: 60000,
    xp: 0,
    stash,
    equipment: starterKit(),
    stats: { raids: 0, survived: 0, kills: 0, deaths: 0, mia: 0, bestHaul: 0, timePlayed: 0 },
    npcs,
    companion: null,
    companionEq: {},
    lastFreeKit: 0,
    settings: { quality: 'auto', showPerf: false, volume: 0.7, difficulty: 'normal' },
    look: { ...look },
    grave: null,
    tasks: {},
    hideout: newHideout(now),
  };
}

/** Forward-migrate any older saved profile. Never throws: falls back to a fresh profile on garbage input. */
export function migrateProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') return createProfile();
  const p = raw as Partial<Profile> & { version?: number };
  if (typeof p.version !== 'number' || !p.stash || !p.equipment) return createProfile(p.name);
  const out = p as Profile;
  if (out.version < 2) {
    // v1 → v2: melee slot, NPC relationships, companions.
    out.equipment.slots.melee ??= null;
    out.npcs ??= {};
    out.companion ??= null;
    out.companionEq ??= {};
    out.version = 2;
  }
  for (const id of Object.keys(NPCS)) out.npcs[id] ??= { ...newRelationship(), affinity: INITIAL_AFFINITY[id] ?? 0 };
  out.settings ??= { quality: 'auto', showPerf: false, volume: 0.7, difficulty: 'normal' };
  if (out.version < 3) {
    // v2 → v3: secure container slot, difficulty, death grave.
    out.equipment.slots.secure ??= null;
    for (const eq of Object.values(out.companionEq ?? {})) eq.slots.secure ??= null;
    const hasSecure = !!out.equipment.slots.secure || out.stash.items.some((p) => getDef(p.item.def).category === 'secure');
    if (!hasSecure) out.equipment.slots.secure = createItem('sc_alpha');
    out.settings.difficulty ??= 'normal';
    out.grave ??= null;
    out.version = 3;
  }
  out.settings.difficulty ??= 'normal';
  out.grave ??= null;
  out.rev ??= 0;
  out.look ??= { ...DEFAULT_LOOK };
  return out;
}

export function levelFromXp(xp: number): { level: number; into: number; next: number } {
  let level = 1;
  let need = 1000;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level++;
    need = Math.round(need * 1.25);
  }
  return { level, into: rest, next: need };
}

/** Gear the NPC brings on a raid (persisted per companion so their kit carries over between raids). */
export function companionLoadout(profile: Profile, npcId: string): Equipment {
  const existing = profile.companionEq[npcId];
  if (existing && (existing.slots.primary || existing.slots.secondary)) return existing;
  const eq = generateLoadout('raider', new Rng(`${profile.id}:${npcId}:${profile.stats.raids}`), 0);
  // Companions start a little lighter than raiders.
  eq.slots.backpack = null;
  if (npcId === 'lena') for (let i = 0; i < 2; i++) addItem(eq.pockets, createItem('bandage'));
  profile.companionEq[npcId] = eq;
  return eq;
}

/** Encounter NPC gear: a pistol and not much else. */
export function encounterLoadout(npcId: string): Equipment {
  const eq = createEquipment();
  eq.slots.secondary = createItem('pm', { ammo: 3, ammoType: 'a_9x18' });
  if (npcId === 'lena') addItem(eq.pockets, createItem('roubles', { stack: 6000 }));
  return eq;
}

export interface RaidSummary {
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  moneyFromItems: number;
  /** Loot moved from your gear into the stash (stash full → it stays on your gear). */
  toStash: ItemInstance[];
  /** Task progress made this raid. */
  taskNotes: string[];
}

/** Fold a finished raid back into the persistent profile. */
export function applyRaidResult(profile: Profile, result: RaidResult): RaidSummary {
  const levelBefore = levelFromXp(profile.xp).level;
  profile.stats.raids++;
  profile.stats.timePlayed += result.duration;
  const kills = Object.values(result.kills).reduce((a, b) => a + b, 0);
  profile.stats.kills += kills;
  if (result.status === 'extracted' && result.playerEq) {
    profile.stats.survived++;
    profile.equipment = result.playerEq;
    profile.stats.bestHaul = Math.max(profile.stats.bestHaul, result.valueOut - result.valueIn);
  } else {
    if (result.status === 'dead') profile.stats.deaths++;
    else profile.stats.mia++;
    profile.equipment = createEquipment();
  }
  // The secure container always comes home, with whatever is inside.
  if (result.secure) profile.equipment.slots.secure = result.secure;
  // Recovery grave: one attempt. Visiting the map uses it up; a new death replaces it.
  if (result.graveVisited) profile.grave = null;
  if (result.deathAt && (profile.settings.difficulty ?? 'normal') !== 'hard') profile.grave = { ...result.deathAt };
  profile.xp += result.xp;
  if (result.companion) {
    const rel = profile.npcs[result.companion.npcId];
    if (result.companion.alive && result.companion.eq) {
      profile.companionEq[result.companion.npcId] = result.companion.eq;
      if (rel && result.status === 'extracted') {
        rel.affinity = Math.min(100, rel.affinity + 4);
        if (!rel.flags.includes('at_base')) rel.flags.push('at_base');
      }
    }
  }
  for (const id of result.metNpcs) if (profile.npcs[id]) profile.npcs[id]!.met = true;
  for (const id of result.deadNpcs) {
    const rel = profile.npcs[id];
    if (rel) rel.dead = true;
    if (profile.companion === id) profile.companion = null;
    delete profile.companionEq[id];
  }
  // Money items picked up in raid are deposited automatically.
  let moneyFromItems = 0;
  for (const g of carryGrids(profile.equipment))
    for (let i = g.items.length - 1; i >= 0; i--) {
      const it = g.items[i]!.item;
      if (getDef(it.def).category === 'money') {
        moneyFromItems += it.stack;
        g.items.splice(i, 1);
      }
    }
  profile.money += moneyFromItems;
  // Found-in-raid loot goes straight to the stash, so your kit comes back the way you packed it.
  const toStash: ItemInstance[] = [];
  if (result.status === 'extracted' && result.loot?.length) {
    const loot = new Set(result.loot);
    for (const g of carryGrids(profile.equipment))
      for (const p of [...g.items]) {
        if (!loot.has(p.item.uid)) continue;
        removeItem(g, p.item.uid);
        // Carried out alive: it counts as found in raid (task hand-ins need that).
        p.item.fir = true;
        if (addItem(profile.stash, p.item)) toStash.push(p.item);
        else g.items.push(p); // stash full: keep it where it was
      }
  }
  const taskNotes = applyRaidToTasks(profile, result, levelFromXp(profile.xp).level);
  profile.updatedAt = Date.now();
  return { xpGained: result.xp, levelBefore, levelAfter: levelFromXp(profile.xp).level, moneyFromItems, toStash, taskNotes };
}

/** True when the player has no weapon at all anywhere — they get a free survivor kit (every 10 min) to avoid a soft-lock. */
export function canClaimFreeKit(profile: Profile, now = Date.now()): boolean {
  const hasWeapon =
    SLOTS.some((s) => s !== 'melee' && profile.equipment.slots[s] && getDef(profile.equipment.slots[s]!.def).weapon) ||
    profile.stash.items.some((p) => getDef(p.item.def).weapon);
  return !hasWeapon && profile.money < 20000 && now - profile.lastFreeKit > 10 * 60 * 1000;
}

export function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
