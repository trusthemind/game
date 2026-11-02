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
  | 'mod'
  | 'med'
  | 'food'
  | 'drink'
  | 'valuable'
  | 'junk'
  | 'money';

export type Caliber = '9x18' | '9x19' | '12g' | '5.45' | '5.56' | '7.62x39' | '7.62x54';

export type WeaponClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'marksman' | 'lmg';
/** What kind of part an attachment is. The first six are the attachment slots every older gun has. */
export type ModSlot = 'muzzle' | 'scope' | 'grip' | 'mag' | 'stock' | 'light' | 'pgrip' | 'dustcover' | 'gastube' | 'handguard' | 'barrel' | 'slide' | 'cylinder';
export const MOD_SLOTS: readonly ModSlot[] = ['muzzle', 'scope', 'grip', 'stock', 'mag', 'light'];

/**
 * How a part physically attaches. A socket accepts parts by mount, never by weapon id, so a Picatinny sight
 * goes on any rail and an AK-74 muzzle device on any 24x1.5 thread.
 */
export type Mount =
  | 'picatinny'
  | 'ak_pgrip'
  | 'ak_dustcover'
  | 'ak_gastube'
  | 'ak_handguard'
  | 'ak_stock'
  | 'ak_dovetail'
  | 'ak545_muzzle'
  | 'ak762_muzzle'
  | 'ak545_mag'
  | 'ak762_mag'
  | 'aks74u_handguard'
  | 'aks74u_muzzle'
  | 'ar_barrel'
  | 'ar_handguard'
  | 'ar_buffer'
  | 'ar_pgrip'
  | 'ar_muzzle'
  | 'stanag'
  | 'pm_slide'
  | 'pm_mag'
  | 'mp443_slide'
  | 'mp443_mag'
  | 'glock_slide'
  | 'glock_mag'
  | 'pistol_optic'
  | 'pistol9_muzzle'
  | 'rhino_cylinder'
  | 'pp19_stock'
  | 'pp19_handguard'
  | 'pp19_mag'
  | 'mp5_stock'
  | 'mp5_handguard'
  | 'mp5_mag'
  | 'vector_stock'
  | 'vector_mag'
  | 'rpk16_handguard'
  | 'scope_rings'
  | 'rifle762_muzzle'
  | 'rifle54_muzzle'
  | 'sks_mag'
  | 'vepr_stock'
  | 'vepr_mag'
  | 'svd_stock'
  | 'svd_handguard'
  | 'svd_mag'
  | 'sv98_mag'
  | 'pkm_stock'
  | 'pkm_box'
  | 'aug_mag';

/** A place on a weapon or part where another part goes. */
export interface Socket {
  id: string;
  label: string;
  accepts: Mount[];
  /** Only parts of these kinds (a top rail takes sights, a bottom rail foregrips). */
  kinds?: ModSlot[];
  /** The gun doesn't fire with this socket empty (barrel, gas tube, magazine…). */
  required?: boolean;
}

/** Factory parts per socket: a part id, or a part id with its own factory parts. */
export type Preset = Record<string, string | [string, Preset]>;

/** Attachment stats. Multipliers apply to the weapon's base stats; `magSize` replaces it. */
export interface ModStats {
  slot: ModSlot;
  /** Sockets this part fits (weapons built from parts). Older guns go by calibers / classes / ids below. */
  mounts?: Mount[];
  /** Sockets on the part itself (a handguard's rails, a barrel's muzzle thread). */
  sockets?: Socket[];
  preset?: Preset;
  /** Fits weapons with one of these calibers (optionally only these classes), or these exact weapon ids. */
  calibers?: Caliber[];
  classes?: WeaponClass[];
  ids?: string[];
  spreadMul?: number;
  /** Extra accuracy only while aiming down sights (scopes). */
  aimSpreadMul?: number;
  recoilMul?: number;
  noiseMul?: number;
  rangeMul?: number;
  reloadMul?: number;
  magSize?: number;
  suppressed?: boolean;
  /** Camera pulls back by this factor while aiming (scopes). */
  zoom?: number;
  light?: boolean;
  /** Movement speed multiplier while holding the weapon (heavy optics, drums). */
  ergo?: number;
}

export interface WeaponStats {
  cls: WeaponClass;
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
  /** Built from parts: the receiver's sockets and the parts it leaves the factory with. */
  sockets?: Socket[];
  preset?: Preset;
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
  mod?: ModStats;
  med?: MedEffect;
  food?: { energy: number; hydration: number; useTime: number };
}

// ── Guns built from parts ──────────────────────────────────
// The receiver's sockets and its factory parts. Factory parts are neutral, so a stock gun shoots exactly like
// its stats above; aftermarket parts move the numbers. The def's weight and value are the complete gun's.

const AK_RECEIVER: Socket[] = [
  { id: 'pgrip', label: 'Pistol grip', accepts: ['ak_pgrip'], required: true },
  { id: 'dustcover', label: 'Dust cover', accepts: ['ak_dustcover'], required: true },
  { id: 'gastube', label: 'Gas tube', accepts: ['ak_gastube'], required: true },
  { id: 'handguard', label: 'Handguard', accepts: ['ak_handguard'], required: true },
  { id: 'stock', label: 'Stock', accepts: ['ak_stock'] },
  { id: 'side', label: 'Side mount', accepts: ['ak_dovetail'], kinds: ['scope'] },
];
const AK74M = {
  sockets: [
    ...AK_RECEIVER,
    { id: 'muzzle', label: 'Muzzle', accepts: ['ak545_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['ak545_mag'], required: true },
  ] as Socket[],
  preset: { pgrip: 'ak_pg_74', dustcover: 'ak_dc', gastube: 'ak_gt_74', handguard: 'ak_hg_74', stock: 'ak_st_74m', muzzle: 'ak_mz_74', mag: 'mag_ak545_30' } as Preset,
};
const AKM = {
  sockets: [
    ...AK_RECEIVER,
    { id: 'muzzle', label: 'Muzzle', accepts: ['ak762_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['ak762_mag'], required: true },
  ] as Socket[],
  preset: { pgrip: 'ak_pg_akm', dustcover: 'ak_dc', gastube: 'ak_gt_akm', handguard: 'ak_hg_akm', stock: 'ak_st_akm', muzzle: 'ak_mz_akm', mag: 'mag_akm30' } as Preset,
};
const AKS74U = {
  sockets: [
    { id: 'pgrip', label: 'Pistol grip', accepts: ['ak_pgrip'], required: true },
    { id: 'handguard', label: 'Handguard', accepts: ['aks74u_handguard'], required: true },
    { id: 'muzzle', label: 'Muzzle', accepts: ['aks74u_muzzle'] },
    { id: 'side', label: 'Side mount', accepts: ['ak_dovetail'], kinds: ['scope'] },
    { id: 'mag', label: 'Magazine', accepts: ['ak545_mag'], required: true },
  ] as Socket[],
  preset: { pgrip: 'ak_pg_74', handguard: 'aks74u_hg', muzzle: 'aks74u_mz', mag: 'mag_ak545_30' } as Preset,
};
const M4A1 = {
  sockets: [
    { id: 'barrel', label: 'Barrel', accepts: ['ar_barrel'], required: true },
    { id: 'handguard', label: 'Handguard', accepts: ['ar_handguard'], required: true },
    { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
    { id: 'pgrip', label: 'Pistol grip', accepts: ['ar_pgrip'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['ar_buffer'] },
    { id: 'mag', label: 'Magazine', accepts: ['stanag'], required: true },
  ] as Socket[],
  preset: { barrel: ['ar_barrel_145', { muzzle: 'ar_fh_a2' }], handguard: 'ar_hg_m4', pgrip: 'ar_pg_a2', stock: 'ar_st_m4', mag: 'mag_stanag30' } as Preset,
};
// Pistols: the frame is the gun; the slide (a revolver's cylinder) and the magazine are parts.
const PISTOL_RAIL: Socket = { id: 'tactical', label: 'Rail', accepts: ['picatinny'], kinds: ['light'] };
const PM = {
  sockets: [
    { id: 'slide', label: 'Slide', accepts: ['pm_slide'], required: true },
    { id: 'mag', label: 'Magazine', accepts: ['pm_mag'], required: true },
  ] as Socket[],
  preset: { slide: 'pm_slide', mag: 'pm_mag8' } as Preset,
};
const MP443 = {
  sockets: [
    { id: 'slide', label: 'Slide', accepts: ['mp443_slide'], required: true },
    PISTOL_RAIL,
    { id: 'mag', label: 'Magazine', accepts: ['mp443_mag'], required: true },
  ] as Socket[],
  preset: { slide: 'mp443_slide', mag: 'mp443_mag18' } as Preset,
};
const GLOCK17 = {
  sockets: [
    { id: 'slide', label: 'Slide', accepts: ['glock_slide'], required: true },
    { id: 'muzzle', label: 'Muzzle', accepts: ['pistol9_muzzle'] },
    PISTOL_RAIL,
    { id: 'mag', label: 'Magazine', accepts: ['glock_mag'], required: true },
  ] as Socket[],
  preset: { slide: 'glock_slide', mag: 'glock_mag17' } as Preset,
};
const RHINO = {
  sockets: [{ id: 'cylinder', label: 'Cylinder', accepts: ['rhino_cylinder'], required: true }] as Socket[],
  preset: { cylinder: 'rhino_cyl' } as Preset,
};
// Submachine guns: each its own stock, handguard and magazine (the parts are drawn in its own model's frame, so a
// part from another platform can't take their place); sights, lights, grips and the 9 mm suppressor bolt on.
const SMG_TOP: Socket = { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] };
const SMG_MUZZLE: Socket = { id: 'muzzle', label: 'Muzzle', accepts: ['pistol9_muzzle'] };
const PP19 = {
  sockets: [
    SMG_TOP,
    { id: 'handguard', label: 'Handguard', accepts: ['pp19_handguard'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['pp19_stock'] },
    SMG_MUZZLE,
    { id: 'mag', label: 'Magazine', accepts: ['pp19_mag'], required: true },
  ] as Socket[],
  preset: { handguard: 'pp19_hg', stock: 'pp19_st', mag: 'pp19_mag30' } as Preset,
};
const MP5 = {
  sockets: [
    SMG_TOP,
    { id: 'handguard', label: 'Handguard', accepts: ['mp5_handguard'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['mp5_stock'] },
    SMG_MUZZLE,
    { id: 'mag', label: 'Magazine', accepts: ['mp5_mag'], required: true },
  ] as Socket[],
  preset: { handguard: 'mp5_hg', stock: 'mp5_st', mag: 'mp5_mag30' } as Preset,
};
const VECTOR = {
  sockets: [
    SMG_TOP,
    { id: 'foregrip', label: 'Bottom rail', accepts: ['picatinny'], kinds: ['grip'] },
    { id: 'tactical', label: 'Side rail', accepts: ['picatinny'], kinds: ['light'] },
    { id: 'stock', label: 'Stock', accepts: ['vector_stock'] },
    SMG_MUZZLE,
    { id: 'mag', label: 'Magazine', accepts: ['vector_mag'], required: true },
  ] as Socket[],
  preset: { stock: 'vector_st', mag: 'vector_mag17' } as Preset,
};
// Rifles and machine guns. The RPK-16 is an AK (its grips, stocks, muzzle devices and magazines are the AK-74's),
// the HK416 an AR (grips, stocks, STANAG magazines); the rest are each their own model with their own stock,
// handguard and magazine where those come off. Marksman rifles take scope rings as well as a Picatinny rail.
const RIFLE_TOP: Socket = { id: 'sight', label: 'Scope mount', accepts: ['picatinny', 'scope_rings'], kinds: ['scope'] };
const DOVETAIL: Socket = { id: 'side', label: 'Side mount', accepts: ['ak_dovetail'], kinds: ['scope'] };
const RPK16 = {
  sockets: [
    { id: 'pgrip', label: 'Pistol grip', accepts: ['ak_pgrip'], required: true },
    { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
    { id: 'handguard', label: 'Handguard', accepts: ['rpk16_handguard'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['ak_stock'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['ak545_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['ak545_mag'], required: true },
  ] as Socket[],
  preset: { pgrip: 'ak_pg_rpk16', handguard: 'rpk16_hg', stock: 'ak_st_rpk16', muzzle: 'ak_mz_rpk16', mag: 'mag_ak45' } as Preset,
};
const HK416 = {
  sockets: [
    { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
    { id: 'foregrip', label: 'Bottom rail', accepts: ['picatinny'], kinds: ['grip'] },
    { id: 'tactical', label: 'Side rail', accepts: ['picatinny'], kinds: ['light'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['ar_muzzle'] },
    { id: 'pgrip', label: 'Pistol grip', accepts: ['ar_pgrip'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['ar_buffer'] },
    { id: 'mag', label: 'Magazine', accepts: ['stanag'], required: true },
  ] as Socket[],
  preset: { pgrip: 'ar_pg_hk416', stock: 'ar_st_hk416', mag: 'mag_stanag30' } as Preset,
};
const SKS = {
  sockets: [
    RIFLE_TOP,
    { id: 'muzzle', label: 'Muzzle', accepts: ['rifle762_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['sks_mag'], required: true },
  ] as Socket[],
  preset: { mag: 'sks_mag10' } as Preset,
};
const VEPR = {
  sockets: [
    RIFLE_TOP,
    { id: 'stock', label: 'Stock', accepts: ['vepr_stock'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['rifle762_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['vepr_mag'], required: true },
  ] as Socket[],
  preset: { stock: 'vepr_st', mag: 'vepr_mag10' } as Preset,
};
const SVD = {
  sockets: [
    DOVETAIL,
    RIFLE_TOP,
    { id: 'handguard', label: 'Handguard', accepts: ['svd_handguard'], required: true },
    { id: 'stock', label: 'Stock', accepts: ['svd_stock'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['rifle54_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['svd_mag'], required: true },
  ] as Socket[],
  preset: { handguard: 'svd_hg', stock: 'svd_st', mag: 'svd_mag10' } as Preset,
};
const SV98 = {
  sockets: [
    RIFLE_TOP,
    { id: 'muzzle', label: 'Muzzle', accepts: ['rifle54_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['sv98_mag'], required: true },
  ] as Socket[],
  preset: { mag: 'sv98_mag10' } as Preset,
};
const MOSIN = {
  sockets: [RIFLE_TOP, { id: 'muzzle', label: 'Muzzle', accepts: ['rifle54_muzzle'] }] as Socket[],
  preset: {} as Preset,
};
const PKM = {
  sockets: [
    DOVETAIL,
    { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
    { id: 'stock', label: 'Stock', accepts: ['pkm_stock'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['rifle54_muzzle'] },
    { id: 'mag', label: 'Ammo box', accepts: ['pkm_box'], required: true },
  ] as Socket[],
  preset: { stock: 'pkm_st', mag: 'pkm_box100' } as Preset,
};
const AUG = {
  sockets: [
    { id: 'sight', label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
    { id: 'foregrip', label: 'Bottom rail', accepts: ['picatinny'], kinds: ['grip'] },
    { id: 'muzzle', label: 'Muzzle', accepts: ['ar_muzzle'] },
    { id: 'mag', label: 'Magazine', accepts: ['aug_mag'], required: true },
  ] as Socket[],
  preset: { mag: 'aug_mag30' } as Preset,
};
const RAILS = (...ids: ('foregrip' | 'tactical' | 'sight')[]): Socket[] =>
  ids.map((id) =>
    id === 'foregrip'
      ? { id, label: 'Bottom rail', accepts: ['picatinny'], kinds: ['grip'] }
      : id === 'tactical'
        ? { id, label: 'Side rail', accepts: ['picatinny'], kinds: ['light'] }
        : { id, label: 'Top rail', accepts: ['picatinny'], kinds: ['scope'] },
  );
const AR_MUZZLE: Socket[] = [{ id: 'muzzle', label: 'Muzzle', accepts: ['ar_muzzle'] }];

const defs: ItemDef[] = [
  // ── Weapons ──────────────────────────────────────────────
  { id: 'pm', name: 'PM 9x18 pistol', short: 'PM', category: 'weapon', w: 2, h: 1, weight: 0.7, value: 9000, rarity: 1,
    weapon: { cls: 'pistol', caliber: '9x18', damage: 28, rpm: 360, magSize: 8, spread: 0.06, range: 22, reloadTime: 1.6, noise: 22, auto: false, recoil: 0.04, ...PM } },
  { id: 'mp443', name: 'MP-443 9x19 pistol', short: 'MP-443', category: 'weapon', w: 2, h: 1, weight: 0.9, value: 21000, rarity: 2,
    weapon: { cls: 'pistol', caliber: '9x19', damage: 34, rpm: 400, magSize: 18, spread: 0.05, range: 24, reloadTime: 1.7, noise: 24, auto: false, recoil: 0.045, ...MP443 } },
  { id: 'mp133', name: 'MP-133 12ga shotgun', short: 'MP-133', category: 'weapon', w: 4, h: 1, weight: 3.5, value: 18000, rarity: 1,
    weapon: { cls: 'shotgun', caliber: '12g', damage: 24, rpm: 70, magSize: 6, spread: 0.11, range: 16, reloadTime: 3.2, noise: 32, auto: false, pellets: 8, recoil: 0.14 } },
  { id: 'aks74u', name: 'AKS-74U carbine', short: 'AKS-74U', category: 'weapon', w: 3, h: 2, weight: 2.7, value: 34000, rarity: 2,
    weapon: { cls: 'rifle', caliber: '5.45', damage: 40, rpm: 650, magSize: 30, spread: 0.045, range: 30, reloadTime: 2.3, noise: 30, auto: true, recoil: 0.05, ...AKS74U } },
  { id: 'sks', name: 'SKS carbine', short: 'SKS', category: 'weapon', w: 4, h: 1, weight: 3.8, value: 29000, rarity: 2,
    weapon: { cls: 'marksman', caliber: '7.62x39', damage: 54, rpm: 300, magSize: 10, spread: 0.018, range: 42, reloadTime: 2.8, noise: 34, auto: false, recoil: 0.06, ...SKS } },
  { id: 'ak74m', name: 'AK-74M assault rifle', short: 'AK-74M', category: 'weapon', w: 4, h: 2, weight: 3.6, value: 62000, rarity: 3,
    weapon: { cls: 'rifle', caliber: '5.45', damage: 42, rpm: 650, magSize: 30, spread: 0.028, range: 40, reloadTime: 2.4, noise: 34, auto: true, recoil: 0.04, ...AK74M } },
  { id: 'm4a1', name: 'M4A1 rifle', short: 'M4A1', category: 'weapon', w: 4, h: 2, weight: 3.2, value: 88000, rarity: 4,
    weapon: { cls: 'rifle', caliber: '5.56', damage: 44, rpm: 800, magSize: 30, spread: 0.022, range: 44, reloadTime: 2.2, noise: 33, auto: true, recoil: 0.034, ...M4A1 } },
  { id: 'akm', name: 'AKM assault rifle', short: 'AKM', category: 'weapon', w: 4, h: 2, weight: 3.8, value: 58000, rarity: 3,
    weapon: { cls: 'rifle', caliber: '7.62x39', damage: 56, rpm: 600, magSize: 30, spread: 0.032, range: 40, reloadTime: 2.5, noise: 36, auto: true, recoil: 0.06, ...AKM } },
  { id: 'svd', name: 'SVD marksman rifle', short: 'SVD', category: 'weapon', w: 5, h: 1, weight: 4.3, value: 115000, rarity: 4,
    weapon: { cls: 'marksman', caliber: '7.62x54', damage: 86, rpm: 200, magSize: 10, spread: 0.008, range: 60, reloadTime: 3.0, noise: 42, auto: false, recoil: 0.09, ...SVD } },
  { id: 'pkm', name: 'PKM machine gun', short: 'PKM', category: 'weapon', w: 5, h: 2, weight: 8.9, value: 190000, rarity: 5,
    weapon: { cls: 'lmg', caliber: '7.62x54', damage: 78, rpm: 700, magSize: 100, spread: 0.04, range: 50, reloadTime: 5.5, noise: 44, auto: true, recoil: 0.05, ...PKM } },

  { id: 'glock17', name: 'Glock 17 pistol', short: 'G17', category: 'weapon', w: 2, h: 1, weight: 0.7, value: 26000, rarity: 2,
    weapon: { cls: 'pistol', caliber: '9x19', damage: 33, rpm: 450, magSize: 17, spread: 0.05, range: 24, reloadTime: 1.6, noise: 24, auto: false, recoil: 0.04, ...GLOCK17 } },
  { id: 'rhino', name: 'Chiappa Rhino revolver', short: 'RHINO', category: 'weapon', w: 2, h: 1, weight: 0.8, value: 38000, rarity: 3,
    weapon: { cls: 'pistol', caliber: '9x19', damage: 46, rpm: 220, magSize: 6, spread: 0.035, range: 26, reloadTime: 2.6, noise: 26, auto: false, recoil: 0.08, ...RHINO } },
  { id: 'toz', name: 'TOZ-66 sawed-off', short: 'TOZ', category: 'weapon', w: 2, h: 1, weight: 2.1, value: 12000, rarity: 1,
    weapon: { cls: 'shotgun', caliber: '12g', damage: 26, rpm: 400, magSize: 2, spread: 0.16, range: 12, reloadTime: 2.4, noise: 34, auto: false, pellets: 9, recoil: 0.16 } },
  { id: 'pp19', name: 'PP-19-01 Vityaz SMG', short: 'VITYAZ', category: 'weapon', w: 3, h: 2, weight: 2.9, value: 39000, rarity: 2,
    weapon: { cls: 'smg', caliber: '9x19', damage: 32, rpm: 700, magSize: 30, spread: 0.042, range: 27, reloadTime: 2.2, noise: 27, auto: true, recoil: 0.03, ...PP19 } },
  { id: 'mp5', name: 'MP5 submachine gun', short: 'MP5', category: 'weapon', w: 3, h: 2, weight: 2.5, value: 45000, rarity: 3,
    weapon: { cls: 'smg', caliber: '9x19', damage: 31, rpm: 800, magSize: 30, spread: 0.04, range: 26, reloadTime: 2.0, noise: 26, auto: true, recoil: 0.025, ...MP5 } },
  { id: 'vector', name: 'KRISS Vector 9x19', short: 'VECTOR', category: 'weapon', w: 3, h: 2, weight: 2.7, value: 120000, rarity: 4,
    weapon: { cls: 'smg', caliber: '9x19', damage: 30, rpm: 1100, magSize: 17, spread: 0.045, range: 24, reloadTime: 2.1, noise: 26, auto: true, recoil: 0.022, ...VECTOR } },
  { id: 'saiga12', name: 'Saiga-12K shotgun', short: 'SAIGA', category: 'weapon', w: 4, h: 1, weight: 3.6, value: 55000, rarity: 3,
    weapon: { cls: 'shotgun', caliber: '12g', damage: 24, rpm: 240, magSize: 5, spread: 0.1, range: 17, reloadTime: 3.0, noise: 34, auto: false, pellets: 8, recoil: 0.12 } },
  { id: 'vepr', name: 'Vepr Hunter carbine', short: 'VEPR', category: 'weapon', w: 4, h: 1, weight: 3.9, value: 33000, rarity: 2,
    weapon: { cls: 'marksman', caliber: '7.62x39', damage: 58, rpm: 340, magSize: 10, spread: 0.016, range: 44, reloadTime: 2.7, noise: 35, auto: false, recoil: 0.065, ...VEPR } },
  { id: 'aug', name: 'Steyr AUG A3', short: 'AUG', category: 'weapon', w: 3, h: 2, weight: 3.4, value: 110000, rarity: 4,
    weapon: { cls: 'rifle', caliber: '5.56', damage: 44, rpm: 700, magSize: 30, spread: 0.021, range: 44, reloadTime: 2.4, noise: 33, auto: true, recoil: 0.032, ...AUG } },
  { id: 'hk416', name: 'HK 416A5', short: 'HK416', category: 'weapon', w: 4, h: 2, weight: 3.5, value: 150000, rarity: 5,
    weapon: { cls: 'rifle', caliber: '5.56', damage: 45, rpm: 850, magSize: 30, spread: 0.02, range: 46, reloadTime: 2.2, noise: 33, auto: true, recoil: 0.03, ...HK416 } },
  { id: 'rpk16', name: 'RPK-16 light machine gun', short: 'RPK-16', category: 'weapon', w: 5, h: 2, weight: 4.8, value: 98000, rarity: 4,
    weapon: { cls: 'lmg', caliber: '5.45', damage: 43, rpm: 650, magSize: 45, spread: 0.03, range: 44, reloadTime: 2.86, noise: 35, auto: true, recoil: 0.035, ...RPK16 } },
  { id: 'mosin', name: 'Mosin bolt-action rifle', short: 'MOSIN', category: 'weapon', w: 5, h: 1, weight: 4.0, value: 52000, rarity: 2,
    weapon: { cls: 'marksman', caliber: '7.62x54', damage: 98, rpm: 45, magSize: 5, spread: 0.006, range: 64, reloadTime: 3.5, noise: 44, auto: false, recoil: 0.12, ...MOSIN } },
  { id: 'sv98', name: 'SV-98 sniper rifle', short: 'SV-98', category: 'weapon', w: 5, h: 1, weight: 5.8, value: 165000, rarity: 5,
    weapon: { cls: 'marksman', caliber: '7.62x54', damage: 104, rpm: 50, magSize: 10, spread: 0.004, range: 70, reloadTime: 3.2, noise: 44, auto: false, recoil: 0.11, ...SV98 } },

  // ── Weapon mods ──────────────────────────────────────────
  { id: 'sup_9', name: '9mm suppressor', short: 'SUP 9', category: 'mod', w: 2, h: 1, weight: 0.2, value: 21000, rarity: 3,
    mod: { slot: 'muzzle', mounts: ['pistol9_muzzle'], calibers: ['9x18', '9x19'], classes: ['pistol', 'smg'], noiseMul: 0.32, suppressed: true, recoilMul: 0.9, rangeMul: 0.95, ergo: 0.99 } },
  { id: 'sup_545', name: '5.45 suppressor', short: 'SUP 545', category: 'mod', w: 2, h: 1, weight: 0.4, value: 34000, rarity: 3,
    mod: { slot: 'muzzle', mounts: ['ak545_muzzle', 'aks74u_muzzle'], calibers: ['5.45'], noiseMul: 0.36, suppressed: true, recoilMul: 0.88, ergo: 0.98 } },
  { id: 'sup_556', name: '5.56 suppressor', short: 'SUP 556', category: 'mod', w: 2, h: 1, weight: 0.4, value: 39000, rarity: 4,
    mod: { slot: 'muzzle', mounts: ['ar_muzzle'], calibers: ['5.56'], noiseMul: 0.36, suppressed: true, recoilMul: 0.88, ergo: 0.98 } },
  { id: 'sup_762', name: '7.62x39 suppressor', short: 'SUP 762', category: 'mod', w: 2, h: 1, weight: 0.5, value: 36000, rarity: 3,
    mod: { slot: 'muzzle', mounts: ['ak762_muzzle', 'rifle762_muzzle'], calibers: ['7.62x39'], noiseMul: 0.38, suppressed: true, recoilMul: 0.86, ergo: 0.98 } },
  { id: 'sup_54r', name: '7.62x54R suppressor', short: 'SUP 54R', category: 'mod', w: 3, h: 1, weight: 0.6, value: 62000, rarity: 4,
    mod: { slot: 'muzzle', mounts: ['rifle54_muzzle'], ids: ['svd', 'mosin', 'sv98', 'pkm'], noiseMul: 0.4, suppressed: true, recoilMul: 0.85, ergo: 0.97 } },
  { id: 'brake', name: 'Muzzle brake', short: 'BRAKE', category: 'mod', w: 1, h: 1, weight: 0.15, value: 9000, rarity: 2,
    mod: { slot: 'muzzle', mounts: ['ak545_muzzle', 'ak762_muzzle', 'ar_muzzle', 'rifle762_muzzle', 'rifle54_muzzle'], calibers: ['5.45', '5.56', '7.62x39', '7.62x54'], classes: ['rifle', 'lmg', 'marksman'], recoilMul: 0.7, noiseMul: 1.12 } },
  { id: 'red_dot', name: 'Red dot sight', short: 'RDS', category: 'mod', w: 1, h: 1, weight: 0.1, value: 12000, rarity: 2,
    mod: { slot: 'scope', mounts: ['picatinny', 'pistol_optic'], classes: ['pistol', 'smg', 'rifle', 'shotgun', 'lmg'], aimSpreadMul: 0.82, zoom: 1.06 } },
  { id: 'holo', name: 'Holographic sight', short: 'HOLO', category: 'mod', w: 1, h: 1, weight: 0.3, value: 26000, rarity: 3,
    mod: { slot: 'scope', mounts: ['picatinny'], classes: ['smg', 'rifle', 'shotgun', 'lmg'], aimSpreadMul: 0.76, zoom: 1.1 } },
  { id: 'scope_4x', name: '4x combat scope', short: '4X', category: 'mod', w: 2, h: 1, weight: 0.5, value: 48000, rarity: 4,
    mod: { slot: 'scope', mounts: ['picatinny'], classes: ['rifle', 'marksman', 'lmg'], aimSpreadMul: 0.55, zoom: 1.4, ergo: 0.98 } },
  { id: 'scope_8x', name: '8x sniper scope', short: '8X', category: 'mod', w: 2, h: 1, weight: 0.8, value: 85000, rarity: 5,
    mod: { slot: 'scope', mounts: ['scope_rings'], classes: ['marksman'], aimSpreadMul: 0.4, zoom: 1.75, ergo: 0.96 } },
  { id: 'fgrip', name: 'Vertical foregrip', short: 'GRIP', category: 'mod', w: 1, h: 1, weight: 0.1, value: 8000, rarity: 2,
    mod: { slot: 'grip', mounts: ['picatinny'], classes: ['smg', 'rifle', 'lmg', 'shotgun'], recoilMul: 0.78, spreadMul: 0.93 } },
  { id: 'stock_tac', name: 'Tactical stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.4, value: 15000, rarity: 2,
    mod: { slot: 'stock', mounts: ['ak_stock', 'ar_buffer', 'pp19_stock', 'mp5_stock', 'vector_stock', 'vepr_stock', 'svd_stock', 'pkm_stock'], classes: ['smg', 'rifle', 'lmg', 'marksman', 'shotgun'], recoilMul: 0.8, spreadMul: 0.95 } },
  { id: 'tac_light', name: 'Tactical flashlight', short: 'LIGHT', category: 'mod', w: 1, h: 1, weight: 0.1, value: 7000, rarity: 1,
    mod: { slot: 'light', mounts: ['picatinny'], classes: ['pistol', 'smg', 'rifle', 'shotgun', 'lmg'], light: true } },
  { id: 'mag_ak45', name: 'AK 5.45 45-round mag', short: 'MAG 45', category: 'mod', w: 1, h: 2, weight: 0.3, value: 14000, rarity: 3,
    mod: { slot: 'mag', mounts: ['ak545_mag'], ids: ['aks74u', 'ak74m', 'rpk16'], magSize: 45, reloadMul: 1.12, ergo: 0.98 } },
  { id: 'mag_rpk95', name: 'RPK 95-round drum', short: 'DRUM 95', category: 'mod', w: 2, h: 2, weight: 1.1, value: 46000, rarity: 4,
    mod: { slot: 'mag', mounts: ['ak545_mag'], ids: ['ak74m', 'rpk16'], magSize: 95, reloadMul: 1.5, ergo: 0.95 } },
  { id: 'mag_akm40', name: 'AKM 40-round mag', short: 'MAG 40', category: 'mod', w: 1, h: 2, weight: 0.35, value: 15000, rarity: 3,
    mod: { slot: 'mag', mounts: ['ak762_mag'], ids: ['akm'], magSize: 40, reloadMul: 1.12, ergo: 0.98 } },
  { id: 'mag_stanag60', name: 'STANAG 60-round mag', short: 'MAG 60', category: 'mod', w: 1, h: 2, weight: 0.4, value: 32000, rarity: 4,
    mod: { slot: 'mag', mounts: ['stanag'], ids: ['m4a1', 'hk416'], magSize: 60, reloadMul: 1.25, ergo: 0.97 } },
  { id: 'mag_9_33', name: '9x19 33-round mag', short: 'MAG 33', category: 'mod', w: 1, h: 2, weight: 0.2, value: 11000, rarity: 3,
    mod: { slot: 'mag', mounts: ['glock_mag', 'mp443_mag', 'vector_mag'], ids: ['glock17', 'vector', 'mp443'], magSize: 33, reloadMul: 1.1 } },
  { id: 'mag_sks20', name: 'SKS 20-round mag', short: 'MAG 20', category: 'mod', w: 1, h: 1, weight: 0.2, value: 9000, rarity: 2,
    mod: { slot: 'mag', mounts: ['sks_mag'], ids: ['sks', 'vepr'], magSize: 20, reloadMul: 0.85 } },
  { id: 'mag_saiga20', name: 'Saiga-12 20-round drum', short: 'DRUM 20', category: 'mod', w: 2, h: 2, weight: 1.2, value: 38000, rarity: 4,
    mod: { slot: 'mag', ids: ['saiga12'], magSize: 20, reloadMul: 1.4, ergo: 0.95 } },

  // ── Weapon parts (guns built from parts: AK family, M4) ──
  // AK
  { id: 'ak_pg_74', name: 'AK-74 pistol grip', short: 'AK GRIP', category: 'mod', w: 1, h: 1, weight: 0.06, value: 1500, rarity: 1, mod: { slot: 'pgrip', mounts: ['ak_pgrip'] } },
  { id: 'ak_pg_akm', name: 'AKM wooden pistol grip', short: 'AKM GRIP', category: 'mod', w: 1, h: 1, weight: 0.07, value: 1400, rarity: 1, mod: { slot: 'pgrip', mounts: ['ak_pgrip'] } },
  { id: 'ak_pg_rk9', name: 'Zenitco RK-9 pistol grip', short: 'RK-9', category: 'mod', w: 1, h: 1, weight: 0.08, value: 6500, rarity: 2, mod: { slot: 'pgrip', mounts: ['ak_pgrip'], recoilMul: 0.97, ergo: 1.01 } },
  { id: 'ak_pg_moe', name: 'Magpul MOE AK grip', short: 'MOE AK', category: 'mod', w: 1, h: 1, weight: 0.07, value: 5200, rarity: 2, mod: { slot: 'pgrip', mounts: ['ak_pgrip'], recoilMul: 0.98, ergo: 1.01 } },
  { id: 'ak_dc', name: 'AK dust cover', short: 'COVER', category: 'mod', w: 2, h: 1, weight: 0.2, value: 2500, rarity: 1, mod: { slot: 'dustcover', mounts: ['ak_dustcover'] } },
  { id: 'ak_gt_74', name: 'AK-74 gas tube', short: 'GAS TUBE', category: 'mod', w: 2, h: 1, weight: 0.15, value: 2200, rarity: 1, mod: { slot: 'gastube', mounts: ['ak_gastube'] } },
  { id: 'ak_gt_akm', name: 'AKM wooden gas tube', short: 'GAS TUBE', category: 'mod', w: 2, h: 1, weight: 0.17, value: 2000, rarity: 1, mod: { slot: 'gastube', mounts: ['ak_gastube'] } },
  { id: 'ak_gt_b19', name: 'Zenitco B-19 rail mount', short: 'B-19', category: 'mod', w: 2, h: 1, weight: 0.12, value: 14000, rarity: 3, mod: { slot: 'gastube', mounts: ['ak_gastube'], sockets: RAILS('sight') } },
  { id: 'ak_hg_74', name: 'AK-74M polymer handguard', short: 'HANDGRD', category: 'mod', w: 2, h: 1, weight: 0.2, value: 2500, rarity: 1, mod: { slot: 'handguard', mounts: ['ak_handguard'] } },
  { id: 'ak_hg_akm', name: 'AKM wooden handguard', short: 'HANDGRD', category: 'mod', w: 2, h: 1, weight: 0.22, value: 2200, rarity: 1, mod: { slot: 'handguard', mounts: ['ak_handguard'] } },
  { id: 'ak_hg_b10', name: 'Zenitco B-10 handguard', short: 'B-10', category: 'mod', w: 2, h: 1, weight: 0.25, value: 16000, rarity: 3, mod: { slot: 'handguard', mounts: ['ak_handguard'], recoilMul: 0.97, sockets: RAILS('foregrip') } },
  { id: 'ak_hg_fab', name: 'FAB Defense AK handguard', short: 'FAB', category: 'mod', w: 2, h: 1, weight: 0.3, value: 12000, rarity: 2, mod: { slot: 'handguard', mounts: ['ak_handguard'], sockets: RAILS('foregrip', 'tactical') } },
  { id: 'ak_st_74m', name: 'AK-74M folding stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.3, value: 4000, rarity: 1, mod: { slot: 'stock', mounts: ['ak_stock'] } },
  { id: 'ak_st_akm', name: 'AKM wooden stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.45, value: 3500, rarity: 1, mod: { slot: 'stock', mounts: ['ak_stock'] } },
  { id: 'ak_st_pt1', name: 'Zenitco PT-1 stock', short: 'PT-1', category: 'mod', w: 2, h: 1, weight: 0.4, value: 17000, rarity: 3, mod: { slot: 'stock', mounts: ['ak_stock'], recoilMul: 0.85, spreadMul: 0.96 } },
  { id: 'ak_st_zhukov', name: 'Magpul Zhukov-S stock', short: 'ZHUKOV', category: 'mod', w: 2, h: 1, weight: 0.35, value: 13000, rarity: 3, mod: { slot: 'stock', mounts: ['ak_stock'], recoilMul: 0.88 } },
  { id: 'ak_mz_74', name: 'AK-74 muzzle brake', short: 'DTK', category: 'mod', w: 1, h: 1, weight: 0.05, value: 2000, rarity: 1, mod: { slot: 'muzzle', mounts: ['ak545_muzzle'] } },
  { id: 'ak_mz_akm', name: 'AKM slant brake', short: 'SLANT', category: 'mod', w: 1, h: 1, weight: 0.04, value: 1500, rarity: 1, mod: { slot: 'muzzle', mounts: ['ak762_muzzle'] } },
  { id: 'sup_dtk1p', name: 'DTK-1P suppressor', short: 'DTK-1P', category: 'mod', w: 2, h: 1, weight: 0.45, value: 38000, rarity: 4, mod: { slot: 'muzzle', mounts: ['ak545_muzzle'], noiseMul: 0.34, suppressed: true, recoilMul: 0.86, ergo: 0.98 } },
  { id: 'aks74u_hg', name: 'AKS-74U wooden handguard', short: 'HANDGRD', category: 'mod', w: 1, h: 1, weight: 0.15, value: 2000, rarity: 1, mod: { slot: 'handguard', mounts: ['aks74u_handguard'] } },
  { id: 'aks74u_mz', name: 'AKS-74U muzzle booster', short: 'BOOSTER', category: 'mod', w: 1, h: 1, weight: 0.06, value: 1800, rarity: 1, mod: { slot: 'muzzle', mounts: ['aks74u_muzzle'] } },
  { id: 'pm_slide', name: 'PM slide', short: 'SLIDE', category: 'mod', w: 1, h: 1, weight: 0.2, value: 1500, rarity: 1, mod: { slot: 'slide', mounts: ['pm_slide'] } },
  { id: 'pm_mag8', name: 'PM 8-round mag', short: 'MAG 8', category: 'mod', w: 1, h: 1, weight: 0.08, value: 900, rarity: 1, mod: { slot: 'mag', mounts: ['pm_mag'] } },
  { id: 'mp443_slide', name: 'MP-443 slide', short: 'SLIDE', category: 'mod', w: 1, h: 1, weight: 0.3, value: 3000, rarity: 1, mod: { slot: 'slide', mounts: ['mp443_slide'] } },
  { id: 'mp443_mag18', name: 'MP-443 18-round mag', short: 'MAG 18', category: 'mod', w: 1, h: 1, weight: 0.1, value: 1400, rarity: 1, mod: { slot: 'mag', mounts: ['mp443_mag'] } },
  { id: 'glock_slide', name: 'Glock 17 slide', short: 'SLIDE', category: 'mod', w: 1, h: 1, weight: 0.25, value: 3500, rarity: 1,
    mod: { slot: 'slide', mounts: ['glock_slide'], sockets: [{ id: 'sight', label: 'Optic plate', accepts: ['pistol_optic'], kinds: ['scope'] }] } },
  { id: 'glock_mag17', name: 'Glock 17-round mag', short: 'MAG 17', category: 'mod', w: 1, h: 1, weight: 0.09, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['glock_mag'] } },
  { id: 'pp19_hg', name: 'PP-19-01 handguard', short: 'HANDGRD', category: 'mod', w: 1, h: 1, weight: 0.15, value: 1800, rarity: 1, mod: { slot: 'handguard', mounts: ['pp19_handguard'] } },
  { id: 'pp19_st', name: 'PP-19-01 folding stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.3, value: 2500, rarity: 1, mod: { slot: 'stock', mounts: ['pp19_stock'] } },
  { id: 'pp19_mag30', name: 'PP-19-01 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.18, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['pp19_mag'] } },
  { id: 'mp5_hg', name: 'MP5 handguard', short: 'HANDGRD', category: 'mod', w: 1, h: 1, weight: 0.12, value: 2000, rarity: 1, mod: { slot: 'handguard', mounts: ['mp5_handguard'] } },
  { id: 'mp5_st', name: 'MP5 retractable stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.35, value: 2500, rarity: 1, mod: { slot: 'stock', mounts: ['mp5_stock'] } },
  { id: 'mp5_mag30', name: 'MP5 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.15, value: 1600, rarity: 1, mod: { slot: 'mag', mounts: ['mp5_mag'] } },
  { id: 'vector_st', name: 'Vector folding stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.3, value: 4000, rarity: 1, mod: { slot: 'stock', mounts: ['vector_stock'] } },
  { id: 'vector_mag17', name: 'Vector 17-round mag', short: 'MAG 17', category: 'mod', w: 1, h: 1, weight: 0.09, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['vector_mag'] } },
  // Rifles and machine guns
  { id: 'ak_pg_rpk16', name: 'RPK-16 pistol grip', short: 'GRIP', category: 'mod', w: 1, h: 1, weight: 0.07, value: 2200, rarity: 1, mod: { slot: 'pgrip', mounts: ['ak_pgrip'] } },
  { id: 'ak_st_rpk16', name: 'RPK-16 folding stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.35, value: 5000, rarity: 1, mod: { slot: 'stock', mounts: ['ak_stock'] } },
  { id: 'rpk16_hg', name: 'RPK-16 rail handguard', short: 'HANDGRD', category: 'mod', w: 2, h: 1, weight: 0.3, value: 6000, rarity: 1,
    mod: { slot: 'handguard', mounts: ['rpk16_handguard'], sockets: RAILS('foregrip', 'tactical') } },
  { id: 'ak_mz_rpk16', name: 'RPK-16 muzzle brake', short: 'BRAKE', category: 'mod', w: 1, h: 1, weight: 0.06, value: 2500, rarity: 1, mod: { slot: 'muzzle', mounts: ['ak545_muzzle'] } },
  { id: 'ar_pg_hk416', name: 'HK416 pistol grip', short: 'GRIP', category: 'mod', w: 1, h: 1, weight: 0.07, value: 2500, rarity: 1, mod: { slot: 'pgrip', mounts: ['ar_pgrip'] } },
  { id: 'ar_st_hk416', name: 'HK416 slim stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.3, value: 5500, rarity: 1, mod: { slot: 'stock', mounts: ['ar_buffer'] } },
  { id: 'sks_mag10', name: 'SKS 10-round fixed mag', short: 'MAG 10', category: 'mod', w: 1, h: 1, weight: 0.1, value: 1000, rarity: 1, mod: { slot: 'mag', mounts: ['sks_mag'], magSize: 10 } },
  { id: 'vepr_st', name: 'Vepr thumbhole stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.5, value: 3500, rarity: 1, mod: { slot: 'stock', mounts: ['vepr_stock'] } },
  { id: 'vepr_mag10', name: 'Vepr 10-round mag', short: 'MAG 10', category: 'mod', w: 1, h: 1, weight: 0.2, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['vepr_mag'], magSize: 10 } },
  { id: 'svd_st', name: 'SVD wooden stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.6, value: 5000, rarity: 1, mod: { slot: 'stock', mounts: ['svd_stock'] } },
  { id: 'svd_hg', name: 'SVD wooden handguard', short: 'HANDGRD', category: 'mod', w: 2, h: 1, weight: 0.3, value: 3000, rarity: 1, mod: { slot: 'handguard', mounts: ['svd_handguard'] } },
  { id: 'svd_mag10', name: 'SVD 10-round mag', short: 'MAG 10', category: 'mod', w: 1, h: 1, weight: 0.2, value: 2500, rarity: 1, mod: { slot: 'mag', mounts: ['svd_mag'], magSize: 10 } },
  { id: 'sv98_mag10', name: 'SV-98 10-round mag', short: 'MAG 10', category: 'mod', w: 1, h: 1, weight: 0.2, value: 3000, rarity: 1, mod: { slot: 'mag', mounts: ['sv98_mag'], magSize: 10 } },
  { id: 'pkm_st', name: 'PKM stock', short: 'STOCK', category: 'mod', w: 2, h: 1, weight: 0.6, value: 5000, rarity: 1, mod: { slot: 'stock', mounts: ['pkm_stock'] } },
  { id: 'pkm_box100', name: 'PKM 100-round box', short: 'BOX 100', category: 'mod', w: 2, h: 2, weight: 1.0, value: 4000, rarity: 1, mod: { slot: 'mag', mounts: ['pkm_box'], magSize: 100 } },
  { id: 'aug_mag30', name: 'AUG 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.13, value: 2000, rarity: 1, mod: { slot: 'mag', mounts: ['aug_mag'], magSize: 30 } },
  { id: 'rhino_cyl', name: 'Rhino 6-round cylinder', short: 'CYL', category: 'mod', w: 1, h: 1, weight: 0.15, value: 4000, rarity: 1, mod: { slot: 'cylinder', mounts: ['rhino_cylinder'] } },
  { id: 'mag_ak545_30', name: 'AK-74 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.22, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['ak545_mag'], magSize: 30 } },
  { id: 'mag_akm30', name: 'AKM 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.3, value: 1500, rarity: 1, mod: { slot: 'mag', mounts: ['ak762_mag'], magSize: 30 } },
  { id: 'pso1', name: 'PSO-1 4x scope', short: 'PSO-1', category: 'mod', w: 2, h: 1, weight: 0.6, value: 42000, rarity: 4, mod: { slot: 'scope', mounts: ['ak_dovetail'], aimSpreadMul: 0.55, zoom: 1.4, ergo: 0.98 } },
  // M4 / AR-15
  { id: 'ar_barrel_145', name: 'M4 14.5" barrel', short: '14.5"', category: 'mod', w: 3, h: 1, weight: 0.7, value: 9000, rarity: 2, mod: { slot: 'barrel', mounts: ['ar_barrel'], sockets: AR_MUZZLE } },
  { id: 'ar_barrel_20', name: 'M16 20" barrel', short: '20"', category: 'mod', w: 4, h: 1, weight: 0.95, value: 16000, rarity: 3, mod: { slot: 'barrel', mounts: ['ar_barrel'], sockets: AR_MUZZLE, rangeMul: 1.15, spreadMul: 0.88, recoilMul: 0.95, ergo: 0.97 } },
  { id: 'ar_barrel_103', name: 'AR 10.3" barrel', short: '10.3"', category: 'mod', w: 2, h: 1, weight: 0.5, value: 12000, rarity: 3, mod: { slot: 'barrel', mounts: ['ar_barrel'], sockets: AR_MUZZLE, rangeMul: 0.85, spreadMul: 1.12, recoilMul: 1.08, noiseMul: 1.06, ergo: 1.02 } },
  { id: 'ar_fh_a2', name: 'A2 flash hider', short: 'A2 FH', category: 'mod', w: 1, h: 1, weight: 0.05, value: 1200, rarity: 1, mod: { slot: 'muzzle', mounts: ['ar_muzzle'] } },
  { id: 'ar_hg_m4', name: 'M4 polymer handguard', short: 'HANDGRD', category: 'mod', w: 2, h: 1, weight: 0.25, value: 3000, rarity: 1, mod: { slot: 'handguard', mounts: ['ar_handguard'] } },
  { id: 'ar_hg_ris', name: 'RIS quad-rail handguard', short: 'RIS', category: 'mod', w: 2, h: 1, weight: 0.35, value: 14000, rarity: 3, mod: { slot: 'handguard', mounts: ['ar_handguard'], sockets: RAILS('foregrip', 'tactical') } },
  { id: 'ar_hg_mlok', name: 'M-LOK 13" handguard', short: 'M-LOK', category: 'mod', w: 3, h: 1, weight: 0.3, value: 18000, rarity: 3, mod: { slot: 'handguard', mounts: ['ar_handguard'], recoilMul: 0.97, ergo: 1.01, sockets: RAILS('foregrip', 'tactical') } },
  { id: 'ar_hg_m16a4', name: 'M16A4 rail handguard', short: 'M16 RAS', category: 'mod', w: 3, h: 1, weight: 0.4, value: 15000, rarity: 3, mod: { slot: 'handguard', mounts: ['ar_handguard'], sockets: RAILS('foregrip', 'tactical') } },
  { id: 'ar_pg_a2', name: 'A2 pistol grip', short: 'A2 GRIP', category: 'mod', w: 1, h: 1, weight: 0.05, value: 1200, rarity: 1, mod: { slot: 'pgrip', mounts: ['ar_pgrip'] } },
  { id: 'ar_pg_moe', name: 'Magpul MOE grip', short: 'MOE', category: 'mod', w: 1, h: 1, weight: 0.06, value: 4000, rarity: 2, mod: { slot: 'pgrip', mounts: ['ar_pgrip'], ergo: 1.01 } },
  { id: 'ar_pg_ergo', name: 'Ergo pistol grip', short: 'ERGO', category: 'mod', w: 1, h: 1, weight: 0.07, value: 4500, rarity: 2, mod: { slot: 'pgrip', mounts: ['ar_pgrip'], recoilMul: 0.98 } },
  { id: 'ar_st_m4', name: 'M4 collapsible stock', short: 'M4 STOCK', category: 'mod', w: 2, h: 1, weight: 0.25, value: 3500, rarity: 1, mod: { slot: 'stock', mounts: ['ar_buffer'] } },
  { id: 'ar_st_ctr', name: 'Magpul CTR stock', short: 'CTR', category: 'mod', w: 2, h: 1, weight: 0.3, value: 11000, rarity: 2, mod: { slot: 'stock', mounts: ['ar_buffer'], recoilMul: 0.9 } },
  { id: 'ar_st_a2', name: 'A2 fixed stock', short: 'A2 STOCK', category: 'mod', w: 2, h: 1, weight: 0.4, value: 7000, rarity: 2, mod: { slot: 'stock', mounts: ['ar_buffer'], recoilMul: 0.86, ergo: 0.98 } },
  { id: 'mag_stanag30', name: 'STANAG 30-round mag', short: 'MAG 30', category: 'mod', w: 1, h: 2, weight: 0.12, value: 1600, rarity: 1, mod: { slot: 'mag', mounts: ['stanag'], magSize: 30 } },
  { id: 'mag_pmag30', name: 'Magpul PMAG 30', short: 'PMAG', category: 'mod', w: 1, h: 2, weight: 0.13, value: 3500, rarity: 2, mod: { slot: 'mag', mounts: ['stanag'], magSize: 30, reloadMul: 0.94 } },

  // ── Boss trophies (only from bosses) ─────────────────────
  { id: 'kostia_ring', name: "Warlord's signet ring", short: 'SIGNET', category: 'valuable', w: 1, h: 1, weight: 0.05, value: 380000, rarity: 5 },
  { id: 'bohdan_claw', name: 'Bear-claw hunting trophy', short: 'TROPHY', category: 'valuable', w: 1, h: 2, weight: 0.4, value: 260000, rarity: 5 },
  { id: 'rina_ledger', name: "Smuggler's ledger", short: 'LEDGER', category: 'valuable', w: 2, h: 1, weight: 0.3, value: 320000, rarity: 5 },

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
  { id: 'bayonet', name: '6Kh5 bayonet', short: '6KH5', category: 'melee', w: 1, h: 2, weight: 0.3, value: 11000, rarity: 2,
    melee: { damage: 27, reach: 0.78, cooldown: 0.42, arc: 0.7, stamina: 6, bleedChance: 0.55, armorBypass: 0.18, noise: 3 } },
  { id: 'cleaver', name: "Butcher's cleaver", short: 'CLEAVER', category: 'melee', w: 1, h: 2, weight: 0.7, value: 6500, rarity: 1,
    melee: { damage: 36, reach: 0.72, cooldown: 0.6, arc: 0.8, stamina: 8, bleedChance: 0.55, armorBypass: 0.12, noise: 4 } },
  { id: 'kukri', name: 'Kukri', short: 'KUKRI', category: 'melee', w: 1, h: 2, weight: 0.8, value: 21000, rarity: 3,
    melee: { damage: 46, reach: 0.9, cooldown: 0.55, arc: 0.9, stamina: 9, bleedChance: 0.65, armorBypass: 0.2, noise: 4 } },
  { id: 'hatchet', name: 'Hatchet', short: 'HATCHET', category: 'melee', w: 1, h: 2, weight: 0.9, value: 8000, rarity: 1,
    melee: { damage: 40, reach: 0.8, cooldown: 0.65, arc: 0.8, stamina: 10, bleedChance: 0.4, armorBypass: 0.25, noise: 5 } },
  { id: 'tomahawk', name: 'Tactical tomahawk', short: 'TOMHWK', category: 'melee', w: 1, h: 2, weight: 0.8, value: 34000, rarity: 3,
    melee: { damage: 52, reach: 0.9, cooldown: 0.6, arc: 0.85, stamina: 10, bleedChance: 0.5, armorBypass: 0.4, noise: 4 } },
  { id: 'shovel', name: 'MPL-50 entrenching tool', short: 'MPL-50', category: 'melee', w: 1, h: 3, weight: 1.2, value: 9500, rarity: 2,
    melee: { damage: 40, reach: 0.95, cooldown: 0.7, arc: 0.95, stamina: 12, bleedChance: 0.35, armorBypass: 0.3, noise: 5 } },
  { id: 'rebar', name: 'Rebar club', short: 'REBAR', category: 'melee', w: 1, h: 3, weight: 1.8, value: 2500, rarity: 1,
    melee: { damage: 32, reach: 0.95, cooldown: 0.8, arc: 0.9, stamina: 13, bleedChance: 0.08, armorBypass: 0.4, noise: 6 } },
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
