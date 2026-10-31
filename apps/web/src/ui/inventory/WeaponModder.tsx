import { useContext } from 'react';
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
        <div className="modder-body">
          <div className="modder-slots">
            {tree.map((t) => {
              const m = t.part;
              const key = t.path.join('/');
              const options = available.filter((a) => a.item.uid !== m?.uid && partFits(a.item.def, t.socket, t.host.def, gun.def));
              return (
                <div key={key} className={`mslot ${m ? 'filled' : ''}`} style={{ marginLeft: (t.path.length - 1) * 14 }}>
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
                        <button key={o.item.uid} className="mopt" onClick={() => install(t.path, o.item.uid, o.grid)} title={`From ${o.label}`}>
                          <span>{getDef(o.item.def).short}</span>
                          <span className="faint small">{o.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!m && !options.length && <div className="faint small">No compatible parts — buy from Vera or loot gun-part boxes.</div>}
                </div>
              );
            })}
          </div>
          <div className="modder-stats">
            <div className="dim small">Stats</div>
            {stat('Accuracy', +acc(base.spread * base.aimSpreadMul), +acc(cur.spread * cur.aimSpreadMul), (n) => `${n}`, 'up')}
            {stat('Recoil', base.recoil * 1000, cur.recoil * 1000, (n) => n.toFixed(0), 'down')}
            {stat('Loudness (m)', base.noise * 0.65, cur.noise * 0.65, (n) => n.toFixed(0), 'down')}
            {stat('Magazine', base.magSize, cur.magSize, (n) => `${n}`, 'up')}
            {stat('Reload (s)', base.reloadTime, cur.reloadTime, (n) => n.toFixed(1), 'down')}
            {stat('Aim zoom', base.zoom, cur.zoom, (n) => `${n.toFixed(2)}×`, 'up')}
            {stat('Mobility', base.ergo * 100, cur.ergo * 100, (n) => `${n.toFixed(0)}%`, 'up')}
            {!cur.operable && <div className="bad small">Missing a required part — it won't fire.</div>}
            <div className="mstat">
              <span className="dim">Suppressed</span>
              <span className={cur.suppressed ? 'good' : 'faint'}>{cur.suppressed ? 'yes — bots hear you at a third of the distance' : 'no'}</span>
            </div>
            <p className="faint small">Damage {def.weapon!.damage}{def.weapon!.pellets ? ` ×${def.weapon!.pellets}` : ''} · {def.weapon!.rpm} rpm · {def.weapon!.caliber}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
