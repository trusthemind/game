import { intelDiscount } from './hideout';
import { ALL_ITEMS, getDef, type ItemDef } from './items/defs';
import { addItem, createItem, itemValue, type ItemInstance } from './items/inventory';
import { levelFromXp, type Profile } from './profile';

/** Trader discount from Vera's affinity: up to 15%. */
export function traderDiscount(profile: Profile): number {
  const a = profile.npcs.vera?.affinity ?? 0;
  const rel = Math.max(0, Math.min(0.15, a / 400 + (profile.npcs.vera?.flags.includes('q_intel_done') ? 0.05 : 0)));
  return Math.min(0.25, rel + intelDiscount(profile));
}

export function buyPrice(def: ItemDef, profile: Profile, stack = 1): number {
  return Math.round(def.value * 1.3 * (1 - traderDiscount(profile))) * stack;
}

export function sellPrice(item: ItemInstance, profile: Profile): number {
  if (getDef(item.def).category === 'money') return item.stack;
  return Math.round(itemValue(item) * (0.55 + traderDiscount(profile) / 2));
}

/** What the trader offers: unlocks by player level, high-end gear never sold (must be looted). */
export function traderCatalog(profile: Profile): { def: ItemDef; stack: number; minLevel: number }[] {
  const level = levelFromXp(profile.xp).level;
  return ALL_ITEMS.filter((d) => d.category !== 'money' && d.category !== 'valuable' && d.category !== 'junk' && d.rarity <= 4)
    .map((def) => ({ def, stack: def.category === 'ammo' ? Math.min(def.stackMax ?? 30, 30) : 1, minLevel: Math.max(1, (def.rarity - 1) * 2) }))
    .filter((e) => e.minLevel <= level + 2)
    .sort((a, b) => a.def.category.localeCompare(b.def.category) || a.def.value - b.def.value);
}

export function buy(profile: Profile, defId: string, stack = 1): { ok: boolean; reason?: string } {
  const def = getDef(defId);
  const price = buyPrice(def, profile, stack);
  if (profile.money < price) return { ok: false, reason: 'Not enough credits' };
  const item = createItem(defId, { stack });
  if (def.weapon) {
    item.ammo = 0;
  }
  if (!addItem(profile.stash, item)) return { ok: false, reason: 'Stash is full' };
  profile.money -= price;
  return { ok: true };
}
