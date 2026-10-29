import { create } from 'zustand';
import type { Interactable, LootTarget } from '@ashfall/engine';

import type { PartView } from '../ui/components/BodyFigure';

export interface HudState {
  parts: PartView[];
  pain: boolean;
  painkiller: number;
  hp: number;
  maxHp: number;
  bleed: boolean;
  stamina: number;
  winded: boolean;
  energy: number;
  hydration: number;
  weapon: string;
  weaponSlot: string;
  ammo: number | null;
  mag: number;
  reserve: number;
  ammoType: string;
  reloading: number;
  using: number;
  timeLeft: number;
  extract: number;
  extractName: string;
  extractions: { name: string; dist: number; angle: number; kind: 'exit' | 'grave' | 'event' }[];
  interact: Interactable | null;
  crouch: boolean;
  flashlight: boolean;
  weight: number;
  facing: number;
  status: 'active' | 'extracted' | 'dead' | 'mia';
  timeOfDay: string;
  rain: boolean;
  kills: number;
  companion: { name: string; hp: number; alive: boolean } | null;
}

export type Overlay = null | 'inventory' | 'loot' | 'dialogue' | 'pause' | 'map';

interface RaidUiState {
  hud: HudState | null;
  overlay: Overlay;
  loot: LootTarget | null;
  dialogueActor: number | null;
  invVersion: number;
  showPerf: boolean;
  perf: { fps: number; ms: number; p99: number; sim: number; render: number; calls: number; tris: number; scale: number; actors: number; pathHit: number } | null;
  messages: { id: number; text: string; tone?: 'info' | 'good' | 'bad' }[];
  /** Right-click world menu (screen position + option labels; the session holds the callbacks). */
  worldMenu: { x: number; y: number; title: string; options: string[] } | null;
  setHud(h: HudState): void;
  setOverlay(o: Overlay): void;
  bumpInv(): void;
  pushMessage(text: string, tone?: 'info' | 'good' | 'bad'): void;
}

let msgId = 1;

export const useRaidUi = create<RaidUiState>((set) => ({
  hud: null,
  overlay: null,
  loot: null,
  dialogueActor: null,
  invVersion: 0,
  showPerf: false,
  perf: null,
  messages: [],
  worldMenu: null,
  setHud: (hud) => set({ hud }),
  setOverlay: (overlay) => set({ overlay }),
  bumpInv: () => set((s) => ({ invVersion: s.invVersion + 1 })),
  pushMessage: (text, tone) => {
    const id = msgId++;
    set((s) => ({ messages: [...s.messages.slice(-5), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })), 3500);
  },
}));
