import {
  claimTask,
  firCount,
  getDef,
  handOver,
  levelFromXp,
  NPCS,
  objectiveProgress,
  objectiveTarget,
  TASKS,
  taskComplete,
  taskUnlocked,
  type Profile,
  type TaskDef,
} from '@ashfall/engine';
import { useProfile } from '../../state/profileStore';
import { useApp } from '../../state/appStore';
import { usePortrait } from '../components/usePortrait';
import { audio } from '../../audio/AudioEngine';

const fmt = (n: number) => n.toLocaleString('en-US');
const GIVERS = ['mykola', 'vera', 'lena'] as const;

/** The task board: what each survivor wants, what you've done, and what it pays. */
export function TasksTab() {
  const profile = useProfile((s) => s.profile)!;
  const level = levelFromXp(profile.xp).level;
  return (
    <div className="tasks-tab">
      <Onboarding profile={profile} />
      {GIVERS.map((g) => (
        <section key={g} className="panel task-col">
          <GiverHead id={g} profile={profile} />
          <div className="task-list">
            {TASKS.filter((t) => t.giver === g).map((t) => (
              <TaskCard key={t.id} t={t} profile={profile} level={level} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GiverHead({ id, profile }: { id: (typeof GIVERS)[number]; profile: Profile }) {
  const portrait = usePortrait(id);
  const rel = profile.npcs[id];
  const done = TASKS.filter((t) => t.giver === id && profile.tasks?.[t.id]?.claimed).length;
  return (
    <div className="giver">
      {portrait ? <img src={portrait} alt="" /> : <span className="giver-ph" />}
      <div>
        <div className="h">{NPCS[id]?.name ?? id}</div>
        <div className="dim small">
          {done}/{TASKS.filter((t) => t.giver === id).length} tasks · affinity {Math.round(rel?.affinity ?? 0)}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ t, profile, level }: { t: TaskDef; profile: Profile; level: number }) {
  const s = profile.tasks?.[t.id];
  const unlocked = taskUnlocked(profile, t, level);
  const complete = unlocked && taskComplete(profile, t);
  const claimed = !!s?.claimed;
  const mutate = useProfile.getState().mutate;
  if (claimed)
    return (
      <div className="task done">
        <span className="h small">✓ {t.title}</span>
      </div>
    );
  if (!unlocked) {
    const need = [
      ...(t.requires?.level && level < t.requires.level ? [`level ${t.requires.level}`] : []),
      ...(t.requires?.tasks ?? []).filter((id) => !profile.tasks?.[id]?.claimed).map((id) => `“${TASKS.find((x) => x.id === id)?.title}”`),
    ];
    return (
      <div className="task locked">
        <span className="h small">🔒 {t.title}</span>
        <span className="faint small">Requires {need.join(' and ')}</span>
      </div>
    );
  }
  return (
    <div className={`task ${complete ? 'ready' : ''}`}>
      <div className="task-title h">{t.title}</div>
      <p className="dim small task-brief">{t.brief}</p>
      <div className="objectives">
        {t.objectives.map((o, i) => {
          const v = objectiveProgress(o, s?.progress[i] ?? 0);
          const max = objectiveTarget(o);
          const have = o.kind === 'handover' ? firCount(profile.stash, o.item) : 0;
          return (
            <div key={i} className={`objective ${v >= max ? 'met' : ''}`}>
              <div className="obj-row">
                <span>{o.text}</span>
                <span className="mono">
                  {v}/{max}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
              </div>
              {o.kind === 'handover' && v < max && (
                <button
                  className="btn small"
                  disabled={have === 0}
                  title="Only items found in raid count (carried out alive)"
                  onClick={() => {
                    let n = 0;
                    mutate((d) => void (n = handOver(d, t.id, i)));
                    if (n) {
                      audio.ui('move');
                      useApp.getState().toast(`Handed over ${n}× ${getDef(o.item).name}`, 'good');
                    }
                  }}
                >
                  Hand over · {have} found in raid
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="task-reward small">
        <span className="dim">Reward</span>
        {t.reward.money ? <span className="mono accent">{fmt(t.reward.money)} ₵</span> : null}
        {t.reward.xp ? <span className="mono">+{fmt(t.reward.xp)} XP</span> : null}
        {(t.reward.items ?? []).map(([id, n]) => (
          <span key={id} className="chip">
            {getDef(id).name}
            {n > 1 ? ` ×${n}` : ''}
          </span>
        ))}
      </div>
      {complete && (
        <button
          className="btn primary"
          onClick={() => {
            let ok = false;
            mutate((d) => void (ok = claimTask(d, t.id, level)));
            if (ok) {
              audio.ui('equip');
              useApp.getState().toast(`Task complete: ${t.title}`, 'good');
            }
          }}
        >
          Claim reward
        </button>
      )}
    </div>
  );
}

/** First-session guide: what the game loop is. Hidden once the first task is claimed. */
function Onboarding({ profile }: { profile: Profile }) {
  if (profile.tasks?.first_steps?.claimed) return null;
  return (
    <section className="panel onboarding">
      <div className="h">How Ashfall works</div>
      <ol>
        <li>
          <b>Gear up</b> in Stash &amp; Gear. What you take into a raid is at risk — your <b>secure container</b> always comes home.
        </li>
        <li>
          <b>Deploy</b> to a location. Loot buildings, bodies, airdrops and crash sites. Bosses carry the best gear.
        </li>
        <li>
          <b>Extract</b>: reach a green exit and stay inside it. Die and you lose your kit (on Normal your body waits for one recovery run).
        </li>
        <li>
          <b>Do tasks</b> for Mykola, Vera and Lena below: money, XP, rare items and better prices.
        </li>
        <li>
          <b>Sell</b> what you don't need to Vera, <b>mod</b> your guns (right-click a gun → Modify) and go again, better equipped.
        </li>
      </ol>
      <p className="faint small">Controls: WASD move · Shift sprint · RMB hold aim · LMB fire · R reload · E interact · quick RMB on anything for actions · Tab inventory · Q heal · V eat · M map · C crouch · F flashlight</p>
    </section>
  );
}
