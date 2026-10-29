import type { Rng } from '../core/rng';
import type { ArmorStats, MeleeStats } from '../items/defs';
import type { ItemInstance } from '../items/inventory';
import { getDef } from '../items/defs';
import type { HitZone } from './types';

export const ZONE_WEIGHTS: readonly (readonly [HitZone, number])[] = [
  ['head', 0.12],
  ['thorax', 0.5],
  ['limbs', 0.38],
];
export const ZONE_MULT: Record<HitZone, number> = { head: 2.1, thorax: 1, limbs: 0.65 };

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
    return { damage: dmg, penetrated: true, armorDamage: 0, bleedChance: zone === 'limbs' ? 0.35 : 0.25 };
  }
  const chance = penetrationChance(pen, armor, armorItem.dur ?? 0);
  const penetrated = rng.next() < chance;
  const armorDamage = (dmg * (penetrated ? 0.45 : 0.6) * Math.max(0.4, 1 - pen / 100 + 0.3)) / 2;
  return {
    damage: penetrated ? dmg * (0.75 + 0.25 * chance) : dmg * 0.22,
    penetrated,
    armorDamage,
    bleedChance: penetrated ? 0.3 : 0,
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
  return { damage, penetrated: false, armorDamage: raw * 0.2, bleedChance: stats.bleedChance * (1 - absorbed) };
}

export function armorFor(zone: HitZone, slots: { helmet: ItemInstance | null; armor: ItemInstance | null }): ItemInstance | null {
  if (zone === 'head') return slots.helmet;
  if (zone === 'thorax') return slots.armor;
  return null;
}

/** Box–Muller normal sample, used for weapon spread so most shots land near the centre of the cone. */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
