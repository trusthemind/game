import { Rng } from './core/rng';
import { getDef } from './items/defs';
import { addItem, createItem, equipmentValue, itemValue, type Equipment } from './items/inventory';
import { dressOutfit, generateLoadout, OUTFITS } from './items/loadouts';
import type { Profile } from './profile';

/**
 * Companions: the named survivors who come on raids with you. They level up from the raids they survive,
 * each brings one squad perk while alive at your side, and a fallen companion isn't gone for good — they're
 * carried back wounded and sit out one raid, or you pay the medic to have them back at once.
 */

export interface CompanionState {
  xp: number;
  /** Raids they still have to sit out after being brought back wounded (0 = fit to deploy). */
  wounded: number;
}

export type PerkId = 'medic' | 'spotter' | 'mule' | 'scout' | 'forager';

export interface Perk {
  id: PerkId;
  name: string;
  /** What it does at a given level (for the UI). */
  describe(level: number): string;
}

export const COMPANION_MAX_LEVEL = 10;
/** Total XP needed for each level (index = level − 1). */
const LEVEL_XP = [0, 250, 600, 1050, 1600, 2250, 3000, 3900, 4900, 6000];

/** Perk strength multiplier: 1 at level 1, +6 % per level after. */
export function perkPower(level: number): number {
  return 1 + (Math.max(1, Math.min(COMPANION_MAX_LEVEL, level)) - 1) * 0.06;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const PERKS: Record<PerkId, Perk> = {
  medic: {
    id: 'medic',
    name: 'Field medic',
    describe: (l) =>
      `Patches you up when you bleed or drop below half health (every ${Math.round(medicCooldown(l))} s). Your meds work ${pct(1 - medUseMul(l))} faster.`,
  },
  spotter: {
    id: 'spotter',
    name: 'Spotter',
    describe: (l) => `Marks hostiles within ${Math.round(spotRange(l))} m of them on your minimap, even out of your sight.`,
  },
  mule: { id: 'mule', name: 'Pack mule', describe: (l) => `You carry ${Math.round(muleKg(l))} kg more before you slow down.` },
  scout: { id: 'scout', name: 'Light feet', describe: (l) => `Your footsteps carry ${pct(1 - stepNoiseMul(l))} less far.` },
  forager: { id: 'forager', name: 'Forager', describe: (l) => `You search containers ${pct(1 - searchMul(l))} faster.` },
};

/** Which perk each recruitable survivor brings. */
export const COMPANION_PERK: Record<string, PerkId> = {
  lena: 'medic',
  taras: 'spotter',
  mykola: 'mule',
  yaryna: 'scout',
  ostap: 'forager',
};

// Perk numbers (all scale with perkPower).
export const medicCooldown = (level: number) => 45 / perkPower(level);
export const medicHeal = (level: number) => 14 * perkPower(level);
export const medUseMul = (level: number) => 1 / (1 + 0.25 * perkPower(level));
export const spotRange = (level: number) => 40 * perkPower(level);
export const muleKg = (level: number) => 10 * perkPower(level);
export const stepNoiseMul = (level: number) => Math.max(0.45, 1 - 0.3 * perkPower(level));
export const searchMul = (level: number) => 1 / (1 + 0.25 * perkPower(level));

export function companionLevel(xp: number): { level: number; into: number; next: number | null } {
  let level = 1;
  while (level < COMPANION_MAX_LEVEL && xp >= LEVEL_XP[level]!) level++;
  const base = LEVEL_XP[level - 1]!;
  const next = level < COMPANION_MAX_LEVEL ? LEVEL_XP[level]! - base : null;
  return { level, into: xp - base, next };
}

/** Combat stats by level: more health, steadier aim, quicker reactions. */
export function companionStats(level: number): { hp: number; skillAdd: number; reactMul: number } {
  const l = Math.max(1, Math.min(COMPANION_MAX_LEVEL, level)) - 1;
  return { hp: 110 + 9 * l, skillAdd: 0.03 * l, reactMul: 1 - 0.035 * l };
}

/** XP for one raid: something for coming back alive, more for extracting, and per kill. */
export function companionRaidXp(alive: boolean, extracted: boolean, kills: number): number {
  return (alive ? 80 : 0) + (alive && extracted ? 120 : 0) + kills * 45;
}

/** Symbolic medic's fee to have a wounded companion back right away. */
export const reviveCost = (level: number) => 1000 * level;

export function companionState(profile: Profile, npcId: string): CompanionState {
  return (profile.companions[npcId] ??= { xp: 0, wounded: 0 });
}

export function canDeploy(profile: Profile, npcId: string): boolean {
  return !profile.npcs[npcId]?.dead && companionState(profile, npcId).wounded <= 0;
}

/** Pay the fee and get a wounded companion back now. False when they're fit or you can't afford it. */
export function reviveCompanion(profile: Profile, npcId: string): boolean {
  const st = companionState(profile, npcId);
  if (st.wounded <= 0) return false;
  const cost = reviveCost(companionLevel(st.xp).level);
  if (profile.money < cost) return false;
  profile.money -= cost;
  st.wounded = 0;
  return true;
}

/** Gear tier a companion of this level should be carrying (0 = basic … 3 = top). */
export function gearTierFor(level: number): number {
  return Math.min(3, Math.floor((level - 1) / 3));
}

/**
 * Auto-progression: after a level-up a companion swaps to better kit of their tier if it's worth more
 * than what they carry now (their own stash, not yours). Keeps the signature gun until something better.
 */
export function upgradeCompanionGear(profile: Profile, npcId: string, level: number, seed: string): boolean {
  const current = profile.companionEq[npcId];
  const fresh = generateLoadout('raider', new Rng(`${seed}:${npcId}:lvl${level}`), gearTierFor(level));
  fresh.slots.backpack = null;
  if (OUTFITS[npcId]) dressOutfit(fresh, OUTFITS[npcId]!);
  if (!current) {
    profile.companionEq[npcId] = fresh;
    return true;
  }
  let changed = false;
  for (const slot of ['armor', 'helmet', 'rig', 'primary', 'secondary'] as const) {
    const now = current.slots[slot];
    const next = fresh.slots[slot];
    if (!next || (now && itemValue(now) >= itemValue(next))) continue;
    if (slot === 'rig' && now?.grid) for (const p of [...now.grid.items]) if (next.grid) addItem(next.grid, p.item);
    current.slots[slot] = next;
    changed = true;
    if (slot === 'primary' || slot === 'secondary') {
      // Spare rounds for the new gun.
      const ammo = next.ammoType;
      if (ammo) {
        const rounds = createItem(ammo, { stack: (getDef(next.def).weapon?.magSize ?? 30) * 2 });
        if (!(current.slots.rig?.grid && addItem(current.slots.rig.grid, rounds))) addItem(current.pockets, rounds);
      }
    }
  }
  return changed;
}

/** What the companion carries is worth (for the UI). */
export const companionGearValue = (eq: Equipment | undefined) => (eq ? equipmentValue(eq) : 0);
