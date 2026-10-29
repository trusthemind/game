import { useEffect, useState } from 'react';
import {
  canCraft,
  collectCraft,
  collectFarm,
  farmReady,
  getDef,
  RECIPES,
  STATIONS,
  stashCount,
  startCraft,
  stationLevel,
  upgradeBlocker,
  upgradeStation,
  type Profile,
  type StationDef,
} from '@ashfall/engine';
import { useProfile } from '../../state/profileStore';
import { useApp } from '../../state/appStore';
import { audio } from '../../audio/AudioEngine';

const fmt = (n: number) => n.toLocaleString('en-US');
const mins = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Base building: stations, upgrades, crafting and the bitcoin farm. */
export function BaseTab() {
  const profile = useProfile((s) => s.profile)!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="base-tab">
      {STATIONS.map((s) => (
        <StationCard key={s.id} s={s} profile={profile} now={now} />
      ))}
    </div>
  );
}

function StationCard({ s, profile, now }: { s: StationDef; profile: Profile; now: number }) {
  const lvl = stationLevel(profile, s.id);
  const next = s.levels[lvl];
  const blocker = upgradeBlocker(profile, s.id);
  const mutate = useProfile.getState().mutate;
  const job = profile.hideout?.crafts[s.id];
  const recipes = RECIPES.filter((r) => r.station === s.id);
  return (
    <section className={`panel station ${lvl ? 'built' : ''}`}>
      <div className="station-head">
        <div>
          <div className="h">{s.name}</div>
          <div className="faint small">{s.blurb}</div>
        </div>
        <div className="lvl-pips">
          {s.levels.map((_, i) => (
            <i key={i} className={i < lvl ? 'on' : ''} />
          ))}
        </div>
      </div>
      {lvl > 0 && <div className="good small">✓ {s.levels[lvl - 1]!.bonus}</div>}
      {next && (
        <div className="upgrade">
          <div className="dim small">
            {lvl ? 'Next level' : 'Build'}: {next.bonus}
          </div>
          <div className="cost">
            <span className={`chip mono ${profile.money >= next.money ? '' : 'bad'}`}>{fmt(next.money)} ₵</span>
            {next.items.map(([id, n]) => {
              const have = stashCount(profile.stash, id);
              return (
                <span key={id} className={`chip ${have >= n ? '' : 'bad'}`}>
                  {getDef(id).name} {Math.min(have, n)}/{n}
                </span>
              );
            })}
          </div>
          <button
            className="btn small"
            disabled={!!blocker}
            title={blocker ?? ''}
            onClick={() => {
              let ok = false;
              mutate((d) => void (ok = upgradeStation(d, s.id)));
              if (ok) {
                audio.ui('equip');
                useApp.getState().toast(`${s.name} upgraded`, 'good');
              }
            }}
          >
            {blocker ?? (lvl ? 'Upgrade' : 'Build')}
          </button>
        </div>
      )}
      {s.id === 'farm' && lvl > 0 && (
        <div className="craft-job">
          <span>
            Bitcoins ready: <b className="mono">{farmReady(profile, now)}</b>
          </span>
          <button className="btn small" disabled={farmReady(profile, now) === 0} onClick={() => mutate((d) => void collectFarm(d))}>
            Collect
          </button>
        </div>
      )}
      {recipes.length > 0 && lvl > 0 && (
        <div className="recipes">
          {job && (() => {
            const r = RECIPES.find((x) => x.id === job.recipe)!;
            const total = r.minutes * 60_000;
            const left = job.readyAt - now;
            return (
              <div className="craft-job">
                <span>
                  {getDef(r.output[0]).name} ×{r.output[1]} — {left > 0 ? mins(left) : 'ready'}
                </span>
                <div className="bar">
                  <i style={{ width: `${Math.min(100, ((total - left) / total) * 100)}%` }} />
                </div>
                <button className="btn small primary" disabled={left > 0} onClick={() => mutate((d) => void collectCraft(d, s.id))}>
                  Collect
                </button>
              </div>
            );
          })()}
          {recipes.map((r) => {
            const why = canCraft(profile, r);
            const locked = lvl < r.level;
            return (
              <div key={r.id} className={`recipe ${locked ? 'locked' : ''}`}>
                <span className="small">
                  {r.inputs.map(([id, n]) => `${getDef(id).short} ×${n}`).join(' + ')} → <b>{getDef(r.output[0]).name}</b> ×{r.output[1]}
                </span>
                <span className="faint small mono">{r.minutes}m</span>
                <button className="btn small" disabled={!!why} title={why ?? ''} onClick={() => mutate((d) => void startCraft(d, r.id))}>
                  {locked ? `Lvl ${r.level}` : 'Craft'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
