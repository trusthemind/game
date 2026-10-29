import { useEffect, useMemo, useState } from 'react';
import {
  buy,
  buyPrice,
  canClaimFreeKit,
  equipmentValue,
  levelFromXp,
  NPCS,
  npcAtHideout,
  stageOf,
  STAGE_LABEL,
  starterKit,
  traderCatalog,
  traderDiscount,
  type Category,
  MAP_PRESETS,
  type MapId,
} from '@ashfall/engine';
import { useApp, type HideoutTab } from '../../state/appStore';
import { useProfile } from '../../state/profileStore';
import { api } from '../../state/api';
import { DropZoneBox, InventoryRoot, ItemGrid } from '../inventory/components';
import { GearPanel } from '../inventory/GearPanel';
import { makeProfileHost } from '../inventory/hosts';
import { CategoryIcon } from '../inventory/icons';
import { DialogueBox } from '../components/DialogueBox';
import { hideoutDialogueHost } from '../dialogueHosts';
import { SyncBadge } from '../components/SyncBadge';
import { audio } from '../../audio/AudioEngine';
import { usePortrait } from '../components/usePortrait';
import './hideout.css';

const fmt = (n: number) => n.toLocaleString('en-US');
const TABS: { id: HideoutTab; label: string }[] = [
  { id: 'gear', label: 'Stash & Gear' },
  { id: 'trader', label: 'Trader' },
  { id: 'survivors', label: 'Survivors' },
  { id: 'stats', label: 'Profile' },
];

export function Hideout() {
  const profile = useProfile((s) => s.profile)!;
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const dialogueNpc = useApp((s) => s.dialogueNpc);
  const host = useMemo(() => makeProfileHost(), []);
  const [deploy, setDeploy] = useState(false);
  const dialogueHost = useMemo(() => (dialogueNpc ? hideoutDialogueHost(dialogueNpc) : null), [dialogueNpc]);
  const lvl = levelFromXp(profile.xp);

  return (
    <div className="hideout">
      <header className="topbar">
        <div className="brand h">
          Ash<span>fall</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <div className="lvl">
            <span className="h">{profile.name}</span>
            <span className="mono dim">LVL {lvl.level}</span>
            <div className="bar xp">
              <i style={{ width: `${(lvl.into / lvl.next) * 100}%` }} />
            </div>
          </div>
          <div className="money mono">{fmt(profile.money)} ₵</div>
          <SyncBadge />
          <button className="btn primary deploy" onClick={() => setDeploy(true)}>
            Deploy ▸
          </button>
        </div>
      </header>

      <InventoryRoot host={host} version={profile.rev}>
        <main className="hideout-main fade-in" key={tab}>
          {tab === 'gear' && <GearTab />}
          {tab === 'trader' && <TraderTab />}
          {tab === 'survivors' && <SurvivorsTab />}
          {tab === 'stats' && <StatsTab />}
        </main>
      </InventoryRoot>

      {deploy && <DeployModal onClose={() => setDeploy(false)} />}
      {dialogueNpc && dialogueHost && (
        <DialogueBox
          key={dialogueNpc}
          npcId={dialogueNpc}
          rel={profile.npcs[dialogueNpc]!}
          host={dialogueHost}
          onRelChange={(r) => useProfile.getState().mutate((d) => void (d.npcs[dialogueNpc] = r))}
          onClose={() => useApp.getState().openDialogue(null)}
        />
      )}
    </div>
  );
}

function GearTab() {
  const profile = useProfile((s) => s.profile)!;
  const freeKit = canClaimFreeKit(profile);
  return (
    <div className="gear-tab">
      <section className="panel col">
        <div className="panel-title">
          <span>Loadout</span>
          <span className="dim">At risk: {fmt(equipmentValue(profile.equipment))} ₵</span>
        </div>
        <div className="pad">
          <GearPanel owner="player" cell={50} />
          {freeKit && (
            <div className="free-kit">
              <p>Out of guns and money? Mykola can spare a survivor kit.</p>
              <button
                className="btn"
                onClick={() =>
                  useProfile.getState().mutate((d) => {
                    d.equipment = starterKit();
                    d.lastFreeKit = Date.now();
                  })
                }
              >
                Take survivor kit
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="panel col stash-col">
        <div className="panel-title">
          <span>Stash</span>
          <span className="dim">
            <span className="kbd">⇧</span>+click to move · double-click to equip · <span className="kbd">R</span> rotate while dragging
          </span>
        </div>
        <div className="pad">
          <ItemGrid gridId="stash" cell={50} maxHeight={window.innerHeight - 190} />
        </div>
      </section>
    </div>
  );
}

const CATS: (Category | 'all')[] = ['all', 'weapon', 'melee', 'ammo', 'armor', 'helmet', 'rig', 'backpack', 'med', 'food', 'drink'];

function TraderTab() {
  const profile = useProfile((s) => s.profile)!;
  const [cat, setCat] = useState<Category | 'all'>('all');
  const catalog = traderCatalog(profile).filter((e) => cat === 'all' || e.def.category === cat);
  const level = levelFromXp(profile.xp).level;
  const vera = profile.npcs.vera!;
  return (
    <div className="trader-tab">
      <section className="panel col">
        <div className="trader-head">
          <div className="portrait-ring small" style={{ ['--npc' as string]: NPCS.vera!.color }}>
            <span>В</span>
          </div>
          <div>
            <div className="h">Віра · Trader</div>
            <div className="dim small">
              {STAGE_LABEL[stageOf(vera)]} · discount {Math.round(traderDiscount(profile) * 100)}%
            </div>
          </div>
          <button className="btn small" onClick={() => useApp.getState().openDialogue('vera')}>
            Talk
          </button>
        </div>
        <div className="chips">
          {CATS.map((c) => (
            <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="catalog">
          {catalog.map(({ def, stack, minLevel }) => {
            const price = buyPrice(def, profile, stack);
            const locked = minLevel > level;
            return (
              <div key={def.id} className={`offer r${def.rarity} ${locked ? 'locked' : ''}`}>
                <div className="offer-icon">
                  <CategoryIcon category={def.category} size={26} />
                </div>
                <div className="offer-info">
                  <div className="offer-name">
                    {def.name}
                    {stack > 1 && <span className="dim"> ×{stack}</span>}
                  </div>
                  <div className="dim small">{offerSub(def)}</div>
                </div>
                <button
                  className="btn small"
                  disabled={locked || profile.money < price}
                  onClick={() => {
                    let res: { ok: boolean; reason?: string } = { ok: false };
                    useProfile.getState().tryMutate((d) => (res = buy(d, def.id, stack)).ok);
                    if (!res.ok) useApp.getState().toast(res.reason ?? 'Cannot buy', 'bad');
                  }}
                >
                  {locked ? `LVL ${minLevel}` : `${fmt(price)} ₵`}
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel col stash-col">
        <div className="panel-title">
          <span>Stash</span>
          <span className="dim">Drag here ↓ or right-click → Sell</span>
        </div>
        <div className="pad">
          <DropZoneBox zone="sell" label="Drop to sell" className="sell" />
          <ItemGrid gridId="stash" cell={44} maxHeight={window.innerHeight - 280} />
        </div>
      </section>
    </div>
  );
}

function offerSub(def: ReturnType<typeof traderCatalog>[number]['def']): string {
  if (def.weapon) return `${def.weapon.caliber} · ${def.weapon.damage} dmg · ${def.weapon.rpm} rpm`;
  if (def.melee) return `${def.melee.damage} dmg · ${(1 / def.melee.cooldown).toFixed(1)} hits/s`;
  if (def.ammo) return `pen ${def.ammo.penetration} · ${def.ammo.caliber}`;
  if (def.armor) return `class ${def.armor.armorClass} · ${def.armor.durability} dur`;
  if (def.grid) return `${def.grid.w}×${def.grid.h} slots`;
  if (def.med) return [def.med.resource && `${def.med.resource} HP`, def.med.stopsHeavy && 'heavy bleed', def.med.stopsLight && 'bleed', def.med.fixesFracture && 'fracture', def.med.surgery && 'surgery', def.med.painkiller && 'painkiller'].filter(Boolean).join(' · ');
  if (def.food) return `energy ${def.food.energy} · water ${def.food.hydration}`;
  return def.category;
}

function SurvivorsTab() {
  const profile = useProfile((s) => s.profile)!;
  return (
    <div className="survivors">
      {Object.values(NPCS).map((npc) => {
        const rel = profile.npcs[npc.id]!;
        const here = npcAtHideout(npc, rel);
        const stage = stageOf(rel);
        const quests = Object.entries({ q_tools_active: 'Find a toolset for Mykola', q_batt_active: 'Find a car battery', q_salewa_active: 'Bring Olena a Salewa kit', q_intel_active: 'Bring Vera the intelligence folder' }).filter(([f]) => rel.flags.includes(f));
        if (!here && !rel.met && !rel.dead) {
          return (
            <div key={npc.id} className="npc-card unknown panel">
              <div className="portrait-ring">
                <span>?</span>
              </div>
              <div className="h">Unknown survivor</div>
              <p className="dim">Rumours say someone is hiding in the zone. Maybe you'll cross paths.</p>
            </div>
          );
        }
        return (
          <div key={npc.id} className={`npc-card panel ${rel.dead ? 'dead' : ''}`} style={{ ['--npc' as string]: npc.color }}>
            <NpcPortrait npcId={npc.id} letter={npc.name[0]!} />
            <div className="h">{npc.name}</div>
            <div className="dim small">{npc.role}</div>
            <p className="bio">{npc.bio}</p>
            {rel.dead ? (
              <div className="bad h">Dead</div>
            ) : (
              <>
                <div className="rel">
                  <div className="rel-label">
                    <span>{STAGE_LABEL[stage]}</span>
                    <span className="mono">{rel.affinity}</span>
                  </div>
                  <div className="rel-bar">
                    <i style={{ width: `${(rel.affinity + 100) / 2}%` }} />
                    <b />
                  </div>
                </div>
                {quests.length > 0 && (
                  <ul className="quests">
                    {quests.map(([f, q]) => (
                      <li key={f}>{q}</li>
                    ))}
                  </ul>
                )}
                {profile.companion === npc.id && <div className="companion-badge">Joins your next raid</div>}
                {here ? (
                  <button className="btn" onClick={() => useApp.getState().openDialogue(npc.id)}>
                    Talk
                  </button>
                ) : (
                  <div className="dim small">Last seen in the zone</div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NpcPortrait({ npcId, letter }: { npcId: string; letter: string }) {
  const url = usePortrait(npcId);
  return <div className="portrait-ring">{url ? <img src={url} alt="" /> : <span>{letter}</span>}</div>;
}

function StatsTab() {
  const profile = useProfile((s) => s.profile)!;
  const auth = useProfile((s) => s.auth);
  const [code, setCode] = useState<string | null>(null);
  const [claim, setClaim] = useState('');
  const [board, setBoard] = useState<{ name: string; level: number; xp: number; survived: number; kills: number }[] | null>(null);
  useEffect(() => {
    api
      .leaderboard()
      .then((r) => setBoard(r.entries))
      .catch(() => setBoard(null));
  }, []);
  const s = profile.stats;
  const sr = s.raids ? Math.round((s.survived / s.raids) * 100) : 0;
  return (
    <div className="stats-tab">
      <section className="panel col">
        <div className="panel-title">
          <span>Record</span>
        </div>
        <div className="stat-grid pad">
          {[
            ['Raids', s.raids],
            ['Survived', `${s.survived} (${sr}%)`],
            ['Kills', s.kills],
            ['Deaths', s.deaths],
            ['MIA', s.mia],
            ['Best haul', `${fmt(s.bestHaul)} ₵`],
            ['Time in raids', `${Math.round(s.timePlayed / 60)} min`],
            ['XP', fmt(profile.xp)],
          ].map(([k, v]) => (
            <div key={k as string} className="stat">
              <span className="dim small">{k}</span>
              <b className="mono">{v}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="panel col">
        <div className="panel-title">
          <span>Cloud save & devices</span>
          <SyncBadge />
        </div>
        <div className="pad stack">
          <p className="dim">Your progress is saved locally and synced to the server, so you can come back any time — or continue on another Mac.</p>
          {auth ? (
            <>
              <button className="btn" onClick={() => api.linkCode(auth).then((r) => setCode(r.code)).catch(() => useApp.getState().toast('Server unreachable', 'bad'))}>
                Show link code
              </button>
              {code && <div className="link-code mono">{code}</div>}
            </>
          ) : (
            <p className="dim small">Offline: playing with a local save.</p>
          )}
          <div className="row">
            <input className="input" placeholder="Enter code from another device" value={claim} onChange={(e) => setClaim(e.target.value)} />
            <button
              className="btn"
              disabled={claim.length < 4}
              onClick={async () => {
                const ok = await useProfile.getState().linkDevice(claim);
                useApp.getState().toast(ok ? 'Profile loaded from cloud' : 'Invalid code', ok ? 'good' : 'bad');
              }}
            >
              Link
            </button>
          </div>
        </div>
        <div className="panel-title">
          <span>Settings</span>
        </div>
        <div className="pad stack">
          <label className="row">
            <span>Graphics quality</span>
            <select className="input" value={profile.settings.quality} onChange={(e) => useProfile.getState().mutate((d) => (d.settings.quality = e.target.value as never))}>
              <option value="auto">Auto (adaptive)</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={profile.settings.volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                audio.setVolume(v);
                useProfile.getState().mutate((d) => (d.settings.volume = v));
              }}
            />
          </label>
          <label className="row">
            <span>Performance overlay (F3)</span>
            <input type="checkbox" checked={profile.settings.showPerf} onChange={(e) => useProfile.getState().mutate((d) => (d.settings.showPerf = e.target.checked))} />
          </label>
        </div>
      </section>
      <section className="panel col">
        <div className="panel-title">
          <span>Leaderboard</span>
        </div>
        <div className="pad">
          {board === null ? (
            <p className="dim">Leaderboard is available when the server is online.</p>
          ) : (
            <table className="board">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>LVL</th>
                  <th>Survived</th>
                  <th>Kills</th>
                </tr>
              </thead>
              <tbody>
                {board.map((e, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{e.name}</td>
                    <td className="mono">{e.level}</td>
                    <td className="mono">{e.survived}</td>
                    <td className="mono">{e.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function DeployModal({ onClose }: { onClose(): void }) {
  const profile = useProfile((s) => s.profile)!;
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 99999));
  const [mapId, setMapId] = useState<MapId>(useApp.getState().raidMap);
  const [time, setTime] = useState(useApp.getState().raidTime);
  const comp = profile.companion ? NPCS[profile.companion] : null;
  const atRisk = equipmentValue(profile.equipment);
  const armed = !!(profile.equipment.slots.primary || profile.equipment.slots.secondary);
  return (
    <div className="modal-backdrop fade-in" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <span>Deploy to the zone</span>
          <button className="btn ghost small" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="pad stack">
          <div className="map-picks">
            {(['outskirts', 'pinehollow', 'portkirov'] as const).map((id) => {
              const m = MAP_PRESETS[id];
              return (
                <button key={id} className={`map-pick ${mapId === id ? 'on' : ''}`} onClick={() => setMapId(id)}>
                  <span className={`map-thumb ${id}`} />
                  <span className="h">{m.name}</span>
                  <span className="dim small">{m.tagline}</span>
                  <span className="faint small mono">
                    {m.size}×{m.size} m · {m.raidMinutes} min
                  </span>
                </button>
              );
            })}
          </div>
          <div className="deploy-grid">
            <div>
              <div className="dim small">Gear at risk</div>
              <div className="mono big accent">{fmt(atRisk)} ₵</div>
            </div>
            <div>
              <div className="dim small">Companion</div>
              <div className="h">{comp ? comp.name : '—'}</div>
            </div>
            <div>
              <div className="dim small">Time of day</div>
              <div className="seg">
                {(['random', 'day', 'dusk', 'night'] as const).map((t) => (
                  <button key={t} className={time === t ? 'on' : ''} onClick={() => setTime(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="dim small">Zone seed</div>
              <input className="input mono" value={seed} onChange={(e) => setSeed(Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </div>
          </div>
          {!armed && <p className="bad small">You have no firearm equipped. A knife won't stop a raider.</p>}
          <p className="dim small">Find an extraction point and stay inside it to leave. Die or run out of time and everything you carry is lost.</p>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              useApp.getState().startRaid(seed, mapId, time);
            }}
          >
            Enter raid
          </button>
        </div>
      </div>
    </div>
  );
}
