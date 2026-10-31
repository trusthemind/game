import {
  Tile,
  TASKS,
  levelFromXp,
  objectiveProgress,
  objectiveTarget,
  taskUnlocked,
  effectiveWeapon,
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
import { lookFor, playerAppearance } from '../render/character';
import type { QualityLevel } from '../render/quality';
import { Input } from '../input/Input';
import { PerfMonitor } from '../perf/PerfMonitor';
import { useRaidUi, type HudState } from './hudStore';
import { audio, BLADES } from '../audio/AudioEngine';

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
/** One line per unfinished objective that this raid can advance (kills, extracts, loot, sites). */
function trackedTasks(profile: Profile, mapId: string): string[] {
  const level = levelFromXp(profile.xp).level;
  const out: string[] = [];
  for (const t of TASKS) {
    const st = profile.tasks?.[t.id];
    if (st?.claimed || !taskUnlocked(profile, t, level)) continue;
    t.objectives.forEach((o, i) => {
      if (o.kind === 'handover') return;
      if ((o.kind === 'kill' || o.kind === 'extract') && o.map && o.map !== mapId) return;
      const v = objectiveProgress(o, st?.progress[i] ?? 0);
      const max = objectiveTarget(o);
      if (v < max) out.push(`${o.text} ${v}/${max}`);
    });
  }
  return out.slice(0, 4);
}

export function raidFromProfile(profile: Profile, seed: number, mapId: MapId = 'outskirts', timeOfDay?: 'day' | 'dusk' | 'night'): Raid {
  const rng = new Rng(seed ^ 0xabcdef);
  const encounters: RaidNpcSpawn[] = [];
  for (const npc of Object.values(NPCS)) {
    const rel = profile.npcs[npc.id];
    if (!rel || !npcEncounterEligible(npc, rel) || profile.companion === npc.id) continue;
    if (encounters.length < 3 && rng.chance(rel.met ? 0.45 : 0.7)) encounters.push({ npcId: npc.id, name: npc.name, prefers: npc.prefers ?? ['house'], eq: encounterLoadout(npc.id), wounded: npc.id === 'lena' });
  }
  const compId = profile.companion;
  const compRel = compId ? profile.npcs[compId] : undefined;
  const companion = compId && compRel && !compRel.dead ? { npcId: compId, name: NPCS[compId]?.name ?? compId, eq: structuredClone(companionLoadout(profile, compId)) } : null;
  return new Raid({
    seed,
    mapId,
    timeOfDay,
    playerEq: structuredClone(profile.equipment),
    playerName: profile.name,
    companion,
    encounters,
    difficulty: profile.settings.difficulty ?? 'normal',
    autoHeal: profile.settings.autoHeal ?? true,
    grave: profile.grave ? structuredClone(profile.grave) : null,
  });
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
  private frozenStats: ReturnType<GameRenderer['render']> | null = null;
  private ended = false;
  private lastInv = -1;
  private onResize = () => this.renderer.resize();
  private menuActions: (() => void)[] = [];
  /** Open task objectives that can progress on this map (snapshot at deploy). */
  private trackedTasks: string[] = [];
  /** Click-to-walk (from the context menu): path target, how close is close enough, and what to do there. */
  private autoWalk: { x: number; y: number; range: number; then: (() => void) | null; path: { x: number; y: number }[]; repath: number; t: number } | null = null;

  constructor(private opts: SessionOptions) {
    this.raid = raidFromProfile(opts.profile, opts.seed, opts.mapId, opts.timeOfDay);
    this.renderer = new GameRenderer(opts.canvas, this.raid, opts.quality, opts.labelLayer, opts.assets, playerAppearance(opts.profile.look));
    this.input = new Input(opts.canvas);
    window.addEventListener('resize', this.onResize);
    audio.setVolume(opts.profile.settings.volume ?? 0.7);
    audio.unlock();
    audio.startAmbience(this.raid.timeOfDay, this.raid.rain);
    this.trackedTasks = trackedTasks(opts.profile, this.raid.map.mapId);
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
  }

  /** Voice for pain and death cries: the same deterministic look the renderer draws. */
  private sexOf(id: number): 'm' | 'f' {
    const a = this.raid.actorById(id);
    if (!a) return 'm';
    if (a === this.raid.player) return playerAppearance(this.opts.profile.look).sex;
    return lookFor(a.id, a.archetype, a.npcId, a.bossId).sex;
  }

  /** Browsers start audio suspended until a user gesture. */
  private onGesture = () => audio.unlock();
  private groanT = 2;

  private playSounds(events: ReturnType<Raid['drainEvents']>, dt: number): void {
    const raid = this.raid;
    const pid = raid.player.id;
    audio.setListener(raid.player.pos.x, raid.player.pos.y, raid.map.isIndoors(Math.floor(raid.player.pos.x), Math.floor(raid.player.pos.y)));
    for (const e of events) {
      switch (e.t) {
        case 'shot':
          if (e.pellet) break;
          audio.shot(e.weapon, e.fx, e.fy, e.actor === pid, !!e.suppressed);
          break;
        case 'step': {
          const t = e.tile;
          const d = raid.map.districtOf(Math.floor(e.x), Math.floor(e.y));
          const surface = t === Tile.Wood ? 'wood' : t === Tile.Road || t === Tile.Concrete ? 'stone' : t === Tile.Dirt ? (raid.rain ? 'mud' : 'gravel') : d === 'forest' ? 'leaves' : 'grass';
          audio.step(e.actor, surface, e.x, e.y, e.loud, e.actor === pid);
          break;
        }
        case 'reload':
          {
            const a = raid.actorById(e.actor);
            if (a) audio.reload(raid.weaponItem(a)?.def ?? '', a.pos.x, a.pos.y, e.actor === pid);
          }
          break;
        case 'swing':
          audio.swing(e.weapon, e.x, e.y, e.actor === pid);
          break;
        case 'hit': {
          const mine = e.target === pid;
          if (e.melee) {
            const w = raid.actorById(e.attacker)?.eq.slots.melee?.def ?? 'fists';
            audio.hit(e.x, e.y, BLADES.has(w) ? 'blade' : 'blunt', mine);
          } else audio.hit(e.x, e.y, e.penetrated ? 'bullet' : 'armor', mine);
          const t = raid.actorById(e.target);
          if (t?.alive && e.damage > 0) audio.pain(t.id, t.pos.x, t.pos.y, this.sexOf(t.id), t.archetype === 'infected', mine);
          break;
        }
        case 'death': {
          const a = raid.actorById(e.actor);
          if (a) audio.death(a.id, a.pos.x, a.pos.y, this.sexOf(a.id), a.archetype === 'infected', a.id === pid);
          break;
        }
        case 'impact':
          audio.impact(e.x, e.y, e.material);
          break;
        case 'glass':
          audio.glass(e.x, e.y);
          break;
        case 'vault': {
          const a = raid.actorById(e.actor);
          if (a) audio.step(a.id, 'wood', a.pos.x, a.pos.y, 1.2, a.id === pid);
          break;
        }
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

    for (const c of this.input.contextClicks.splice(0)) if (!ui.overlay && raid.status === 'active') this.openWorldMenu(c);

    const intent = this.input.poll();
    const aim = this.renderer.screenToWorld(this.input.mouseNdc.x, this.input.mouseNdc.y);
    intent.aimX = aim.x;
    intent.aimY = aim.y;
    if (ui.overlay || ui.worldMenu) intent.fire = intent.firePressed = false;
    this.steerAutoWalk(intent, dt, !!ui.overlay);

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
    // On the pause menu the world is frozen: draw it once and then leave the frame to the UI (and the battery).
    const frozen = this.paused && ui.overlay === 'pause';
    let stats = frozen ? this.frozenStats : null;
    if (!stats) stats = this.renderer.render(this.paused && ui.overlay !== 'dialogue' ? 0 : dt, this.interact);
    this.frozenStats = frozen ? stats : null;
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
      // Wall-clock delay: on a slow machine the clamped frame dt would stretch the death banner for ages.
      if (this.endT < 0) {
        this.endT = performance.now() + 2800;
        useRaidUi.setState({ overlay: null });
        this.input.enabled = false;
      }
      if (performance.now() >= this.endT) {
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
          if (m) {
            this.input.intent.use = m.uid;
            ui.pushMessage(`Using ${getDef(m.def).name}`, 'info');
          } else ui.pushMessage(raid.medHint(p), 'bad');
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
        audio.search(target.x, target.y);
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
    } else if (target.kind === 'window') {
      this.raid.vault(this.raid.player, target.id);
    }
  }

  // ── Right-click world menu & click-to-walk ─────────────────────────────────

  private openWorldMenu(c: { x: number; y: number; ndcX: number; ndcY: number }): void {
    const raid = this.raid;
    const p = raid.player;
    const w = this.renderer.screenToWorld(c.ndcX, c.ndcY);
    const opts: { label: string; run: () => void }[] = [];
    let title = 'Here';
    const go = (x: number, y: number, range: number, then: (() => void) | null) => {
      if (Math.hypot(x - p.pos.x, y - p.pos.y) <= range) then?.();
      else this.autoWalk = { x, y, range, then, path: [], repath: 0, t: 0 };
    };
    if (Math.hypot(w.x - p.pos.x, w.y - p.pos.y) < 0.7) {
      title = 'You';
      opts.push({ label: 'Treat wounds (Q)', run: () => this.input.queueAction('heal') });
      opts.push({ label: 'Eat or drink (V)', run: () => this.input.queueAction('eat') });
      opts.push({ label: 'Open inventory', run: () => this.openOverlay('inventory') });
      opts.push({ label: p.flashlight ? 'Flashlight off' : 'Flashlight on', run: () => (p.flashlight = !p.flashlight) });
      opts.push({ label: p.crouching ? 'Stand up' : 'Crouch', run: () => this.input.toggleCrouch() });
    } else {
      const near = raid.interactablesAt(w.x, w.y, 1.1);
      const t = near[0];
      if (t) {
        title = t.label;
        const r = 1.5;
        if (t.kind === 'container') opts.push({ label: t.searched ? 'Open' : 'Search', run: () => go(t.x, t.y, r, () => this.interactWith(t)) });
        if (t.kind === 'corpse') opts.push({ label: 'Loot body', run: () => go(t.x, t.y, r, () => this.interactWith(t)) });
        if (t.kind === 'npc') opts.push({ label: `Talk to ${t.label}`, run: () => go(t.x, t.y, 2, () => this.interactWith(t)) });
        if (t.kind === 'window') {
          opts.push({ label: 'Climb through', run: () => go(t.x, t.y, 1.25, () => raid.vault(p, t.id)) });
          if (!t.broken) opts.push({ label: 'Smash the glass', run: () => go(t.x, t.y, 1.4, () => raid.breakGlass(t.id, p)) });
        }
        if (t.kind === 'extract') opts.push({ label: `Walk to ${t.label}`, run: () => go(t.x, t.y, 1, null) });
      }
      if (raid.map.isWalkable(Math.floor(w.x), Math.floor(w.y))) opts.push({ label: 'Walk here', run: () => go(w.x, w.y, 0.4, null) });
    }
    if (!opts.length) return;
    this.menuActions = opts.map((o) => o.run);
    useRaidUi.setState({ worldMenu: { x: c.x, y: c.y, title, options: opts.map((o) => o.label) } });
  }

  pickWorldMenu(i: number | null): void {
    const run = i === null ? null : this.menuActions[i];
    useRaidUi.setState({ worldMenu: null });
    this.menuActions = [];
    run?.();
  }

  private steerAutoWalk(intent: { moveX: number; moveY: number; sprint: boolean }, dt: number, blocked: boolean): void {
    const w = this.autoWalk;
    if (!w) return;
    const p = this.raid.player;
    // Any movement key (or dying, or taking too long) cancels it.
    if (this.input.moving || !p.alive || (w.t += dt) > 30) {
      this.autoWalk = null;
      return;
    }
    if (blocked) return;
    if (Math.hypot(w.x - p.pos.x, w.y - p.pos.y) <= w.range) {
      this.autoWalk = null;
      w.then?.();
      return;
    }
    w.repath -= dt;
    if (w.repath <= 0 || !w.path.length) {
      w.repath = 1;
      // Copy: the pathfinder caches and shares its arrays.
      w.path = [...(this.raid.pathfinder.find(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(w.x), Math.floor(w.y)) ?? [])];
      if (!w.path.length && Math.hypot(w.x - p.pos.x, w.y - p.pos.y) > 1.5) {
        this.autoWalk = null;
        useRaidUi.getState().pushMessage("Can't find a way there", 'bad');
        return;
      }
    }
    let next = w.path[0] ?? { x: w.x, y: w.y };
    if (Math.hypot(next.x - p.pos.x, next.y - p.pos.y) < 0.35 && w.path.length) {
      w.path.shift();
      next = w.path[0] ?? { x: w.x, y: w.y };
    }
    const dx = next.x - p.pos.x;
    const dy = next.y - p.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    intent.moveX = dx / l;
    intent.moveY = dy / l;
    intent.sprint = false;
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
    const wd = w ? effectiveWeapon(w) : undefined;
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
      winded: p.winded,
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
      tasks: this.trackedTasks,
      extractions: [
        ...raid.map.extractions.map((e) => ({ name: e.name, dist: Math.hypot(e.x - p.pos.x, e.y - p.pos.y), angle: Math.atan2(e.y - p.pos.y, e.x - p.pos.x), kind: 'exit' as const })),
        ...raid.corpses
          .filter((c) => c.actorId < 0)
          .map((c) => ({ name: 'Your body', dist: Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y), angle: Math.atan2(c.pos.y - p.pos.y, c.pos.x - p.pos.x), kind: 'grave' as const })),
        ...raid.mapEvents.map((ev) => ({ name: ev.name, dist: Math.hypot(ev.x - p.pos.x, ev.y - p.pos.y), angle: Math.atan2(ev.y - p.pos.y, ev.x - p.pos.x), kind: 'event' as const })),
      ],
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
