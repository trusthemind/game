import { Rng } from '../core/rng';
import { SpatialHash } from '../core/spatialHash';
import { angleTo, clamp, dist, rayCircle, turnTowards, type Vec2 } from '../core/math';
import { getDef, FISTS, type MeleeStats } from '../items/defs';
import {
  addItem,
  carryGrids,
  createGrid,
  equipmentValue,
  allItems,
  equipmentWeight,
  findPlaced,
  removeItem,
  takeAmmo,
  type Equipment,
  type ItemInstance,
} from '../items/inventory';
import { generateLoadout } from '../items/loadouts';
import { CONTAINERS, generateLoot } from '../items/loot';
import { effectiveWeapon } from '../items/mods';
import { bossById } from '../items/bosses';
import { computeFov } from '../world/fov';
import type { GameMap, LootContainer, BotArchetype, ContainerKind } from '../world/map';
import { generateMap, MAP_PRESETS, type MapId } from '../world/mapGen';
import { Pathfinder } from '../world/pathfinding';
import { OPAQUE, Tile } from '../world/tiles';
import { solidBoxes, type Box } from '../world/collision';
import { BotBrain, type BrainRole } from '../ai/brain';
import { armorFor, gaussian, resolveBulletHit, resolveMeleeHit, ZONE_WEIGHTS } from './combat';
import {
  aimMul,
  applyMed,
  bleeding,
  BODY_PARTS,
  canSprint,
  createHealth,
  damagePart,
  HEAVY_BLEED_DPS,
  inPain,
  isLimb,
  isDead,
  LIGHT_BLEED_DPS,
  metabolismMul,
  moveMul,
  PART_LABEL,
  tickHealth,
  totalHp,
  totalMax,
  treatmentTarget,
  type BodyPart,
} from './health';
import {
  emptyIntent,
  hostile,
  type Actor,
  type ActorIntent,
  type Corpse,
  type Faction,
  type HitZone,
  type Noise,
  type RaidEvent,
  type WeaponSlot,
} from './types';

export type RaidStatus = 'active' | 'extracted' | 'dead' | 'mia';
export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface RaidNpcSpawn {
  npcId: string;
  name: string;
  /** Building kinds the NPC likes to hang out in. */
  prefers: string[];
  eq: Equipment;
}

export interface RaidOptions {
  seed: number;
  playerEq: Equipment;
  playerName?: string;
  companion?: { npcId: string; name: string; eq: Equipment } | null;
  encounters?: RaidNpcSpawn[];
  botDensity?: number;
  mapSize?: number;
  mapId?: MapId;
  timeLimit?: number;
  /** Force time of day (otherwise random per seed). */
  timeOfDay?: TimeOfDay;
  /** Pre-generated map (lets the client reuse a cached map for the same seed). */
  map?: GameMap;
  /** Airdrops / helicopter crash (default on). */
  events?: boolean;
  difficulty?: Difficulty;
  /** Your body from the last death on this map (Normal/Easy): loot it back once. */
  grave?: Grave | null;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Seconds an airdrop crate takes to come down under its parachute. */
export const AIRDROP_FALL = 12;
export interface MapEvent {
  id: number;
  kind: 'airdrop' | 'heli';
  x: number;
  y: number;
  angle: number;
  landed: boolean;
  /** Raid time it was announced. */
  at: number;
  name: string;
}
export interface Grave {
  mapId: string;
  x: number;
  y: number;
  eq: Equipment;
}

/** Enemy toughness / damage / reaction-time multipliers and accuracy offset per difficulty. */
export const DIFFICULTY: Record<Difficulty, { botHp: number; botDamage: number; react: number; skill: number; grave: boolean; label: string; blurb: string }> = {
  easy: { botHp: 0.8, botDamage: 0.6, react: 1.45, skill: -0.1, grave: true, label: 'Easy', blurb: 'Weaker, slower enemies. Your body (with your gear) waits for you after death.' },
  normal: { botHp: 1, botDamage: 1, react: 1, skill: 0, grave: true, label: 'Normal', blurb: 'Fair fights. After death your body stays on that map for one recovery raid.' },
  hard: { botHp: 1.15, botDamage: 1.3, react: 0.8, skill: 0.08, grave: false, label: 'Hard', blurb: 'Tarkov rules: tougher enemies, die and everything you carried is gone.' },
};

export interface RaidResult {
  status: RaidStatus;
  duration: number;
  kills: Record<string, number>;
  playerEq: Equipment | null;
  /** The secure container comes home no matter what. */
  secure: ItemInstance | null;
  /** Where you died (for the recovery grave). */
  deathAt: { mapId: string; x: number; y: number; eq: Equipment } | null;
  /** True when this raid's map had your grave (the recovery attempt is used up). */
  graveVisited: boolean;
  /** Uids of items picked up during the raid that the player carried out. */
  loot?: string[];
  valueIn: number;
  valueOut: number;
  xp: number;
  companion: { npcId: string; alive: boolean; eq: Equipment | null } | null;
  metNpcs: string[];
  deadNpcs: string[];
}

export type LootTarget = { kind: 'container'; id: number } | { kind: 'corpse'; id: number };
export type Interactable =
  | { kind: 'container'; id: number; label: string; x: number; y: number; searched: boolean }
  | { kind: 'corpse'; id: number; label: string; x: number; y: number }
  | { kind: 'npc'; id: number; npcId: string; label: string; x: number; y: number }
  | { kind: 'extract'; id: number; label: string; x: number; y: number }
  | { kind: 'window'; id: number; label: string; x: number; y: number; broken: boolean };

const FIXED_DT = 1 / 60;
export const INTERACT_RANGE = 1.7;
export const VAULT_TIME = 0.95;
const EXTRACT_TIME = 6;

const ARCH_STATS: Record<BotArchetype, { hp: number; speed: number; faction: Faction; names: string[] }> = {
  scav: { hp: 100, speed: 2.7, faction: 'scav', names: ['Scav', 'Looter', 'Drifter', 'Marauder'] },
  raider: { hp: 120, speed: 3.0, faction: 'raider', names: ['Raider', 'Operator', 'Hunter'] },
  guard: { hp: 125, speed: 2.9, faction: 'boss', names: ['Guard', 'Bodyguard', 'Enforcer'] },
  boss: { hp: 160, speed: 2.6, faction: 'boss', names: ['Warlord Kostia'] },
  infected: { hp: 70, speed: 2.1, faction: 'infected', names: ['Infected'] },
};

const KILL_XP: Record<string, number> = { scav: 60, raider: 180, guard: 250, boss: 1200, infected: 25, npc: 0, player: 0 };

export class Raid {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly pathfinder: Pathfinder;
  readonly actors: Actor[] = [];
  readonly corpses: Corpse[] = [];
  readonly noises: Noise[] = [];
  readonly hash = new SpatialHash<Actor>(4);
  readonly player: Actor;
  readonly timeOfDay: TimeOfDay;
  readonly rain: boolean;
  /** Tiles currently visible to the player (1) — recomputed only when the player's tile or facing bucket changes. */
  readonly playerFov: Uint8Array;
  /** Tiles the player has ever seen. */
  readonly explored: Uint8Array;
  fovVersion = 0;
  private fovKey = -1;

  time = 0;
  readonly timeLimit: number;
  readonly difficulty: Difficulty;
  /** Named bosses on this map this raid. */
  readonly bossesPresent: string[] = [];
  /** Dynamic world events (airdrop, helicopter crash), visible on the map once announced. */
  readonly mapEvents: MapEvent[] = [];
  private airdropAt = -1;
  private readonly hadGrave: boolean;
  /** Uids the player brought in — anything else carried out is loot. */
  private readonly startUids = new Set<string>();
  status: RaidStatus = 'active';
  extractT = 0;
  extractingAt: number | null = null;
  loot: LootTarget | null = null;
  /** Bumps whenever inventories change so UIs know to re-render. */
  invVersion = 0;
  private events: RaidEvent[] = [];
  private nextId = 1;
  private nextCorpseId = 1;
  private nextEventId = 1;
  /** Window tiles whose glass has been smashed. */
  readonly brokenGlass = new Set<number>();
  private accumulator = 0;
  private valueIn: number;
  private killsBy: Record<string, number> = {};
  private metNpcs = new Set<string>();
  private deadNpcs = new Set<string>();
  private scratch: Actor[] = [];
  private waveT = 180;
  private noiseId = 1;
  private botRng!: Rng;

  constructor(opts: RaidOptions) {
    this.rng = new Rng(opts.seed);
    this.map = opts.map ?? generateMap(opts.seed, { mapId: opts.mapId, size: opts.mapSize, botDensity: opts.botDensity });
    this.pathfinder = new Pathfinder(this.map);
    this.timeLimit = opts.timeLimit ?? (MAP_PRESETS[this.map.mapId as MapId]?.raidMinutes ?? 25) * 60;
    const envRng = this.rng.fork('env');
    const rolledTod = envRng.weighted([['day', 3], ['dusk', 4], ['night', 3]] as const);
    this.timeOfDay = opts.timeOfDay ?? rolledTod;
    this.rain = envRng.chance(0.35);
    this.playerFov = new Uint8Array(this.map.width * this.map.height);
    this.explored = new Uint8Array(this.map.width * this.map.height);

    const sp = this.map.playerSpawn;
    this.player = this.spawnActor({
      name: opts.playerName ?? 'You',
      faction: 'player',
      archetype: 'player',
      x: sp.x + 0.5,
      y: sp.y + 0.5,
      hp: 100,
      speed: 3.1,
      eq: opts.playerEq,
    });
    this.player.flashlight = this.timeOfDay !== 'day';
    this.player.facing = Math.atan2(this.map.height / 2 - sp.y, this.map.width / 2 - sp.x);
    this.valueIn = equipmentValue(opts.playerEq);
    this.difficulty = opts.difficulty ?? 'normal';
    this.hadGrave = !!opts.grave && opts.grave.mapId === this.map.mapId;
    if (this.hadGrave) {
      const g = opts.grave!;
      this.corpses.push({ id: this.nextCorpseId++, actorId: -1, name: 'Your body', faction: 'player', pos: { x: g.x, y: g.y }, facing: 0, eq: g.eq });
      this.emit({ t: 'msg', text: 'Your body is still out here — check the map', tone: 'info' });
    }
    for (const it of allItems(opts.playerEq)) this.startUids.add(it.uid);

    if (opts.companion) {
      const c = this.spawnActor({
        name: opts.companion.name,
        faction: 'player',
        archetype: 'npc',
        x: sp.x + 1.2,
        y: sp.y + 0.6,
        hp: 110,
        speed: 3.0,
        eq: opts.companion.eq,
      });
      c.npcId = opts.companion.npcId;
      c.companion = true;
      c.brain = new BotBrain('companion', this.rng.fork('companion'), this.player.id);
    }

    this.botRng = this.rng.fork('bots');
    const groupLeaders = new Map<number, number>();
    for (const s of this.map.botSpawns) {
      const a = this.spawnBot(s.archetype, s.x, s.y, groupLeaders.get(s.group) ?? null, s.boss);
      if (!groupLeaders.has(s.group)) groupLeaders.set(s.group, a.id);
    }

    for (const enc of opts.encounters ?? []) this.spawnEncounter(enc);
    this.setupEvents(opts.events ?? true);
    this.hash.rebuild(this.liveActors());
    this.updateFov(true);
  }

  // ── Setup helpers ───────────────────────────────────────────────────────────

  private spawnActor(o: { name: string; faction: Faction; archetype: Actor['archetype']; x: number; y: number; hp: number; speed: number; eq: Equipment }): Actor {
    // `hp` is a toughness factor relative to a human (100 → the standard 440-HP Tarkov body).
    const health = createHealth(o.hp / 100, o.archetype === 'infected');
    const a: Actor = {
      id: this.nextId++,
      name: o.name,
      faction: o.faction,
      archetype: o.archetype,
      pos: { x: o.x, y: o.y },
      vel: { x: 0, y: 0 },
      facing: 0,
      radius: 0.34,
      baseSpeed: o.speed,
      hp: totalHp(health),
      maxHp: totalMax(health),
      bleed: 0,
      health,
      stamina: 100,
      energy: 85,
      hydration: 85,
      alive: true,
      eq: o.eq,
      active: o.eq.slots.primary ? 'primary' : o.eq.slots.secondary ? 'secondary' : 'melee',
      fireCd: 0,
      reloadT: 0,
      bloom: 0,
      useT: 0,
      useUid: null,
      usePart: null,
      aiming: false,
      crouching: false,
      sprinting: false,
      winded: false,
      vaultT: 0,
      vaultFrom: null,
      vaultTo: null,
      flashlight: false,
      lastHitAt: -999,
      lastAttacker: null,
      kills: 0,
      stepT: 0,
      intent: emptyIntent(),
      brain: null,
      speedMul: 1,
    };
    this.recomputeSpeed(a);
    this.actors.push(a);
    return a;
  }

  private spawnBot(arch: BotArchetype, x: number, y: number, leader: number | null, bossId?: string): Actor {
    const rng = this.botRng;
    const tier = arch === 'boss' || arch === 'guard' ? 3 : 1;
    const st = ARCH_STATS[arch];
    const boss = bossId ? bossById(bossId) : null;
    const a = this.spawnActor({
      name: boss?.name ?? rng.pick(st.names),
      faction: st.faction,
      archetype: arch,
      x,
      y,
      hp: (boss?.hp ?? st.hp) * (arch === 'infected' ? 1 : DIFFICULTY[this.difficulty].botHp),
      speed: st.speed * rng.range(0.94, 1.06),
      eq: boss ? boss.loadout(rng.fork(`boss-${boss.id}`)) : generateLoadout(arch, rng.fork(`l${this.nextId}`), tier),
    });
    if (boss) {
      a.bossId = boss.id;
      this.bossesPresent.push(boss.id);
    }
    if (arch === 'infected') a.natural = { damage: 13, cooldown: 1.05, reach: 0.65, bleedChance: 0.35 };
    const role: BrainRole = arch === 'infected' ? 'infected' : arch === 'boss' || arch === 'guard' ? 'guard' : 'bot';
    a.brain = new BotBrain(role, rng.fork(`b${a.id}`), leader);
    const diff = DIFFICULTY[this.difficulty];
    a.brain.tune(diff.react, diff.skill);
    a.facing = rng.range(-Math.PI, Math.PI);
    return a;
  }

  // ── Map events ──────────────────────────────────────────────────────────────

  private setupEvents(enabled: boolean): void {
    if (!enabled) return;
    const rng = this.rng.fork('events');
    // Airdrop some minutes in.
    if (rng.chance(0.75)) this.airdropAt = rng.range(150, Math.min(420, this.timeLimit * 0.5));
    // A crashed helicopter with cargo, guarded by a raider team.
    if (rng.chance(0.55)) {
      const spot = this.openSpot(rng, 45, 4);
      if (spot) {
        const angle = rng.range(-Math.PI, Math.PI);
        const ev: MapEvent = { id: this.nextEventId++, kind: 'heli', x: spot.x, y: spot.y, angle, landed: true, at: 0, name: 'Helicopter crash site' };
        this.mapEvents.push(ev);
        for (const [dx, dy] of [[2, 1], [-2, -1]] as const) {
          const t = this.pathfinder.nearestWalkable(Math.floor(spot.x + Math.cos(angle) * dx - Math.sin(angle) * dy), Math.floor(spot.y + Math.sin(angle) * dx + Math.cos(angle) * dy), 3);
          if (t) this.addEventContainer('helicrate', t.x, t.y, 3);
        }
        let leader: number | null = null;
        const team = rng.int(2, 3);
        for (let i = 0; i < team; i++) {
          const t = this.pathfinder.nearestWalkable(Math.floor(spot.x + rng.range(-5, 5)), Math.floor(spot.y + rng.range(-5, 5)), 4);
          if (!t) continue;
          const a = this.spawnBot('raider', t.x + 0.5, t.y + 0.5, leader);
          leader ??= a.id;
        }
      }
    }
  }

  /** Open outdoor walkable tile with clearance, at least `minDist` from the player. */
  private openSpot(rng: Rng, minDist: number, clearance: number): { x: number; y: number } | null {
    const m = this.map;
    for (let tries = 0; tries < 400; tries++) {
      const x = rng.int(clearance + 2, m.width - clearance - 3);
      const y = rng.int(clearance + 2, m.height - clearance - 3);
      if (Math.hypot(x - this.player.pos.x, y - this.player.pos.y) < minDist) continue;
      let ok = true;
      for (let dy = -clearance; dy <= clearance && ok; dy++)
        for (let dx = -clearance; dx <= clearance && ok; dx++) ok = m.isWalkable(x + dx, y + dy) && !m.isIndoors(x + dx, y + dy);
      if (ok) return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  private addEventContainer(kind: ContainerKind, x: number, y: number, tier: number): LootContainer {
    const c: LootContainer = { id: 200000 + this.nextId++, kind, x, y, grid: createGrid(1, 1), revealedUids: [], searchT: 0, searched: false, generated: false, tier };
    this.map.containers.push(c);
    return c;
  }

  private updateMapEvents(): void {
    if (this.airdropAt > 0 && this.time >= this.airdropAt) {
      this.airdropAt = -1;
      const spot = this.openSpot(this.rng.fork(`drop${Math.floor(this.time)}`), 30, 2);
      if (spot) {
        this.mapEvents.push({ id: this.nextEventId++, kind: 'airdrop', x: spot.x, y: spot.y, angle: 0, landed: false, at: this.time, name: 'Airdrop' });
        this.emit({ t: 'msg', text: 'Airdrop inbound — green smoke marks the drop zone (see map)', tone: 'info' });
      }
    }
    for (const ev of this.mapEvents) {
      if (ev.kind !== 'airdrop' || ev.landed || this.time - ev.at < AIRDROP_FALL) continue;
      ev.landed = true;
      this.addEventContainer('airdrop', Math.floor(ev.x), Math.floor(ev.y), 4);
      // The thud and smoke draw everyone nearby.
      this.makeNoise(ev.x, ev.y, 80, -1, 'shot');
      this.emit({ t: 'msg', text: 'The airdrop has landed', tone: 'info' });
    }
  }

  /** Reinforcement waves (scavs / infected) arrive from out-of-sight spots so the map stays alive. */
  private spawnWave(): void {
    const alive = this.actors.reduce((n, a) => n + (a.alive && a.brain && !a.npcId ? 1 : 0), 0);
    if (alive >= 26) return;
    const rng = this.botRng;
    for (let tries = 0; tries < 40; tries++) {
      const p = rng.pick(this.map.pois);
      if (dist(p, this.player.pos) < 55 || this.isVisibleToPlayer(p.x, p.y)) continue;
      const arch: BotArchetype = rng.chance(0.55) ? 'infected' : rng.chance(0.85) ? 'scav' : 'raider';
      const n = arch === 'infected' ? rng.int(2, 4) : rng.int(1, 3);
      let leader: number | null = null;
      for (let i = 0; i < n; i++) {
        const t = this.pathfinder.nearestWalkable(Math.floor(p.x + rng.range(-2, 2)), Math.floor(p.y + rng.range(-2, 2)), 3);
        if (!t) continue;
        const a = this.spawnBot(arch, t.x + 0.5, t.y + 0.5, leader);
        leader ??= a.id;
      }
      return;
    }
  }

  private spawnEncounter(enc: RaidNpcSpawn): void {
    const rng = this.rng.fork(`npc-${enc.npcId}`);
    const buildings = this.map.buildings.filter((b) => enc.prefers.includes(b.kind));
    const pool = buildings.length ? buildings : this.map.buildings;
    if (!pool.length) return;
    const b = rng.pick(pool);
    const room = rng.pick(b.rooms);
    const tile = this.pathfinder.nearestWalkable(Math.floor(room.x + room.w / 2), Math.floor(room.y + room.h / 2), 3) ?? {
      x: Math.floor(room.x + room.w / 2),
      y: Math.floor(room.y + room.h / 2),
    };
    if (!this.map.isWalkable(tile.x, tile.y)) return;
    const a = this.spawnActor({ name: enc.name, faction: 'npc', archetype: 'npc', x: tile.x + 0.5, y: tile.y + 0.5, hp: 100, speed: 2.8, eq: enc.eq });
    a.npcId = enc.npcId;
    // Wounded — the player finds them in trouble.
    a.health.parts.leftLeg.hp = 18;
    a.health.parts.leftLeg.light = true;
    a.health.parts.stomach.hp = 40;
    this.syncHealth(a);
    a.brain = new BotBrain('npc', rng, null);
  }

  // ── Main loop ───────────────────────────────────────────────────────────────

  /** Advance by real elapsed time using a fixed timestep (deterministic and frame-rate independent). Returns steps run. */
  advance(elapsed: number, input: ActorIntent): number {
    this.accumulator = Math.min(this.accumulator + elapsed, 0.25);
    let steps = 0;
    while (this.accumulator >= FIXED_DT) {
      this.tick(FIXED_DT, input);
      input.firePressed = false;
      input.reload = false;
      input.switchTo = null;
      input.use = null;
      this.accumulator -= FIXED_DT;
      steps++;
    }
    return steps;
  }

  tick(dt: number, input?: ActorIntent): void {
    if (this.status !== 'active') return;
    this.time += dt;
    if (input && this.player.alive) Object.assign(this.player.intent, input);

    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.brain) a.brain.update(this, a, dt);
    }
    for (const a of this.actors) {
      if (!a.alive) continue;
      this.updateActor(a, dt);
    }
    this.hash.rebuild(this.liveActors());
    this.separateActors();

    for (let i = this.noises.length - 1; i >= 0; i--) if (this.time - this.noises[i]!.t > 0.6) this.noises.splice(i, 1);

    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = this.rng.range(160, 260);
      this.spawnWave();
    }
    this.updateMapEvents();

    this.updateLootSearch(dt);
    this.updateExtraction(dt);
    this.updateFov(false);
    if (this.time >= this.timeLimit && this.status === 'active') {
      this.status = 'mia';
      this.emit({ t: 'msg', text: 'Raid time expired — missing in action.', tone: 'bad' });
    }
  }

  *liveActors(): Iterable<Actor> {
    for (const a of this.actors) if (a.alive) yield a;
  }

  drainEvents(): RaidEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  emit(e: RaidEvent): void {
    this.events.push(e);
  }

  // ── Actor update ────────────────────────────────────────────────────────────

  private updateActor(a: Actor, dt: number): void {
    const it = a.intent;
    if (a.vaultT > 0 && a.vaultFrom && a.vaultTo) {
      a.vaultT = Math.max(0, a.vaultT - dt);
      const t = 1 - a.vaultT / VAULT_TIME;
      const e = t * t * (3 - 2 * t);
      a.pos.x = a.vaultFrom.x + (a.vaultTo.x - a.vaultFrom.x) * e;
      a.pos.y = a.vaultFrom.y + (a.vaultTo.y - a.vaultFrom.y) * e;
      a.vel.x = a.vel.y = 0;
      if (a.vaultT <= 0) a.vaultFrom = a.vaultTo = null;
      return;
    }

    // Status effects: bleeding, regeneration, painkillers.
    if (tickHealth(a.health, dt) > 0 || a.health.regenT > 0) this.syncHealth(a);
    if (isDead(a.health)) return this.kill(a, a.lastAttacker !== null ? this.actorById(a.lastAttacker) : null);
    if (a.faction === 'player') {
      const meta = metabolismMul(a.health);
      a.energy = Math.max(0, a.energy - 0.035 * meta * dt);
      a.hydration = Math.max(0, a.hydration - 0.055 * meta * dt);
      if (a.energy <= 0 || a.hydration <= 0) this.damageRaw(a, 0.4 * dt, null, 'stomach');
      if (!a.alive) return;
    }

    // Weapon switching.
    if (it.switchTo && it.switchTo !== a.active && (it.switchTo === 'melee' || a.eq.slots[it.switchTo])) {
      a.active = it.switchTo;
      a.reloadT = 0;
      a.fireCd = Math.max(a.fireCd, 0.35);
    }
    if (a.active !== 'melee' && !a.eq.slots[a.active]) a.active = a.eq.slots.primary ? 'primary' : a.eq.slots.secondary ? 'secondary' : 'melee';

    // Facing: you look (and your vision cone + flashlight point) where the mouse is; walking sideways or
    // backwards is allowed. Only a sprint without aiming turns the body into the run direction.
    const aiming = !a.brain ? it.aim || it.fire || a.fireCd > -0.5 : true;
    a.aiming = aiming;
    const runTurn = !a.brain && !aiming && it.sprint && Math.hypot(it.moveX, it.moveY) > 0.1 && a.stamina > 0 && !a.winded;
    const turnRate = a.faction === 'player' ? (aiming ? 40 : 18) : a.archetype === 'infected' ? 4 : 7;
    if (runTurn) {
      a.facing = turnTowards(a.facing, Math.atan2(it.moveY, it.moveX), 14 * dt);
    } else if (Math.hypot(it.aimX - a.pos.x, it.aimY - a.pos.y) > 0.05) {
      a.facing = turnTowards(a.facing, angleTo(a.pos, { x: it.aimX, y: it.aimY }), turnRate * dt);
    }

    // Movement.
    let mx = it.moveX;
    let my = it.moveY;
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    const moving = ml > 0.05;
    a.crouching = it.crouch;
    // Winded: once stamina hits zero you can't sprint again until it recovers to 30 (no sprint/walk flicker).
    if (a.stamina <= 0) a.winded = true;
    else if (a.winded && a.stamina >= 30) a.winded = false;
    a.sprinting = it.sprint && moving && !a.crouching && !a.winded && (a.brain !== null || !it.aim) && a.useT <= 0 && canSprint(a.health);
    if (a.sprinting) a.stamina = Math.max(0, a.stamina - 13 * dt);
    else a.stamina = Math.min(100, a.stamina + (moving ? 6 : 11) * (a.winded ? 0.8 : 1) * dt);

    if (((this.time * 60) | 0) % 30 === a.id % 30) this.recomputeSpeed(a);
    let speed = a.baseSpeed * a.speedMul;
    if (a.crouching) speed *= 0.5;
    else if (a.sprinting) speed *= 1.6;
    if (a.useT > 0) speed *= 0.45;
    if (a.reloadT > 0) speed *= 0.85;
    // Backpedalling is slower than walking forward.
    if (moving && !a.sprinting && Math.cos(Math.atan2(my, mx) - a.facing) < -0.3) speed *= 0.78;
    speed *= moveMul(a.health);
    const accel = Math.min(1, dt * 14);
    a.vel.x += (mx * speed - a.vel.x) * accel;
    a.vel.y += (my * speed - a.vel.y) * accel;
    this.moveAndCollide(a, a.vel.x * dt, a.vel.y * dt);

    // Footstep noise.
    const v = Math.hypot(a.vel.x, a.vel.y);
    if (v > 0.4) {
      a.stepT -= dt * v;
      if (a.stepT <= 0) {
        a.stepT = 0.75;
        const r = a.crouching ? 1.4 : a.sprinting ? 8 : 3.5;
        this.makeNoise(a.pos.x, a.pos.y, a.archetype === 'infected' ? r * 0.5 : r, a.id, 'step');
        const tx = Math.floor(a.pos.x);
        const ty = Math.floor(a.pos.y);
        this.emit({ t: 'step', actor: a.id, x: a.pos.x, y: a.pos.y, tile: this.map.get(tx, ty), indoor: this.map.isIndoors(tx, ty), loud: a.crouching ? 0.35 : a.sprinting ? 1.4 : 1 });
      }
    }

    // Item use (meds / food).
    if (it.use && a.useT <= 0 && a.reloadT <= 0) this.startUse(a, it.use, it.useOn ?? null);
    if (a.useT > 0) {
      a.useT -= dt;
      if (a.useT <= 0) this.finishUse(a);
    }

    // Weapons.
    a.fireCd -= dt;
    a.bloom = Math.max(0, a.bloom - dt * 0.18);
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) this.finishReload(a);
    }
    if (it.reload) this.startReload(a);
    if (it.fire && a.useT <= 0) this.tryAttack(a, it);
  }

  recomputeSpeed(a: Actor): void {
    const weight = equipmentWeight(a.eq);
    let mul = 1;
    if (weight > 28) mul -= Math.min(0.45, (weight - 28) / 70);
    for (const s of ['armor', 'helmet'] as const) {
      const it = a.eq.slots[s];
      if (it) mul -= getDef(it.def).armor?.slow ?? 0;
    }
    const held = this.weaponItem(a);
    if (held) mul *= effectiveWeapon(held).ergo;
    a.speedMul = Math.max(0.45, mul);
  }

  private moveAndCollide(a: Actor, dx: number, dy: number): void {
    // Sub-step fast moves so we never tunnel through 1-tile walls.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25));
    for (let s = 0; s < steps; s++) {
      a.pos.x += dx / steps;
      this.resolveTiles(a);
      a.pos.y += dy / steps;
      this.resolveTiles(a);
    }
  }

  private boxScratch: Box[] = [];

  private resolveTiles(a: Actor): void {
    const r = a.radius;
    const x0 = Math.floor(a.pos.x - r);
    const x1 = Math.floor(a.pos.x + r);
    const y0 = Math.floor(a.pos.y - r);
    const y1 = Math.floor(a.pos.y + r);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.map.isSolid(tx, ty)) continue;
        for (const [bx0, by0, bx1, by1] of solidBoxes(this.map, tx, ty, this.boxScratch)) {
          const cx = clamp(a.pos.x, bx0, bx1);
          const cy = clamp(a.pos.y, by0, by1);
          let nx = a.pos.x - cx;
          let ny = a.pos.y - cy;
          const d2 = nx * nx + ny * ny;
          if (d2 >= r * r) continue;
          if (d2 < 1e-10) {
            // Centre inside the box: push out along the shortest axis.
            const left = a.pos.x - bx0;
            const right = bx1 - a.pos.x;
            const top = a.pos.y - by0;
            const bottom = by1 - a.pos.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) a.pos.x = bx0 - r;
            else if (m === right) a.pos.x = bx1 + r;
            else if (m === top) a.pos.y = by0 - r;
            else a.pos.y = by1 + r;
            continue;
          }
          const d = Math.sqrt(d2);
          nx /= d;
          ny /= d;
          a.pos.x = cx + nx * r;
          a.pos.y = cy + ny * r;
        }
      }
  }

  private separateActors(): void {
    const near = this.scratch;
    for (const a of this.actors) {
      if (!a.alive) continue;
      near.length = 0;
      this.hash.query(a.pos.x, a.pos.y, 0.8, near);
      for (const b of near) {
        if (b.id <= a.id) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        a.pos.x -= (dx / d) * push;
        a.pos.y -= (dy / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.y += (dy / d) * push;
        this.resolveTiles(a);
        this.resolveTiles(b);
      }
    }
  }

  // ── Weapons ─────────────────────────────────────────────────────────────────

  weaponItem(a: Actor): ItemInstance | null {
    if (a.active === 'melee') return null;
    const it = a.eq.slots[a.active];
    return it && getDef(it.def).weapon ? it : null;
  }

  meleeStats(a: Actor): MeleeStats {
    if (a.natural) return { ...FISTS, damage: a.natural.damage, cooldown: a.natural.cooldown, reach: a.natural.reach, bleedChance: a.natural.bleedChance, armorBypass: 0.25 };
    const m = a.eq.slots.melee;
    return (m && getDef(m.def).melee) || FISTS;
  }

  private tryAttack(a: Actor, it: ActorIntent): void {
    if (a.fireCd > 0 || a.reloadT > 0) return;
    const w = this.weaponItem(a);
    if (!w) {
      this.melee(a);
      return;
    }
    const def = effectiveWeapon(w);
    if (!def.auto && !it.firePressed) return;
    if ((w.ammo ?? 0) <= 0) {
      if (it.firePressed && a === this.player) this.emit({ t: 'msg', text: 'Out of ammo — press R to reload' });
      a.fireCd = 0.25;
      return;
    }
    this.fireGun(a, w);
  }

  private fireGun(a: Actor, w: ItemInstance): void {
    const def = effectiveWeapon(w);
    a.fireCd = 60 / def.rpm;
    w.ammo = (w.ammo ?? 1) - 1;
    const moving = Math.hypot(a.vel.x, a.vel.y) > 0.6;
    // Hip fire (player not holding aim) is much less accurate; optics only help when aiming.
    const aiming = !!a.brain || a.intent.aim;
    const hip = aiming ? def.aimSpreadMul : 1.6;
    const spread = (def.spread * (moving ? 1.8 : 1) * (a.crouching ? 0.7 : 1) * hip + a.bloom) * aimMul(a.health);
    a.bloom = Math.min(0.12, a.bloom + def.recoil * 0.35);
    this.makeNoise(a.pos.x, a.pos.y, def.noise, a.id, 'shot');
    const pellets = def.pellets ?? 1;
    for (let p = 0; p < pellets; p++) {
      const ang = a.facing + gaussian(this.rng) * spread * 0.5;
      this.traceBullet(a, ang, def.range, def.damage, w.ammoType, w.def, p === 0, def.suppressed);
    }
    if (a === this.player) this.invVersion++;
  }

  /** Hitscan bullet: walls stop it, cars/trees/fences may catch it, the nearest actor on the line takes the hit. */
  private traceBullet(a: Actor, angle: number, range: number, damage: number, ammoType: string | undefined, weapon: string, first = true, suppressed = false): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const ox = a.pos.x + dx * (a.radius + 0.05);
    const oy = a.pos.y + dy * (a.radius + 0.05);
    let wallT = this.bulletObstacle(ox, oy, dx, dy, range);
    const blocked = wallT >= 0;
    if (!blocked) wallT = range;

    const near = this.scratch;
    near.length = 0;
    this.hash.query(ox + (dx * wallT) / 2, oy + (dy * wallT) / 2, wallT / 2 + 1, near);
    let best: Actor | null = null;
    let bestT = wallT;
    for (const b of near) {
      if (b === a || !b.alive) continue;
      const t = rayCircle(ox, oy, dx, dy, b.pos.x, b.pos.y, b.radius);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = b;
      }
    }
    const ex = ox + dx * bestT;
    const ey = oy + dy * bestT;
    this.emit({ t: 'shot', actor: a.id, fx: ox, fy: oy, tx: ex, ty: ey, weapon, hit: !!best, suppressed, pellet: !first });
    if (best) {
      // Falloff past effective range.
      const falloff = bestT > range * 0.6 ? 1 - ((bestT - range * 0.6) / (range * 0.4)) * 0.35 : 1;
      const zone = this.rollZone(best);
      const res = resolveBulletHit(this.rng, damage * falloff, ammoType, zone, armorFor(zone, best.eq.slots));
      this.applyHit(best, a, res, zone, false, ex, ey);
    } else if (blocked) {
      const tile = this.map.get(Math.floor(ex + dx * 0.08), Math.floor(ey + dy * 0.08));
      if (tile === Tile.Window) this.breakGlass(this.map.idx(Math.floor(ex + dx * 0.08), Math.floor(ey + dy * 0.08)), a);
      const material = tile === Tile.Window ? 'glass' : tile === Tile.Tree || tile === Tile.Wood ? 'wood' : tile === Tile.Car || tile === Tile.Fence ? 'metal' : 'ground';
      this.emit({ t: 'impact', x: ex, y: ey, material });
      this.makeNoise(ex, ey, 3, a.id, 'impact');
    }
  }

  /** Distance to the first tile that stops a bullet, or -1. */
  bulletObstacle(ox: number, oy: number, dx: number, dy: number, range: number): number {
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDY : Infinity;
    let t = 0;
    while (t < range) {
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDX;
        x += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDY;
        y += stepY;
      }
      if (t >= range) break;
      const tile = this.map.get(x, y);
      if (OPAQUE[tile]) return t;
      // Soft cover: shooting *over* adjacent cover is fine, far cover catches most rounds.
      if ((tile === Tile.Car || tile === Tile.Tree || tile === Tile.Fence) && t > 1.4 && this.rng.chance(tile === Tile.Fence ? 0.25 : 0.7)) return t;
    }
    return -1;
  }

  private rollZone(target: Actor): HitZone {
    // Crouching behind cover protects legs a bit more.
    return target.crouching && this.rng.chance(0.3) ? 'thorax' : this.rng.weighted(ZONE_WEIGHTS);
  }

  private melee(a: Actor): void {
    const st = this.meleeStats(a);
    if (a.stamina < st.stamina * 0.5) return;
    a.fireCd = st.cooldown;
    a.stamina = Math.max(0, a.stamina - st.stamina);
    const wid = a.natural ? 'claws' : (a.eq.slots.melee?.def ?? 'fists');
    this.emit({ t: 'swing', actor: a.id, x: a.pos.x, y: a.pos.y, facing: a.facing, weapon: wid });
    this.makeNoise(a.pos.x, a.pos.y, st.noise, a.id, 'melee');
    const near = this.scratch;
    near.length = 0;
    this.hash.query(a.pos.x, a.pos.y, a.radius + st.reach + 0.5, near);
    let hits = 0;
    for (const b of near) {
      if (b === a || !b.alive) continue;
      const d = dist(a.pos, b.pos) - b.radius - a.radius;
      if (d > st.reach) continue;
      const ang = Math.abs(((angleTo(a.pos, b.pos) - a.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ang > st.arc) continue;
      if (!this.map.rayClear(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue;
      // Allies don't hit each other in melee (bots would otherwise brawl in doorways).
      if (!hostile(a.faction, b.faction) && a.faction !== 'player') continue;
      const zone = this.rollZone(b);
      const res: ReturnType<typeof resolveMeleeHit> & { fractureChance?: number } = resolveMeleeHit(st, zone, armorFor(zone, b.eq.slots));
      res.fractureChance = st.armorBypass * 0.35;
      // Stealth bonus: hitting someone who isn't facing you.
      const facingAway = Math.abs(((angleTo(b.pos, a.pos) - b.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 2.1;
      if (facingAway && b.brain && !b.brain.alerted) res.damage *= 1.8;
      this.applyHit(b, a, res, zone, true, b.pos.x, b.pos.y);
      if (++hits >= 2) break;
    }
  }

  private applyHit(
    target: Actor,
    attacker: Actor,
    res: { damage: number; penetrated: boolean; armorDamage: number; bleedChance: number; fractureChance?: number },
    zone: HitZone,
    melee: boolean,
    x: number,
    y: number,
  ): void {
    if (!target.alive) return;
    if (target === this.player && attacker.brain && !attacker.companion) res = { ...res, damage: res.damage * DIFFICULTY[this.difficulty].botDamage };
    const armor = armorFor(zone, target.eq.slots);
    if (armor && res.armorDamage > 0) armor.dur = Math.max(0, (armor.dur ?? 0) - res.armorDamage);
    target.lastHitAt = this.time;
    target.lastAttacker = attacker.id;
    this.emit({ t: 'hit', target: target.id, attacker: attacker.id, x, y, zone, damage: res.damage, penetrated: res.penetrated, melee });
    if (target.brain) target.brain.onDamaged(this, target, attacker);
    const died = damagePart(target.health, zone, res.damage, this.rng, {
      bleedChance: res.bleedChance,
      heavyChance: res.damage > 40 ? 0.45 : 0.2,
      fractureChance: res.fractureChance ?? (res.penetrated && !melee ? 0.16 : 0),
    });
    this.syncHealth(target);
    if (target === this.player) {
      const p = target.health.parts[zone];
      if (p.fracture && res.fractureChance !== 0) this.emit({ t: 'msg', text: `${PART_LABEL[zone]}: fracture`, tone: 'bad' });
    }
    if (died) this.kill(target, attacker);
    if (target === this.player || attacker === this.player) this.invVersion++;
  }

  /** Keep the derived totals that AI and HUD read in sync with the per-limb model. */
  syncHealth(a: Actor): void {
    a.hp = totalHp(a.health);
    a.maxHp = totalMax(a.health);
    let dps = 0;
    for (const p of BODY_PARTS) dps += (a.health.parts[p].heavy ? HEAVY_BLEED_DPS : 0) + (a.health.parts[p].light ? LIGHT_BLEED_DPS : 0);
    a.bleed = dps;
  }

  private damageRaw(a: Actor, amount: number, attacker: Actor | null, part: BodyPart = 'thorax'): void {
    if (!a.alive) return;
    const died = damagePart(a.health, part, amount, null);
    this.syncHealth(a);
    if (died) this.kill(a, attacker ?? (a.lastAttacker !== null ? this.actorById(a.lastAttacker) : null));
  }

  private kill(a: Actor, killer: Actor | null): void {
    if (!a.alive) return;
    a.alive = false;
    a.hp = 0;
    a.vel.x = a.vel.y = 0;
    this.corpses.push({ id: this.nextCorpseId++, actorId: a.id, name: a.name, faction: a.faction, pos: { ...a.pos }, facing: a.facing, eq: a.eq });
    this.emit({ t: 'death', actor: a.id, killer: killer?.id ?? null, name: a.name, faction: a.faction });
    if (killer) {
      killer.kills++;
      if (killer === this.player) {
        this.killsBy[a.archetype] = (this.killsBy[a.archetype] ?? 0) + 1;
        this.emit({ t: 'msg', text: `Killed ${a.name}`, tone: 'good' });
      }
    }
    if (a.npcId) {
      this.deadNpcs.add(a.npcId);
      this.emit({ t: 'msg', text: `${a.name} is dead.`, tone: 'bad' });
    }
    if (a === this.player) {
      this.status = 'dead';
      this.emit({ t: 'died' });
    }
  }

  startReload(a: Actor): boolean {
    const w = this.weaponItem(a);
    if (!w || a.reloadT > 0) return false;
    const def = effectiveWeapon(w);
    if ((w.ammo ?? 0) >= def.magSize) return false;
    if (!carryGrids(a.eq).some((g) => g.items.some((p) => getDef(p.item.def).ammo?.caliber === def.caliber))) {
      if (a === this.player) this.emit({ t: 'msg', text: `No ${def.caliber} ammo`, tone: 'bad' });
      return false;
    }
    a.reloadT = def.reloadTime;
    this.emit({ t: 'reload', actor: a.id });
    return true;
  }

  private finishReload(a: Actor): void {
    const w = this.weaponItem(a);
    if (!w) return;
    const def = effectiveWeapon(w);
    const loaded = w.ammo ?? 0;
    const { taken, type } = takeAmmo(a.eq, def.caliber, def.magSize - loaded, loaded > 0 ? w.ammoType : undefined);
    if (taken > 0) {
      if (type !== w.ammoType && loaded > 0 && w.ammoType) {
        // Swapped ammo type: old rounds go back into the inventory.
        const back = { uid: `${w.uid}-r${this.nextId++}`, def: w.ammoType, stack: loaded };
        for (const g of carryGrids(a.eq)) if (addItem(g, back)) break;
        w.ammo = 0;
      }
      w.ammoType = type ?? w.ammoType;
      w.ammo = (w.ammo ?? 0) + taken;
    }
    if (a === this.player) this.invVersion++;
  }

  // ── Items ───────────────────────────────────────────────────────────────────

  findCarried(a: Actor, uid: string): { grid: ReturnType<typeof carryGrids>[number]; item: ItemInstance } | null {
    for (const g of carryGrids(a.eq)) {
      const p = findPlaced(g, uid);
      if (p) return { grid: g, item: p.item };
    }
    return null;
  }

  private startUse(a: Actor, uid: string, part: BodyPart | null): void {
    const found = this.findCarried(a, uid);
    if (!found) return;
    const d = getDef(found.item.def);
    const t = d.med?.useTime ?? d.food?.useTime;
    if (t === undefined) return;
    if (d.med) {
      const target = treatmentTarget(a.health, d.med, part ?? undefined);
      if (!target || (part && treatmentTarget(a.health, d.med, part) !== part && !d.med.painkiller && !d.med.regen)) {
        if (a === this.player) this.emit({ t: 'msg', text: part ? `Nothing to treat on ${PART_LABEL[part].toLowerCase()}` : 'Nothing to treat with that' });
        return;
      }
      a.usePart = target;
    }
    a.useT = t;
    a.useUid = uid;
    a.reloadT = 0;
  }

  private finishUse(a: Actor): void {
    const uid = a.useUid;
    a.useUid = null;
    if (!uid) return;
    const found = this.findCarried(a, uid);
    if (!found) return;
    const d = getDef(found.item.def);
    if (d.med) {
      const part = a.usePart ?? treatmentTarget(a.health, d.med);
      a.usePart = null;
      if (!part) return;
      const left = applyMed(a.health, d.med, part, found.item.uses ?? (d.med.resource || d.med.uses));
      if (left === null) return;
      found.item.uses = left;
      if (left <= 0) removeItem(found.grid, uid);
      if (found.item.def === 'stim') a.stamina = 100;
      this.syncHealth(a);
      this.emit({ t: 'used', actor: a.id, item: found.item.def });
      if (a === this.player) this.invVersion++;
      return;
    }
    if (d.food) {
      a.energy = clamp(a.energy + d.food.energy, 0, 100);
      a.hydration = clamp(a.hydration + d.food.hydration, 0, 100);
    }
    removeItem(found.grid, uid);
    this.emit({ t: 'used', actor: a.id, item: found.item.def });
    if (a === this.player) this.invVersion++;
  }

  /**
   * Best med for the current state, Tarkov priority: heavy bleed → light bleed → fracture → pain → HP.
   * Bots skip surgery (too slow mid-fight).
   */
  /** Why quick-heal found nothing: no meds at all, or nothing they can fix. */
  medHint(a: Actor): string {
    const meds = carryGrids(a.eq).flatMap((g) => g.items.filter((p) => getDef(p.item.def).med));
    if (!meds.length) return 'No meds in your pockets, rig or backpack';
    const h = a.health;
    if (BODY_PARTS.some((p) => isLimb(p) && h.parts[p].hp <= 0)) return 'Destroyed limb — needs a surgical kit (CMS / Surv12)';
    if (totalHp(h) >= totalMax(h) && !bleeding(h).light && !bleeding(h).heavy) return 'Nothing to treat';
    return 'None of your meds can treat this';
  }

  bestMed(a: Actor): ItemInstance | null {
    const h = a.health;
    const b = bleeding(h);
    const fracture = BODY_PARTS.some((p) => h.parts[p].fracture);
    const missing = totalMax(h) - totalHp(h);
    let best: ItemInstance | null = null;
    let score = -Infinity;
    for (const g of carryGrids(a.eq))
      for (const p of g.items) {
        const m = getDef(p.item.def).med;
        if (!m || (m.surgery && a.brain)) continue;
        if (!treatmentTarget(h, m)) continue;
        let s = 0;
        if (b.heavy && m.stopsHeavy) s += 100;
        if (b.light && m.stopsLight) s += 50;
        if (fracture && m.fixesFracture) s += 40;
        if (inPain(h) && m.painkiller) s += 25;
        if (m.resource > 0) s += 5 + Math.min(missing, p.item.uses ?? m.resource) * 0.3;
        if (m.surgery) s += 30;
        // Use time only breaks ties — any med that has something to do beats doing nothing.
        s -= m.useTime * 0.1;
        if (s > score) {
          score = s;
          best = p.item;
        }
      }
    return best;
  }

  bestFood(a: Actor): ItemInstance | null {
    for (const g of carryGrids(a.eq))
      for (const p of g.items) {
        const f = getDef(p.item.def).food;
        if (f && (a.hydration < a.energy ? f.hydration > 0 : f.energy > 0)) return p.item;
      }
    return null;
  }

  // ── Noise / perception helpers ──────────────────────────────────────────────

  makeNoise(x: number, y: number, radius: number, source: number, kind: Noise['kind']): void {
    // Gunfire carries, but not across the whole map: ~65% of the weapon's nominal noise radius.
    this.noises.push({ x, y, radius: kind === 'shot' ? radius * 0.65 : radius, source, t: this.time, kind, id: this.noiseId++ });
  }

  actorById(id: number): Actor | null {
    for (const a of this.actors) if (a.id === id) return a;
    return null;
  }

  queryActors(x: number, y: number, r: number, out: Actor[]): Actor[] {
    return this.hash.query(x, y, r, out);
  }

  /** Light level 0..1 at a position: indoors and at night it's dark, flashlights light you up. */
  visibilityOf(target: Actor): number {
    let v = this.timeOfDay === 'day' ? 1 : this.timeOfDay === 'dusk' ? 0.75 : 0.45;
    if (this.map.isIndoors(Math.floor(target.pos.x), Math.floor(target.pos.y))) v *= 0.8;
    if (target.flashlight && this.timeOfDay !== 'day') v = Math.min(1.2, v + 0.6);
    if (target.crouching) v *= 0.6;
    if (this.rain) v *= 0.85;
    return v;
  }

  private updateFov(force: boolean): void {
    const p = this.player;
    const tx = Math.floor(p.pos.x);
    const ty = Math.floor(p.pos.y);
    const bucket = Math.round(((p.facing + Math.PI) / (Math.PI * 2)) * 48) % 48;
    const key = (ty * this.map.width + tx) * 64 + bucket;
    if (!force && key === this.fovKey) return;
    this.fovKey = key;
    const radius = this.timeOfDay === 'night' ? 22 : 30;
    computeFov(this.map, p.pos.x, p.pos.y, { radius, facing: p.facing, coneHalf: 1.15, nearRadius: 4.5 }, this.playerFov);
    for (let i = 0; i < this.playerFov.length; i++) if (this.playerFov[i]) this.explored[i] = 1;
    this.fovVersion++;
  }

  isVisibleToPlayer(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.map.inBounds(tx, ty) && this.playerFov[this.map.idx(tx, ty)] === 1;
  }

  // ── Interaction / looting ───────────────────────────────────────────────────

  /** Closest thing the player can interact with. */
  nearestInteractable(): Interactable | null {
    const p = this.player.pos;
    let best: Interactable | null = null;
    let bestD = INTERACT_RANGE;
    for (const c of this.map.containers) {
      const d = Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y);
      if (d < bestD && this.map.rayClear(p.x, p.y, c.x + 0.5, c.y + 0.5)) {
        bestD = d;
        best = { kind: 'container', id: c.id, label: CONTAINERS[c.kind].label, x: c.x + 0.5, y: c.y + 0.5, searched: c.searched };
      }
    }
    for (const c of this.corpses) {
      const d = dist(c.pos, p);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'corpse', id: c.id, label: `Body: ${c.name}`, x: c.pos.x, y: c.pos.y };
      }
    }
    for (const a of this.actors) {
      if (!a.alive || !a.npcId) continue;
      const d = dist(a.pos, p);
      if (d < bestD + 0.6) {
        bestD = d;
        best = { kind: 'npc', id: a.id, npcId: a.npcId, label: `Talk to ${a.name}`, x: a.pos.x, y: a.pos.y };
      }
    }
    return best ?? this.windowNear(this.player);
  }

  /** Everything you could interact with around a world point (for the right-click menu), nearest first. */
  interactablesAt(x: number, y: number, r = 1.2): Interactable[] {
    const out: { d: number; it: Interactable }[] = [];
    for (const c of this.map.containers) {
      const d = Math.hypot(c.x + 0.5 - x, c.y + 0.5 - y);
      if (d < r) out.push({ d, it: { kind: 'container', id: c.id, label: CONTAINERS[c.kind].label, x: c.x + 0.5, y: c.y + 0.5, searched: c.searched } });
    }
    for (const c of this.corpses) {
      const d = Math.hypot(c.pos.x - x, c.pos.y - y);
      if (d < r) out.push({ d, it: { kind: 'corpse', id: c.id, label: c.name, x: c.pos.x, y: c.pos.y } });
    }
    for (const a of this.actors) {
      if (!a.alive || !a.npcId) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.y - y);
      if (d < r) out.push({ d, it: { kind: 'npc', id: a.id, npcId: a.npcId, label: a.name, x: a.pos.x, y: a.pos.y } });
    }
    for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++)
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (this.map.get(tx, ty) !== Tile.Window) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        const idx = this.map.idx(tx, ty);
        if (d < r) out.push({ d, it: { kind: 'window', id: idx, label: 'Window', x: tx + 0.5, y: ty + 0.5, broken: this.brokenGlass.has(idx) } });
      }
    for (const e of this.map.extractions) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < e.radius + 0.5) out.push({ d: d + 1, it: { kind: 'extract', id: e.id, label: e.name, x: e.x, y: e.y } });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.it);
  }

  // ── Windows ─────────────────────────────────────────────────────────────────

  /** Window tile the actor can climb through right now (adjacent, facing roughly towards it, room behind). */
  windowNear(a: Actor): Interactable | null {
    const tx = Math.floor(a.pos.x);
    const ty = Math.floor(a.pos.y);
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const wx = tx + dx;
      const wy = ty + dy;
      if (this.map.get(wx, wy) !== Tile.Window || !this.map.isWalkable(wx + dx, wy + dy)) continue;
      const d = Math.hypot(wx + 0.5 - a.pos.x, wy + 0.5 - a.pos.y);
      if (d > 1.25) continue;
      const score = Math.cos(Math.atan2(dy, dx) - a.facing) - d;
      if (score > bestScore) {
        bestScore = score;
        const idx = this.map.idx(wx, wy);
        best = { kind: 'window', id: idx, label: this.brokenGlass.has(idx) ? 'Climb through window' : 'Climb through window (glass)', x: wx + 0.5, y: wy + 0.5, broken: this.brokenGlass.has(idx) };
      }
    }
    return best;
  }

  /** Smash the glass of a window tile (loud). */
  breakGlass(idx: number, by: Actor): void {
    if (this.brokenGlass.has(idx)) return;
    this.brokenGlass.add(idx);
    const x = (idx % this.map.width) + 0.5;
    const y = Math.floor(idx / this.map.width) + 0.5;
    this.emit({ t: 'glass', x, y, idx });
    this.makeNoise(x, y, 16, by.id, 'impact');
  }

  /** Start climbing through the window `idx` (must be adjacent). Unbroken glass gets smashed and may cut you. */
  vault(a: Actor, idx: number): boolean {
    if (a.vaultT > 0 || a.useT > 0) return false;
    const wx = idx % this.map.width;
    const wy = Math.floor(idx / this.map.width);
    if (this.map.get(wx, wy) !== Tile.Window) return false;
    const dx = Math.sign(wx + 0.5 - a.pos.x);
    const dy = Math.sign(wy + 0.5 - a.pos.y);
    const horiz = Math.abs(wx + 0.5 - a.pos.x) > Math.abs(wy + 0.5 - a.pos.y);
    const to = horiz ? { x: wx + 0.5 + dx, y: wy + 0.5 } : { x: wx + 0.5, y: wy + 0.5 + dy };
    if (!this.map.isWalkable(Math.floor(to.x), Math.floor(to.y))) return false;
    if (Math.hypot(wx + 0.5 - a.pos.x, wy + 0.5 - a.pos.y) > 1.4) return false;
    if (!this.brokenGlass.has(idx)) {
      this.breakGlass(idx, a);
      if (this.rng.chance(0.35)) {
        const arm = this.rng.chance(0.5) ? 'leftArm' : 'rightArm';
        a.health.parts[arm].light = true;
        if (a === this.player) this.emit({ t: 'msg', text: 'Cut yourself on the glass', tone: 'bad' });
      }
    }
    a.vaultT = VAULT_TIME;
    a.vaultFrom = { ...a.pos };
    a.vaultTo = to;
    a.facing = Math.atan2(to.y - a.pos.y, to.x - a.pos.x);
    a.reloadT = 0;
    this.emit({ t: 'vault', actor: a.id });
    this.makeNoise(a.pos.x, a.pos.y, 5, a.id, 'step');
    return true;
  }

  container(id: number): LootContainer | null {
    return this.map.containers.find((c) => c.id === id) ?? null;
  }

  corpse(id: number): Corpse | null {
    return this.corpses.find((c) => c.id === id) ?? null;
  }

  ensureGenerated(c: LootContainer): void {
    if (c.generated) return;
    c.grid = generateLoot(c.kind, this.rng.fork(`c${c.id}`), c.tier);
    c.generated = true;
    if (c.grid.items.length === 0) c.searched = true;
  }

  openLoot(target: LootTarget): boolean {
    if (target.kind === 'container') {
      const c = this.container(target.id);
      if (!c) return false;
      this.ensureGenerated(c);
      // Opening makes a little noise (drawers creak, zombies hear it).
      this.makeNoise(c.x + 0.5, c.y + 0.5, 3, this.player.id, 'step');
    } else if (!this.corpse(target.id)) return false;
    this.loot = target;
    this.invVersion++;
    return true;
  }

  closeLoot(): void {
    this.loot = null;
    this.invVersion++;
  }

  noteNpcMet(npcId: string): void {
    this.metNpcs.add(npcId);
  }

  /** An NPC joins the player's squad on the spot (dialogue "come with me"). */
  makeCompanion(actorId: number): void {
    const a = this.actorById(actorId);
    if (!a || !a.alive) return;
    a.faction = 'player';
    a.companion = true;
    a.brain = new BotBrain('companion', this.rng.fork(`join${a.id}`), this.player.id);
    this.emit({ t: 'msg', text: `${a.name} joined you`, tone: 'good' });
  }

  healActor(actorId: number): void {
    const a = this.actorById(actorId);
    if (!a || !a.alive) return;
    for (const p of BODY_PARTS) {
      const s = a.health.parts[p];
      s.light = s.heavy = s.fracture = false;
      s.hp = Math.max(s.hp, s.max * 0.85);
    }
    this.syncHealth(a);
  }

  private updateLootSearch(dt: number): void {
    if (!this.loot) return;
    const pos = this.loot.kind === 'container' ? this.container(this.loot.id) : this.corpse(this.loot.id)?.pos;
    if (!pos) return this.closeLoot();
    const lx = 'kind' in pos ? pos.x + 0.5 : pos.x;
    const ly = 'kind' in pos ? pos.y + 0.5 : pos.y;
    if (Math.hypot(lx - this.player.pos.x, ly - this.player.pos.y) > INTERACT_RANGE + 0.8 || !this.player.alive) return this.closeLoot();
    if (this.loot.kind !== 'container') return;
    const c = this.container(this.loot.id)!;
    if (c.searched) return;
    c.searchT += dt;
    const per = CONTAINERS[c.kind].searchTime;
    while (c.searchT >= per && !c.searched) {
      c.searchT -= per;
      const next = c.grid.items.find((pl) => !c.revealedUids.includes(pl.item.uid));
      if (next) c.revealedUids.push(next.item.uid);
      if (!next || c.revealedUids.length >= c.grid.items.length) c.searched = true;
      this.invVersion++;
    }
  }

  /** Drop an item from the player's inventory onto the ground (creates or reuses a ground pile). */
  dropToGround(item: ItemInstance): void {
    const p = this.player.pos;
    let pile = this.map.containers.find((c) => c.kind === 'ground' && Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y) < 1.2);
    if (!pile || !addItem(pile.grid, item)) {
      pile = {
        id: 100000 + this.nextId++,
        kind: 'ground',
        x: Math.floor(p.x),
        y: Math.floor(p.y),
        grid: createGrid(6, 6),
        revealedUids: [],
        searchT: 0,
        searched: true,
        generated: true,
        tier: 0,
      };
      addItem(pile.grid, item);
      this.map.containers.push(pile);
    }
    this.invVersion++;
  }

  // ── Extraction ──────────────────────────────────────────────────────────────

  private updateExtraction(dt: number): void {
    const p = this.player;
    if (!p.alive) return;
    const ex = this.map.extractions.find((e) => Math.hypot(e.x - p.pos.x, e.y - p.pos.y) < e.radius);
    if (!ex) {
      this.extractT = 0;
      this.extractingAt = null;
      return;
    }
    if (this.extractingAt !== ex.id) {
      this.extractingAt = ex.id;
      this.extractT = 0;
      this.emit({ t: 'msg', text: `Extracting at ${ex.name}…` });
    }
    this.extractT += dt;
    if (this.extractT >= EXTRACT_TIME) {
      this.status = 'extracted';
      this.emit({ t: 'extracted' });
    }
  }

  get extractProgress(): number {
    return this.extractingAt === null ? 0 : Math.min(1, this.extractT / EXTRACT_TIME);
  }

  /** Abort the raid voluntarily (counts as MIA: gear is lost). */
  abandon(): void {
    if (this.status === 'active') this.status = 'mia';
  }

  result(): RaidResult {
    const survived = this.status === 'extracted';
    const comp = this.actors.find((a) => a.companion);
    const kills = this.killsBy;
    let xp = 0;
    for (const [k, n] of Object.entries(kills)) xp += (KILL_XP[k] ?? 30) * n;
    const valueOut = survived ? equipmentValue(this.player.eq) : 0;
    if (survived) xp += 300 + Math.max(0, Math.round((valueOut - this.valueIn) / 800));
    xp += Math.round(this.explored.reduce((s, v) => s + v, 0) / 60);
    return {
      status: this.status,
      duration: this.time,
      kills,
      playerEq: survived ? this.player.eq : null,
      secure: this.player.eq.slots.secure ?? null,
      deathAt:
        this.status === 'dead' ? { mapId: this.map.mapId, x: this.player.pos.x, y: this.player.pos.y, eq: { ...this.player.eq, slots: { ...this.player.eq.slots, secure: null } } } : null,
      graveVisited: this.hadGrave,
      loot: survived ? allItems(this.player.eq).filter((it) => !this.startUids.has(it.uid)).map((it) => it.uid) : [],
      valueIn: this.valueIn,
      valueOut,
      xp,
      companion: comp?.npcId ? { npcId: comp.npcId, alive: comp.alive, eq: comp.alive ? comp.eq : null } : null,
      metNpcs: [...this.metNpcs],
      deadNpcs: [...this.deadNpcs],
    };
  }
}

export type { Vec2, WeaponSlot };
