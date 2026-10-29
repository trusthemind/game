import { getDef, MOD_SLOTS, type ModSlot, type WeaponClass, type WeaponStats } from './defs';
import type { ItemInstance } from './inventory';

/** Which attachment slots each weapon class exposes. */
export const CLASS_SLOTS: Record<WeaponClass, readonly ModSlot[]> = {
  pistol: ['muzzle', 'scope', 'mag', 'light'],
  smg: ['muzzle', 'scope', 'grip', 'stock', 'mag', 'light'],
  rifle: ['muzzle', 'scope', 'grip', 'stock', 'mag', 'light'],
  shotgun: ['scope', 'grip', 'stock', 'mag', 'light'],
  marksman: ['muzzle', 'scope', 'stock', 'mag'],
  lmg: ['muzzle', 'scope', 'grip', 'mag', 'light'],
};

export function modSlotsFor(weaponId: string): readonly ModSlot[] {
  const w = getDef(weaponId).weapon;
  return w ? MOD_SLOTS.filter((s) => CLASS_SLOTS[w.cls].includes(s)) : [];
}

/** Does attachment `modId` fit weapon `weaponId`? */
export function modFits(modId: string, weaponId: string): boolean {
  const m = getDef(modId).mod;
  const w = getDef(weaponId).weapon;
  if (!m || !w || !CLASS_SLOTS[w.cls].includes(m.slot)) return false;
  if (m.ids) return m.ids.includes(weaponId);
  if (m.calibers && !m.calibers.includes(w.caliber)) return false;
  if (m.classes && !m.classes.includes(w.cls)) return false;
  return true;
}

export interface EffectiveWeapon extends WeaponStats {
  /** Extra spread multiplier while aiming (optics). */
  aimSpreadMul: number;
  suppressed: boolean;
  zoom: number;
  light: boolean;
  ergo: number;
}

const cache = new WeakMap<ItemInstance, { key: string; stats: EffectiveWeapon }>();

/** Base stats with every installed attachment applied. Cached per item until its mods change. */
export function effectiveWeapon(item: ItemInstance): EffectiveWeapon {
  const key = item.mods ? Object.values(item.mods).map((m) => m?.def ?? '').join('|') : '';
  const hit = cache.get(item);
  if (hit && hit.key === key) return hit.stats;
  const base = getDef(item.def).weapon!;
  const out: EffectiveWeapon = { ...base, aimSpreadMul: 1, suppressed: false, zoom: 1, light: false, ergo: 1 };
  for (const m of Object.values(item.mods ?? {})) {
    const s = m && getDef(m.def).mod;
    if (!s) continue;
    if (s.spreadMul) out.spread *= s.spreadMul;
    if (s.aimSpreadMul) out.aimSpreadMul *= s.aimSpreadMul;
    if (s.recoilMul) out.recoil *= s.recoilMul;
    if (s.noiseMul) out.noise *= s.noiseMul;
    if (s.rangeMul) out.range *= s.rangeMul;
    if (s.reloadMul) out.reloadTime *= s.reloadMul;
    if (s.magSize) out.magSize = s.magSize;
    if (s.suppressed) out.suppressed = true;
    if (s.zoom) out.zoom = Math.max(out.zoom, s.zoom);
    if (s.light) out.light = true;
    if (s.ergo) out.ergo *= s.ergo;
  }
  cache.set(item, { key, stats: out });
  return out;
}

/**
 * Install `mod` on `weapon`. Returns the attachment it replaced (null if the slot was empty) plus rounds
 * unloaded because a smaller magazine went in, or false if it doesn't fit.
 */
export function installMod(weapon: ItemInstance, mod: ItemInstance): { replaced: ItemInstance | null; unloaded: number } | false {
  const m = getDef(mod.def).mod;
  if (!m || !modFits(mod.def, weapon.def)) return false;
  weapon.mods ??= {};
  const replaced = weapon.mods[m.slot] ?? null;
  weapon.mods[m.slot] = mod;
  return { replaced, unloaded: clampAmmo(weapon) };
}

/** Remove the attachment in `slot`. Returns it plus any rounds that no longer fit the magazine. */
export function removeMod(weapon: ItemInstance, slot: ModSlot): { mod: ItemInstance | null; unloaded: number } {
  const mod = weapon.mods?.[slot] ?? null;
  if (weapon.mods) delete weapon.mods[slot];
  return { mod, unloaded: mod ? clampAmmo(weapon) : 0 };
}

function clampAmmo(weapon: ItemInstance): number {
  const cap = effectiveWeapon(weapon).magSize;
  const extra = Math.max(0, (weapon.ammo ?? 0) - cap);
  if (extra) weapon.ammo = cap;
  return extra;
}
