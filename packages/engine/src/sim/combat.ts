import type { Rng } from '../core/rng';
import { ARMOR_MATERIALS, armorMaterial, armorZones, type ArmorStats, type MeleeStats } from '../items/defs';
import { plateOf, type ItemInstance } from '../items/inventory';
import { getDef } from '../items/defs';
import type { HitZone } from './types';

export const ZONE_WEIGHTS: readonly (readonly [HitZone, number])[] = [
  ['head', 0.09],
  ['thorax', 0.26],
  ['stomach', 0.17],
  ['leftArm', 0.11],
  ['rightArm', 0.11],
  ['leftLeg', 0.13],
  ['rightLeg', 0.13],
];
/** Per-part HP pools already make heads fragile; multipliers only fine-tune. */
export const ZONE_MULT: Record<HitZone, number> = { head: 1.2, thorax: 1, stomach: 1, leftArm: 0.9, rightArm: 0.9, leftLeg: 0.9, rightLeg: 0.9 };

export interface DamageResult {
  damage: number;
  penetrated: boolean;
  armorDamage: number;
  bleedChance: number;
}

/**
 * Tarkov-style armour model: penetration vs armour class × 10, scaled by remaining durability.
 * A non-penetrating hit still deals blunt damage and chews through armour durability.
 */
export function penetrationChance(penetration: number, armor: ArmorStats, durability: number): number {
  const durFrac = Math.max(0, durability) / armor.durability;
  // Worn armour behaves as a lower class.
  const effective = armor.armorClass * 10 * (0.55 + 0.45 * durFrac);
  const diff = penetration - effective;
  return Math.min(0.97, Math.max(0.03, 0.5 + diff / 18));
}

/** Durability spent by a hit after taking the material into account. 0.5 was the original neutral wear rate. */
export function armorWear(baseDamage: number, armorItem: ItemInstance): number {
  return baseDamage * (ARMOR_MATERIALS[armorMaterial(getDef(armorItem.def))].wear / 0.5);
}

export function resolveBulletHit(
  rng: Rng,
  baseDamage: number,
  ammoDefId: string | undefined,
  zone: HitZone,
  armorItem: ItemInstance | null,
): DamageResult {
  const ammo = ammoDefId ? getDef(ammoDefId).ammo : undefined;
  const pen = ammo?.penetration ?? 15;
  const dmg = baseDamage * (ammo?.damageMul ?? 1) * ZONE_MULT[zone];
  const armor = armorItem ? getDef(armorItem.def).armor : undefined;
  if (!armor || !armorItem || (armorItem.dur ?? 0) <= 0) {
    return { damage: dmg, penetrated: true, armorDamage: 0, bleedChance: 0.4 };
  }
  const chance = penetrationChance(pen, armor, armorItem.dur ?? 0);
  const penetrated = rng.next() < chance;
  // What it's made of decides how fast it goes: aramid shrugs hits off, ceramic cracks (0.5 = the old flat rate).
  const armorDamage = armorWear((dmg * (penetrated ? 0.45 : 0.6) * Math.max(0.4, 1 - pen / 100 + 0.3)) / 2, armorItem);
  return {
    damage: penetrated ? dmg * (0.75 + 0.25 * chance) : dmg * 0.22,
    penetrated,
    armorDamage,
    bleedChance: penetrated ? 0.4 : 0,
  };
}

export function resolveMeleeHit(stats: MeleeStats, zone: HitZone, armorItem: ItemInstance | null): DamageResult {
  const armor = armorItem ? getDef(armorItem.def).armor : undefined;
  const raw = stats.damage * ZONE_MULT[zone];
  if (!armor || !armorItem || (armorItem.dur ?? 0) <= 0) {
    return { damage: raw, penetrated: true, armorDamage: 0, bleedChance: stats.bleedChance };
  }
  // Blades skate off plates, blunt force carries through.
  const absorbed = Math.min(0.9, armor.armorClass * 0.14 * ((armorItem.dur ?? 0) / armor.durability));
  const damage = raw * (stats.armorBypass + (1 - stats.armorBypass) * (1 - absorbed));
  return { damage, penetrated: false, armorDamage: armorWear(raw * 0.2, armorItem), bleedChance: stats.bleedChance * (1 - absorbed) };
}

export function armorFor(zone: HitZone, slots: { helmet: ItemInstance | null; armor: ItemInstance | null }): ItemInstance | null {
  // Each piece covers the parts it says it does (a plate carrier leaves the stomach open, heavy armour has
  // shoulder guards); the vest first, so a helmet with a neck guard never shadows it.
  // A plate in a carrier takes the hit first, where it covers and while it holds; then the carrier's soft armour.
  const plate = plateOf(slots.armor);
  if (plate && (plate.dur ?? 0) > 0 && armorZones(getDef(plate.def)).includes(zone)) return plate;
  for (const it of [slots.armor, slots.helmet]) if (it && armorZones(getDef(it.def)).includes(zone)) return it;
  return null;
}

/** Box–Muller normal sample, used for weapon spread so most shots land near the centre of the cone. */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
