import { create } from 'zustand';
import type { MapId, RaidResult, RaidSummary } from '@ashfall/engine';

export type Screen = 'menu' | 'hideout' | 'raid' | 'raidEnd';
export type HideoutTab = 'gear' | 'trader' | 'survivors' | 'stats';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'good' | 'bad';
}

interface AppState {
  screen: Screen;
  tab: HideoutTab;
  raidSeed: number;
  raidMap: MapId;
  raidTime: 'random' | 'day' | 'dusk' | 'night';
  lastResult: { result: RaidResult; summary: RaidSummary } | null;
  toasts: Toast[];
  dialogueNpc: string | null;
  go(screen: Screen): void;
  setTab(tab: HideoutTab): void;
  startRaid(seed?: number, mapId?: MapId, time?: AppState['raidTime']): void;
  finishRaid(result: RaidResult, summary: RaidSummary): void;
  toast(text: string, tone?: Toast['tone']): void;
  openDialogue(npcId: string | null): void;
}

let toastId = 1;

export const useApp = create<AppState>((set) => ({
  screen: 'menu',
  tab: 'gear',
  raidSeed: 0,
  raidMap: 'outskirts',
  raidTime: 'random',
  lastResult: null,
  toasts: [],
  dialogueNpc: null,
  go: (screen) => set({ screen }),
  setTab: (tab) => set({ tab }),
  startRaid: (seed, mapId, time) => set((s) => ({ screen: 'raid', raidSeed: seed ?? Math.floor(Math.random() * 2 ** 31), raidMap: mapId ?? s.raidMap, raidTime: time ?? s.raidTime })),
  finishRaid: (result, summary) => set({ screen: 'raidEnd', lastResult: { result, summary } }),
  toast: (text, tone) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
  openDialogue: (npcId) => set({ dialogueNpc: npcId }),
}));
