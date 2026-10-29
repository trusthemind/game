import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import {
  footprint,
  getDef,
  itemValue,
  itemWeight,
  moveItem,
  quickMove,
  RARITY_COLORS,
  type ItemInstance,
  type Slot,
} from '@ashfall/engine';
import { CategoryIcon } from './icons';
import { canDrop, splitGridId, toSource, toTarget, type DstRef, type InvHost, type MenuAction, type SrcRef } from './host';
import { useDrag, zones } from './drag';
import './inventory.css';

export const InvContext = createContext<{ host: InvHost; version: number } | null>(null);
const useInv = () => {
  const c = useContext(InvContext);
  if (!c) throw new Error('InvContext missing');
  return c;
};

// ── Tooltip & context menu (global singletons) ───────────────────────────────

const useTip = create<{ item: ItemInstance | null; x: number; y: number; set(i: ItemInstance | null, x?: number, y?: number): void }>((set) => ({
  item: null,
  x: 0,
  y: 0,
  set: (item, x = 0, y = 0) => set({ item, x, y }),
}));
const useMenu = create<{ actions: MenuAction[]; x: number; y: number; open(a: MenuAction[], x: number, y: number): void; close(): void }>((set) => ({
  actions: [],
  x: 0,
  y: 0,
  open: (actions, x, y) => set({ actions, x, y }),
  close: () => set({ actions: [] }),
}));

const fmt = (n: number) => n.toLocaleString('en-US');

export function ItemTooltip() {
  const { item, x, y } = useTip();
  const dragging = useDrag((s) => !!s.drag);
  if (!item || dragging) return null;
  const d = getDef(item.def);
  const lines: [string, string][] = [];
  if (d.weapon) {
    lines.push(['Caliber', d.weapon.caliber], ['Damage', `${d.weapon.damage}${d.weapon.pellets ? ` ×${d.weapon.pellets}` : ''}`], ['Fire rate', `${d.weapon.rpm} rpm`], ['Magazine', `${item.ammo ?? 0}/${d.weapon.magSize}${item.ammoType ? ` · ${getDef(item.ammoType).short}` : ''}`], ['Mode', d.weapon.auto ? 'Full auto' : 'Semi']);
  }
  if (d.melee) lines.push(['Damage', `${d.melee.damage}`], ['Speed', `${(1 / d.melee.cooldown).toFixed(1)}/s`], ['Bleed', `${Math.round(d.melee.bleedChance * 100)}%`], ['Armor bypass', `${Math.round(d.melee.armorBypass * 100)}%`]);
  if (d.ammo) lines.push(['Caliber', d.ammo.caliber], ['Penetration', `${d.ammo.penetration}`], ['Damage', `×${d.ammo.damageMul}`]);
  if (d.armor) lines.push(['Class', `${d.armor.armorClass}`], ['Durability', `${Math.round(item.dur ?? 0)}/${d.armor.durability}`], ['Speed', `-${Math.round(d.armor.slow * 100)}%`]);
  if (d.grid) lines.push(['Capacity', `${d.grid.w}×${d.grid.h}`]);
  if (d.med) {
    const m = d.med;
    if (m.resource) lines.push(['HP resource', `${item.uses ?? m.resource}/${m.resource}`]);
    else lines.push(['Uses', `${item.uses ?? m.uses}/${m.uses}`]);
    const fx = [m.stopsLight && 'light bleed', m.stopsHeavy && 'heavy bleed', m.fixesFracture && 'fracture', m.surgery && 'destroyed limb', m.painkiller && `pain ${m.painkiller}s`, m.regen && 'regeneration'].filter(Boolean);
    if (fx.length) lines.push(['Treats', fx.join(', ')]);
    lines.push(['Use time', `${m.useTime}s`]);
  }
  if (d.food) lines.push(['Energy', `${d.food.energy > 0 ? '+' : ''}${d.food.energy}`], ['Hydration', `${d.food.hydration > 0 ? '+' : ''}${d.food.hydration}`]);
  lines.push(['Weight', `${itemWeight(item).toFixed(2)} kg`], ['Value', `${fmt(itemValue(item))} ₵`]);
  const left = Math.min(x + 16, window.innerWidth - 260);
  const top = Math.min(y + 16, window.innerHeight - 40 - lines.length * 20);
  return createPortal(
    <div className="tooltip fade-in" style={{ left, top }}>
      <div className="tooltip-name" style={{ borderColor: RARITY_COLORS[d.rarity] }}>
        {d.name}
        {item.fir && <span className="fir">FIR</span>}
      </div>
      <div className="tooltip-cat">{d.category}</div>
      {lines.map(([k, v]) => (
        <div key={k} className="tooltip-row">
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ContextMenu() {
  const { actions, x, y, close } = useMenu();
  useEffect(() => {
    if (!actions.length) return;
    const h = () => close();
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [actions, close]);
  if (!actions.length) return null;
  return createPortal(
    <div className="ctx-menu fade-in" style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - actions.length * 34 - 10) }} onPointerDown={(e) => e.stopPropagation()}>
      {actions.map((a) => (
        <button
          key={a.label}
          className={a.danger ? 'danger' : ''}
          onClick={() => {
            close();
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ── Item tile ────────────────────────────────────────────────────────────────

interface TileProps {
  item: ItemInstance;
  cell: number;
  hidden?: boolean;
  src: SrcRef;
  style?: CSSProperties;
  fit?: { w: number; h: number };
}

export function ItemTile({ item, cell, hidden, src, style, fit }: TileProps) {
  const { host } = useInv();
  const startDrag = useDrag((s) => s.start);
  const d = getDef(item.def);
  const f = footprint(item);
  const w = fit ? fit.w : f.w * cell;
  const h = fit ? fit.h : f.h * cell;
  const pending = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || hidden) return;
    e.stopPropagation();
    useMenu.getState().close();
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const t = host.quickTargets(src);
      host.apply((r) => {
        const s = toSource(r, src);
        if (!s) return false;
        const grids = t.grids.map((id) => r.grid(id)).filter((g): g is NonNullable<typeof g> => !!g);
        return quickMove(s, grids, t.owner ? (r.equipment(t.owner) ?? undefined) : undefined);
      });
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pending.current = { x: e.clientX, y: e.clientY, ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    const move = (ev: PointerEvent) => {
      const p = pending.current;
      if (!p || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 5) return;
      pending.current = null;
      window.removeEventListener('pointermove', move);
      useTip.getState().set(null);
      const gx = fit ? 0 : Math.min(f.w - 1, Math.floor(p.ox / cell));
      const gy = fit ? 0 : Math.min(f.h - 1, Math.floor(p.oy / cell));
      startDrag({ item, src, rot: !!item.rot, grabX: gx, grabY: gy, host });
    };
    const up = () => {
      pending.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (hidden) {
    return (
      <div className="item hidden" style={{ width: w, height: h, ...style }}>
        <span className="search-spin" />
      </div>
    );
  }
  const armor = d.armor && item.dur !== undefined ? item.dur / d.armor.durability : null;
  return (
    <div
      className={`item r${d.rarity}`}
      style={{ width: w, height: h, ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => useTip.getState().set(item, e.clientX, e.clientY)}
      onPointerLeave={() => useTip.getState().set(null)}
      onDoubleClick={() => host.onDoubleClick?.(item, src)}
      onContextMenu={(e) => {
        e.preventDefault();
        const actions = host.menu?.(item, src) ?? [];
        if (actions.length) useMenu.getState().open(actions, e.clientX, e.clientY);
      }}
    >
      <div className="item-icon" style={{ transform: item.rot ? 'rotate(90deg)' : undefined }}>
        <CategoryIcon category={d.category} size={Math.min(w, h) * 0.55} />
      </div>
      <span className="item-name">{d.short}</span>
      {d.stackMax && d.category !== 'money' && <span className="item-count">{item.stack}</span>}
      {d.category === 'money' && <span className="item-count">{item.stack >= 1000 ? `${Math.round(item.stack / 1000)}k` : item.stack}</span>}
      {d.weapon && <span className="item-ammo">{item.ammo ?? 0}/{d.weapon.magSize}</span>}
      {armor !== null && (
        <span className="item-dur">
          <i style={{ width: `${armor * 100}%`, background: armor > 0.5 ? 'var(--good)' : armor > 0.2 ? 'var(--accent)' : 'var(--bad)' }} />
        </span>
      )}
      {item.grid && item.grid.items.length > 0 && <span className="item-full" />}
    </div>
  );
}

// ── Grid ─────────────────────────────────────────────────────────────────────

let zoneSeq = 0;
function useZone(kind: 'grid' | 'slot' | 'special', id: string, extra: Partial<{ cell: number; owner: string; slot: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const key = useRef(`z${zoneSeq++}`);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const k = key.current;
    zones.set(k, { el, kind, id, ...extra });
    return () => void zones.delete(k);
  }, [kind, id, extra.cell, extra.owner, extra.slot]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

export function ItemGrid({ gridId, cell = 52, label, maxHeight }: { gridId: string; cell?: number; label?: string; maxHeight?: number }) {
  const { host } = useInv();
  const grid = host.resolver.grid(gridId);
  const ref = useZone('grid', gridId, { cell });
  const hover = useDrag((s) => (s.hover?.kind === 'grid' && s.hover.gridId === gridId ? s.hover : null));
  const valid = useDrag((s) => s.valid);
  const drag = useDrag((s) => s.drag);
  if (!grid) return null;
  const locked = host.isLocked?.(gridId);
  const fp = drag && hover ? footprint(drag.item, drag.rot) : null;
  return (
    <div className="grid-wrap">
      {label && <div className="grid-label">{label}</div>}
      <div className="grid-scroll" style={{ maxHeight }}>
        <div
          ref={ref}
          className={`grid ${locked ? 'locked' : ''}`}
          style={{ width: grid.w * cell, height: grid.h * cell, backgroundSize: `${cell}px ${cell}px` }}
        >
          {grid.items.map((p) => (
            <ItemTile
              key={p.item.uid}
              item={p.item}
              cell={cell}
              hidden={host.isHidden?.(gridId, p.item.uid)}
              src={{ kind: 'grid', gridId, uid: p.item.uid }}
              style={{ position: 'absolute', left: p.x * cell, top: p.y * cell, opacity: drag?.item.uid === p.item.uid ? 0.3 : 1 }}
            />
          ))}
          {fp && hover && (
            <div
              className={`drop-preview ${valid ? 'ok' : 'bad'}`}
              style={{ left: hover.x * cell, top: hover.y * cell, width: fp.w * cell, height: fp.h * cell }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const SLOT_LABEL: Record<Slot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  melee: 'Melee',
  helmet: 'Helmet',
  armor: 'Body armor',
  rig: 'Tactical rig',
  backpack: 'Backpack',
};

export function EquipSlot({ owner, slot, w = 2, h = 2, cell = 52 }: { owner: string; slot: Slot; w?: number; h?: number; cell?: number }) {
  const { host } = useInv();
  const eq = host.resolver.equipment(owner);
  const ref = useZone('slot', `${owner}/${slot}`, { owner, slot });
  const hover = useDrag((s) => (s.hover?.kind === 'slot' && s.hover.owner === owner && s.hover.slot === slot ? s.hover : null));
  const valid = useDrag((s) => s.valid);
  const drag = useDrag((s) => s.drag);
  if (!eq) return null;
  const item = eq.slots[slot];
  const W = w * cell;
  const H = h * cell;
  return (
    <div className="slot-wrap">
      <div className="grid-label">{SLOT_LABEL[slot]}</div>
      <div ref={ref} className={`slot ${hover ? (valid ? 'ok' : 'bad') : ''}`} style={{ width: W, height: H }}>
        {item ? (
          <ItemTile item={item} cell={cell} src={{ kind: 'slot', owner, slot }} fit={{ w: W - 2, h: H - 2 }} style={{ opacity: drag?.item.uid === item.uid ? 0.3 : 1 }} />
        ) : (
          <span className="slot-empty">{SLOT_LABEL[slot]}</span>
        )}
      </div>
    </div>
  );
}

export function DropZoneBox({ zone, label, className }: { zone: string; label: string; className?: string }) {
  const ref = useZone('special', zone, {});
  const hover = useDrag((s) => s.hover?.kind === 'special' && s.hover.zone === zone);
  const dragging = useDrag((s) => !!s.drag);
  return (
    <div ref={ref} className={`drop-zone ${className ?? ''} ${dragging ? 'armed' : ''} ${hover ? 'hover' : ''}`}>
      {label}
    </div>
  );
}

// ── Drag layer: ghost + hit-testing + drop ────────────────────────────────────

export function DragLayer() {
  const drag = useDrag((s) => s.drag);
  const ghost = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });

  const hitTest = useCallback((px: number, py: number) => {
    const st = useDrag.getState();
    const d = st.drag;
    if (!d) return;
    for (const z of zones.values()) {
      const r = z.el.getBoundingClientRect();
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      if (z.kind === 'special') return st.setHover({ kind: 'special', zone: z.id }, true);
      if (z.kind === 'slot') {
        const dst: DstRef = { kind: 'slot', owner: z.owner!, slot: z.slot as Slot };
        return st.setHover(dst, canDrop(d.host, d.src, dst));
      }
      const cell = z.cell ?? 52;
      const x = Math.floor((px - r.left) / cell) - d.grabX;
      const y = Math.floor((py - r.top) / cell) - d.grabY;
      const dst: DstRef = { kind: 'grid', gridId: z.id, x, y, rot: d.rot };
      const h = st.hover;
      if (h?.kind === 'grid' && h.gridId === z.id && h.x === x && h.y === y && h.rot === d.rot) return;
      return st.setHover(dst, canDrop(d.host, d.src, dst));
    }
    if (st.hover) st.setHover(null, false);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (ghost.current) ghost.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      hitTest(e.clientX, e.clientY);
    };
    const up = () => {
      const st = useDrag.getState();
      const d = st.drag;
      const h = st.hover;
      if (d && h && st.valid) {
        if (h.kind === 'special') d.host.dropSpecial?.(h.zone, d.src);
        else
          d.host.apply((r) => {
            const s = toSource(r, d.src);
            const t = toTarget(r, h);
            return !!s && !!t && moveItem(s, t);
          });
      }
      st.end();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR') {
        e.preventDefault();
        e.stopPropagation();
        useDrag.getState().rotate();
        useDrag.getState().setHover(null, false);
        hitTest(pos.current.x, pos.current.y);
      }
      if (e.code === 'Escape') useDrag.getState().end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [drag, hitTest]);

  if (!drag) return null;
  const f = footprint(drag.item, drag.rot);
  const cell = 52;
  const d = getDef(drag.item.def);
  return createPortal(
    <div ref={ghost} className="drag-ghost" style={{ transform: `translate(${pos.current.x}px, ${pos.current.y}px)` }}>
      <div
        className={`item r${d.rarity}`}
        style={{ width: f.w * cell, height: f.h * cell, marginLeft: -(drag.grabX + 0.5) * cell, marginTop: -(drag.grabY + 0.5) * cell }}
      >
        <div className="item-icon" style={{ transform: drag.rot ? 'rotate(90deg)' : undefined }}>
          <CategoryIcon category={d.category} size={Math.min(f.w, f.h) * cell * 0.55} />
        </div>
        <span className="item-name">{d.short}</span>
      </div>
    </div>,
    document.body,
  );
}

export function useGridOwner(gridId: string) {
  return splitGridId(gridId).owner;
}

export function InventoryRoot({ host, version, children }: { host: InvHost; version: number; children: React.ReactNode }) {
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [version]);
  return (
    <InvContext.Provider value={{ host, version }}>
      {children}
      <DragLayer />
      <ItemTooltip />
      <ContextMenu />
    </InvContext.Provider>
  );
}
