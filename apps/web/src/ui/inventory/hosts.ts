import {
  carryGrids,
  getDef,
  peekSource,
  removeItem,
  sellPrice,
  slotAccepts,
  SLOTS,
  moveItem,
  quickMove,
  type Equipment,
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

function equipQuick(r: Resolver, src: SrcRef, eq: Equipment): boolean {
  const s = toSource(r, src);
  const it = s && peekSource(s);
  if (!s || !it) return false;
  const def = getDef(it.def);
  for (const slot of SLOTS) if (!eq.slots[slot] && slotAccepts(slot, def)) return moveItem(s, { kind: 'slot', eq, slot });
  return false;
}

/** Hideout: stash ↔ equipment, selling to the trader. Every change is an atomic profile mutation (persisted + synced). */
export function makeProfileHost(): InvHost {
  const store = useProfile;
  const resolver = profileResolver(() => store.getState().profile);
  const host: InvHost = {
    resolver,
    apply: (fn) => store.getState().tryMutate((draft) => fn(profileResolver(() => draft))),
    quickTargets: (src) =>
      src.kind === 'grid' && src.gridId === 'stash' ? { grids: ['player:rig', 'player:pockets', 'player:backpack'], owner: 'player' } : { grids: ['stash'] },
    onDoubleClick: (_item, src) => {
      if (src.kind === 'grid' && src.gridId === 'stash') host.apply((r) => equipQuick(r, src, r.equipment('player')!));
      else host.apply((r) => quickMove(toSource(r, src)!, [r.grid('stash')!]));
    },
    menu: (item, src) => {
      const profile = store.getState().profile!;
      const price = sellPrice(item, profile);
      const out: MenuAction[] = [];
      if (src.kind === 'grid' && src.gridId === 'stash') out.push({ label: 'Equip', run: () => host.apply((r) => equipQuick(r, src, r.equipment('player')!)) });
      else out.push({ label: 'Move to stash', run: () => host.apply((r) => quickMove(toSource(r, src)!, [r.grid('stash')!])) });
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
  const fromPlayer = (src: SrcRef) => (src.kind === 'grid' ? src.gridId.startsWith('player:') : src.owner === 'player');
  const use = (item: ItemInstance) => {
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
    quickTargets: (src) => (fromPlayer(src) ? lootGrids() : { grids: ['player:rig', 'player:pockets', 'player:backpack'], owner: 'player' }),
    onDoubleClick(item, src) {
      const d = getDef(item.def);
      if (fromPlayer(src) && (d.med || d.food)) return use(item);
      host.apply((r) => {
        const s = toSource(r, src);
        if (!s) return false;
        const t = host.quickTargets(src);
        return quickMove(s, t.grids.map((g) => r.grid(g)!).filter(Boolean), t.owner ? r.equipment(t.owner)! : undefined);
      });
    },
    menu(item, src) {
      const d = getDef(item.def);
      const out: MenuAction[] = [];
      if (fromPlayer(src) && (d.med || d.food)) out.push({ label: d.med ? 'Use' : 'Consume', run: () => use(item) });
      if (!fromPlayer(src)) out.push({ label: 'Take', run: () => host.onDoubleClick!(item, src) });
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
