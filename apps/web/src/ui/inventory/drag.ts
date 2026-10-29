import { create } from 'zustand';
import type { ItemInstance } from '@ashfall/engine';
import type { DstRef, InvHost, SrcRef } from './host';

export interface DragInfo {
  item: ItemInstance;
  src: SrcRef;
  rot: boolean;
  /** Cell offset inside the item where it was grabbed. */
  grabX: number;
  grabY: number;
  host: InvHost;
}

interface DragState {
  drag: DragInfo | null;
  hover: DstRef | { kind: 'special'; zone: string } | null;
  valid: boolean;
  start(d: DragInfo): void;
  setHover(h: DragState['hover'], valid: boolean): void;
  rotate(): void;
  end(): void;
}

export const useDrag = create<DragState>((set) => ({
  drag: null,
  hover: null,
  valid: false,
  start: (drag) => set({ drag, hover: null, valid: false }),
  setHover: (hover, valid) => set({ hover, valid }),
  rotate: () => set((s) => (s.drag ? { drag: { ...s.drag, rot: !s.drag.rot, grabX: s.drag.grabY, grabY: s.drag.grabX } } : s)),
  end: () => set({ drag: null, hover: null, valid: false }),
}));

/** Drop target registry: components register their DOM element so the drag layer can hit-test with one rect pass. */
export interface DropZone {
  el: HTMLElement;
  kind: 'grid' | 'slot' | 'special';
  id: string;
  cell?: number;
  owner?: string;
  slot?: string;
}

export const zones = new Map<string, DropZone>();
