import {
  addItem,
  carryGrids,
  findSpot,
  getDef,
  insertPlate,
  plateOf,
  peekSource,
  removeItem,
  removePlate,
  repair,
  repairCost,
  sellPrice,
  takesPlate,
  quickMove,
  quickMoveOwn,
  equipItem,
  equipTarget,
  unequipItem,
  ownMoveOrder,
  type CarryPart,
  type EquipOptions,
  type EquipResult,
  type ItemInstance,
  type Profile,
} from '@ashfall/engine';
import { useProfile } from '../../state/profileStore';
import { useApp } from '../../state/appStore';
import type { GameSession } from '../../game/GameSession';
import { gridFromEquipment, splitGridId, toSource, type InvHost, type MenuAction, type Resolver, type SrcRef } from './host';

const fmt = (n: number) => n.toLocaleString('en-US');

function profileResolver(get: () => Profile | null): Resolver {
  return {
    grid(id) {
      const p = get();
      if (!p) return null;
      if (id === 'stash') return p.stash;
      const { owner, part } = splitGridId(id);
      return owner === 'player' ? gridFromEquipment(p.equipment, part) : null;
    },
    equipment(owner) {
      return owner === 'player' ? (get()?.equipment ?? null) : null;
    },
  };
}

function removeFrom(r: Resolver, src: SrcRef): ItemInstance | null {
  const s = toSource(r, src);
  if (!s) return null;
  const it = peekSource(s);
  if (!it) return null;
  if (s.kind === 'grid') removeItem(s.grid, it.uid);
  else s.eq.slots[s.slot] = null;
  return it;
}

const CARRY: readonly string[] = ['pockets', 'rig', 'backpack', 'secure'];
/** The player's own carried container a source sits in ("player:rig" → rig), or null. */
function ownPart(src: SrcRef): CarryPart | null {
  if (src.kind !== 'grid') return null;
  const { owner, part } = splitGridId(src.gridId);
  return owner === 'player' && CARRY.includes(part) ? (part as CarryPart) : null;
}
/** Grid ids an item in an own container quick-moves to, best first. */
const ownTargets = (part: CarryPart, item: ItemInstance) => ownMoveOrder(part, getDef(item.def)).map((p) => `player:${p}`);
const PLAYER_GRIDS = ['player:rig', 'player:pockets', 'player:backpack'];
const toast = (msg: string, tone?: 'good' | 'bad') => useApp.getState().toast(msg, tone);

/** Equip (or swap) through a host's apply; toasts why when it can't. */
function runEquip(host: InvHost, src: SrcRef, opts: (r: Resolver) => EquipOptions): boolean {
  let res: EquipResult | null = null;
  host.apply((r) => {
    const s = toSource(r, src);
    const eq = r.equipment('player');
    if (!s || !eq) return false;
    res = equipItem(s, eq, opts(r));
    return res.ok;
  });
  const out = res as EquipResult | null;
  if (out && !out.ok) toast(out.reason, 'bad');
  else if (out?.ok && out.dropped && out.displaced) toast(`Dropped the ${getDef(out.displaced.def).short}`);
  return !!out?.ok;
}

/** Move an item in an own container to the next one; toasts when nothing has room. */
function runOwnMove(host: InvHost, part: CarryPart, uid: string): boolean {
  const ok = host.apply((r) => {
    const eq = r.equipment('player');
    return !!eq && quickMoveOwn(eq, part, uid);
  });
  if (!ok) toast('No room in your other containers', 'bad');
  return ok;
}

/** Take a worn item off into the first own grid with room (then `extra`, e.g. the stash); toasts when it can't. */
function runUnequip(host: InvHost, src: SrcRef, extra: string[] = []): boolean {
  if (src.kind !== 'slot' || src.owner !== 'player') return false;
  const ok = host.apply((r) => {
    const eq = r.equipment('player');
    return !!eq && unequipItem(eq, src.slot, extra.map((g) => r.grid(g)).filter((g): g is NonNullable<typeof g> => !!g));
  });
  if (!ok) toast(extra.length ? 'No room to take that off' : 'No room in your containers', 'bad');
  return ok;
}
const isOwnSlot = (src: SrcRef) => src.kind === 'slot' && src.owner === 'player';

/** Can the player equip this (from anywhere but their own slots)? */
const equippable = (r: Resolver, item: ItemInstance, src: SrcRef) => {
  const eq = r.equipment('player');
  return !!eq && !(src.kind === 'slot' && src.owner === 'player') && !!equipTarget(eq, item);
};

/** Hideout: stash ↔ equipment, selling to the trader. Every change is an atomic profile mutation (persisted + synced). */
export function makeProfileHost(): InvHost {
  const store = useProfile;
  const resolver = profileResolver(() => store.getState().profile);
  const host: InvHost = {
    resolver,
    apply: (fn) => store.getState().tryMutate((draft) => fn(profileResolver(() => draft))),
    quickTargets: (src) =>
      src.kind === 'grid' && src.gridId === 'stash' ? { grids: PLAYER_GRIDS, owner: 'player' } : { grids: ['stash'] },
    onDoubleClick: (item, src) => {
      // Equippables go on (the replaced piece goes to the stash); loadout items hop to the next own container.
      if (isOwnSlot(src)) return void runUnequip(host, src, ['stash']);
      if (equippable(resolver, item, src)) return void runEquip(host, src, (r) => ({ spill: [r.grid('stash')!] }));
      const part = ownPart(src);
      if (part) return void runOwnMove(host, part, (src as { uid: string }).uid);
      const targets = src.kind === 'grid' && src.gridId === 'stash' ? PLAYER_GRIDS : ['stash'];
      const ok = host.apply((r) => quickMove(toSource(r, src)!, targets.map((g) => r.grid(g)).filter((g): g is NonNullable<typeof g> => !!g)));
      if (!ok) toast(targets[0] === 'stash' ? 'No room in the stash' : 'No room in your loadout', 'bad');
    },
    onDropKey: (_item, src) => {
      // X never deletes in the hideout: loadout items go back to the stash.
      if (src.kind === 'grid' && src.gridId === 'stash') return;
      if (!host.apply((r) => quickMove(toSource(r, src)!, [r.grid('stash')!]))) toast('No room in the stash', 'bad');
    },
    hint: 'F / double-click equip · move   X to stash   ⇧+click stash ↔ loadout   R rotate',
    menu: (item, src) => {
      const profile = store.getState().profile!;
      const price = sellPrice(item, profile);
      const out: MenuAction[] = [];
      // Plates live inside the carrier rather than in a fake equipment slot. Keep a swap in one profile
      // mutation, so an occupied stash cannot make a plate disappear halfway through the action.
      if (getDef(item.def).category === 'plate' && src.kind === 'grid') {
        const carrier = profile.equipment.slots.armor;
        if (carrier && takesPlate(carrier)) {
          out.push({
            label: `Insert into ${getDef(carrier.def).short}`,
            run: () => {
              const ok = host.apply((r) => {
                const s = toSource(r, src);
                const plate = s && peekSource(s);
                const current = r.equipment('player')?.slots.armor;
                if (!s || s.kind !== 'grid' || !plate || !current || !takesPlate(current)) return false;
                const old = plateOf(current);
                if (old && !findSpot(s.grid, old)) return false;
                const pulled = removeFrom(r, src);
                if (!pulled) return false;
                const replaced = insertPlate(current, pulled);
                if (replaced === false) return false;
                return !replaced || addItem(s.grid, replaced);
              });
              useApp.getState().toast(ok ? 'Plate installed' : 'No room to swap that plate', ok ? 'good' : 'bad');
            },
          });
        }
      }
      if (takesPlate(item) && plateOf(item)) {
        out.push({
          label: 'Remove installed plate',
          run: () => {
            const ok = host.apply((r) => {
              const s = toSource(r, src);
              const current = s && peekSource(s);
              const plate = current && plateOf(current);
              const stash = r.grid('stash');
              if (!current || !plate || !stash || !findSpot(stash, plate)) return false;
              removePlate(current);
              return addItem(stash, plate);
            });
            useApp.getState().toast(ok ? 'Plate moved to stash' : 'No room in stash for the plate', ok ? 'good' : 'bad');
          },
        });
      }
      if (equippable(resolver, item, src)) out.push({ label: 'Equip', run: () => void runEquip(host, src, (r) => ({ spill: [r.grid('stash')!] })) });
      const part = ownPart(src);
      if (part) out.push({ label: 'Quick move', run: () => void runOwnMove(host, part, (src as { uid: string }).uid) });
      if (isOwnSlot(src)) out.push({ label: 'Unequip', run: () => void runUnequip(host, src, ['stash']) });
      if (!(src.kind === 'grid' && src.gridId === 'stash')) out.push({ label: 'Move to stash', run: () => host.onDropKey!(item, src) });
      const cost = repairCost(item);
      if (cost)
        out.push({
          label: `Repair · ${fmt(cost)} ₵`,
          run: () => {
            let why: string | undefined;
            const ok = store.getState().tryMutate((d) => {
              const s = toSource(profileResolver(() => d), src);
              const it = s && peekSource(s);
              if (!it) return false;
              const r = repair(d, it);
              why = r.reason;
              return r.ok;
            });
            useApp.getState().toast(ok ? `Repaired for ${fmt(cost)} ₵` : (why ?? 'Can’t repair that'), ok ? 'good' : 'bad');
          },
        });
      out.push({ label: `Sell · ${fmt(price)} ₵`, run: () => host.dropSpecial!('sell', src) });
      out.push({ label: 'Discard', danger: true, run: () => host.apply((r) => !!removeFrom(r, src)) });
      return out;
    },
    dropSpecial: (zone, src) => {
      if (zone !== 'sell') return;
      let gained = 0;
      const ok = host.apply((r) => {
        const it = removeFrom(r, src);
        if (!it) return false;
        gained = sellPrice(it, store.getState().profile!);
        return true;
      });
      if (ok) {
        store.getState().mutate((d) => (d.money += gained));
        useApp.getState().toast(`Sold for ${fmt(gained)} ₵`, 'good');
      }
    },
  };
  return host;
}

/** In-raid: player gear ↔ open container / body, ground drops, using meds & food. Mutates the live sim. */
export function makeRaidHost(session: GameSession): InvHost {
  const raid = session.raid;
  const resolver: Resolver = {
    grid(id) {
      if (id.startsWith('c:')) {
        const c = raid.container(Number(id.slice(2)));
        return c?.grid ?? null;
      }
      const { owner, part } = splitGridId(id);
      return gridFromEquipment(resolver.equipment(owner), part);
    },
    equipment(owner) {
      if (owner === 'player') return raid.player.eq;
      if (owner.startsWith('corpse:')) return raid.corpse(Number(owner.slice(7)))?.eq ?? null;
      return null;
    },
  };
  const lootGrids = (): { grids: string[]; owner?: string } => {
    const l = raid.loot;
    if (!l) return { grids: [] };
    if (l.kind === 'container') return { grids: [`c:${l.id}`] };
    return { grids: ['pockets', 'rig', 'backpack'].map((p) => `corpse:${l.id}:${p}`) };
  };
  const peekItem = (src: SrcRef) => {
    const s = toSource(resolver, src);
    return s ? peekSource(s) : null;
  };
  const fromPlayer = (src: SrcRef) => (src.kind === 'grid' ? src.gridId.startsWith('player:') : src.owner === 'player');
  const consume = (item: ItemInstance) => {
    const d = getDef(item.def);
    if (d.med || d.food) session.input.intent.use = item.uid;
  };
  const host: InvHost = {
    resolver,
    apply(fn) {
      const ok = fn(resolver);
      if (ok) {
        raid.invVersion++;
        raid.recomputeSpeed(raid.player);
      }
      return ok;
    },
    isHidden(gridId, uid) {
      if (!gridId.startsWith('c:')) return false;
      const c = raid.container(Number(gridId.slice(2)));
      return !!c && !c.searched && !c.revealedUids.includes(uid);
    },
    isLocked(gridId) {
      if (!gridId.startsWith('c:')) return false;
      const c = raid.container(Number(gridId.slice(2)));
      return !!c && !c.searched;
    },
    quickTargets: (src) => {
      if (!fromPlayer(src)) return { grids: PLAYER_GRIDS, owner: 'player' };
      if (raid.loot) return lootGrids();
      // Nothing open: shift-click hops between own containers (a worn item goes into the bags).
      const part = peekItem(src) && ownPart(src);
      return part ? { grids: ownTargets(part, peekItem(src)!) } : { grids: ['player:backpack', 'player:rig', 'player:pockets'] };
    },
    onDoubleClick(item, src) {
      const d = getDef(item.def);
      if (fromPlayer(src) && (d.med || d.food)) return consume(item);
      if (isOwnSlot(src)) return void runUnequip(host, src);
      if (equippable(resolver, item, src)) return void runEquip(host, src, () => ({ drop: (it) => raid.dropToGround(it) }));
      const part = ownPart(src);
      if (part) return void runOwnMove(host, part, (src as { uid: string }).uid);
      const ok = host.apply((r) => {
        const s = toSource(r, src);
        if (!s) return false;
        const t = host.quickTargets(src);
        return quickMove(s, t.grids.map((g) => r.grid(g)!).filter(Boolean), t.owner ? r.equipment(t.owner)! : undefined);
      });
      if (!ok) toast(fromPlayer(src) ? 'No room there' : 'No room in your gear', 'bad');
    },
    onDropKey(_item, src) {
      if (fromPlayer(src)) host.dropSpecial!('ground', src);
    },
    hint: 'F take · equip · move   X drop   ⇧+click transfer   R rotate',
    menu(item, src) {
      const d = getDef(item.def);
      const out: MenuAction[] = [];
      if (fromPlayer(src) && (d.med || d.food)) out.push({ label: d.med ? 'Use' : 'Consume', run: () => consume(item) });
      if (equippable(resolver, item, src))
        out.push({ label: d.category === 'plate' ? 'Insert plate' : 'Equip', run: () => void runEquip(host, src, () => ({ drop: (it) => raid.dropToGround(it) })) });
      if (!fromPlayer(src)) out.push({ label: 'Take', run: () => void host.apply((r) => quickMove(toSource(r, src)!, PLAYER_GRIDS.map((g) => r.grid(g)!).filter(Boolean), r.equipment('player')!)) });
      if (isOwnSlot(src)) out.push({ label: 'Unequip', run: () => void runUnequip(host, src) });
      const part = ownPart(src);
      if (part) out.push({ label: 'Quick move', run: () => void runOwnMove(host, part, (src as { uid: string }).uid) });
      if (fromPlayer(src) && raid.loot) out.push({ label: 'Put in container', run: () => void host.apply((r) => quickMove(toSource(r, src)!, lootGrids().grids.map((g) => r.grid(g)!).filter(Boolean))) });
      if (fromPlayer(src)) out.push({ label: 'Drop', danger: true, run: () => host.dropSpecial!('ground', src) });
      return out;
    },
    dropSpecial(zone, src) {
      if (zone.startsWith('heal:')) {
        // Drag a med onto a body part: treat that part specifically.
        const it = toSource(resolver, src);
        const item = it && peekSource(it);
        if (item && getDef(item.def).med && fromPlayer(src)) {
          session.input.intent.use = item.uid;
          session.input.intent.useOn = zone.slice(5) as never;
        }
        return;
      }
      if (zone !== 'ground') return;
      const it = removeFrom(resolver, src);
      if (it) {
        raid.dropToGround(it);
        raid.recomputeSpeed(raid.player);
      }
    },
  };
  return host;
}

export { carryGrids };
