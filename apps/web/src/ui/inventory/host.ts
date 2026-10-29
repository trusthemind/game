import {
  canMove,
  type Equipment,
  type GridContainer,
  type ItemInstance,
  type ItemSource,
  type ItemTarget,
  type Slot,
} from '@ashfall/engine';

/** Resolves stable string ids ("player:rig", "stash", "c:12", "corpse:3:backpack") to live inventory objects. */
export interface Resolver {
  grid(id: string): GridContainer | null;
  equipment(owner: string): Equipment | null;
}

export type SrcRef = { kind: 'grid'; gridId: string; uid: string } | { kind: 'slot'; owner: string; slot: Slot };
export type DstRef = { kind: 'grid'; gridId: string; x: number; y: number; rot: boolean } | { kind: 'slot'; owner: string; slot: Slot };

export interface MenuAction {
  label: string;
  run(): void;
  danger?: boolean;
}

export interface InvHost {
  resolver: Resolver;
  /** Run a mutation; host commits/persists when it returns true. */
  apply(fn: (r: Resolver) => boolean): boolean;
  isHidden?(gridId: string, uid: string): boolean;
  isLocked?(gridId: string): boolean;
  /** Grids for ctrl/shift-click quick transfer from the given source. */
  quickTargets(src: SrcRef): { grids: string[]; owner?: string };
  menu?(item: ItemInstance, src: SrcRef): MenuAction[];
  onDoubleClick?(item: ItemInstance, src: SrcRef): void;
  /** Special drop zones (sell / ground). */
  dropSpecial?(zone: string, src: SrcRef): void;
}

export function gridFromEquipment(eq: Equipment | null, part: string): GridContainer | null {
  if (!eq) return null;
  if (part === 'pockets') return eq.pockets;
  if (part === 'rig') return eq.slots.rig?.grid ?? null;
  if (part === 'backpack') return eq.slots.backpack?.grid ?? null;
  return null;
}

/** Split "owner:part" where owner itself may contain a colon (corpse:3). */
export function splitGridId(id: string): { owner: string; part: string } {
  const i = id.lastIndexOf(':');
  return { owner: id.slice(0, i), part: id.slice(i + 1) };
}

export function toSource(r: Resolver, s: SrcRef): ItemSource | null {
  if (s.kind === 'grid') {
    const grid = r.grid(s.gridId);
    return grid ? { kind: 'grid', grid, uid: s.uid } : null;
  }
  const eq = r.equipment(s.owner);
  return eq ? { kind: 'slot', eq, slot: s.slot } : null;
}

export function toTarget(r: Resolver, d: DstRef): ItemTarget | null {
  if (d.kind === 'grid') {
    const grid = r.grid(d.gridId);
    return grid ? { kind: 'grid', grid, x: d.x, y: d.y, rot: d.rot } : null;
  }
  const eq = r.equipment(d.owner);
  return eq ? { kind: 'slot', eq, slot: d.slot } : null;
}

export function canDrop(host: InvHost, src: SrcRef, dst: DstRef): boolean {
  if (dst.kind === 'grid' && host.isLocked?.(dst.gridId)) return false;
  const s = toSource(host.resolver, src);
  const d = toTarget(host.resolver, dst);
  return !!s && !!d && canMove(s, d);
}
