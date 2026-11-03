import { useContext, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useEscape } from '../components/useEscape';
import {
  addItem,
  createItem,
  effectiveWeapon,
  getDef,
  installPart,
  partFits,
  peekSource,
  removeItem,
  removePart,
  socketTree,
  type ItemInstance,
} from '@ashfall/engine';
import { InvContext } from './components';
import { GunViewer } from './GunViewer';
import { toSource, type Resolver, type SrcRef } from './host';
import { audio } from '../../audio/AudioEngine';

export const useModder = create<{ src: SrcRef | null; open(src: SrcRef): void; close(): void }>((set) => ({
  src: null,
  open: (src) => set({ src }),
  close: () => set({ src: null }),
}));

/** Grids that mods can come from / go back to (in order). */
function modGrids(r: Resolver): { id: string; label: string }[] {
  const out = [
    { id: 'stash', label: 'Stash' },
    { id: 'player:pockets', label: 'Pockets' },
    { id: 'player:rig', label: 'Rig' },
    { id: 'player:backpack', label: 'Backpack' },
    { id: 'player:secure', label: 'Secure' },
  ];
  return out.filter((g) => r.grid(g.id));
}

function stat(label: string, base: number, cur: number, fmt: (n: number) => string, better: 'up' | 'down') {
  const diff = cur - base;
  const good = better === 'up' ? diff > 0 : diff < 0;
  return (
    <div className="mstat" key={label}>
      <span className="dim">{label}</span>
      <span className="mono">
        {fmt(cur)}
        {Math.abs(diff) > 1e-6 && <span className={good ? 'good' : 'bad'}> ({diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))})</span>}
      </span>
    </div>
  );
}

/** Tarkov/Duckov-style gunsmith: slots on the left, compatible parts from your stash and gear on the right. */
export function WeaponModder() {
  const src = useModder((s) => s.src);
  const ctx = useContext(InvContext);
  // The socket being pointed at (its part glows) and the part being tried on there (shown on the gun, stats diffed).
  const [focus, setFocus] = useState<string | null>(null);
  const [tryOn, setTryOn] = useState<{ path: string[]; def: string } | null>(null);
  useEscape(() => useModder.getState().close(), !!src);
  if (!src || !ctx) return null;
  const { host } = ctx;
  const s = toSource(host.resolver, src);
  const gun = s && peekSource(s);
  if (!gun || !getDef(gun.def).weapon) return null;
  const def = getDef(gun.def);
  // Compared against the gun as it leaves the factory (bare, for guns with plain attachment slots).
  const base = effectiveWeapon(createItem(gun.def));
  const cur = effectiveWeapon(gun);
  const tree = socketTree(gun);
  const preview = (() => {
    if (!tryOn) return null;
    const g = structuredClone(gun);
    return installPart(g, tryOn.path, createItem(tryOn.def)) ? g : null;
  })();
  const shown = preview ? effectiveWeapon(preview) : cur;
  // Differences against the factory gun, or against the gun as it is while trying a part on.
  const ref = preview ? cur : base;
  const grids = modGrids(host.resolver);
  const available: { item: ItemInstance; grid: string; label: string }[] = [];
  for (const g of grids) for (const p of host.resolver.grid(g.id)!.items) if (getDef(p.item.def).mod) available.push({ item: p.item, grid: g.id, label: g.label });

  /** Put a removed part (and any unloaded rounds) somewhere sensible. */
  const stow = (r: Resolver, item: ItemInstance): boolean => grids.some((g) => addItem(r.grid(g.id)!, item));

  const install = (path: string[], modUid: string, gridId: string) =>
    host.apply((r) => {
      const g = r.grid(gridId);
      const w = peekSource(toSource(r, src)!);
      const placed = g?.items.find((p) => p.item.uid === modUid);
      if (!g || !w || !placed) return false;
      removeItem(g, modUid);
      const res = installPart(w, path, placed.item);
      if (!res) {
        addItem(g, placed.item);
        return false;
      }
      if (res.replaced) stow(r, res.replaced);
      if (res.unloaded && w.ammoType) stow(r, createItem(w.ammoType, { stack: res.unloaded }));
      audio.ui('equip');
      return true;
    });

  const remove = (path: string[]) =>
    host.apply((r) => {
      const w = peekSource(toSource(r, src)!);
      const ref = w && socketTree(w).find((t) => t.path.join('/') === path.join('/'));
      if (!w || !ref?.part) return false;
      // Check there's room before detaching (the part comes off with everything on it).
      if (!grids.some((g) => r.grid(g.id) && addItem(r.grid(g.id)!, ref.part!))) return false;
      const res = removePart(w, path);
      if (res.unloaded && w.ammoType) stow(r, createItem(w.ammoType, { stack: res.unloaded }));
      audio.ui('move');
      return true;
    });

  // A socket and, inside it, the sockets on whatever is in it (a handguard's rails, a barrel's muzzle).
  const slotCard = (t: (typeof tree)[number]): ReactNode => {
    const m = t.part;
    const key = t.path.join('/');
    const nested = t.path.length > 1;
    const options = available.filter((a) => a.item.uid !== m?.uid && partFits(a.item.def, t.socket, t.host.def, gun.def));
    const kids = tree.filter((c) => c.path.length === t.path.length + 1 && c.path.slice(0, -1).join('/') === key);
    return (
      <div
        key={key}
        className={`mslot ${m ? 'filled' : ''} ${nested ? 'sub' : ''}`}
        onMouseEnter={(e) => (e.stopPropagation(), setFocus(key))}
      >
        <div className="mslot-head">
          <span className="h small">
            {t.socket.label}
            {t.socket.required && !m && <span className="bad"> · required</span>}
          </span>
          {m ? (
            <button className="btn small" onClick={() => remove(t.path)}>
              Remove
            </button>
          ) : (
            <span className="faint small">empty</span>
          )}
        </div>
        {m && <div className="mslot-cur">{getDef(m.def).name}</div>}
        {options.length > 0 && (
          <div className="mslot-opts">
            {options.map((o) => (
              <button
                key={o.item.uid}
                className="mopt"
                onClick={() => (setTryOn(null), install(t.path, o.item.uid, o.grid))}
                onMouseEnter={() => setTryOn({ path: t.path, def: o.item.def })}
                onMouseLeave={() => setTryOn(null)}
                title={`${getDef(o.item.def).name} — from ${o.label}`}
              >
                <span>{getDef(o.item.def).name}</span>
                <span className="faint small">{o.label}</span>
              </button>
            ))}
          </div>
        )}
        {!m && !options.length && (
          <div className="faint small">{nested ? 'Nothing for it in your stash.' : 'No compatible parts — buy from Vera or loot gun-part boxes.'}</div>
        )}
        {kids.length > 0 && <div className="mslot-kids">{kids.map((c) => slotCard(c))}</div>}
      </div>
    );
  };

  const acc = (spread: number) => `${Math.max(0, Math.round(100 - spread * 1000))}`;
  return (
    <div className="modal-backdrop fade-in" onClick={() => useModder.getState().close()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel modal modder" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <span>Modify · {def.name}</span>
          <button className="btn ghost small" onClick={() => useModder.getState().close()}>
            ✕
          </button>
        </div>
        <GunViewer item={preview ?? gun} highlight={tryOn ? tryOn.path.join('/') : focus} />
        <div className="modder-body">
          <div className="modder-slots" onMouseLeave={() => (setFocus(null), setTryOn(null))}>
            {tree.filter((t) => t.path.length === 1).map((t) => slotCard(t))}
          </div>
          <div className="modder-stats">
            <div className="dim small">{preview ? `Stats · with ${getDef(tryOn!.def).name}` : 'Stats'}</div>
            {stat('Accuracy', +acc(ref.spread * ref.aimSpreadMul), +acc(shown.spread * shown.aimSpreadMul), (n) => `${n}`, 'up')}
            {stat('Recoil', ref.recoil * 1000, shown.recoil * 1000, (n) => n.toFixed(0), 'down')}
            {stat('Loudness (m)', ref.noise * 0.65, shown.noise * 0.65, (n) => n.toFixed(0), 'down')}
            {stat('Magazine', ref.magSize, shown.magSize, (n) => `${n}`, 'up')}
            {stat('Reload (s)', ref.reloadTime, shown.reloadTime, (n) => n.toFixed(1), 'down')}
            {stat('Aim zoom', ref.zoom, shown.zoom, (n) => `${n.toFixed(2)}×`, 'up')}
            {stat('Mobility', ref.ergo * 100, shown.ergo * 100, (n) => `${n.toFixed(0)}%`, 'up')}
            {!shown.operable && <div className="bad small">Missing a required part — it won't fire.</div>}
            <div className="mstat">
              <span className="dim">Suppressed</span>
              <span className={shown.suppressed ? 'good' : 'faint'}>{shown.suppressed ? 'yes — bots hear you at a third of the distance' : 'no'}</span>
            </div>
            <p className="faint small">Damage {def.weapon!.damage}{def.weapon!.pellets ? ` ×${def.weapon!.pellets}` : ''} · {def.weapon!.rpm} rpm · {def.weapon!.caliber}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
