import { useEffect, useMemo, useRef, useState } from 'react';
import { applyRaidResult, createEquipment, CONTAINERS, NPCS, type RaidResult, type RaidSummary } from '@ashfall/engine';
import { GameSession } from '../../game/GameSession';
import { useRaidUi } from '../../game/hudStore';
import { useApp } from '../../state/appStore';
import { useProfile } from '../../state/profileStore';
import { api } from '../../state/api';
import { detectQuality, type QualityLevel } from '../../render/quality';
import { Hud } from '../hud/Hud';
import { Minimap } from '../hud/Minimap';
import { DialogueBox } from '../components/DialogueBox';
import { raidDialogueHost } from '../dialogueHosts';
import { InventoryRoot, ItemGrid, DropZoneBox, EquipSlot } from '../inventory/components';
import { GearPanel } from '../inventory/GearPanel';
import { makeRaidHost } from '../inventory/hosts';
import './raid.css';

export function resolveQuality(q: string): QualityLevel {
  return q === 'auto' ? detectQuality() : (q as QualityLevel);
}

export function RaidScreen() {
  const seed = useApp((s) => s.raidSeed);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = useProfile.getState().profile;
    if (!profile || !canvasRef.current) return;
    const draft = structuredClone(profile);
    let s: GameSession;
    try {
      s = new GameSession({
        canvas: canvasRef.current,
        labelLayer: labelsRef.current,
        seed,
        profile: draft,
        quality: resolveQuality(profile.settings.quality),
        onEnd: (result) => finishRaid(result),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
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
    return () => s.dispose();
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
      {session && <RaidOverlays session={session} />}
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

function RaidOverlays({ session }: { session: GameSession }) {
  const overlay = useRaidUi((s) => s.overlay);
  const showPerf = useRaidUi((s) => s.showPerf);
  return (
    <>
      <Hud session={session} />
      <Crosshair hidden={!!overlay} />
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
                <span>Quick use</span>
              </div>
              <div className="hints">
                <p>
                  <span className="kbd">Q</span> best meds · <span className="kbd">V</span> eat / drink
                </p>
                <p className="dim">Double-click a med or food item to use it. Right-click for more actions.</p>
                <EquipSlot owner="player" slot="melee" w={2} h={1.5} cell={46} />
              </div>
            </div>
          )}
        </div>
      </InventoryRoot>
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
              ['Mouse / LMB', 'Aim / fire'],
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
