import {
  Tile,
  BODY_PARTS,
  inPain,
  carryGrids,
  companionLoadout,
  countAmmo,
  encounterLoadout,
  equipmentWeight,
  getDef,
  NPCS,
  npcEncounterEligible,
  Raid,
  Rng,
  type Interactable,
  type MapId,
  type Profile,
  type RaidNpcSpawn,
  type RaidResult,
} from '@ashfall/engine';
import { GameRenderer } from '../render/GameRenderer';
import type { AssetLibrary } from '../render/assets';
import { playerAppearance } from '../render/character';
import type { QualityLevel } from '../render/quality';
import { Input } from '../input/Input';
import { PerfMonitor } from '../perf/PerfMonitor';
import { useRaidUi, type HudState } from './hudStore';
import { audio, gunClass } from '../audio/AudioEngine';

export interface SessionOptions {
  canvas: HTMLCanvasElement;
  labelLayer: HTMLElement | null;
  seed: number;
  mapId: MapId;
  timeOfDay?: 'day' | 'dusk' | 'night';
  profile: Profile;
  quality: QualityLevel;
  assets: AssetLibrary;
  onEnd(result: RaidResult): void;
}

/** Builds the raid's starting state from the persistent profile: gear, companion, possible NPC encounters. */
export function raidFromProfile(profile: Profile, seed: number, mapId: MapId = 'outskirts', timeOfDay?: 'day' | 'dusk' | 'night'): Raid {
  const rng = new Rng(seed ^ 0xabcdef);
  const encounters: RaidNpcSpawn[] = [];
  for (const npc of Object.values(NPCS)) {
    const rel = profile.npcs[npc.id];
    if (!rel || !npcEncounterEligible(npc, rel) || profile.companion === npc.id) continue;
    if (rng.chance(rel.met ? 0.4 : 0.65)) encounters.push({ npcId: npc.id, name: npc.name, prefers: npc.prefers ?? ['house'], eq: encounterLoadout(npc.id) });
  }
  const compId = profile.companion;
  const compRel = compId ? profile.npcs[compId] : undefined;
  const companion = compId && compRel && !compRel.dead ? { npcId: compId, name: NPCS[compId]?.name ?? compId, eq: structuredClone(companionLoadout(profile, compId)) } : null;
  return new Raid({ seed, mapId, timeOfDay, playerEq: structuredClone(profile.equipment), playerName: profile.name, companion, encounters });
}

/**
 * Glue between sim, renderer, input and React HUD. Runs the RAF loop:
 * fixed-step sim (60 Hz) → renderer (display rate) → HUD snapshot (10 Hz, only on change).
 */
export class GameSession {
  readonly raid: Raid;
  readonly renderer: GameRenderer;
  readonly input: Input;
  readonly perf = new PerfMonitor();
  paused = false;
  private raf = 0;
  private last = 0;
  private hudT = 0;
  private interact: Interactable | null = null;
  private interactT = 0;
  private endT = -1;
  private ended = false;
  private lastInv = -1;
  private onResize = () => this.renderer.resize();

  constructor(private opts: SessionOptions) {
    this.raid = raidFromProfile(opts.profile, opts.seed, opts.mapId, opts.timeOfDay);
    this.renderer = new GameRenderer(opts.canvas, this.raid, opts.quality, opts.labelLayer, opts.assets, playerAppearance(opts.profile.look));
    this.input = new Input(opts.canvas);
    window.addEventListener('resize', this.onResize);
    audio.setVolume(opts.profile.settings.volume ?? 0.7);
    audio.unlock();
    audio.startAmbience(this.raid.timeOfDay, this.raid.rain);
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
  }

  /** Browsers start audio suspended until a user gesture. */
  private onGesture = () => audio.unlock();
  private groanT = 2;

  private playSounds(events: ReturnType<Raid['drainEvents']>, dt: number): void {
    const raid = this.raid;
    const pid = raid.player.id;
    audio.setListener(raid.player.pos.x, raid.player.pos.y);
    for (const e of events) {
      switch (e.t) {
        case 'shot':
          audio.shot(gunClass(e.weapon), e.fx, e.fy, e.actor === pid);
          if (e.hit) audio.hit(e.tx, e.ty, false, false);
          break;
        case 'step': {
          const t = e.tile;
          const surface = t === Tile.Wood ? 'wood' : t === Tile.Road || t === Tile.Concrete ? 'hard' : t === Tile.Dirt ? 'dirt' : 'grass';
          audio.step(e.actor, surface, e.x, e.y, e.loud, e.actor === pid);
          break;
        }
        case 'reload':
          if (raid.actorById(e.actor)) audio.reload(raid.actorById(e.actor)!.pos.x, raid.actorById(e.actor)!.pos.y, e.actor === pid);
          break;
        case 'swing':
          audio.swing(e.x, e.y, e.actor === pid);
          break;
        case 'hit':
          if (!e.penetrated && !e.melee) audio.hit(e.x, e.y, true, e.target === pid);
          else if (e.melee) audio.hit(e.x, e.y, false, e.target === pid);
          break;
        case 'impact':
          audio.impact(e.x, e.y);
          break;
        case 'used':
          if (e.actor === pid) audio.meds();
          break;
        default:
          break;
      }
    }
    // Infected near the player groan now and then.
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 1.5 + Math.random() * 2.5;
      const z = raid.actors.find((a) => a.alive && a.archetype === 'infected' && Math.hypot(a.pos.x - raid.player.pos.x, a.pos.y - raid.player.pos.y) < 22 && Math.random() < 0.5);
      if (z) audio.groan(z.pos.x, z.pos.y);
    }
    audio.tick(dt, raid.player.hp / raid.player.maxHp);
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const ui = useRaidUi.getState();
    const raid = this.raid;

    this.handleActions();
    if (this.input.wheel !== 0) {
      this.renderer.setZoom(this.renderer.zoomLevel + this.input.wheel * 0.0012);
      this.input.wheel = 0;
    }

    const intent = this.input.poll();
    const aim = this.renderer.screenToWorld(this.input.mouseNdc.x, this.input.mouseNdc.y);
    intent.aimX = aim.x;
    intent.aimY = aim.y;
    if (ui.overlay) intent.fire = intent.firePressed = false;

    const t0 = performance.now();
    if (!this.paused) raid.advance(dt, intent);
    else intent.firePressed = false;
    const t1 = performance.now();

    const events = raid.drainEvents();
    this.renderer.handleEvents(events);
    this.playSounds(events, this.paused ? 0 : dt);
    for (const e of events) {
      if (e.t === 'msg') ui.pushMessage(e.text, e.tone);
      if (e.t === 'used' && e.actor === raid.player.id) ui.pushMessage(`Used ${getDef(e.item).name}`, 'good');
    }

    this.interactT -= dt;
    if (this.interactT <= 0) {
      this.interactT = 0.1;
      this.interact = raid.status === 'active' ? raid.nearestInteractable() : null;
    }
    const stats = this.renderer.render(this.paused && ui.overlay !== 'dialogue' ? 0 : dt, this.interact);
    const t2 = performance.now();

    this.perf.push(dt * 1000);
    this.perf.simMs = this.perf.simMs * 0.9 + (t1 - t0) * 0.1;
    this.perf.renderMs = this.perf.renderMs * 0.9 + (t2 - t1) * 0.1;
    this.renderer.setResolutionScale(this.perf.adapt(this.renderer.resolutionScale, dt));

    if (raid.invVersion !== this.lastInv) {
      this.lastInv = raid.invVersion;
      ui.bumpInv();
    }
    if (ui.loot && !raid.loot && ui.overlay === 'loot') useRaidUi.setState({ overlay: null, loot: null });

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      ui.setHud(this.snapshot());
      if (ui.showPerf)
        useRaidUi.setState({
          perf: {
            fps: this.perf.fps,
            ms: this.perf.avgMs,
            p99: this.perf.p99,
            sim: this.perf.simMs,
            render: this.perf.renderMs,
            calls: stats.calls,
            tris: stats.triangles,
            scale: this.renderer.resolutionScale,
            actors: raid.actors.filter((a) => a.alive).length,
            pathHit: raid.pathfinder.cache.hitRate,
          },
        });
    }

    if (raid.status !== 'active' && !this.ended) {
      if (this.endT < 0) {
        this.endT = 2.8;
        useRaidUi.setState({ overlay: null });
        this.input.enabled = false;
      }
      this.endT -= dt;
      if (this.endT <= 0) {
        this.ended = true;
        this.opts.onEnd(raid.result());
      }
    }
  }

  private handleActions(): void {
    const ui = useRaidUi.getState();
    const raid = this.raid;
    const p = raid.player;
    for (const a of this.input.drain()) {
      if (raid.status !== 'active') continue;
      switch (a) {
        case 'menu':
          if (ui.overlay === 'dialogue') break;
          if (ui.overlay) this.closeOverlay();
          else this.openOverlay('pause');
          break;
        case 'inventory':
          if (ui.overlay === 'inventory' || ui.overlay === 'loot') this.closeOverlay();
          else if (!ui.overlay) this.openOverlay('inventory');
          break;
        case 'map':
          if (ui.overlay === 'map') this.closeOverlay();
          else if (!ui.overlay) this.openOverlay('map');
          break;
        case 'perf':
          useRaidUi.setState({ showPerf: !ui.showPerf });
          break;
        case 'interact':
          if (ui.overlay === 'loot') {
            this.closeOverlay();
            break;
          }
          if (!ui.overlay) this.interactWith(this.interact);
          break;
        case 'reload':
          this.input.intent.reload = true;
          break;
        case 'flashlight':
          p.flashlight = !p.flashlight;
          break;
        case 'crouch':
          this.input.toggleCrouch();
          break;
        case 'heal': {
          const m = raid.bestMed(p);
          if (m) this.input.intent.use = m.uid;
          else ui.pushMessage('No meds', 'bad');
          break;
        }
        case 'eat': {
          const f = raid.bestFood(p);
          if (f) this.input.intent.use = f.uid;
          else ui.pushMessage('No food or water', 'bad');
          break;
        }
        case 'slot1':
          this.input.intent.switchTo = 'primary';
          break;
        case 'slot2':
          this.input.intent.switchTo = 'secondary';
          break;
        case 'slot3':
          this.input.intent.switchTo = 'melee';
          break;
      }
    }
  }

  interactWith(target: Interactable | null): void {
    if (!target) return;
    if (target.kind === 'container' || target.kind === 'corpse') {
      if (this.raid.openLoot({ kind: target.kind, id: target.id })) {
        useRaidUi.setState({ overlay: 'loot', loot: { kind: target.kind, id: target.id } });
      }
    } else if (target.kind === 'npc') {
      this.raid.noteNpcMet(target.npcId);
      this.paused = true;
      this.input.releaseAll();
      this.renderer.talkingActor = target.id;
      const npc = this.raid.actorById(target.id);
      if (npc) {
        // Face each other.
        npc.facing = Math.atan2(this.raid.player.pos.y - npc.pos.y, this.raid.player.pos.x - npc.pos.x);
        this.raid.player.facing = npc.facing + Math.PI;
        npc.vel.x = npc.vel.y = this.raid.player.vel.x = this.raid.player.vel.y = 0;
      }
      useRaidUi.setState({ overlay: 'dialogue', dialogueActor: target.id });
    }
  }

  openOverlay(o: 'inventory' | 'pause' | 'map'): void {
    if (o === 'pause') {
      this.paused = true;
      this.input.releaseAll();
    }
    useRaidUi.setState({ overlay: o });
  }

  closeOverlay(): void {
    const ui = useRaidUi.getState();
    if (ui.overlay === 'loot') this.raid.closeLoot();
    this.paused = false;
    this.renderer.talkingActor = null;
    useRaidUi.setState({ overlay: null, loot: null, dialogueActor: null });
  }

  private snapshot(): HudState {
    const raid = this.raid;
    const p = raid.player;
    const w = raid.weaponItem(p);
    const wd = w ? getDef(w.def).weapon : undefined;
    const held = p.active === 'melee' ? p.eq.slots.melee : w;
    const ex = raid.extractingAt !== null ? raid.map.extractions.find((e) => e.id === raid.extractingAt) : undefined;
    const comp = raid.actors.find((a) => a.companion);
    return {
      parts: BODY_PARTS.map((part) => ({ part, ...p.health.parts[part] })),
      pain: inPain(p.health),
      painkiller: p.health.painkiller,
      hp: p.hp,
      maxHp: p.maxHp,
      bleed: p.bleed > 0,
      stamina: p.stamina,
      energy: p.energy,
      hydration: p.hydration,
      weapon: held ? getDef(held.def).name : 'Fists',
      weaponSlot: p.active,
      ammo: w ? (w.ammo ?? 0) : null,
      mag: wd?.magSize ?? 0,
      reserve: wd ? countAmmo(p.eq, wd.caliber) : 0,
      ammoType: w?.ammoType ? getDef(w.ammoType).short : '',
      reloading: p.reloadT > 0 && wd ? 1 - p.reloadT / wd.reloadTime : 0,
      using: p.useT > 0 && p.useUid ? 1 : 0,
      timeLeft: Math.max(0, raid.timeLimit - raid.time),
      extract: raid.extractProgress,
      extractName: ex?.name ?? '',
      extractions: raid.map.extractions.map((e) => ({ name: e.name, dist: Math.hypot(e.x - p.pos.x, e.y - p.pos.y), angle: Math.atan2(e.y - p.pos.y, e.x - p.pos.x) })),
      interact: this.interact,
      crouch: p.crouching,
      flashlight: p.flashlight,
      weight: equipmentWeight(p.eq),
      facing: p.facing,
      status: raid.status,
      timeOfDay: raid.timeOfDay,
      rain: raid.rain,
      kills: p.kills,
      companion: comp ? { name: comp.name, hp: comp.hp / comp.maxHp, alive: comp.alive } : null,
    };
  }

  /** Carried grids of the player — used by inventory UI. */
  get playerGrids() {
    return carryGrids(this.raid.player.eq);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    audio.stopAmbience();
    this.input.dispose();
    this.renderer.dispose();
  }
}
