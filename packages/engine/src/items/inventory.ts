import { getDef, type Caliber, type ItemDef } from './defs';

/** A concrete item. Containers (rigs, backpacks) carry their own grid, so dropping a backpack keeps its contents. */
export interface ItemInstance {
  uid: string;
  def: string;
  stack: number;
  rot?: boolean;
  /** Armor/helmet durability points. */
  dur?: number;
  /** Rounds loaded in a weapon. */
  ammo?: number;
  /** Def id of the loaded ammo type. */
  ammoType?: string;
  grid?: GridContainer;
  /** Remaining uses (bandages, painkillers…) or HP resource (medkits). */
  uses?: number;
  /** Found in raid. */
  fir?: boolean;
}

export interface Placed {
  item: ItemInstance;
  x: number;
  y: number;
}

export interface GridContainer {
  w: number;
  h: number;
  items: Placed[];
  /** The stash is the only grid that may hold rigs/backpacks that still have things inside. */
  stash?: boolean;
}

export type Slot = 'primary' | 'secondary' | 'melee' | 'helmet' | 'armor' | 'rig' | 'backpack';
export const SLOTS: readonly Slot[] = ['primary', 'secondary', 'melee', 'helmet', 'armor', 'rig', 'backpack'];

export interface Equipment {
  slots: Record<Slot, ItemInstance | null>;
  pockets: GridContainer;
}

let uidCounter = 0;
const uidSalt = Math.floor(Math.random() * 0xffffff).toString(36);
export const newUid = () => `${uidSalt}${(uidCounter++).toString(36)}`;

export const createGrid = (w: number, h: number, stash = false): GridContainer => (stash ? { w, h, items: [], stash } : { w, h, items: [] });

export function createItem(defId: string, opts: Partial<Omit<ItemInstance, 'def' | 'uid'>> = {}): ItemInstance {
  const def = getDef(defId);
  const item: ItemInstance = { uid: newUid(), def: defId, stack: 1, ...opts };
  if (def.armor && item.dur === undefined) item.dur = def.armor.durability;
  if (def.grid && !item.grid) item.grid = createGrid(def.grid.w, def.grid.h);
  if (def.weapon && item.ammo === undefined) item.ammo = 0;
  if (def.med && item.uses === undefined) item.uses = def.med.resource || def.med.uses;
  if (def.stackMax) item.stack = Math.min(Math.max(1, item.stack), def.stackMax);
  return item;
}

export function createEquipment(): Equipment {
  return {
    slots: { primary: null, secondary: null, melee: null, helmet: null, armor: null, rig: null, backpack: null },
    pockets: createGrid(4, 1),
  };
}

export function footprint(item: ItemInstance, rot = !!item.rot): { w: number; h: number } {
  const d = getDef(item.def);
  return rot ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export function canPlace(grid: GridContainer, item: ItemInstance, x: number, y: number, rot: boolean, ignoreUid = item.uid): boolean {
  const { w, h } = footprint(item, rot);
  if (x < 0 || y < 0 || x + w > grid.w || y + h > grid.h) return false;
  if (!grid.stash && item.grid && item.grid.items.length > 0) return false;
  for (const p of grid.items) {
    if (p.item.uid === ignoreUid) continue;
    const f = footprint(p.item);
    if (x < p.x + f.w && x + w > p.x && y < p.y + f.h && y + h > p.y) return false;
  }
  return true;
}

export function itemAt(grid: GridContainer, x: number, y: number): Placed | null {
  for (const p of grid.items) {
    const f = footprint(p.item);
    if (x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h) return p;
  }
  return null;
}

export function findPlaced(grid: GridContainer, uid: string): Placed | null {
  return grid.items.find((p) => p.item.uid === uid) ?? null;
}

export function findSpot(grid: GridContainer, item: ItemInstance): { x: number; y: number; rot: boolean } | null {
  const d = getDef(item.def);
  const rots = d.w === d.h ? [false] : [!!item.rot, !item.rot];
  for (const rot of rots) {
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (canPlace(grid, item, x, y, rot)) return { x, y, rot };
      }
    }
  }
  return null;
}

export function placeAt(grid: GridContainer, item: ItemInstance, x: number, y: number, rot: boolean): boolean {
  if (!canPlace(grid, item, x, y, rot)) return false;
  item.rot = rot || undefined;
  grid.items.push({ item, x, y });
  return true;
}

/** Merge into existing stacks first, then place leftovers. Returns true when the whole item ended up in the grid. */
export function addItem(grid: GridContainer, item: ItemInstance): boolean {
  const def = getDef(item.def);
  if (def.stackMax) {
    for (const p of grid.items) {
      if (item.stack <= 0) break;
      if (p.item.def !== item.def || p.item.stack >= def.stackMax) continue;
      const moved = Math.min(def.stackMax - p.item.stack, item.stack);
      p.item.stack += moved;
      item.stack -= moved;
    }
    if (item.stack <= 0) return true;
  }
  const spot = findSpot(grid, item);
  if (!spot) return false;
  return placeAt(grid, item, spot.x, spot.y, spot.rot);
}

export function removeItem(grid: GridContainer, uid: string): Placed | null {
  const i = grid.items.findIndex((p) => p.item.uid === uid);
  if (i < 0) return null;
  return grid.items.splice(i, 1)[0]!;
}

export function slotAccepts(slot: Slot, def: ItemDef): boolean {
  switch (slot) {
    case 'primary':
      return def.category === 'weapon' && (def.w >= 3 || def.h >= 2);
    case 'secondary':
      return def.category === 'weapon';
    case 'melee':
      return def.category === 'melee';
    case 'helmet':
      return def.category === 'helmet';
    case 'armor':
      return def.category === 'armor';
    case 'rig':
      return def.category === 'rig';
    case 'backpack':
      return def.category === 'backpack';
  }
}

/** Grids the owner can carry loot in, in the order loot should be auto-placed. */
export function carryGrids(eq: Equipment): GridContainer[] {
  const out = [eq.pockets];
  if (eq.slots.rig?.grid) out.push(eq.slots.rig.grid);
  if (eq.slots.backpack?.grid) out.push(eq.slots.backpack.grid);
  return out;
}

export function itemWeight(item: ItemInstance): number {
  const d = getDef(item.def);
  let w = d.weight * (d.stackMax ? item.stack : 1);
  if (item.grid) for (const p of item.grid.items) w += itemWeight(p.item);
  return w;
}

export function gridWeight(grid: GridContainer): number {
  let w = 0;
  for (const p of grid.items) w += itemWeight(p.item);
  return w;
}

export function equipmentWeight(eq: Equipment): number {
  let w = gridWeight(eq.pockets);
  for (const s of SLOTS) {
    const it = eq.slots[s];
    if (it) w += itemWeight(it);
  }
  return w;
}

export function itemValue(item: ItemInstance): number {
  const d = getDef(item.def);
  let v = d.value * (d.stackMax ? item.stack : 1);
  if (d.armor && item.dur !== undefined) v *= 0.35 + 0.65 * (item.dur / d.armor.durability);
  if (item.grid) for (const p of item.grid.items) v += itemValue(p.item);
  return Math.round(v);
}

export function equipmentValue(eq: Equipment): number {
  let v = 0;
  for (const p of eq.pockets.items) v += itemValue(p.item);
  for (const s of SLOTS) {
    const it = eq.slots[s];
    if (it) v += itemValue(it);
  }
  return v;
}

export function countAmmo(eq: Equipment, caliber: Caliber): number {
  let n = 0;
  for (const g of carryGrids(eq))
    for (const p of g.items) if (getDef(p.item.def).ammo?.caliber === caliber) n += p.item.stack;
  return n;
}

/**
 * Pull up to `amount` rounds of a caliber out of carried grids. Prefers `preferType`, then highest penetration.
 * Returns the number taken and the ammo type used (only one type per reload, like a real magazine).
 */
export function takeAmmo(eq: Equipment, caliber: Caliber, amount: number, preferType?: string): { taken: number; type: string | null } {
  const grids = carryGrids(eq);
  const candidates: { grid: GridContainer; p: Placed; pen: number }[] = [];
  for (const g of grids)
    for (const p of g.items) {
      const a = getDef(p.item.def).ammo;
      if (a?.caliber === caliber) candidates.push({ grid: g, p, pen: a.penetration });
    }
  if (candidates.length === 0) return { taken: 0, type: null };
  const type =
    preferType && candidates.some((c) => c.p.item.def === preferType)
      ? preferType
      : candidates.sort((a, b) => b.pen - a.pen)[0]!.p.item.def;
  let taken = 0;
  for (const c of candidates) {
    if (c.p.item.def !== type || taken >= amount) continue;
    const n = Math.min(c.p.item.stack, amount - taken);
    c.p.item.stack -= n;
    taken += n;
    if (c.p.item.stack <= 0) removeItem(c.grid, c.p.item.uid);
  }
  return { taken, type };
}

/** True if `grid` is `item`'s own grid or nested anywhere inside it (prevents putting a backpack inside itself). */
export function containsGrid(item: ItemInstance, grid: GridContainer): boolean {
  if (!item.grid) return false;
  if (item.grid === grid) return true;
  return item.grid.items.some((p) => containsGrid(p.item, grid));
}

// ── Transfers ────────────────────────────────────────────────────────────────

export type ItemSource = { kind: 'grid'; grid: GridContainer; uid: string } | { kind: 'slot'; eq: Equipment; slot: Slot };
export type ItemTarget = { kind: 'grid'; grid: GridContainer; x: number; y: number; rot: boolean } | { kind: 'slot'; eq: Equipment; slot: Slot };

export function peekSource(src: ItemSource): ItemInstance | null {
  return src.kind === 'grid' ? (findPlaced(src.grid, src.uid)?.item ?? null) : src.eq.slots[src.slot];
}

function detach(src: ItemSource): { item: ItemInstance; restore: () => void } | null {
  if (src.kind === 'grid') {
    const p = removeItem(src.grid, src.uid);
    if (!p) return null;
    const rot = p.item.rot;
    return { item: p.item, restore: () => (p.item.rot = rot, src.grid.items.push(p)) };
  }
  const item = src.eq.slots[src.slot];
  if (!item) return null;
  src.eq.slots[src.slot] = null;
  return { item, restore: () => (src.eq.slots[src.slot] = item) };
}

/** Validate a move without performing it (used to colour drag previews). */
export function canMove(src: ItemSource, dst: ItemTarget): boolean {
  const item = peekSource(src);
  if (!item) return false;
  if (dst.kind === 'slot') return !dst.eq.slots[dst.slot] && slotAccepts(dst.slot, getDef(item.def));
  if (containsGrid(item, dst.grid)) return false;
  const under = itemAt(dst.grid, dst.x, dst.y);
  if (under && under.item.uid !== item.uid && under.item.def === item.def && getDef(item.def).stackMax) {
    return under.item.stack < getDef(item.def).stackMax!;
  }
  return canPlace(dst.grid, item, dst.x, dst.y, dst.rot);
}

/** Move an item between grids and equipment slots. Merges stacks when dropped on the same stackable item. */
export function moveItem(src: ItemSource, dst: ItemTarget): boolean {
  if (!canMove(src, dst)) return false;
  const item = peekSource(src)!;
  if (dst.kind === 'grid') {
    const under = itemAt(dst.grid, dst.x, dst.y);
    const max = getDef(item.def).stackMax;
    if (under && under.item.uid !== item.uid && under.item.def === item.def && max) {
      const moved = Math.min(max - under.item.stack, item.stack);
      under.item.stack += moved;
      item.stack -= moved;
      if (item.stack <= 0) detach(src);
      return true;
    }
  }
  const d = detach(src)!;
  if (dst.kind === 'slot') {
    d.item.rot = undefined;
    dst.eq.slots[dst.slot] = d.item;
    return true;
  }
  if (placeAt(dst.grid, d.item, dst.x, dst.y, dst.rot)) return true;
  d.restore();
  return false;
}

/** Shift-click style transfer: first grid in `targets` with room wins. Equipment slots are tried when `eq` is given. */
export function quickMove(src: ItemSource, targets: GridContainer[], eq?: Equipment): boolean {
  const item = peekSource(src);
  if (!item) return false;
  if (eq && src.kind === 'grid') {
    const def = getDef(item.def);
    for (const s of SLOTS) if (!eq.slots[s] && slotAccepts(s, def)) return moveItem(src, { kind: 'slot', eq, slot: s });
  }
  for (const g of targets) {
    if (src.kind === 'grid' && g === src.grid) continue;
    if (containsGrid(item, g)) continue;
    const d = detach(src);
    if (!d) return false;
    if (addItem(g, d.item)) return true;
    // Partial stack merges leave a remainder; put it back where it came from.
    d.restore();
  }
  return false;
}

export function cloneDeep<T>(v: T): T {
  return structuredClone(v);
}

/** Every item carried in `eq`: slot items, grid items, and items nested inside containers (depth-first). */
export function allItems(eq: Equipment, out: ItemInstance[] = []): ItemInstance[] {
  const walkGrid = (g: GridContainer) => {
    for (const p of g.items) {
      out.push(p.item);
      if (p.item.grid) walkGrid(p.item.grid);
    }
  };
  for (const s of SLOTS) {
    const it = eq.slots[s];
    if (!it) continue;
    out.push(it);
    if (it.grid) walkGrid(it.grid);
  }
  walkGrid(eq.pockets);
  return out;
}
