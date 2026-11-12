import { getDef, type Caliber, type Category, type ItemDef, type Preset } from './defs';

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
  /**
   * Installed parts by socket id. A part can carry parts of its own (a handguard's foregrip), so a gun built
   * from parts is a tree; older guns use the attachment slot names (muzzle, scope, …) as socket ids.
   */
  mods?: Partial<Record<string, ItemInstance>>;
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
  /** Secure container grid: no containers inside it. */
  secure?: boolean;
}

export type Slot = 'primary' | 'secondary' | 'melee' | 'helmet' | 'armor' | 'rig' | 'backpack' | 'secure' | 'hat' | 'top' | 'pants' | 'boots';
export const SLOTS: readonly Slot[] = ['primary', 'secondary', 'melee', 'helmet', 'armor', 'rig', 'backpack', 'secure', 'hat', 'top', 'pants', 'boots'];
export const CLOTHING_SLOTS = ['hat', 'top', 'pants', 'boots'] as const;

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
  // A plate carrier leaves the factory with its plate in.
  if (def.armor?.plate && !opts.mods) item.mods = { plate: createItem(def.armor.plate, opts.fir ? { fir: true } : {}) };
  if (def.grid && !item.grid) item.grid = createGrid(def.grid.w, def.grid.h);
  if (def.category === 'secure' && item.grid) item.grid.secure = true;
  if (def.weapon && item.ammo === undefined) item.ammo = 0;
  // Guns and parts built from parts leave the factory with their parts in.
  const preset = def.weapon?.preset ?? def.mod?.preset;
  if (preset && !opts.mods) item.mods = presetParts(preset);
  if (def.med && item.uses === undefined) item.uses = def.med.resource || def.med.uses;
  if (def.stackMax) item.stack = Math.min(Math.max(1, item.stack), def.stackMax);
  return item;
}

function presetParts(preset: Preset): Partial<Record<string, ItemInstance>> {
  const out: Partial<Record<string, ItemInstance>> = {};
  for (const [socket, p] of Object.entries(preset)) {
    const [id, sub] = typeof p === 'string' ? [p, undefined] : p;
    out[socket] = createItem(id, sub ? { mods: presetParts(sub) } : {});
  }
  return out;
}

/** Weight and value of a def's factory parts: a gun's def lists the complete gun, its receiver is the rest. */
const presetTotals = new Map<string, { weight: number; value: number }>();
function factoryParts(d: ItemDef): { weight: number; value: number } {
  // A carrier's listed weight and price include its factory plate.
  if (d.armor?.plate) return { weight: getDef(d.armor.plate).weight, value: getDef(d.armor.plate).value };
  const preset = d.weapon?.preset ?? d.mod?.preset;
  if (!preset || !d.weapon) return { weight: 0, value: 0 };
  let t = presetTotals.get(d.id);
  if (!t) {
    t = { weight: 0, value: 0 };
    const add = (p: Preset) => {
      for (const v of Object.values(p)) {
        const [id, sub] = typeof v === 'string' ? [v, undefined] : v;
        t!.weight += getDef(id).weight;
        t!.value += getDef(id).value;
        if (sub) add(sub);
      }
    };
    add(preset);
    presetTotals.set(d.id, t);
  }
  return t;
}

export function createEquipment(): Equipment {
  return {
    slots: { primary: null, secondary: null, melee: null, helmet: null, armor: null, rig: null, backpack: null, secure: null, hat: null, top: null, pants: null, boots: null },
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
  if (grid.secure && (item.grid || getDef(item.def).category === 'secure')) return false;
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

/** The sort button's order: what you reach for first at the top. */
const SORT_ORDER: readonly Category[] = ['weapon', 'melee', 'mod', 'ammo', 'armor', 'helmet', 'rig', 'backpack', 'secure', 'clothing', 'med', 'food', 'drink', 'valuable', 'junk', 'money'];

/**
 * Tidy a grid: top up part-stacks of the same thing, then lay everything out again from the top left, grouped by
 * kind in SORT_ORDER, the biggest first within a kind (then by name), each lying wide if it fits that way. When
 * that layout doesn't fit (a grid packed tight by hand), it packs by size alone; when nothing fits, the grid
 * stays as it was. Returns whether anything changed.
 */
export function sortGrid(grid: GridContainer): boolean {
  const before = grid.items.map((p) => `${p.item.uid}:${p.x}:${p.y}:${!!p.item.rot}:${p.item.stack}`).join();
  const stacks = grid.items.map((p) => p.item.stack);
  const items = mergeStacks(grid.items.map((p) => p.item));
  const area = (it: ItemInstance) => getDef(it.def).w * getDef(it.def).h;
  const byKind = (a: ItemInstance, b: ItemInstance) =>
    SORT_ORDER.indexOf(getDef(a.def).category) - SORT_ORDER.indexOf(getDef(b.def).category) ||
    area(b) - area(a) ||
    getDef(a.def).name.localeCompare(getDef(b.def).name) ||
    b.stack - a.stack;
  const bySize = (a: ItemInstance, b: ItemInstance) => area(b) - area(a) || byKind(a, b);
  for (const order of [byKind, bySize]) {
    const plan = pack(grid.w, grid.h, [...items].sort(order));
    if (!plan) continue;
    grid.items = plan.map(({ item, x, y, rot }) => {
      item.rot = rot || undefined;
      return { item, x, y };
    });
    return grid.items.map((p) => `${p.item.uid}:${p.x}:${p.y}:${!!p.item.rot}:${p.item.stack}`).join() !== before;
  }
  grid.items.forEach((p, i) => (p.item.stack = stacks[i]!));
  return false;
}

/** Fill part-stacks from others of the same thing (found-in-raid ones only with each other); emptied ones go. */
function mergeStacks(items: ItemInstance[]): ItemInstance[] {
  const out: ItemInstance[] = [];
  for (const it of items) {
    const max = getDef(it.def).stackMax;
    if (max)
      for (const o of out) {
        if (it.stack <= 0) break;
        if (o.def !== it.def || !!o.fir !== !!it.fir || o.stack >= max) continue;
        const n = Math.min(max - o.stack, it.stack);
        o.stack += n;
        it.stack -= n;
      }
    if (!max || it.stack > 0) out.push(it);
  }
  return out;
}

/** First fit, row by row from the top left, wide side first. Null when something doesn't fit. */
function pack(w: number, h: number, items: ItemInstance[]): { item: ItemInstance; x: number; y: number; rot: boolean }[] | null {
  const used = new Uint8Array(w * h);
  const free = (x: number, y: number, fw: number, fh: number) => {
    if (x + fw > w || y + fh > h) return false;
    for (let j = y; j < y + fh; j++) for (let i = x; i < x + fw; i++) if (used[j * w + i]) return false;
    return true;
  };
  const out: { item: ItemInstance; x: number; y: number; rot: boolean }[] = [];
  for (const item of items) {
    const d = getDef(item.def);
    const rots = d.w === d.h ? [false] : d.w > d.h ? [false, true] : [true, false];
    let spot: { x: number; y: number; rot: boolean } | null = null;
    for (let y = 0; y < h && !spot; y++)
      for (let x = 0; x < w && !spot; x++)
        for (const rot of rots) {
          const f = footprint(item, rot);
          if (free(x, y, f.w, f.h)) {
            spot = { x, y, rot };
            break;
          }
        }
    if (!spot) return null;
    const f = footprint(item, spot.rot);
    for (let j = spot.y; j < spot.y + f.h; j++) used.fill(1, j * w + spot.x, j * w + spot.x + f.w);
    out.push({ item, ...spot });
  }
  return out;
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
    case 'secure':
      return def.category === 'secure';
    case 'hat':
    case 'top':
    case 'pants':
    case 'boots':
      return def.clothing?.slot === slot;
  }
}

/** Grids the owner can carry loot in, in the order loot should be auto-placed. */
export function carryGrids(eq: Equipment): GridContainer[] {
  const out = [eq.pockets];
  if (eq.slots.rig?.grid) out.push(eq.slots.rig.grid);
  if (eq.slots.backpack?.grid) out.push(eq.slots.backpack.grid);
  if (eq.slots.secure?.grid) out.push(eq.slots.secure.grid);
  return out;
}

export function itemWeight(item: ItemInstance): number {
  const d = getDef(item.def);
  let w = (d.weight - factoryParts(d).weight) * (d.stackMax ? item.stack : 1);
  if (item.grid) for (const p of item.grid.items) w += itemWeight(p.item);
  for (const m of Object.values(item.mods ?? {})) if (m) w += itemWeight(m);
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
  let v = (d.value - factoryParts(d).value) * (d.stackMax ? item.stack : 1);
  if (d.armor && item.dur !== undefined) v *= 0.35 + 0.65 * (item.dur / d.armor.durability);
  if (item.grid) for (const p of item.grid.items) v += itemValue(p.item);
  for (const m of Object.values(item.mods ?? {})) if (m) v += itemValue(m);
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

/**
 * Shift-click style transfer. Stackables first top up existing stacks across all `targets` (in order), then the
 * rest goes to the first grid in `targets` with room. Equipment slots are tried first when `eq` is given.
 * Returns true when anything moved; a remainder that fits nowhere stays where it was (nothing is ever lost).
 */
export function quickMove(src: ItemSource, targets: GridContainer[], eq?: Equipment): boolean {
  const item = peekSource(src);
  if (!item) return false;
  if (eq && src.kind === 'grid') {
    const def = getDef(item.def);
    for (const s of SLOTS) if (!eq.slots[s] && slotAccepts(s, def)) return moveItem(src, { kind: 'slot', eq, slot: s });
  }
  const grids = targets.filter((g) => !(src.kind === 'grid' && g === src.grid) && !containsGrid(item, g));
  const max = getDef(item.def).stackMax;
  let moved = false;
  if (max) {
    for (const g of grids)
      for (const p of g.items) {
        if (item.stack <= 0) break;
        if (p.item.uid === item.uid || p.item.def !== item.def || p.item.stack >= max) continue;
        const n = Math.min(max - p.item.stack, item.stack);
        p.item.stack += n;
        item.stack -= n;
        moved = true;
      }
    if (item.stack <= 0) {
      detach(src);
      return true;
    }
  }
  for (const g of grids) {
    const spot = findSpot(g, item);
    if (!spot) continue;
    const d = detach(src);
    if (!d) return moved;
    if (placeAt(g, d.item, spot.x, spot.y, spot.rot)) return true;
    d.restore();
  }
  return moved;
}

// ── One-click moves between the player's own containers ─────────────────────

export type CarryPart = 'pockets' | 'rig' | 'backpack' | 'secure';

/** A carried grid by name (null when that container isn't worn). */
export function carryGrid(eq: Equipment, part: CarryPart): GridContainer | null {
  if (part === 'pockets') return eq.pockets;
  return eq.slots[part]?.grid ?? null;
}

/** Things that belong in a rig's quick-access pouches. */
const RIG_FIRST: readonly Category[] = ['ammo', 'med', 'food', 'drink'];

/**
 * Where a one-click move sends an item from one of the player's own containers, best first:
 * rig → backpack, pockets · backpack → rig (ammo/meds/food) or pockets, then secure · pockets → rig, backpack,
 * secure · secure → pockets, backpack, rig.
 */
export function ownMoveOrder(from: CarryPart, def: ItemDef): CarryPart[] {
  switch (from) {
    case 'rig':
      return ['backpack', 'pockets'];
    case 'backpack':
      return RIG_FIRST.includes(def.category) ? ['rig', 'pockets', 'secure'] : ['pockets', 'rig', 'secure'];
    case 'pockets':
      return ['rig', 'backpack', 'secure'];
    case 'secure':
      return ['pockets', 'backpack', 'rig'];
  }
}

/** Move an item in the player's own `from` container to the next sensible own container (merging stacks first). */
export function quickMoveOwn(eq: Equipment, from: CarryPart, uid: string): boolean {
  const grid = carryGrid(eq, from);
  const item = grid && findPlaced(grid, uid)?.item;
  if (!grid || !item) return false;
  const targets = ownMoveOrder(from, getDef(item.def))
    .map((p) => carryGrid(eq, p))
    .filter((g): g is GridContainer => !!g);
  return quickMove({ kind: 'grid', grid, uid }, targets);
}

/**
 * Take a worn item off into the first own grid with room (pockets, rig, backpack, secure), then `extra` grids
 * (the hideout passes the stash). A container still holding things only fits the stash; false when nothing fits.
 */
export function unequipItem(eq: Equipment, slot: Slot, extra: GridContainer[] = []): boolean {
  if (!eq.slots[slot]) return false;
  return quickMove({ kind: 'slot', eq, slot }, [...carryGrids(eq), ...extra]);
}

// ── Equip / swap ─────────────────────────────────────────────────────────────

/** What equipping `item` would do: the slot it goes to (free one first), 'plate' for a plate carrier, or null. */
export function equipTarget(eq: Equipment, item: ItemInstance): Slot | 'plate' | null {
  const def = getDef(item.def);
  if (def.category === 'plate') return eq.slots.armor && takesPlate(eq.slots.armor) ? 'plate' : null;
  const fits = SLOTS.filter((s) => slotAccepts(s, def));
  return fits.find((s) => !eq.slots[s]) ?? fits[0] ?? null;
}

export type EquipResult = { ok: true; slot: Slot | 'plate'; displaced: ItemInstance | null; dropped: boolean } | { ok: false; reason: string };

export interface EquipOptions {
  /** Grids for the item it replaces, tried before the source grid (default: the player's carry grids). */
  spill?: GridContainer[];
  /** Last resort for the replaced item (a raid drops it to the ground). Without it, a swap with no room fails. */
  drop?: (item: ItemInstance) => void;
}

/**
 * Equip an item into the matching slot of `eq` (or a plate into the worn carrier). When the slot is taken, swap:
 * the old item goes to `spill` (default: carry grids), else to the freed spot in the source grid (or anywhere in
 * it), else `drop`. When it fits nowhere, everything is put back as it was and the reason is returned.
 */
export function equipItem(src: ItemSource, eq: Equipment, opts: EquipOptions = {}): EquipResult {
  const item = peekSource(src);
  if (!item) return { ok: false, reason: 'Nothing there' };
  if (src.kind === 'slot' && src.eq === eq) return { ok: false, reason: 'Already equipped' };
  const target = equipTarget(eq, item);
  if (!target) return { ok: false, reason: getDef(item.def).category === 'plate' ? 'No plate carrier worn' : 'Can’t equip that' };
  if (target !== 'plate' && !eq.slots[target]) {
    return moveItem(src, { kind: 'slot', eq, slot: target }) ? { ok: true, slot: target, displaced: null, dropped: false } : { ok: false, reason: 'Can’t equip that' };
  }
  const at = src.kind === 'grid' ? findPlaced(src.grid, src.uid) : null;
  const spot = at ? { x: at.x, y: at.y, rot: !!at.item.rot } : null;
  const d = detach(src);
  if (!d) return { ok: false, reason: 'Nothing there' };
  let old: ItemInstance | null;
  let undo: () => void;
  if (target === 'plate') {
    const carrier = eq.slots.armor!;
    const r = insertPlate(carrier, d.item);
    if (r === false) {
      d.restore();
      return { ok: false, reason: 'Can’t equip that' };
    }
    old = r;
    undo = () => {
      if (old) carrier.mods = { ...carrier.mods, plate: old };
      else removePlate(carrier);
    };
  } else {
    old = eq.slots[target];
    d.item.rot = undefined;
    eq.slots[target] = d.item;
    undo = () => (eq.slots[target] = old);
  }
  if (!old) return { ok: true, slot: target, displaced: null, dropped: false };
  const o = old;
  const spill = (opts.spill ?? carryGrids(eq)).filter((g) => !containsGrid(o, g));
  for (const g of spill) if (addItem(g, o)) return { ok: true, slot: target, displaced: o, dropped: false };
  if (src.kind === 'grid' && !containsGrid(o, src.grid)) {
    if ((spot && placeAt(src.grid, o, spot.x, spot.y, spot.rot)) || (spot && placeAt(src.grid, o, spot.x, spot.y, !spot.rot)) || addItem(src.grid, o))
      return { ok: true, slot: target, displaced: o, dropped: false };
  }
  if (src.kind === 'slot' && !src.eq.slots[src.slot] && slotAccepts(src.slot, getDef(o.def))) {
    src.eq.slots[src.slot] = o;
    return { ok: true, slot: target, displaced: o, dropped: false };
  }
  if (opts.drop) {
    opts.drop(o);
    return { ok: true, slot: target, displaced: o, dropped: true };
  }
  undo();
  d.restore();
  return { ok: false, reason: `No room for the ${getDef(o.def).short}` };
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

// ── Plate carriers ────────────────────────────────────────────

/** Whether this armour takes a plate. */
export const takesPlate = (item: ItemInstance) => !!getDef(item.def).armor?.plate;
/** The plate in a carrier, if any. */
export const plateOf = (item: ItemInstance | null | undefined): ItemInstance | null => item?.mods?.plate ?? null;

/** Put a plate into a carrier. Returns the plate that was in it (or null), or false when it doesn't go there. */
export function insertPlate(carrier: ItemInstance, plate: ItemInstance): ItemInstance | null | false {
  if (!takesPlate(carrier) || getDef(plate.def).category !== 'plate') return false;
  const old = plateOf(carrier);
  carrier.mods = { ...carrier.mods, plate };
  return old;
}

/** Take the plate out of a carrier. */
export function removePlate(carrier: ItemInstance): ItemInstance | null {
  const old = plateOf(carrier);
  if (old && carrier.mods) delete carrier.mods.plate;
  return old;
}
