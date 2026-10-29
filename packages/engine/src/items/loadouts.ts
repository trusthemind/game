import type { Rng } from '../core/rng';
import type { BotArchetype } from '../world/map';
import { ammoForCaliber, getDef } from './defs';
import { addItem, createEquipment, createItem, type Equipment } from './inventory';
import { rollItem, tieredTable } from './loot';

type Table = readonly (readonly [string | null, number])[];

interface ArchetypeKit {
  primary: Table;
  secondary: Table;
  melee: Table;
  armor: Table;
  helmet: Table;
  rig: Table;
  backpack: Table;
  /** Index into ammoForCaliber (0 = best). Larger = worse ammo. */
  ammoQuality: [number, number];
  mags: [number, number];
  meds: Table;
  medCount: [number, number];
  extras: Table;
  extraCount: [number, number];
}

const KITS: Record<BotArchetype, ArchetypeKit> = {
  scav: {
    primary: [[null, 3], ['mp133', 4], ['aks74u', 3], ['sks', 3], ['akm', 0.8]],
    secondary: [[null, 6], ['pm', 3], ['mp443', 0.7]],
    melee: [[null, 3], ['knife', 3], ['crowbar', 2], ['bat', 1.5], ['axe', 0.5]],
    armor: [[null, 5], ['paca', 3], ['6b23', 1.2]],
    helmet: [[null, 6], ['ssh68', 3], ['zsh', 0.4]],
    rig: [['r_scav', 5], ['r_mbss', 2]],
    backpack: [[null, 4], ['b_sling', 4], ['b_daypack', 2]],
    ammoQuality: [1, 3], mags: [1, 3],
    meds: [['bandage', 5], ['ai2', 4], ['analgin', 2], ['splint', 1]], medCount: [0, 2],
    extras: [['crackers', 4], ['water', 3], ['bolts', 3], ['wires', 3], ['roubles', 5], ['chain', 1.5], ['rolex', 0.3]], extraCount: [0, 3],
  },
  raider: {
    primary: [['ak74m', 4], ['m4a1', 3], ['akm', 3], ['svd', 0.8]],
    secondary: [[null, 2], ['mp443', 3]],
    melee: [['knife', 2], ['machete', 2], ['karambit', 0.4]],
    armor: [['trooper', 4], ['gzhel', 2.5], ['6b23', 2]],
    helmet: [['zsh', 5], [null, 1], ['altyn', 0.4]],
    rig: [['r_alpha', 4], ['r_bank', 2]],
    backpack: [['b_daypack', 3], ['b_pilgrim', 3], ['b_attack', 1]],
    ammoQuality: [0, 1], mags: [3, 5],
    meds: [['ifak', 4], ['salewa', 3], ['bandage', 3], ['esmarch', 3], ['splint', 2], ['morphine', 1], ['grizzly', 0.6], ['cms', 0.6], ['stim', 0.4]], medCount: [2, 4],
    extras: [['mre', 2], ['water', 2], ['roubles', 4], ['flash', 2], ['cpu', 1.5], ['intel', 0.8], ['bitcoin', 0.5]], extraCount: [1, 3],
  },
  guard: {
    primary: [['akm', 3], ['ak74m', 3], ['m4a1', 2], ['pkm', 0.4]],
    secondary: [['mp443', 1]],
    melee: [['machete', 1], ['axe', 1]],
    armor: [['gzhel', 4], ['trooper', 3]],
    helmet: [['zsh', 4], ['altyn', 1]],
    rig: [['r_bank', 1]],
    backpack: [[null, 3], ['b_pilgrim', 1]],
    ammoQuality: [0, 1], mags: [3, 5],
    meds: [['ifak', 3], ['salewa', 3], ['esmarch', 2], ['splint', 1]], medCount: [1, 3],
    extras: [['roubles', 3], ['rolex', 1], ['bitcoin', 0.6]], extraCount: [0, 2],
  },
  boss: {
    primary: [['pkm', 2], ['m4a1', 2]],
    secondary: [['mp443', 1]],
    melee: [['sledge', 1]],
    armor: [['slick6', 1]],
    helmet: [['altyn', 1]],
    rig: [['r_bank', 1]],
    backpack: [['b_attack', 1]],
    ammoQuality: [0, 0], mags: [3, 4],
    meds: [['grizzly', 2], ['stim', 2], ['ifak', 2], ['surv12', 1]], medCount: [3, 4],
    extras: [['ledx', 1], ['gpu', 1.5], ['bitcoin', 2], ['intel', 2], ['lion', 0.7]], extraCount: [2, 3],
  },
  infected: {
    primary: [[null, 1]],
    secondary: [[null, 1]],
    melee: [[null, 1]],
    armor: [[null, 1]],
    helmet: [[null, 8], ['ssh68', 1]],
    rig: [[null, 1]],
    backpack: [[null, 1]],
    ammoQuality: [0, 0], mags: [0, 0],
    meds: [['bandage', 1]], medCount: [0, 0],
    extras: [['chain', 2], ['crackers', 2], ['roubles', 3], ['rolex', 0.3], ['wires', 2]], extraCount: [0, 2],
  },
};

function pickDef(rng: Rng, table: Table): string | null {
  return rng.weighted(table);
}

function loadWeapon(rng: Rng, eq: Equipment, slot: 'primary' | 'secondary', kit: ArchetypeKit): void {
  const id = pickDef(rng, slot === 'primary' ? kit.primary : kit.secondary);
  if (!id) return;
  const w = getDef(id).weapon!;
  const ammoDefs = ammoForCaliber(w.caliber);
  const q = Math.min(ammoDefs.length - 1, rng.int(kit.ammoQuality[0], kit.ammoQuality[1]));
  const ammoDef = ammoDefs[q]!;
  eq.slots[slot] = createItem(id, { ammo: w.magSize, ammoType: ammoDef.id });
  // Spare ammo, roughly `mags` magazines worth, spread into stacks.
  let spare = slot === 'primary' ? w.magSize * rng.int(kit.mags[0], kit.mags[1]) : w.magSize * rng.int(0, 2);
  const stackMax = ammoDef.stackMax ?? 60;
  while (spare > 0) {
    const n = Math.min(stackMax, spare);
    spare -= n;
    putAnywhere(eq, createItem(ammoDef.id, { stack: n }));
  }
}

function putAnywhere(eq: Equipment, item: ReturnType<typeof createItem>): boolean {
  if (eq.slots.rig?.grid && addItem(eq.slots.rig.grid, item)) return true;
  if (addItem(eq.pockets, item)) return true;
  if (eq.slots.backpack?.grid && addItem(eq.slots.backpack.grid, item)) return true;
  return false;
}

/**
 * Generate a bot's gear. Better archetypes get better armour & ammo — killing a raider is risky but is
 * the fastest way for the player to gear up.
 */
export function generateLoadout(archetype: BotArchetype, rng: Rng, tier = 0): Equipment {
  const kit = KITS[archetype];
  const eq = createEquipment();
  for (const slot of ['armor', 'helmet', 'rig', 'backpack'] as const) {
    const table = slot === 'rig' || slot === 'backpack' ? kit[slot] : (tieredTable(kit[slot].filter(([id]) => id) as [string, number][], tier) as Table).concat(kit[slot].filter(([id]) => !id));
    const id = pickDef(rng, table);
    if (id) eq.slots[slot] = rollItem(id, rng, tier);
  }
  loadWeapon(rng, eq, 'primary', kit);
  loadWeapon(rng, eq, 'secondary', kit);
  const melee = pickDef(rng, kit.melee);
  if (melee) eq.slots.melee = createItem(melee, { fir: true });
  // Scav with no gun at all gets a pistol: unarmed scavs are no fun.
  if (archetype === 'scav' && !eq.slots.primary && !eq.slots.secondary) loadWeapon(rng, eq, 'secondary', { ...kit, secondary: [['pm', 1]] });

  const meds = rng.int(kit.medCount[0], kit.medCount[1]);
  for (let i = 0; i < meds; i++) putAnywhere(eq, rollItem(pickDef(rng, kit.meds)!, rng, tier));
  const extras = rng.int(kit.extraCount[0], kit.extraCount[1]);
  for (let i = 0; i < extras; i++) putAnywhere(eq, rollItem(pickDef(rng, kit.extras)!, rng, tier));
  return eq;
}

/** Starter kit for a fresh profile and for the free "survivor kit" when broke. */
export function starterKit(): Equipment {
  const eq = createEquipment();
  eq.slots.secondary = createItem('pm', { ammo: 8, ammoType: 'a_9x18' });
  eq.slots.melee = createItem('knife');
  eq.slots.rig = createItem('r_scav');
  eq.slots.secure = createItem('sc_alpha');
  addItem(eq.slots.rig.grid!, createItem('a_9x18', { stack: 40 }));
  addItem(eq.pockets, createItem('bandage'));
  addItem(eq.pockets, createItem('ai2'));
  addItem(eq.pockets, createItem('esmarch'));
  addItem(eq.pockets, createItem('water'));
  addItem(eq.slots.rig.grid!, createItem('splint'));
  addItem(eq.slots.rig.grid!, createItem('analgin'));
  return eq;
}
