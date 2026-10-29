import { useEffect, useMemo, useRef, useState } from 'react';
import { applyRaidResult, createEquipment, CONTAINERS, NPCS, PART_LABEL, type RaidResult, type RaidSummary } from '@ashfall/engine';
import { GameSession } from '../../game/GameSession';
import { useRaidUi } from '../../game/hudStore';
import { useApp } from '../../state/appStore';
import { useProfile } from '../../state/profileStore';
import { api } from '../../state/api';
import { detectQuality, type QualityLevel } from '../../render/quality';
import { loadAssets } from '../../render/assets';
import { Hud } from '../hud/Hud';
import { WorldMenu } from '../hud/WorldMenu';
import { Minimap } from '../hud/Minimap';
import { DialogueBox } from '../components/DialogueBox';
import { raidDialogueHost } from '../dialogueHosts';
import { InventoryRoot, ItemGrid, DropZoneBox } from '../inventory/components';
import { BodyFigure } from '../components/BodyFigure';
import { GearPanel } from '../inventory/GearPanel';
import { makeRaidHost } from '../inventory/hosts';
import './raid.css';

export function resolveQuality(q: string): QualityLevel {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  return q === 'auto' ? detectQuality() : (q as QualityLevel);
}

export function RaidScreen() {
  const seed = useApp((s) => s.raidSeed);
  const mapId = useApp((s) => s.raidMap);
  const raidTime = useApp((s) => s.raidTime);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let s: GameSession | null = null;
    let cancelled = false;
    loadAssets(setProgress)
      .then((assets) => {
        const profile = useProfile.getState().profile;
        if (cancelled || !profile || !canvasRef.current) return;
        const draft = structuredClone(profile);
        s = new GameSession({
          canvas: canvasRef.current,
          labelLayer: labelsRef.current,
          seed,
          mapId,
          timeOfDay: raidTime === 'random' ? undefined : raidTime,
          profile: draft,
          quality: resolveQuality(profile.settings.quality),
          assets,
          onEnd: (result) => finishRaid(result),
        });
        // Your gear is now in the raid. Close the tab and it's gone — that's the deal.
        useProfile.getState().mutate((d) => {
          d.equipment = createEquipment();
          d.companionEq = draft.companionEq;
        });
        void useProfile.getState().flush();
        useRaidUi.setState({ overlay: null, hud: null, messages: [], loot: null, dialogueActor: null, showPerf: profile.settings.showPerf });
        s.start();
        setSession(s);
        (window as unknown as { __ashfall?: GameSession }).__ashfall = s;
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      s?.dispose();
    };
    // The raid is keyed by seed; map and time of day are chosen together with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  if (error) {
    return (
      <div className="raid-error">
        <div className="h">Renderer failed to start</div>
        <p className="dim">{error}</p>
        <button className="btn" onClick={() => useApp.getState().go('hideout')}>
          Back to hideout
        </button>
      </div>
    );
  }

  return (
    <div className="raid-screen">
      <canvas ref={canvasRef} className="raid-canvas" />
      <div ref={labelsRef} className="labels" />
      {session ? (
        <RaidOverlays session={session} />
      ) : (
        <div className="raid-loading">
          <div className="h">Entering the zone</div>
          <div className="bar">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function finishRaid(result: RaidResult) {
  let summary: RaidSummary | null = null;
  useProfile.getState().mutate((d) => {
    summary = applyRaidResult(d, result);
  });
  const { auth } = useProfile.getState();
  void useProfile.getState().flush();
  if (auth) {
    const kills = Object.values(result.kills).reduce((a, b) => a + b, 0);
    void api.postRaid(auth, { status: result.status, kills, xp: result.xp, value: result.valueOut - result.valueIn, duration: Math.round(result.duration) }).catch(() => {});
  }
  useApp.getState().finishRaid(result, summary!);
}

/** Key hints for the very first raid; fades out after a minute or on H. */
function FirstRaidHints() {
  const first = useProfile((s) => (s.profile?.stats.raids ?? 1) === 0);
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!first) return;
    const t = setTimeout(() => setOn(false), 60_000);
    const k = (e: KeyboardEvent) => e.code === 'KeyH' && setOn((v) => !v);
    window.addEventListener('keydown', k);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', k);
    };
  }, [first]);
  if (!first || !on) return null;
  return (
    <div className="first-hints panel-lite fade-in">
      <div className="h small">First raid · H to hide</div>
      <div className="hint-grid small">
        {[
          ['WASD', 'move'],
          ['Shift', 'sprint'],
          ['C', 'crouch (quieter, harder to spot)'],
          ['Hold RMB', 'aim — much more accurate'],
          ['LMB', 'fire · R reload · 1/2/3 weapons'],
          ['E', 'search / loot / climb windows'],
          ['Quick RMB', 'actions on anything you click'],
          ['Tab', 'inventory · Q heal · V eat/drink'],
          ['M', 'map — find a green exit and stay in it'],
        ].map(([k, v]) => (
          <div key={k}>
            <span className="kbd">{k}</span> {v}
          </div>
        ))}
      </div>
    </div>
  );
}

function RaidOverlays({ session }: { session: GameSession }) {
  const overlay = useRaidUi((s) => s.overlay);
  const showPerf = useRaidUi((s) => s.showPerf);
  return (
    <>
      <Hud session={session} />
      <Crosshair hidden={!!overlay} />
      <WorldMenu session={session} />
      <FirstRaidHints />
      {showPerf && <PerfOverlay />}
      {(overlay === 'inventory' || overlay === 'loot') && <InventoryOverlay session={session} />}
      {overlay === 'dialogue' && <RaidDialogue session={session} />}
      {overlay === 'pause' && <PauseMenu session={session} />}
      {overlay === 'map' && (
        <div className="overlay center" onClick={() => session.closeOverlay()}>
          <div className="panel map-panel">
            <div className="panel-title">
              <span>Map · explored areas</span>
              <span className="kbd">M</span>
            </div>
            <Minimap raid={session.raid} size={Math.min(720, window.innerHeight - 140)} full />
          </div>
        </div>
      )}
    </>
  );
}

function Crosshair({ hidden }: { hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);
  return <div ref={ref} className="crosshair" style={{ display: hidden ? 'none' : 'block' }} />;
}

function PerfOverlay() {
  const p = useRaidUi((s) => s.perf);
  if (!p) return null;
  return (
    <div className="perf panel-lite">
      <div>
        FPS <b>{p.fps.toFixed(0)}</b> · {p.ms.toFixed(1)}ms · p99 {p.p99.toFixed(1)}ms
      </div>
      <div>
        sim {p.sim.toFixed(2)}ms · render {p.render.toFixed(2)}ms
      </div>
      <div>
        draw calls {p.calls} · tris {(p.tris / 1000).toFixed(0)}k
      </div>
      <div>
        res scale {(p.scale * 100).toFixed(0)}% · actors {p.actors}
      </div>
      <div>path cache hit {(p.pathHit * 100).toFixed(0)}%</div>
    </div>
  );
}

function InventoryOverlay({ session }: { session: GameSession }) {
  const version = useRaidUi((s) => s.invVersion);
  const loot = useRaidUi((s) => s.loot);
  const host = useMemo(() => makeRaidHost(session), [session]);
  const raid = session.raid;
  const container = loot?.kind === 'container' ? raid.container(loot.id) : null;
  const corpse = loot?.kind === 'corpse' ? raid.corpse(loot.id) : null;
  return (
    <div className="overlay inv-overlay" onContextMenu={(e) => e.preventDefault()}>
      <InventoryRoot host={host} version={version}>
        <div className="inv-layout">
          <div className="panel inv-col">
            <div className="panel-title">
              <span>Your gear</span>
              <span>
                <span className="kbd">Tab</span> close · <span className="kbd">R</span> rotate · <span className="kbd">⇧</span>+click quick move
              </span>
            </div>
            <div className="inv-scroll">
              <GearPanel owner="player" cell={46} title={raid.player.name} />
              <DropZoneBox zone="ground" label="Drop on ground" />
            </div>
          </div>
          {container && (
            <div className="panel inv-col loot-col fade-in">
              <div className="panel-title">
                <span>{CONTAINERS[container.kind].label}</span>
                <span className={container.searched ? 'good' : 'accent'}>{container.searched ? 'Searched' : 'Searching…'}</span>
              </div>
              <div className="inv-scroll">
                <ItemGrid gridId={`c:${container.id}`} cell={46} />
              </div>
            </div>
          )}
          {corpse && (
            <div className="panel inv-col loot-col fade-in">
              <div className="panel-title">
                <span>{corpse.name}</span>
                <span className="dim">{corpse.faction}</span>
              </div>
              <div className="inv-scroll">
                <GearPanel owner={`corpse:${corpse.id}`} cell={46} />
              </div>
            </div>
          )}
          {!loot && (
            <div className="panel inv-col hint-col">
              <div className="panel-title">
                <span>Health</span>
                <span className="dim">drag meds onto a body part</span>
              </div>
              <HealthPanel />
            </div>
          )}
        </div>
      </InventoryRoot>
    </div>
  );
}

function HealthPanel() {
  const hud = useRaidUi((s) => s.hud);
  if (!hud) return null;
  return (
    <div className="hints health-panel">
      <BodyFigure parts={hud.parts} height={300} droppable showNumbers />
      <div className="dim small">
        {hud.parts.map((p) => (
          <div key={p.part} className="row">
            <span>{PART_LABEL[p.part]}</span>
            <span className={`mono ${p.hp <= 0 ? 'bad' : ''}`}>
              {Math.ceil(p.hp)}/{p.max}
              {p.heavy ? ' · heavy bleed' : p.light ? ' · bleed' : ''}
              {p.fracture ? ' · fracture' : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="dim small">
        <span className="kbd">Q</span> auto-treat · <span className="kbd">V</span> eat / drink · double-click a med to use it
      </p>
    </div>
  );
}

function RaidDialogue({ session }: { session: GameSession }) {
  const actorId = useRaidUi((s) => s.dialogueActor);
  const actor = actorId !== null ? session.raid.actorById(actorId) : null;
  const npcId = actor?.npcId;
  const host = useMemo(() => (actorId !== null && npcId ? raidDialogueHost(session, actorId, npcId) : null), [session, actorId, npcId]);
  const rel = npcId ? useProfile.getState().profile?.npcs[npcId] : undefined;
  if (!npcId || !host || !rel || !NPCS[npcId]) return null;
  return (
    <DialogueBox
      npcId={npcId}
      rel={rel}
      host={host}
      onRelChange={(r) => useProfile.getState().mutate((d) => void (d.npcs[npcId] = r))}
      onClose={() => session.closeOverlay()}
    />
  );
}

function PauseMenu({ session }: { session: GameSession }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="overlay center">
      <div className="panel pause fade-in">
        <div className="panel-title">
          <span>Paused</span>
          <span className="kbd">Esc</span>
        </div>
        <div className="pause-body">
          <button className="btn primary" onClick={() => session.closeOverlay()}>
            Resume
          </button>
          {!confirm ? (
            <button className="btn danger" onClick={() => setConfirm(true)}>
              Leave raid
            </button>
          ) : (
            <button
              className="btn danger"
              onClick={() => {
                session.raid.abandon();
                session.closeOverlay();
              }}
            >
              Confirm — lose all gear
            </button>
          )}
          <div className="controls">
            {[
              ['WASD', 'Move'],
              ['Shift', 'Sprint'],
              ['C', 'Crouch'],
              ['RMB (hold) / Ctrl', 'Aim — face the cursor, accurate fire'],
              ['LMB', 'Fire (hip fire without aiming)'],
              ['R', 'Reload'],
              ['1 2 3', 'Primary / secondary / melee'],
              ['E', 'Search · loot · talk'],
              ['Tab', 'Inventory'],
              ['Q / V', 'Heal / eat'],
              ['F', 'Flashlight'],
              ['M', 'Map'],
              ['F3', 'Performance overlay'],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="kbd">{k}</span>
                <span className="dim">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
