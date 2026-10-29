import { useEffect } from 'react';
import { useRaidUi } from '../../game/hudStore';
import type { GameSession } from '../../game/GameSession';

/** Project Zomboid-style right-click menu for things in the world (and yourself). */
export function WorldMenu({ session }: { session: GameSession }) {
  const menu = useRaidUi((s) => s.worldMenu);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent | PointerEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && (e.target as HTMLElement).closest('.world-menu')) return;
      session.pickWorldMenu(null);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [menu, session]);
  if (!menu) return null;
  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 40 - menu.options.length * 34);
  return (
    <div className="ctx-menu world-menu fade-in" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{menu.title}</div>
      {menu.options.map((o, i) => (
        <button key={o} className="ctx-item" onClick={() => session.pickWorldMenu(i)}>
          {o}
        </button>
      ))}
    </div>
  );
}
