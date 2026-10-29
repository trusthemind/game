import { addItem, carryGrids, createItem, getDef, removeItem, type DialogueHost, type GridContainer, type Profile } from '@ashfall/engine';
import { useProfile } from '../state/profileStore';
import { useApp } from '../state/appStore';
import type { GameSession } from '../game/GameSession';

function count(grids: GridContainer[], def: string): number {
  let n = 0;
  for (const g of grids) for (const p of g.items) if (p.item.def === def) n += p.item.stack;
  return n;
}

function take(grids: GridContainer[], def: string, n: number): boolean {
  if (count(grids, def) < n) return false;
  for (const g of grids)
    for (const p of [...g.items]) {
      if (n <= 0) return true;
      if (p.item.def !== def) continue;
      const k = Math.min(n, p.item.stack);
      p.item.stack -= k;
      n -= k;
      if (p.item.stack <= 0) removeItem(g, p.item.uid);
    }
  return n <= 0;
}

const profileGrids = (p: Profile) => [p.stash, ...carryGrids(p.equipment)];

export function hideoutDialogueHost(npcId: string): DialogueHost {
  const st = useProfile.getState;
  return {
    inRaid: false,
    get isCompanion() {
      return st().profile?.companion === npcId;
    },
    countItem: (def) => count(profileGrids(st().profile!), def),
    takeItem: (def, n) => st().tryMutate((d) => take(profileGrids(d), def, n)),
    giveItem: (def, n) =>
      st().mutate((d) => {
        addItem(d.stash, createItem(def, { stack: n }));
        useApp.getState().toast(`Received ${getDef(def).name}`, 'good');
      }),
    addMoney: (delta) => {
      st().mutate((d) => (d.money += delta));
      useApp.getState().toast(`${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')} ₵`, delta > 0 ? 'good' : 'info');
    },
    money: () => st().profile?.money ?? 0,
    recruit: () => {
      st().mutate((d) => (d.companion = npcId));
      useApp.getState().toast('Companion will join your next raid', 'good');
    },
    dismiss: () => st().mutate((d) => (d.companion = null)),
    openTrade: () => useApp.getState().setTab('trader'),
  };
}

export function raidDialogueHost(session: GameSession, actorId: number, npcId: string): DialogueHost {
  const raid = session.raid;
  const grids = () => carryGrids(raid.player.eq);
  const st = useProfile.getState;
  return {
    inRaid: true,
    get isCompanion() {
      return !!raid.actorById(actorId)?.companion;
    },
    countItem: (def) => count(grids(), def),
    takeItem: (def, n) => {
      const ok = take(grids(), def, n);
      raid.invVersion++;
      return ok;
    },
    giveItem: (def, n) => {
      const it = createItem(def, { stack: n, fir: true });
      if (!grids().some((g) => addItem(g, it))) raid.dropToGround(it);
      raid.invVersion++;
    },
    addMoney: (delta) => st().mutate((d) => (d.money += delta)),
    money: () => st().profile?.money ?? 0,
    recruit: () => st().mutate((d) => (d.companion = npcId)),
    dismiss: () => st().mutate((d) => (d.companion = null)),
    joinNow: () => raid.makeCompanion(actorId),
    healNpc: () => raid.healActor(actorId),
  };
}
