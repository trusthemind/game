import type { MedEffect } from '../sim/health';

export type Category =
  | 'weapon'
  | 'melee'
  | 'ammo'
  | 'armor'
  | 'helmet'
  | 'rig'
  | 'backpack'
  | 'secure'
  | 'med'
  | 'food'
  | 'drink'
  | 'valuable'
  | 'junk'
  | 'money';

export type Caliber = '9x18' | '9x19' | '12g' | '5.45' | '5.56' | '7.62x39' | '7.62x54';

export interface WeaponStats {
  caliber: Caliber;
  damage: number;
  rpm: number;
  magSize: number;
  /** Base cone half-angle in radians. */
  spread: number;
  range: number;
  reloadTime: number;
  /** Hearing radius in tiles. */
  noise: number;
  auto: boolean;
  pellets?: number;
  recoil: number;
}

export interface MeleeStats {
  damage: number;
  /** Reach in tiles from the attacker's edge. */
  reach: number;
  /** Seconds between swings. */
  cooldown: number;
  /** Swing arc half-angle in radians. */
  arc: number;
  stamina: number;
  bleedChance: number;
  /** Fraction of damage that ignores armor (blunt weapons rattle you through plates). */
  armorBypass: number;
  noise: number;
}

export interface AmmoStats {
  caliber: Caliber;
  penetration: number;
  damageMul: number;
}

export interface ArmorStats {
  armorClass: number;
  durability: number;
  /** Movement multiplier penalty, e.g. 0.06 = 6% slower. */
  slow: number;
}

export interface ItemDef {
  id: string;
  name: string;
  short: string;
  category: Category;
  w: number;
  h: number;
  weight: number;
  value: number;
  /** 1 common … 5 legendary. Drives UI colour and loot weighting. */
  rarity: 1 | 2 | 3 | 4 | 5;
  stackMax?: number;
  weapon?: WeaponStats;
  melee?: MeleeStats;
  ammo?: AmmoStats;
  armor?: ArmorStats;
  grid?: { w: number; h: number };
  med?: MedEffect;
  food?: { energy: number; hydration: number; useTime: number };
}

const defs: ItemDef[] = [
  // ── Weapons ──────────────────────────────────────────────
  { id: 'pm', name: 'PM 9x18 pistol', short: 'PM', category: 'weapon', w: 2, h: 1, weight: 0.7, value: 9000, rarity: 1,
    weapon: { caliber: '9x18', damage: 28, rpm: 360, magSize: 8, spread: 0.06, range: 22, reloadTime: 1.6, noise: 22, auto: false, recoil: 0.04 } },
  { id: 'mp443', name: 'MP-443 9x19 pistol', short: 'MP-443', category: 'weapon', w: 2, h: 1, weight: 0.9, value: 21000, rarity: 2,
    weapon: { caliber: '9x19', damage: 34, rpm: 400, magSize: 18, spread: 0.05, range: 24, reloadTime: 1.7, noise: 24, auto: false, recoil: 0.045 } },
  { id: 'mp133', name: 'MP-133 12ga shotgun', short: 'MP-133', category: 'weapon', w: 4, h: 1, weight: 3.5, value: 18000, rarity: 1,
    weapon: { caliber: '12g', damage: 24, rpm: 70, magSize: 6, spread: 0.11, range: 16, reloadTime: 3.2, noise: 32, auto: false, pellets: 8, recoil: 0.14 } },
  { id: 'aks74u', name: 'AKS-74U carbine', short: 'AKS-74U', category: 'weapon', w: 3, h: 2, weight: 2.7, value: 34000, rarity: 2,
    weapon: { caliber: '5.45', damage: 40, rpm: 650, magSize: 30, spread: 0.045, range: 30, reloadTime: 2.3, noise: 30, auto: true, recoil: 0.05 } },
  { id: 'sks', name: 'SKS carbine', short: 'SKS', category: 'weapon', w: 4, h: 1, weight: 3.8, value: 29000, rarity: 2,
    weapon: { caliber: '7.62x39', damage: 54, rpm: 300, magSize: 10, spread: 0.018, range: 42, reloadTime: 2.8, noise: 34, auto: false, recoil: 0.06 } },
  { id: 'ak74m', name: 'AK-74M assault rifle', short: 'AK-74M', category: 'weapon', w: 4, h: 2, weight: 3.6, value: 62000, rarity: 3,
    weapon: { caliber: '5.45', damage: 42, rpm: 650, magSize: 30, spread: 0.028, range: 40, reloadTime: 2.4, noise: 34, auto: true, recoil: 0.04 } },
  { id: 'm4a1', name: 'M4A1 rifle', short: 'M4A1', category: 'weapon', w: 4, h: 2, weight: 3.2, value: 88000, rarity: 4,
    weapon: { caliber: '5.56', damage: 44, rpm: 800, magSize: 30, spread: 0.022, range: 44, reloadTime: 2.2, noise: 33, auto: true, recoil: 0.034 } },
  { id: 'akm', name: 'AKM assault rifle', short: 'AKM', category: 'weapon', w: 4, h: 2, weight: 3.8, value: 58000, rarity: 3,
    weapon: { caliber: '7.62x39', damage: 56, rpm: 600, magSize: 30, spread: 0.032, range: 40, reloadTime: 2.5, noise: 36, auto: true, recoil: 0.06 } },
  { id: 'svd', name: 'SVD marksman rifle', short: 'SVD', category: 'weapon', w: 5, h: 1, weight: 4.3, value: 115000, rarity: 4,
    weapon: { caliber: '7.62x54', damage: 86, rpm: 200, magSize: 10, spread: 0.008, range: 60, reloadTime: 3.0, noise: 42, auto: false, recoil: 0.09 } },
  { id: 'pkm', name: 'PKM machine gun', short: 'PKM', category: 'weapon', w: 5, h: 2, weight: 8.9, value: 190000, rarity: 5,
    weapon: { caliber: '7.62x54', damage: 78, rpm: 700, magSize: 100, spread: 0.04, range: 50, reloadTime: 5.5, noise: 44, auto: true, recoil: 0.05 } },

  // ── Melee ────────────────────────────────────────────────
  { id: 'knife', name: 'Kitchen knife', short: 'KNIFE', category: 'melee', w: 1, h: 2, weight: 0.2, value: 3000, rarity: 1,
    melee: { damage: 22, reach: 0.75, cooldown: 0.45, arc: 0.7, stamina: 6, bleedChance: 0.45, armorBypass: 0.1, noise: 3 } },
  { id: 'crowbar', name: 'Crowbar', short: 'CROWBAR', category: 'melee', w: 1, h: 3, weight: 1.6, value: 7000, rarity: 1,
    melee: { damage: 34, reach: 0.95, cooldown: 0.75, arc: 0.85, stamina: 12, bleedChance: 0.1, armorBypass: 0.45, noise: 5 } },
  { id: 'bat', name: 'Spiked baseball bat', short: 'BAT', category: 'melee', w: 1, h: 3, weight: 1.1, value: 9000, rarity: 2,
    melee: { damage: 38, reach: 1.05, cooldown: 0.7, arc: 1.0, stamina: 11, bleedChance: 0.25, armorBypass: 0.35, noise: 5 } },
  { id: 'machete', name: 'Machete', short: 'MACHETE', category: 'melee', w: 1, h: 3, weight: 0.9, value: 16000, rarity: 2,
    melee: { damage: 44, reach: 1.0, cooldown: 0.55, arc: 0.95, stamina: 9, bleedChance: 0.6, armorBypass: 0.15, noise: 4 } },
  { id: 'axe', name: 'Fire axe', short: 'AXE', category: 'melee', w: 1, h: 3, weight: 2.4, value: 24000, rarity: 3,
    melee: { damage: 62, reach: 1.05, cooldown: 0.95, arc: 0.8, stamina: 16, bleedChance: 0.5, armorBypass: 0.3, noise: 6 } },
  { id: 'sledge', name: 'Sledgehammer', short: 'SLEDGE', category: 'melee', w: 2, h: 3, weight: 5.5, value: 41000, rarity: 4,
    melee: { damage: 85, reach: 1.15, cooldown: 1.35, arc: 1.1, stamina: 26, bleedChance: 0.05, armorBypass: 0.7, noise: 8 } },
  { id: 'karambit', name: 'Combat karambit', short: 'KRMBT', category: 'melee', w: 1, h: 1, weight: 0.15, value: 58000, rarity: 4,
    melee: { damage: 30, reach: 0.7, cooldown: 0.32, arc: 0.75, stamina: 4, bleedChance: 0.75, armorBypass: 0.2, noise: 2 } },

  // ── Ammo ─────────────────────────────────────────────────
  { id: 'a_9x18', name: '9x18 PST gzh', short: '9x18', category: 'ammo', w: 1, h: 1, weight: 0.01, value: 60, rarity: 1, stackMax: 50, ammo: { caliber: '9x18', penetration: 12, damageMul: 1 } },
  { id: 'a_9x19', name: '9x19 Pst gzh', short: '9x19', category: 'ammo', w: 1, h: 1, weight: 0.01, value: 90, rarity: 1, stackMax: 50, ammo: { caliber: '9x19', penetration: 20, damageMul: 1 } },
  { id: 'a_9x19ap', name: '9x19 AP 6.3', short: '9mm AP', category: 'ammo', w: 1, h: 1, weight: 0.01, value: 320, rarity: 3, stackMax: 50, ammo: { caliber: '9x19', penetration: 30, damageMul: 0.9 } },
  { id: 'a_12buck', name: '12/70 buckshot', short: 'BUCK', category: 'ammo', w: 1, h: 1, weight: 0.05, value: 70, rarity: 1, stackMax: 20, ammo: { caliber: '12g', penetration: 3, damageMul: 1 } },
  { id: 'a_12slug', name: '12/70 AP-20 slug', short: 'AP-20', category: 'ammo', w: 1, h: 1, weight: 0.05, value: 600, rarity: 3, stackMax: 20, ammo: { caliber: '12g', penetration: 37, damageMul: 3.2 } },
  { id: 'a_545ps', name: '5.45 PS gs', short: 'PS', category: 'ammo', w: 1, h: 1, weight: 0.01, value: 140, rarity: 1, stackMax: 60, ammo: { caliber: '5.45', penetration: 28, damageMul: 1 } },
  { id: 'a_545bs', name: '5.45 BS gs', short: 'BS', category: 'ammo', w: 1, h: 1, weight: 0.01, value: 900, rarity: 4, stackMax: 60, ammo: { caliber: '5.45', penetration: 54, damageMul: 0.95 } },
  { id: 'a_556m855', name: '5.56 M855', short: 'M855', category: 'ammo', w: 1, h: 1, weight: 0.012, value: 260, rarity: 2, stackMax: 60, ammo: { caliber: '5.56', penetration: 31, damageMul: 1 } },
  { id: 'a_556m995', name: '5.56 M995', short: 'M995', category: 'ammo', w: 1, h: 1, weight: 0.012, value: 1100, rarity: 5, stackMax: 60, ammo: { caliber: '5.56', penetration: 53, damageMul: 0.95 } },
  { id: 'a_762ps', name: '7.62x39 PS', short: '762 PS', category: 'ammo', w: 1, h: 1, weight: 0.016, value: 180, rarity: 1, stackMax: 60, ammo: { caliber: '7.62x39', penetration: 35, damageMul: 1 } },
  { id: 'a_762bp', name: '7.62x39 BP', short: '762 BP', category: 'ammo', w: 1, h: 1, weight: 0.016, value: 750, rarity: 4, stackMax: 60, ammo: { caliber: '7.62x39', penetration: 47, damageMul: 1 } },
  { id: 'a_54r', name: '7.62x54R LPS', short: '54R', category: 'ammo', w: 1, h: 1, weight: 0.022, value: 420, rarity: 2, stackMax: 40, ammo: { caliber: '7.62x54', penetration: 42, damageMul: 1 } },
  { id: 'a_54r7n1', name: '7.62x54R 7N1', short: '7N1', category: 'ammo', w: 1, h: 1, weight: 0.022, value: 1200, rarity: 5, stackMax: 40, ammo: { caliber: '7.62x54', penetration: 52, damageMul: 1.05 } },

  // ── Armor & helmets ──────────────────────────────────────
  { id: 'paca', name: 'PACA soft armor', short: 'PACA', category: 'armor', w: 3, h: 3, weight: 3.5, value: 22000, rarity: 1, armor: { armorClass: 2, durability: 50, slow: 0.02 } },
  { id: '6b23', name: '6B23-1 body armor', short: '6B23', category: 'armor', w: 3, h: 3, weight: 7.5, value: 48000, rarity: 2, armor: { armorClass: 3, durability: 55, slow: 0.04 } },
  { id: 'trooper', name: 'Trooper plate carrier', short: 'TROOPER', category: 'armor', w: 3, h: 3, weight: 8.4, value: 96000, rarity: 3, armor: { armorClass: 4, durability: 60, slow: 0.05 } },
  { id: 'gzhel', name: 'Gzhel-K armor', short: 'GZHEL', category: 'armor', w: 3, h: 3, weight: 9.5, value: 170000, rarity: 4, armor: { armorClass: 5, durability: 65, slow: 0.06 } },
  { id: 'slick6', name: 'Slick-6 plate carrier', short: 'SLICK', category: 'armor', w: 3, h: 3, weight: 10.0, value: 310000, rarity: 5, armor: { armorClass: 6, durability: 80, slow: 0.07 } },
  { id: 'ssh68', name: 'SSh-68 steel helmet', short: 'SSh-68', category: 'helmet', w: 2, h: 2, weight: 1.5, value: 9000, rarity: 1, armor: { armorClass: 2, durability: 30, slow: 0.01 } },
  { id: 'zsh', name: 'ZSh-1-2M helmet', short: 'ZSh', category: 'helmet', w: 2, h: 2, weight: 3.2, value: 45000, rarity: 3, armor: { armorClass: 4, durability: 40, slow: 0.02 } },
  { id: 'altyn', name: 'Altyn assault helmet', short: 'ALTYN', category: 'helmet', w: 2, h: 2, weight: 4.0, value: 140000, rarity: 5, armor: { armorClass: 5, durability: 55, slow: 0.03 } },

  // ── Rigs & backpacks ─────────────────────────────────────
  { id: 'r_scav', name: 'Scav vest', short: 'VEST', category: 'rig', w: 2, h: 2, weight: 0.4, value: 6000, rarity: 1, grid: { w: 4, h: 1 } },
  { id: 'r_mbss', name: 'Belt-A chest rig', short: 'BELT-A', category: 'rig', w: 2, h: 2, weight: 0.6, value: 18000, rarity: 2, grid: { w: 4, h: 2 } },
  { id: 'r_alpha', name: 'Alpha tactical rig', short: 'ALPHA', category: 'rig', w: 3, h: 3, weight: 0.9, value: 46000, rarity: 3, grid: { w: 5, h: 2 } },
  { id: 'r_bank', name: 'Bankrobber rig', short: 'BANK', category: 'rig', w: 3, h: 3, weight: 1.1, value: 88000, rarity: 4, grid: { w: 6, h: 3 } },
  // Secure containers: whatever is inside survives death. Can't hold other containers.
  { id: 'sc_alpha', name: 'Secure container Alpha', short: 'ALPHA', category: 'secure', w: 2, h: 2, weight: 0.6, value: 45000, rarity: 3, grid: { w: 2, h: 2 } },
  { id: 'sc_beta', name: 'Secure container Beta', short: 'BETA', category: 'secure', w: 2, h: 3, weight: 0.8, value: 160000, rarity: 4, grid: { w: 3, h: 2 } },
  { id: 'sc_gamma', name: 'Secure container Gamma', short: 'GAMMA', category: 'secure', w: 3, h: 3, weight: 1.1, value: 520000, rarity: 5, grid: { w: 3, h: 3 } },
  { id: 'b_sling', name: 'Sling bag', short: 'SLING', category: 'backpack', w: 2, h: 2, weight: 0.5, value: 7000, rarity: 1, grid: { w: 3, h: 2 } },
  { id: 'b_daypack', name: 'Day pack', short: 'DAYPACK', category: 'backpack', w: 3, h: 3, weight: 1.0, value: 21000, rarity: 2, grid: { w: 4, h: 4 } },
  { id: 'b_pilgrim', name: 'Pilgrim tourist backpack', short: 'PILGRIM', category: 'backpack', w: 4, h: 4, weight: 2.0, value: 54000, rarity: 3, grid: { w: 5, h: 6 } },
  { id: 'b_attack', name: 'Attack-2 raid backpack', short: 'ATTACK-2', category: 'backpack', w: 4, h: 5, weight: 2.8, value: 120000, rarity: 4, grid: { w: 6, h: 6 } },

  // ── Meds ─────────────────────────────────────────────────
  { id: 'bandage', name: 'Army bandage', short: 'BNDG', category: 'med', w: 1, h: 1, weight: 0.05, value: 2500, rarity: 1,
    med: { resource: 0, stopsLight: true, stopsHeavy: false, fixesFracture: false, surgery: false, painkiller: 0, uses: 1, useTime: 3 } },
  { id: 'esmarch', name: 'Esmarch tourniquet', short: 'ESMARCH', category: 'med', w: 1, h: 1, weight: 0.08, value: 6500, rarity: 1,
    med: { resource: 0, stopsLight: false, stopsHeavy: true, fixesFracture: false, surgery: false, painkiller: 0, uses: 8, useTime: 4 } },
  { id: 'splint', name: 'Immobilizing splint', short: 'SPLINT', category: 'med', w: 1, h: 1, weight: 0.1, value: 5500, rarity: 1,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: true, surgery: false, painkiller: 0, uses: 1, useTime: 5 } },
  { id: 'ai2', name: 'AI-2 medkit', short: 'AI-2', category: 'med', w: 1, h: 1, weight: 0.1, value: 4500, rarity: 1,
    med: { resource: 100, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: false, painkiller: 0, uses: 1, useTime: 2 } },
  { id: 'salewa', name: 'Salewa first aid kit', short: 'SALEWA', category: 'med', w: 1, h: 2, weight: 0.6, value: 18000, rarity: 2,
    med: { resource: 400, stopsLight: true, stopsHeavy: true, fixesFracture: false, surgery: false, painkiller: 0, costLight: 45, costHeavy: 175, uses: 1, useTime: 3 } },
  { id: 'ifak', name: 'IFAK trauma kit', short: 'IFAK', category: 'med', w: 1, h: 1, weight: 0.4, value: 22000, rarity: 3,
    med: { resource: 300, stopsLight: true, stopsHeavy: true, fixesFracture: false, surgery: false, painkiller: 0, costLight: 30, costHeavy: 210, uses: 1, useTime: 3 } },
  { id: 'grizzly', name: 'Grizzly medical kit', short: 'GRIZZLY', category: 'med', w: 2, h: 2, weight: 1.6, value: 52000, rarity: 4,
    med: { resource: 1800, stopsLight: true, stopsHeavy: true, fixesFracture: true, surgery: false, painkiller: 0, costLight: 40, costHeavy: 130, costFracture: 50, uses: 1, useTime: 5 } },
  { id: 'cms', name: 'CMS surgical kit', short: 'CMS', category: 'med', w: 2, h: 1, weight: 0.4, value: 34000, rarity: 3,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: true, painkiller: 0, uses: 5, useTime: 14 } },
  { id: 'surv12', name: 'Surv12 field surgical kit', short: 'SURV12', category: 'med', w: 3, h: 1, weight: 1.0, value: 96000, rarity: 4,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: true, painkiller: 0, uses: 15, useTime: 9 } },
  { id: 'analgin', name: 'Analgin painkillers', short: 'ANLGN', category: 'med', w: 1, h: 1, weight: 0.05, value: 4200, rarity: 1,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: false, painkiller: 95, uses: 4, useTime: 3 } },
  { id: 'morphine', name: 'Morphine injector', short: 'MORPH', category: 'med', w: 1, h: 1, weight: 0.02, value: 21000, rarity: 3,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: false, painkiller: 305, uses: 1, useTime: 2 } },
  { id: 'stim', name: 'Propital regenerative stim', short: 'PROPITAL', category: 'med', w: 1, h: 1, weight: 0.05, value: 38000, rarity: 4,
    med: { resource: 0, stopsLight: false, stopsHeavy: false, fixesFracture: false, surgery: false, painkiller: 240, regen: 1, regenTime: 300, uses: 1, useTime: 1 } },

  // ── Food & drink ─────────────────────────────────────────
  { id: 'water', name: 'Bottle of water', short: 'WATER', category: 'drink', w: 1, h: 2, weight: 0.6, value: 3500, rarity: 1, food: { energy: 0, hydration: 45, useTime: 3 } },
  { id: 'juice', name: 'Apple juice', short: 'JUICE', category: 'drink', w: 1, h: 2, weight: 0.5, value: 4200, rarity: 1, food: { energy: 8, hydration: 35, useTime: 3 } },
  { id: 'tushonka', name: 'Can of beef stew', short: 'STEW', category: 'food', w: 1, h: 1, weight: 0.35, value: 5500, rarity: 1, food: { energy: 45, hydration: -8, useTime: 4 } },
  { id: 'crackers', name: 'Army crackers', short: 'CRKR', category: 'food', w: 1, h: 1, weight: 0.1, value: 2200, rarity: 1, food: { energy: 20, hydration: -4, useTime: 2 } },
  { id: 'mre', name: 'MRE ration', short: 'MRE', category: 'food', w: 1, h: 2, weight: 0.6, value: 14000, rarity: 2, food: { energy: 70, hydration: 10, useTime: 5 } },

  // ── Valuables & junk ─────────────────────────────────────
  { id: 'roubles', name: 'Credits', short: 'CR', category: 'money', w: 1, h: 1, weight: 0, value: 1, rarity: 1, stackMax: 500000 },
  { id: 'bolts', name: 'Pack of bolts', short: 'BOLTS', category: 'junk', w: 1, h: 1, weight: 0.3, value: 4500, rarity: 1 },
  { id: 'wires', name: 'Bundle of wires', short: 'WIRES', category: 'junk', w: 1, h: 1, weight: 0.2, value: 6200, rarity: 1 },
  { id: 'battery', name: 'Car battery', short: 'BATT', category: 'junk', w: 2, h: 2, weight: 12, value: 26000, rarity: 2 },
  { id: 'gpu', name: 'Graphics card', short: 'GPU', category: 'valuable', w: 2, h: 1, weight: 0.9, value: 240000, rarity: 5 },
  { id: 'cpu', name: 'Military CPU', short: 'CPU', category: 'valuable', w: 1, h: 1, weight: 0.1, value: 42000, rarity: 3 },
  { id: 'ledx', name: 'Skin transilluminator', short: 'LEDX', category: 'valuable', w: 1, h: 1, weight: 0.2, value: 380000, rarity: 5 },
  { id: 'chain', name: 'Golden chain', short: 'CHAIN', category: 'valuable', w: 1, h: 1, weight: 0.1, value: 24000, rarity: 2 },
  { id: 'rolex', name: 'Gold wristwatch', short: 'WATCH', category: 'valuable', w: 1, h: 1, weight: 0.1, value: 68000, rarity: 3 },
  { id: 'bitcoin', name: 'Physical bitcoin', short: '0.2BTC', category: 'valuable', w: 1, h: 1, weight: 0.02, value: 155000, rarity: 4 },
  { id: 'intel', name: 'Intelligence folder', short: 'INTEL', category: 'valuable', w: 2, h: 1, weight: 0.3, value: 120000, rarity: 4 },
  { id: 'flash', name: 'Secure flash drive', short: 'FLASH', category: 'valuable', w: 1, h: 1, weight: 0.02, value: 52000, rarity: 3 },
  { id: 'lion', name: 'Bronze lion statue', short: 'LION', category: 'valuable', w: 3, h: 2, weight: 9, value: 160000, rarity: 4 },
  { id: 'tank', name: 'Propane tank', short: 'PROP', category: 'junk', w: 2, h: 2, weight: 6, value: 14000, rarity: 1 },
  { id: 'tools', name: 'Toolset', short: 'TOOLS', category: 'junk', w: 2, h: 2, weight: 2.5, value: 19000, rarity: 2 },
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.freeze(Object.fromEntries(defs.map((d) => [d.id, d])));
export const ALL_ITEMS: readonly ItemDef[] = defs;

export function getDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item def: ${id}`);
  return d;
}

/** Bare hands, used when the melee slot is empty. Not a real item. */
export const FISTS: MeleeStats = { damage: 9, reach: 0.6, cooldown: 0.5, arc: 0.7, stamina: 5, bleedChance: 0, armorBypass: 0.5, noise: 2 };

/** Ammo defs that fit the given caliber, best penetration first. */
export function ammoForCaliber(caliber: Caliber): ItemDef[] {
  return defs.filter((d) => d.ammo?.caliber === caliber).sort((a, b) => b.ammo!.penetration - a.ammo!.penetration);
}

export const RARITY_COLORS = ['#3a3d3b', '#3a3d3b', '#2f4a32', '#27405c', '#4a2e5c', '#6b5420'] as const;
