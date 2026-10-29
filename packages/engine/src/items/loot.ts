import type { Rng } from '../core/rng';
import type { ContainerKind } from '../world/map';
import { getDef } from './defs';
import { addItem, createGrid, createItem, type GridContainer, type ItemInstance } from './inventory';

type Table = readonly (readonly [string, number])[];

interface ContainerSpec {
  label: string;
  grid: [number, number];
  rolls: [number, number];
  /** Seconds per item while searching. */
  searchTime: number;
  table: Table;
}

const MEDS: Table = [['bandage', 10], ['ai2', 8], ['salewa', 3], ['ifak', 2], ['grizzly', 0.6], ['stim', 0.5]];
const FOOD: Table = [['water', 8], ['juice', 6], ['tushonka', 7], ['crackers', 8], ['mre', 2]];
const JUNK: Table = [['bolts', 8], ['wires', 8], ['battery', 2], ['tank', 3], ['tools', 3]];
const SMALL_VAL: Table = [['chain', 6], ['rolex', 2], ['cpu', 2], ['flash', 2], ['bitcoin', 0.5], ['roubles', 8]];

export const CONTAINERS: Record<ContainerKind, ContainerSpec> = {
  wardrobe: { label: 'Wardrobe', grid: [4, 4], rolls: [0, 3], searchTime: 0.7,
    table: [['b_sling', 4], ['b_daypack', 2], ['r_scav', 4], ['bat', 1.2], ['knife', 1.5], ['paca', 1.5], ['ssh68', 2], ['roubles', 4], ['chain', 2], ['water', 1]] },
  fridge: { label: 'Fridge', grid: [3, 4], rolls: [1, 4], searchTime: 0.5, table: FOOD },

  drawer: { label: 'Drawer', grid: [4, 2], rolls: [0, 3], searchTime: 0.55,
    table: [...SMALL_VAL, ['bandage', 3], ['a_9x18', 4], ['a_12buck', 3], ['crackers', 2], ['bolts', 2]] },
  shelf: { label: 'Shelf', grid: [5, 3], rolls: [1, 4], searchTime: 0.6, table: [...FOOD, ...JUNK, ['ai2', 3]] },
  register: { label: 'Cash register', grid: [3, 2], rolls: [1, 3], searchTime: 0.5, table: [['roubles', 20], ['chain', 2], ['flash', 1]] },
  medcabinet: { label: 'Medical cabinet', grid: [4, 3], rolls: [1, 4], searchTime: 0.6, table: [...MEDS, ['ledx', 0.15], ['salewa', 3]] },
  crate: { label: 'Wooden crate', grid: [5, 4], rolls: [1, 4], searchTime: 0.75, table: [...JUNK, ...FOOD, ['a_545ps', 3], ['a_762ps', 3], ['b_daypack', 1]] },
  toolbox: { label: 'Toolbox', grid: [4, 3], rolls: [1, 3], searchTime: 0.6, table: [...JUNK, ['crowbar', 2], ['axe', 0.8], ['sledge', 0.4], ['cpu', 1], ['gpu', 0.12]] },
  weaponbox: { label: 'Weapon box', grid: [5, 4], rolls: [1, 2], searchTime: 1.1,
    table: [['pm', 4], ['mp443', 3], ['mp133', 4], ['aks74u', 3], ['sks', 3], ['akm', 1.5], ['ak74m', 1.3], ['m4a1', 0.6], ['svd', 0.35], ['pkm', 0.1], ['machete', 1.5], ['karambit', 0.3]] },
  ammocrate: { label: 'Ammo crate', grid: [5, 3], rolls: [2, 4], searchTime: 0.8,
    table: [['a_9x18', 4], ['a_9x19', 4], ['a_12buck', 4], ['a_545ps', 5], ['a_762ps', 4], ['a_556m855', 3], ['a_54r', 2],
      ['a_9x19ap', 1], ['a_12slug', 1], ['a_545bs', 0.6], ['a_762bp', 0.6], ['a_556m995', 0.25], ['a_54r7n1', 0.25]] },
  safe: { label: 'Safe', grid: [3, 3], rolls: [1, 3], searchTime: 1.4,
    table: [['roubles', 10], ['rolex', 4], ['bitcoin', 2], ['intel', 2], ['flash', 3], ['gpu', 0.6], ['ledx', 0.4], ['lion', 0.4]] },
  jacket: { label: 'Jacket', grid: [2, 2], rolls: [0, 2], searchTime: 0.45, table: [...SMALL_VAL, ['a_9x18', 3], ['bandage', 2], ['crackers', 2]] },
  carTrunk: { label: 'Car trunk', grid: [5, 3], rolls: [0, 3], searchTime: 0.7, table: [...JUNK, ['battery', 4], ['water', 2], ['a_12buck', 2], ['salewa', 0.7]] },
  ground: { label: 'Ground', grid: [6, 6], rolls: [0, 0], searchTime: 0, table: [['bolts', 1]] },
  stash: { label: 'Hidden stash', grid: [4, 4], rolls: [2, 4], searchTime: 0.9,
    table: [...MEDS, ...SMALL_VAL, ['a_545ps', 3], ['a_762ps', 3], ['akm', 0.5], ['b_daypack', 1], ['mre', 2]] },
};

/** Stack size for a freshly rolled stackable item. */
function rollStack(defId: string, rng: Rng, tier: number): number {
  const d = getDef(defId);
  if (!d.stackMax) return 1;
  if (d.category === 'money') return Math.round(rng.range(2000, 18000) * (1 + tier * 0.5));
  if (d.category === 'ammo') return Math.min(d.stackMax, rng.int(8, d.stackMax));
  return 1;
}

/**
 * Higher tiers (deeper into dangerous zones) flatten the weights toward rare items:
 * weight × (1 + tier·0.35)^(rarity-1).
 */
export function tieredTable(table: Table, tier: number): Table {
  const boost = 1 + tier * 0.35;
  return table.map(([id, w]) => [id, w * Math.pow(boost, getDef(id).rarity - 1)] as const);
}

export function rollItem(defId: string, rng: Rng, tier = 0): ItemInstance {
  const d = getDef(defId);
  const item = createItem(defId, { stack: rollStack(defId, rng, tier), fir: true });
  if (d.armor) item.dur = Math.round(d.armor.durability * rng.range(0.45, 1));
  return item;
}

export function generateLoot(kind: ContainerKind, rng: Rng, tier = 0): GridContainer {
  const spec = CONTAINERS[kind];
  const grid = createGrid(spec.grid[0], spec.grid[1]);
  const table = tieredTable(spec.table, tier);
  const n = rng.int(spec.rolls[0], spec.rolls[1] + (tier >= 2 ? 1 : 0));
  for (let i = 0; i < n; i++) addItem(grid, rollItem(rng.weighted(table), rng, tier));
  return grid;
}
