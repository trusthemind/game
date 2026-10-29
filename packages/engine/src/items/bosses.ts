import type { Rng } from '../core/rng';
import type { MapId } from '../world/mapGen';
import type { District } from '../world/map';
import { addItem, createEquipment, createItem, type Equipment } from './inventory';
import { effectiveWeapon, installMod } from './mods';

/**
 * Named bosses, one per location (Tarkov-style). Each has a home district, a small escort, a chance to
 * be on the map, a signature loadout and an exclusive trophy item. Tougher than a regular operator — but
 * only somewhat (1.6× health), not a bullet sponge.
 */
export interface BossDef {
  id: string;
  name: string;
  map: MapId;
  district: District;
  /** Building kind to camp in, if any (otherwise roams the district). */
  building?: 'military' | 'warehouse' | 'cabin';
  guards: number;
  chance: number;
  sex: 'm' | 'f';
  /** Health relative to a regular human. */
  hp: number;
  loadout(rng: Rng): Equipment;
}

function gun(id: string, mods: string[], ammoType: string) {
  const g = createItem(id, { ammoType });
  for (const m of mods) installMod(g, createItem(m));
  g.ammo = effectiveWeapon(g).magSize;
  return g;
}

function fill(eq: Equipment, items: [string, number][]) {
  for (const [id, stack] of items) {
    const it = createItem(id, { stack, fir: true });
    for (const g of [eq.slots.rig?.grid, eq.slots.backpack?.grid, eq.pockets]) if (g && addItem(g, it)) break;
  }
}

export const BOSSES: BossDef[] = [
  {
    id: 'kostia',
    name: 'Warlord Kostia',
    map: 'outskirts',
    district: 'military',
    building: 'military',
    guards: 3,
    chance: 0.85,
    sex: 'm',
    hp: 160,
    loadout(rng) {
      const eq = createEquipment();
      eq.slots.primary = rng.chance(0.5) ? gun('pkm', ['scope_4x'], 'a_54r7n1') : gun('hk416', ['sup_556', 'holo', 'fgrip', 'mag_stanag60'], 'a_556m995');
      eq.slots.secondary = gun('glock17', ['mag_9_33', 'tac_light'], 'a_9x19ap');
      eq.slots.melee = createItem('sledge');
      eq.slots.armor = createItem('slick6');
      eq.slots.helmet = createItem('altyn');
      eq.slots.rig = createItem('r_bank');
      eq.slots.backpack = createItem('b_attack');
      fill(eq, [['kostia_ring', 1], ['grizzly', 1], ['stim', 1], ['surv12', 1], ['bitcoin', 1], ['a_54r7n1', 40], ['a_556m995', 60], ['intel', 1]]);
      if (rng.chance(0.25)) fill(eq, [[rng.chance(0.2) ? 'sc_gamma' : 'sc_beta', 1]]);
      return eq;
    },
  },
  {
    id: 'bohdan',
    name: 'Hunter Bohdan',
    map: 'pinehollow',
    district: 'forest',
    building: 'cabin',
    guards: 0,
    chance: 0.7,
    sex: 'm',
    hp: 150,
    loadout(rng) {
      const eq = createEquipment();
      eq.slots.primary = gun(rng.chance(0.6) ? 'sv98' : 'mosin', ['scope_8x', 'sup_54r'], 'a_54r7n1');
      eq.slots.secondary = gun('rhino', [], 'a_9x19ap');
      eq.slots.melee = createItem('machete');
      eq.slots.armor = createItem('gzhel');
      eq.slots.rig = createItem('r_alpha');
      eq.slots.backpack = createItem('b_pilgrim');
      fill(eq, [['bohdan_claw', 1], ['ifak', 1], ['morphine', 1], ['a_54r7n1', 30], ['tushonka', 2], ['ledx', 1]]);
      if (rng.chance(0.2)) fill(eq, [['sc_beta', 1]]);
      return eq;
    },
  },
  {
    id: 'rina',
    name: 'Smuggler Rina',
    map: 'portkirov',
    district: 'docks',
    building: 'warehouse',
    guards: 2,
    chance: 0.8,
    sex: 'f',
    hp: 150,
    loadout(rng) {
      const eq = createEquipment();
      eq.slots.primary = gun('vector', ['sup_9', 'holo', 'mag_9_33', 'tac_light'], 'a_9x19ap');
      eq.slots.secondary = gun('glock17', ['sup_9', 'red_dot'], 'a_9x19ap');
      eq.slots.melee = createItem('karambit');
      eq.slots.armor = createItem('trooper');
      eq.slots.rig = createItem('r_alpha');
      eq.slots.backpack = createItem('b_daypack');
      fill(eq, [['rina_ledger', 1], ['gpu', 1], ['flash', 2], ['salewa', 1], ['a_9x19ap', 50], ['roubles', 40000]]);
      if (rng.chance(0.25)) fill(eq, [['sc_beta', 1]]);
      return eq;
    },
  },
];

export const bossById = (id: string) => BOSSES.find((b) => b.id === id) ?? null;
