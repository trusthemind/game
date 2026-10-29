import { getDef, itemValue, levelFromXp, RARITY_COLORS } from '@ashfall/engine';
import { useApp } from '../../state/appStore';
import { useProfile } from '../../state/profileStore';
import './menu.css';

const TITLES = { extracted: 'Survived', dead: 'Killed in action', mia: 'Missing in action', active: '' } as const;
const fmt = (n: number) => n.toLocaleString('en-US');

export function RaidEnd() {
  const last = useApp((s) => s.lastResult);
  const profile = useProfile((s) => s.profile);
  if (!last || !profile) return null;
  const { result, summary } = last;
  const survived = result.status === 'extracted';
  const kills = Object.entries(result.kills);
  const lvl = levelFromXp(profile.xp);
  const items = survived ? (result.loot?.length ?? countItems(result.playerEq)) : 0;
  const loot = summary.toStash ?? [];
  return (
    <div className="menu raid-end">
      <div className="menu-inner fade-in" style={{ maxWidth: 640 }}>
        <div>
          <div className={`h end-title ${survived ? 'good' : 'bad'}`}>{TITLES[result.status]}</div>
          <div className="dim">
            {Math.floor(result.duration / 60)}m {Math.floor(result.duration % 60)}s in the zone
          </div>
        </div>
        <div className="end-grid">
          <div className="stat">
            <span className="dim small">XP gained</span>
            <b className="mono">+{fmt(summary.xpGained)}</b>
          </div>
          <div className="stat">
            <span className="dim small">Level</span>
            <b className="mono">
              {summary.levelBefore}
              {summary.levelAfter > summary.levelBefore ? ` → ${summary.levelAfter} ▲` : ''}
            </b>
            <div className="bar">
              <i style={{ width: `${(lvl.into / lvl.next) * 100}%` }} />
            </div>
          </div>
          <div className="stat">
            <span className="dim small">Gear value</span>
            <b className={`mono ${survived ? 'good' : 'bad'}`}>
              {survived ? `${fmt(result.valueOut)} ₵` : `−${fmt(result.valueIn)} ₵`}
            </b>
          </div>
          <div className="stat">
            <span className="dim small">Profit</span>
            <b className={`mono ${result.valueOut - result.valueIn >= 0 ? 'good' : 'bad'}`}>{fmt(result.valueOut - result.valueIn)} ₵</b>
          </div>
          <div className="stat">
            <span className="dim small">Kills</span>
            <b className="mono">{kills.reduce((a, [, n]) => a + n, 0)}</b>
            <span className="dim small">{kills.map(([k, n]) => `${k} ×${n}`).join(' · ') || '—'}</span>
          </div>
          <div className="stat">
            <span className="dim small">Items extracted</span>
            <b className="mono">{items}</b>
            {summary.moneyFromItems > 0 && <span className="good small">+{fmt(summary.moneyFromItems)} ₵ deposited</span>}
          </div>
        </div>
        {survived && (
          <div className="end-loot">
            <div className="dim small">
              {loot.length ? `Moved to stash · ${loot.length} item${loot.length === 1 ? '' : 's'} · ${fmt(loot.reduce((s, it) => s + itemValue(it), 0))} ₵` : 'No loot carried out'}
              {items > loot.length && ` · ${items - loot.length} still on your gear`}
            </div>
            {loot.length > 0 && (
              <div className="loot-chips">
                {loot.map((it) => {
                  const d = getDef(it.def);
                  return (
                    <span key={it.uid} className="loot-chip" style={{ borderColor: RARITY_COLORS[d.rarity] }}>
                      {d.name}
                      {it.stack > 1 && <b className="mono"> ×{it.stack}</b>}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!survived && (
          <div className="end-loot">
            <div className="dim small">
              Secure container kept · {result.secure?.grid?.items.length ?? 0} item{(result.secure?.grid?.items.length ?? 0) === 1 ? '' : 's'}
            </div>
            {profile.grave && result.deathAt && <p className="warn small">Your body is still out there. Deploy to the same map to recover your gear — one attempt.</p>}
          </div>
        )}
        {result.companion && (
          <p className={result.companion.alive ? 'good' : 'bad'}>
            {result.companion.alive ? 'Your companion made it out with you.' : 'Your companion did not make it.'}
          </p>
        )}
        <button className="btn primary big-btn" onClick={() => useApp.getState().go('hideout')}>
          Back to hideout
        </button>
      </div>
    </div>
  );
}

function countItems(eq: NonNullable<ReturnType<typeof useApp.getState>['lastResult']>['result']['playerEq']): number {
  if (!eq) return 0;
  let n = 0;
  const walk = (items: { item: { def: string; grid?: { items: unknown[] } } }[]) => {
    for (const p of items) {
      if (getDef(p.item.def)) n++;
      if (p.item.grid) walk(p.item.grid.items as never);
    }
  };
  walk(eq.pockets.items);
  for (const s of Object.values(eq.slots)) if (s?.grid) walk(s.grid.items);
  return n;
}
