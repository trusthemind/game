import { ALL_ITEMS, getDef, MOD_SLOTS, type ItemDef, type ModSlot, type Socket, type WeaponClass, type WeaponStats } from './defs';
import { createItem, type ItemInstance } from './inventory';

/** Which attachment slots each weapon class exposes (guns not built from parts). */
export const CLASS_SLOTS: Record<WeaponClass, readonly ModSlot[]> = {
  pistol: ['muzzle', 'scope', 'mag', 'light'],
  smg: ['muzzle', 'scope', 'grip', 'stock', 'mag', 'light'],
  rifle: ['muzzle', 'scope', 'grip', 'stock', 'mag', 'light'],
  shotgun: ['scope', 'grip', 'stock', 'mag', 'light'],
  marksman: ['muzzle', 'scope', 'stock', 'mag'],
  lmg: ['muzzle', 'scope', 'grip', 'mag', 'light'],
};

const SLOT_LABEL: Record<ModSlot, string> = {
  muzzle: 'Muzzle',
  scope: 'Sight',
  grip: 'Foregrip',
  stock: 'Stock',
  mag: 'Magazine',
  light: 'Tactical light',
  pgrip: 'Pistol grip',
  dustcover: 'Dust cover',
  gastube: 'Gas tube',
  handguard: 'Handguard',
  barrel: 'Barrel',
};

/** Is this gun built from parts (sockets and a part tree) rather than six fixed attachment slots? */
export const isModular = (weaponId: string) => !!getDef(weaponId).weapon?.sockets;

export function modSlotsFor(weaponId: string): readonly ModSlot[] {
  const w = getDef(weaponId).weapon;
  return w ? MOD_SLOTS.filter((s) => CLASS_SLOTS[w.cls].includes(s)) : [];
}

/** Sockets of a weapon or part. Older guns get one per attachment slot, keyed by the slot name. */
export function socketsOf(defId: string): Socket[] {
  const d = getDef(defId);
  if (d.weapon) return d.weapon.sockets ?? modSlotsFor(defId).map((slot) => ({ id: slot, label: SLOT_LABEL[slot], accepts: [], kinds: [slot] }));
  return d.mod?.sockets ?? [];
}

/** Does attachment `modId` fit an older gun `weaponId` (one without sockets)? */
export function modFits(modId: string, weaponId: string): boolean {
  const m = getDef(modId).mod;
  const w = getDef(weaponId).weapon;
  if (!m || !w || w.sockets || !CLASS_SLOTS[w.cls].includes(m.slot)) return false;
  // Parts made only for guns built from parts carry no caliber / class / id rules.
  if (m.mounts && !m.ids && !m.calibers && !m.classes) return false;
  if (m.ids) return m.ids.includes(weaponId);
  if (m.calibers && !m.calibers.includes(w.caliber)) return false;
  if (m.classes && !m.classes.includes(w.cls)) return false;
  return true;
}

/** Does part `partId` go into `socket` on `hostDef` (the gun or the part that carries the socket)? */
export function partFits(partId: string, socket: Socket, hostDef: string, gunDef: string): boolean {
  const m = getDef(partId).mod;
  if (!m) return false;
  if (socket.kinds && !socket.kinds.includes(m.slot)) return false;
  // Older gun: the socket is one of its attachment slots.
  if (hostDef === gunDef && !isModular(gunDef)) return socket.id === m.slot && modFits(partId, gunDef);
  // Mounts carry the calibre where it matters (an AK-74 thread or magazine well is 5.45 only).
  return !!m.mounts?.some((x) => socket.accepts.includes(x));
}

/** One socket somewhere in a gun's part tree: the path of socket ids to it, the item that has it, what's in it. */
export interface SocketRef {
  path: string[];
  socket: Socket;
  host: ItemInstance;
  part: ItemInstance | null;
}

/** Every socket in the tree, parents before children (a handguard's rails right after the handguard). */
export function socketTree(gun: ItemInstance): SocketRef[] {
  const out: SocketRef[] = [];
  const walk = (host: ItemInstance, path: string[]) => {
    for (const socket of socketsOf(host.def)) {
      const part = host.mods?.[socket.id] ?? null;
      const p = [...path, socket.id];
      out.push({ path: p, socket, host, part });
      if (part) walk(part, p);
    }
  };
  walk(gun, []);
  return out;
}

/** Every installed part, with its children (for weight, value, stats and rendering). */
export function allParts(item: ItemInstance): ItemInstance[] {
  const out: ItemInstance[] = [];
  const walk = (it: ItemInstance) => {
    for (const m of Object.values(it.mods ?? {}))
      if (m) {
        out.push(m);
        walk(m);
      }
  };
  walk(item);
  return out;
}

export interface EffectiveWeapon extends WeaponStats {
  /** Extra spread multiplier while aiming (optics). */
  aimSpreadMul: number;
  suppressed: boolean;
  zoom: number;
  light: boolean;
  ergo: number;
  /** Every required part is in (a gun without a barrel, gas tube or magazine doesn't fire). */
  operable: boolean;
}

const treeKey = (item: ItemInstance): string =>
  item.mods ? Object.entries(item.mods).map(([k, m]) => (m ? `${k}=${m.def}(${treeKey(m)})` : '')).join('|') : '';

const cache = new WeakMap<ItemInstance, { key: string; stats: EffectiveWeapon }>();

/** Base stats with every installed part applied. Cached per item until its parts change. */
export function effectiveWeapon(item: ItemInstance): EffectiveWeapon {
  const key = treeKey(item);
  const hit = cache.get(item);
  if (hit && hit.key === key) return hit.stats;
  const base = getDef(item.def).weapon!;
  const out: EffectiveWeapon = { ...base, aimSpreadMul: 1, suppressed: false, zoom: 1, light: false, ergo: 1, operable: true };
  for (const m of allParts(item)) {
    const s = getDef(m.def).mod;
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
  if (base.sockets) out.operable = socketTree(item).every((r) => !r.socket.required || r.part);
  cache.set(item, { key, stats: out });
  return out;
}

function hostAt(gun: ItemInstance, path: string[]): ItemInstance | null {
  let host: ItemInstance | undefined = gun;
  for (const id of path.slice(0, -1)) host = host?.mods?.[id];
  return host ?? null;
}

/**
 * Put `part` into the socket at `path` (socket ids from the gun down). Whatever was there comes off with
 * everything on it. Returns that, plus rounds unloaded because the magazine got smaller; false if it doesn't fit.
 */
export function installPart(gun: ItemInstance, path: string[], part: ItemInstance): { replaced: ItemInstance | null; unloaded: number } | false {
  const host = hostAt(gun, path);
  const socket = host && socketsOf(host.def).find((s) => s.id === path[path.length - 1]);
  if (!host || !socket || !partFits(part.def, socket, host.def, gun.def)) return false;
  host.mods ??= {};
  const replaced = host.mods[socket.id] ?? null;
  host.mods[socket.id] = part;
  return { replaced, unloaded: clampAmmo(gun) };
}

/** Take out the part at `path` (with everything on it). */
export function removePart(gun: ItemInstance, path: string[]): { part: ItemInstance | null; unloaded: number } {
  const host = hostAt(gun, path);
  const id = path[path.length - 1]!;
  const part = host?.mods?.[id] ?? null;
  if (host?.mods) delete host.mods[id];
  return { part, unloaded: part ? clampAmmo(gun) : 0 };
}

/** Where `part` would go on `gun`: the first socket that takes it, an empty one if there is one. */
export function socketFor(gun: ItemInstance, partId: string): string[] | null {
  const fits = socketTree(gun).filter((r) => partFits(partId, r.socket, r.host.def, gun.def));
  return (fits.find((r) => !r.part) ?? fits[0])?.path ?? null;
}

/**
 * Install `mod` wherever it fits. Returns the part it replaced (null if the socket was empty) plus rounds
 * unloaded because a smaller magazine went in, or false if it fits nowhere.
 */
export function installMod(weapon: ItemInstance, mod: ItemInstance): { replaced: ItemInstance | null; unloaded: number } | false {
  const path = socketFor(weapon, mod.def);
  return path ? installPart(weapon, path, mod) : false;
}

/** Remove the attachment in a top-level socket (an older gun's slot). */
export function removeMod(weapon: ItemInstance, slot: string): { mod: ItemInstance | null; unloaded: number } {
  const { part, unloaded } = removePart(weapon, [slot]);
  return { mod: part, unloaded };
}

/** Parts of the catalogue that fit some socket of this gun as it is assembled now. */
export function partsFitting(gun: ItemInstance): ItemDef[] {
  const tree = socketTree(gun);
  return ALL_ITEMS.filter((d) => d.mod && tree.some((r) => partFits(d.id, r.socket, r.host.def, gun.def)));
}

function clampAmmo(weapon: ItemInstance): number {
  const cap = effectiveWeapon(weapon).magSize;
  const extra = Math.max(0, (weapon.ammo ?? 0) - cap);
  if (extra) weapon.ammo = cap;
  return extra;
}

/**
 * Bring a gun from before part trees up to date (profile v5): a modular gun gets its factory parts, then its
 * old attachments go where they fit. One that needs a rail the factory parts lack swaps in a railed part
 * (B-19 / FAB on an AK, quad rail on an M4). Returns attachments that fit nowhere.
 */
export function upgradeLegacyGun(gun: ItemInstance): ItemInstance[] {
  // Already a part tree (a socket other than the old attachment slots is filled): nothing to do.
  if (!isModular(gun.def) || Object.keys(gun.mods ?? {}).some((k) => !(MOD_SLOTS as readonly string[]).includes(k))) return [];
  const old = Object.values(gun.mods ?? {}).filter((m): m is ItemInstance => !!m);
  const fresh = createItem(gun.def);
  gun.mods = fresh.mods;
  const railed = RAILED[gun.def] ?? [];
  const left: ItemInstance[] = [];
  for (const m of old) {
    if (installMod(gun, m)) continue;
    let placed = false;
    for (const [path, id] of railed) {
      if (socketTree(gun).some((r) => r.path.join('/') === path.join('/') && r.part?.def === id)) continue;
      installPart(gun, path, createItem(id));
      if (installMod(gun, m)) {
        placed = true;
        break;
      }
    }
    if (!placed) left.push(m);
  }
  clampAmmo(gun);
  return left;
}

/** Railed parts that make room for older sights, grips and lights on a modular gun. */
const RAILED: Record<string, [string[], string][]> = {
  ak74m: [
    [['gastube'], 'ak_gt_b19'],
    [['handguard'], 'ak_hg_fab'],
  ],
  akm: [
    [['gastube'], 'ak_gt_b19'],
    [['handguard'], 'ak_hg_fab'],
  ],
  m4a1: [[['handguard'], 'ar_hg_ris']],
};
