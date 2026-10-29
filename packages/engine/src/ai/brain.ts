import type { Rng } from '../core/rng';
import { angleDiff, angleTo, dist, rayCircle, type Vec2 } from '../core/math';
import { getDef } from '../items/defs';
import { addItem, carryGrids, itemValue, removeItem, slotAccepts, type ItemInstance, type Slot } from '../items/inventory';
import { COVER } from '../world/tiles';
import type { PathPoint } from '../world/pathfinding';
import type { Raid } from '../sim/raid';
import { hostile, type Actor } from '../sim/types';

export type BrainRole = 'bot' | 'guard' | 'infected' | 'companion' | 'npc';
export type BrainState =
  | 'idle'
  | 'patrol'
  | 'investigate'
  | 'search'
  | 'engage'
  | 'cover'
  | 'heal'
  | 'flee'
  | 'loot'
  | 'follow'
  | 'chase';

const tmp: Actor[] = [];

/**
 * Bot brain: a perception step at a throttled "think" rate (LOD by distance to the player) feeding a
 * utility-style state choice, plus a cheap per-tick "act" step that steers, aims and pulls the trigger.
 *
 * Bots see with a view cone + line of sight, modulated by light (night, indoors, flashlights) and stance,
 * hear footsteps and gunshots, take cover to reload/heal, flee when broken, loot containers and bodies
 * (gearing up mid-raid), and fight each other — scavs, raiders, the boss's guards and the infected are all hostile.
 */
export class BotBrain {
  state: BrainState = 'idle';
  stateT = 0;
  alerted = false;
  targetId: number | null = null;
  private lastNoiseId = 0;
  private goInvestigate = false;
  /** Heard something it won't walk to: just turn and watch that way for a while. */
  lookAtPos: { x: number; y: number } | null = null;
  targetVisible = false;
  lastKnown: Vec2 | null = null;
  lastSeenAt = -999;
  investigatePos: Vec2 | null = null;

  readonly skill: number;
  readonly courage: number;
  private thinkT: number;
  private home: Vec2 | null = null;
  private path: PathPoint[] | null = null;
  private pathIdx = 0;
  private pathGoal: Vec2 | null = null;
  private progressT = 0;
  private progressPos: Vec2 = { x: 0, y: 0 };
  private detect = 0;
  private reactT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private burstT = 0;
  private pauseT = 0;
  private aimErr = { x: 0, y: 0 };
  private aimErrT = 0;
  private idleT = 0;
  private patrolGoal: Vec2 | null = null;
  private coverPos: Vec2 | null = null;
  private lootTarget: { kind: 'container' | 'corpse'; id: number; x: number; y: number } | null = null;
  private lootT = 0;
  private visited = new Set<string>();
  private lookT = 0;

  constructor(
    readonly role: BrainRole,
    private rng: Rng,
    public leaderId: number | null,
  ) {
    this.skill = role === 'guard' ? rng.range(0.5, 0.72) : role === 'companion' ? 0.65 : role === 'infected' ? 0.2 : rng.range(0.22, 0.55);
    this.courage = rng.range(0.3, 1);
    this.thinkT = rng.range(0, 0.5);
  }

  // ── Public hooks ────────────────────────────────────────────────────────────

  update(raid: Raid, a: Actor, dt: number): void {
    if (!this.home) this.home = { ...a.pos };
    this.stateT += dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const dp = dist(a.pos, raid.player.pos);
      const interval = this.alerted || dp < 25 ? 0.15 : dp < 50 ? 0.4 : 0.9;
      this.think(raid, a, interval);
      this.thinkT = interval;
    }
    this.act(raid, a, dt);
  }

  onDamaged(raid: Raid, a: Actor, attacker: Actor): void {
    if (this.role === 'companion' && attacker.faction === 'player') return;
    if (this.role === 'npc' && !hostile(a.faction, attacker.faction) && attacker.faction !== 'player') return;
    this.alerted = true;
    if (this.targetId === null || !this.targetVisible) {
      this.targetId = attacker.id;
      this.lastKnown = { ...attacker.pos };
      this.lastSeenAt = raid.time;
      this.investigatePos = { ...attacker.pos };
      if (this.role === 'npc') a.faction = a.faction === 'npc' ? 'scav' : a.faction; // An attacked NPC turns hostile to you.
      this.setState(this.role === 'infected' ? 'chase' : 'engage');
    }
  }

  // ── Perception + decision ───────────────────────────────────────────────────

  private think(raid: Raid, a: Actor, dt: number): void {
    this.perceive(raid, a, dt);
    this.decide(raid, a);
  }

  private perceive(raid: Raid, a: Actor, dt: number): void {
    // Human-scale eyesight: ~22 m spotting range in daylight, much less at dusk/night. A calm bot watches a
    // ~90° cone and only half-notices things at the edge of it; once alerted it scans wider and further.
    const base = this.role === 'infected' ? 11 : raid.timeOfDay === 'night' ? 13 : raid.timeOfDay === 'dusk' ? 17 : 22;
    const viewRange = base * (this.alerted ? 1.15 : 1);
    const coneHalf = this.alerted ? 1.2 : 0.8;
    tmp.length = 0;
    raid.queryActors(a.pos.x, a.pos.y, viewRange * 1.3, tmp);
    let best: Actor | null = null;
    let bestD = Infinity;
    let bestEff = viewRange;
    for (const b of tmp) {
      if (b === a || !b.alive || !hostile(a.faction, b.faction)) continue;
      const d = dist(a.pos, b.pos);
      // Bots notice each other later than they notice the player, so the map doesn't depopulate before you arrive.
      const botVsBot = b.faction !== 'player' && a.faction !== 'player';
      const off = Math.abs(angleDiff(a.facing, angleTo(a.pos, b.pos)));
      if (d > 1.8 && off > coneHalf) continue;
      // Movement draws the eye: standing still or creeping is much harder to spot than running.
      const speed = Math.hypot(b.vel.x, b.vel.y);
      const motion = b.sprinting ? 1.25 : speed > 0.4 ? 1 : 0.65;
      const peripheral = off > coneHalf * 0.55 ? 0.6 : 1;
      const eff = viewRange * raid.visibilityOf(b) * motion * peripheral * (botVsBot ? 0.45 : 1);
      if (d > eff) continue;
      if (!raid.map.rayClear(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue;
      // Prefer the current target slightly (target stickiness avoids flip-flopping).
      const score = b.id === this.targetId ? d * 0.7 : d;
      if (score < bestD) {
        bestD = score;
        best = b;
        bestEff = eff;
      }
    }

    if (best) {
      const d = dist(a.pos, best.pos);
      const already = best.id === this.targetId && raid.time - this.lastSeenAt < 3;
      if (!already) {
        // Takes a few seconds to recognise someone at the edge of sight, a blink up close.
        const near = 1 - Math.min(1, d / bestEff);
        this.detect += dt * (0.3 + near * near * 3.2) * (this.alerted ? 1.8 : 1);
      }
      if (already || this.detect >= 1) {
        if (!already) this.reactT = (0.55 + this.rng.range(0, 0.6)) * (1.5 - this.skill);
        this.targetId = best.id;
        this.targetVisible = true;
        this.lastKnown = { ...best.pos };
        this.lastSeenAt = raid.time;
        this.alerted = true;
        this.detect = 1;
      } else {
        // Half-noticed something: turn towards it.
        this.investigatePos ??= { ...best.pos };
        this.targetVisible = false;
      }
    } else {
      this.targetVisible = false;
      this.detect = Math.max(0, this.detect - dt * 0.35);
    }

    // Hearing.
    if (!this.targetVisible) {
      const hearing = this.role === 'infected' ? 1.1 : 1;
      let loudest = 0;
      for (const n of raid.noises) {
        if (n.source === a.id) continue;
        const src = raid.actorById(n.source);
        if (src && !hostile(a.faction, src.faction) && n.kind === 'step') continue;
        const d = Math.hypot(n.x - a.pos.x, n.y - a.pos.y);
        const r = n.radius * hearing;
        if (d > r) continue;
        const loud = (1 - d / r) * (n.kind === 'shot' ? 2 : 1);
        if (loud <= loudest) continue;
        loudest = loud;
        // Not everyone runs towards gunfire: decide once per noise. Far shots mostly just put a bot on edge
        // (it turns to look); close ones, and aggressive raiders/infected, pull it over to investigate.
        if (n.kind === 'shot' && this.lastNoiseId !== n.id) {
          this.lastNoiseId = n.id;
          const eager = this.role === 'infected' ? 0.8 : this.role === 'guard' ? 0.15 : a.faction === 'raider' ? 0.55 : 0.35;
          this.goInvestigate = d < r * 0.35 || this.rng.chance(eager * this.courage);
        }
        if (n.kind !== 'shot' || this.goInvestigate) this.investigatePos = { x: n.x, y: n.y };
        else if (!this.investigatePos) this.lookAtPos = { x: n.x, y: n.y };
      }
      if (loudest > 0.4) this.alerted = true;
    }
  }

  private decide(raid: Raid, a: Actor): void {
    const target = this.targetId !== null ? raid.actorById(this.targetId) : null;
    if (target && !target.alive) {
      this.targetId = null;
      this.targetVisible = false;
      if (this.role !== 'infected' && this.lastKnown) this.setState('search');
    }
    const hpFrac = a.hp / a.maxHp;
    const sinceSeen = raid.time - this.lastSeenAt;

    if (this.role === 'infected') {
      if (this.targetVisible || (target && sinceSeen < 4)) return this.setState('chase');
      if (this.investigatePos) return this.setState('investigate');
      return this.setStateIf(['idle', 'patrol'], 'idle');
    }

    if (this.role === 'npc') {
      if (this.targetVisible && raid.weaponItem(a)) return this.setState('engage');
      return this.setStateIf(['idle'], 'idle');
    }

    const med = raid.bestMed(a);
    const needHeal = (a.bleed > 0 || hpFrac < 0.55) && med;
    const w = raid.weaponItem(a);
    const empty = w ? (w.ammo ?? 0) === 0 : false;

    if (this.state === 'heal' && a.useT > 0) return;
    if (this.state === 'cover' && this.stateT < 4 && (a.reloadT > 0 || a.useT > 0 || (needHeal && this.targetVisible))) return;

    if (this.targetVisible && target) {
      if (hpFrac < 0.3 && !med && this.courage < 0.7 && this.role !== 'guard') return this.setState('flee');
      if ((empty || (needHeal && hpFrac < 0.4)) && this.role !== 'companion') return this.setState('cover');
      if (this.role === 'companion' && dist(a.pos, raid.player.pos) > 14) return this.setState('follow');
      return this.setState('engage');
    }
    if (needHeal) return this.setState('heal');
    if (target && this.lastKnown && sinceSeen < 14) return this.setState(this.role === 'guard' && sinceSeen > 6 ? 'patrol' : 'search');
    if (this.investigatePos && this.role !== 'companion') return this.setStateIf(['investigate', 'search'], 'investigate');
    if (this.role === 'companion') return this.setState('follow');
    if (this.state === 'loot') return;
    if (!this.alerted && this.role === 'bot' && this.rng.chance(0.08)) {
      const lt = this.findLoot(raid, a);
      if (lt) {
        this.lootTarget = lt;
        return this.setState('loot');
      }
    }
    if (this.stateT > 30 && this.alerted && !this.investigatePos) this.alerted = false;
    if (this.lookAtPos) return this.setState('idle');
    this.setStateIf(['patrol', 'idle'], 'patrol');
  }

  private setState(s: BrainState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    this.pathGoal = null;
    if (s !== 'cover') this.coverPos = null;
  }

  /** Keep the current state if it's one of `keep`, otherwise switch to `fallback`. */
  private setStateIf(keep: BrainState[], fallback: BrainState): void {
    if (!keep.includes(this.state)) this.setState(fallback);
  }

  // ── Acting ──────────────────────────────────────────────────────────────────

  private act(raid: Raid, a: Actor, dt: number): void {
    const it = a.intent;
    it.moveX = it.moveY = 0;
    it.fire = it.firePressed = it.reload = it.sprint = false;
    it.switchTo = null;
    it.use = null;
    it.crouch = false;
    if (Math.abs(it.aimX) + Math.abs(it.aimY) === 0) {
      it.aimX = a.pos.x + Math.cos(a.facing);
      it.aimY = a.pos.y + Math.sin(a.facing);
    }

    switch (this.state) {
      case 'idle':
        return this.actIdle(raid, a, dt);
      case 'patrol':
        return this.actPatrol(raid, a, dt);
      case 'investigate':
        return this.actInvestigate(raid, a);
      case 'search':
        return this.actSearch(raid, a, dt);
      case 'engage':
        return this.actEngage(raid, a, dt);
      case 'chase':
        return this.actChase(raid, a);
      case 'cover':
        return this.actCover(raid, a);
      case 'heal':
        return this.actHeal(raid, a);
      case 'flee':
        return this.actFlee(raid, a);
      case 'loot':
        return this.actLoot(raid, a, dt);
      case 'follow':
        return this.actFollow(raid, a);
    }
  }

  private lookAt(a: Actor, x: number, y: number): void {
    a.intent.aimX = x;
    a.intent.aimY = y;
  }

  private actIdle(raid: Raid, a: Actor, dt: number): void {
    this.lookT -= dt;
    if (this.lookAtPos) {
      // Watch the direction of the shots for a while, crouched if cautious.
      this.lookAt(a, this.lookAtPos.x, this.lookAtPos.y);
      a.intent.crouch = this.courage < 0.6;
      if (this.lookT <= -6) {
        this.lookAtPos = null;
        this.lookT = 2;
      }
      return;
    }
    if (this.lookT <= 0) {
      this.lookT = this.rng.range(1.5, 4);
      const ang = a.facing + this.rng.range(-1.4, 1.4);
      this.lookAt(a, a.pos.x + Math.cos(ang) * 3, a.pos.y + Math.sin(ang) * 3);
    }
    if (this.role === 'npc' && dist(a.pos, raid.player.pos) < 6) this.lookAt(a, raid.player.pos.x, raid.player.pos.y);
    if (this.role === 'infected' && this.stateT > this.rng.range(6, 14)) {
      // Shamble around a little.
      const ang = this.rng.range(-Math.PI, Math.PI);
      this.investigatePos = { x: a.pos.x + Math.cos(ang) * 5, y: a.pos.y + Math.sin(ang) * 5 };
      this.setState('investigate');
    }
  }

  private actPatrol(raid: Raid, a: Actor, dt: number): void {
    const leader = this.leaderId !== null && this.leaderId !== a.id ? raid.actorById(this.leaderId) : null;
    if (leader?.alive && leader.brain && leader.brain.state === 'patrol') {
      // Group members trail the leader.
      if (dist(a.pos, leader.pos) > 3.5) this.moveTo(raid, a, leader.pos, false);
      else this.lookAt(a, a.pos.x + Math.cos(leader.facing) * 4, a.pos.y + Math.sin(leader.facing) * 4);
      return;
    }
    if (this.idleT > 0) {
      this.idleT -= dt;
      return this.actIdle(raid, a, dt);
    }
    if (!this.patrolGoal) {
      const radius = this.role === 'guard' ? 9 : 30;
      const pois = raid.map.pois.filter((p) => dist(p, this.home!) < radius);
      this.patrolGoal = pois.length ? this.rng.pick(pois) : { ...this.home! };
    }
    if (this.moveTo(raid, a, this.patrolGoal, false)) {
      this.patrolGoal = null;
      this.idleT = this.rng.range(2, 7);
    }
  }

  private actInvestigate(raid: Raid, a: Actor): void {
    const p = this.investigatePos;
    if (!p) return this.setState('patrol');
    a.intent.crouch = this.role === 'guard' && this.alerted;
    if (this.moveTo(raid, a, p, false) || this.stateT > 25) {
      this.investigatePos = null;
      this.setState(this.role === 'infected' ? 'idle' : 'search');
    }
  }

  private actSearch(raid: Raid, a: Actor, dt: number): void {
    const p = this.lastKnown;
    if (p && dist(a.pos, p) > 1.2 && this.stateT < 12) {
      this.moveTo(raid, a, p, false);
      return;
    }
    this.actIdle(raid, a, dt);
    if (this.stateT > 6) {
      this.lastKnown = null;
      this.investigatePos = null;
      this.setState('patrol');
    }
  }

  private actEngage(raid: Raid, a: Actor, dt: number): void {
    const t = this.targetId !== null ? raid.actorById(this.targetId) : null;
    if (!t || !t.alive) return this.setState('search');
    this.reactT -= dt;
    const d = dist(a.pos, t.pos);
    const w = raid.weaponItem(a);

    // Weapon management.
    if (w && (w.ammo ?? 0) === 0) {
      if (raid.startReload(a)) return;
      const other = a.active === 'primary' ? 'secondary' : 'primary';
      const ow = a.eq.slots[other];
      if (a.reloadT <= 0) a.intent.switchTo = ow && (ow.ammo ?? 0) > 0 ? other : 'melee';
      return;
    }
    if (!w && a.active === 'melee') {
      for (const s of ['primary', 'secondary'] as const) {
        const g = a.eq.slots[s];
        if (g && ((g.ammo ?? 0) > 0 || raid.startReload(a))) {
          a.intent.switchTo = s;
          break;
        }
      }
    }

    // Aim error drifts slowly and shrinks with skill.
    this.aimErrT -= dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = this.rng.range(0.25, 0.6);
      // Grows quickly with distance: bots are dangerous up close, mostly suppressive further out.
      const mag = (1.35 - this.skill) * (0.5 + d * 0.085) * (raid.timeOfDay === 'night' && !t.flashlight ? 1.5 : 1) * (t.crouching ? 1.2 : 1);
      this.aimErr = { x: this.rng.range(-mag, mag), y: this.rng.range(-mag, mag) };
    }
    const lead = this.skill * 0.12;
    const aimX = t.pos.x + t.vel.x * lead + this.aimErr.x;
    const aimY = t.pos.y + t.vel.y * lead + this.aimErr.y;
    if (this.targetVisible) this.lookAt(a, aimX, aimY);
    else if (this.lastKnown) this.lookAt(a, this.lastKnown.x, this.lastKnown.y);

    if (!w) {
      // Melee: close the distance and swing.
      this.moveTo(raid, a, t.pos, true);
      if (d < a.radius + t.radius + raid.meleeStats(a).reach + 0.1) {
        a.intent.fire = true;
        a.intent.firePressed = true;
      }
      return;
    }

    const wd = getDef(w.def).weapon!;
    const preferred = wd.pellets ? 5 : wd.range >= 55 ? 16 : wd.auto ? 11 : 10;
    // Engagement distance is about what fits on the player's screen: no sniping from off-camera.
    const maxEngage = Math.min(wd.range * 0.7, wd.pellets ? 12 : wd.range >= 55 ? 24 : 19);
    if (!this.targetVisible || d > maxEngage) {
      if (this.lastKnown) this.moveTo(raid, a, this.lastKnown, d > 20);
    } else {
      // Strafe/keep distance. Better fighters move more.
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = this.rng.range(0.6, 1.8);
        this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
      }
      const ang = angleTo(a.pos, t.pos);
      const mobile = this.role === 'guard' || this.role === 'companion' || this.skill > 0.5;
      let mx = mobile ? Math.cos(ang + (Math.PI / 2) * this.strafeDir) * 0.7 : 0;
      let my = mobile ? Math.sin(ang + (Math.PI / 2) * this.strafeDir) * 0.7 : 0;
      if (d > preferred + 4) {
        mx += Math.cos(ang);
        my += Math.sin(ang);
      } else if (d < preferred - 4) {
        mx -= Math.cos(ang);
        my -= Math.sin(ang);
      }
      a.intent.moveX = mx;
      a.intent.moveY = my;
      a.intent.crouch = !mobile && d > 8;
      this.path = null;
    }

    // Trigger discipline.
    const aimed = Math.abs(angleDiff(a.facing, angleTo(a.pos, { x: aimX, y: aimY }))) < 0.18;
    if (!this.targetVisible || d > maxEngage || this.reactT > 0 || !aimed || this.allyInLine(raid, a, t, d)) return;
    if (wd.auto) {
      if (this.pauseT > 0) {
        this.pauseT -= dt;
        return;
      }
      this.burstT += dt;
      a.intent.fire = true;
      if (this.burstT > (d > 12 ? 0.16 : 0.32)) {
        this.burstT = 0;
        this.pauseT = this.rng.range(0.6, 1.3);
      }
    } else if (a.fireCd <= 0 && this.rng.chance(0.11)) {
      a.intent.fire = true;
      a.intent.firePressed = true;
    }
  }

  private allyInLine(raid: Raid, a: Actor, t: Actor, d: number): boolean {
    tmp.length = 0;
    raid.queryActors((a.pos.x + t.pos.x) / 2, (a.pos.y + t.pos.y) / 2, d / 2 + 1, tmp);
    const dx = (t.pos.x - a.pos.x) / d;
    const dy = (t.pos.y - a.pos.y) / d;
    for (const b of tmp) {
      if (b === a || b === t || !b.alive || hostile(a.faction, b.faction)) continue;
      const hit = rayCircle(a.pos.x, a.pos.y, dx, dy, b.pos.x, b.pos.y, b.radius + 0.25);
      if (hit >= 0 && hit < d) return true;
    }
    return false;
  }

  private actChase(raid: Raid, a: Actor): void {
    const t = this.targetId !== null ? raid.actorById(this.targetId) : null;
    if (!t || !t.alive) return this.setState('idle');
    const goal = this.targetVisible ? t.pos : (this.lastKnown ?? t.pos);
    this.lookAt(a, goal.x, goal.y);
    this.moveTo(raid, a, goal, true);
    const reach = a.radius + t.radius + raid.meleeStats(a).reach;
    if (dist(a.pos, t.pos) < reach) {
      a.intent.fire = true;
      a.intent.firePressed = true;
    }
  }

  private actCover(raid: Raid, a: Actor): void {
    const threat = this.lastKnown ?? raid.player.pos;
    if (!this.coverPos) this.coverPos = this.findCover(raid, a, threat) ?? { ...a.pos };
    const arrived = this.moveTo(raid, a, this.coverPos, true);
    this.lookAt(a, threat.x, threat.y);
    if (arrived) {
      a.intent.crouch = true;
      const w = raid.weaponItem(a);
      if (w && (w.ammo ?? 0) < getDef(w.def).weapon!.magSize && a.reloadT <= 0) raid.startReload(a);
      else if (a.useT <= 0 && (a.bleed > 0 || a.hp < a.maxHp * 0.6)) {
        const med = raid.bestMed(a);
        if (med) a.intent.use = med.uid;
      }
    }
    if (this.stateT > 7 && a.reloadT <= 0 && a.useT <= 0) this.setState('engage');
  }

  private actHeal(raid: Raid, a: Actor): void {
    a.intent.crouch = true;
    if (a.useT > 0) return;
    const med = raid.bestMed(a);
    if (!med || (a.bleed === 0 && a.hp >= a.maxHp * 0.85) || this.stateT > 12) return this.setState('patrol');
    a.intent.use = med.uid;
  }

  private actFlee(raid: Raid, a: Actor): void {
    const threat = this.lastKnown ?? raid.player.pos;
    if (!this.pathGoal || this.stateT < 0.1) {
      const ang = angleTo(threat, a.pos) + this.rng.range(-0.6, 0.6);
      const gx = Math.floor(a.pos.x + Math.cos(ang) * 14);
      const gy = Math.floor(a.pos.y + Math.sin(ang) * 14);
      const p = raid.pathfinder.nearestWalkable(gx, gy, 6) ?? { x: Math.floor(this.home!.x), y: Math.floor(this.home!.y) };
      this.pathGoal = { x: p.x + 0.5, y: p.y + 0.5 };
    }
    if (this.moveTo(raid, a, this.pathGoal, true) || this.stateT > 10) this.setState(raid.bestMed(a) ? 'heal' : 'search');
  }

  private actLoot(raid: Raid, a: Actor, dt: number): void {
    const lt = this.lootTarget;
    if (!lt) return this.setState('patrol');
    if (!this.moveTo(raid, a, lt, false)) {
      if (this.stateT > 20) this.setState('patrol');
      return;
    }
    this.lootT += dt;
    this.lookAt(a, lt.x, lt.y);
    if (this.lootT < 1.6) return;
    this.lootT = 0;
    this.visited.add(`${lt.kind}${lt.id}`);
    this.lootTarget = null;
    this.takeBest(raid, a, lt);
    this.setState('patrol');
  }

  private actFollow(raid: Raid, a: Actor): void {
    const leader = raid.player;
    if (!leader.alive) return this.setState('idle');
    const d = dist(a.pos, leader.pos);
    if (d > 3.2) this.moveTo(raid, a, leader.pos, d > 7);
    else this.lookAt(a, a.pos.x + Math.cos(leader.facing) * 4, a.pos.y + Math.sin(leader.facing) * 4);
    a.intent.crouch = leader.crouching;
    if (a.useT <= 0 && (a.bleed > 0 || a.hp < a.maxHp * 0.5)) {
      const med = raid.bestMed(a);
      if (med) a.intent.use = med.uid;
    }
    const w = raid.weaponItem(a);
    if (w && (w.ammo ?? 0) < getDef(w.def).weapon!.magSize * 0.4 && a.reloadT <= 0) raid.startReload(a);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Follow an A* path to `goal`. Returns true on arrival. */
  private moveTo(raid: Raid, a: Actor, goal: Vec2, sprint: boolean): boolean {
    const d = dist(a.pos, goal);
    if (d < 0.6) return true;
    const it = a.intent;
    it.sprint = sprint;

    // Cheap direct steering when the straight line is clear.
    if (d < 10 && raid.pathfinder.walkLine(a.pos, goal)) {
      this.path = null;
      it.moveX = (goal.x - a.pos.x) / d;
      it.moveY = (goal.y - a.pos.y) / d;
      if (this.state !== 'engage') this.lookAt(a, goal.x, goal.y);
      this.trackProgress(raid, a);
      return false;
    }
    if (!this.path || !this.pathGoal || dist(this.pathGoal, goal) > 1.5) {
      this.path = raid.pathfinder.find(a.pos.x, a.pos.y, goal.x, goal.y);
      this.pathIdx = 0;
      this.pathGoal = { ...goal };
      if (!this.path) {
        // Unreachable: give up on this goal.
        this.patrolGoal = null;
        this.investigatePos = null;
        return true;
      }
    }
    let wp = this.path[this.pathIdx];
    while (wp && dist(a.pos, wp) < 0.45) wp = this.path[++this.pathIdx];
    if (!wp) return d < 1.5;
    const wd = dist(a.pos, wp);
    it.moveX = (wp.x - a.pos.x) / wd;
    it.moveY = (wp.y - a.pos.y) / wd;
    if (this.state !== 'engage' && this.state !== 'cover') this.lookAt(a, wp.x, wp.y);
    this.trackProgress(raid, a);
    return false;
  }

  private trackProgress(raid: Raid, a: Actor): void {
    this.progressT += 1 / 60;
    if (this.progressT < 1.5) return;
    if (dist(a.pos, this.progressPos) < 0.3) {
      // Stuck (crowded doorway etc.): jiggle and repath.
      this.path = null;
      this.pathGoal = null;
      a.intent.moveX += this.rng.range(-1, 1);
      a.intent.moveY += this.rng.range(-1, 1);
      if (this.state === 'patrol') this.patrolGoal = null;
    }
    this.progressT = 0;
    this.progressPos = { ...a.pos };
    void raid;
  }

  /** A nearby tile with blocked line of fire from the threat, preferring short moves. */
  findCover(raid: Raid, a: Actor, threat: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestScore = Infinity;
    const cx = Math.floor(a.pos.x);
    const cy = Math.floor(a.pos.y);
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!raid.map.isWalkable(x, y)) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        if (raid.map.rayClear(threat.x, threat.y, px, py, COVER)) continue;
        const score = Math.hypot(dx, dy) - Math.min(8, Math.hypot(px - threat.x, py - threat.y)) * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = { x: px, y: py };
        }
      }
    return best;
  }

  private findLoot(raid: Raid, a: Actor): { kind: 'container' | 'corpse'; id: number; x: number; y: number } | null {
    for (const c of raid.corpses)
      if (!this.visited.has(`corpse${c.id}`) && dist(c.pos, a.pos) < 14) return { kind: 'corpse', id: c.id, x: c.pos.x, y: c.pos.y };
    for (const c of raid.map.containers) {
      if (this.visited.has(`container${c.id}`)) continue;
      const p = { x: c.x + 0.5, y: c.y + 0.5 };
      if (dist(p, a.pos) < 10) return { kind: 'container', id: c.id, x: p.x, y: p.y };
    }
    return null;
  }

  /** Bots gear up: equip better armour/weapons into empty slots and pocket the most valuable item that fits. */
  private takeBest(raid: Raid, a: Actor, lt: { kind: 'container' | 'corpse'; id: number }): void {
    const sources: { grid?: { items: { item: ItemInstance }[] }; slots?: Record<Slot, ItemInstance | null> }[] = [];
    if (lt.kind === 'container') {
      const c = raid.container(lt.id);
      if (!c || c.kind === 'ground') return;
      raid.ensureGenerated(c);
      sources.push({ grid: c.grid });
    } else {
      const c = raid.corpse(lt.id);
      if (!c) return;
      sources.push({ slots: c.eq.slots });
      for (const g of carryGrids(c.eq)) sources.push({ grid: g });
    }
    // 1) Fill empty equipment slots from a corpse.
    for (const s of sources) {
      if (!s.slots) continue;
      for (const slot of ['armor', 'helmet', 'primary', 'backpack'] as Slot[]) {
        const it = s.slots[slot];
        if (it && !a.eq.slots[slot] && slotAccepts(slot, getDef(it.def))) {
          a.eq.slots[slot] = it;
          s.slots[slot] = null;
          raid.recomputeSpeed(a);
        }
      }
    }
    // 2) Most valuable loose item that fits.
    let best: { grid: { items: { item: ItemInstance }[] }; item: ItemInstance } | null = null;
    for (const s of sources)
      for (const p of s.grid?.items ?? [])
        if (!best || itemValue(p.item) > itemValue(best.item)) best = { grid: s.grid!, item: p.item };
    if (!best) return;
    for (const g of carryGrids(a.eq)) {
      if (addItem(g, best.item)) {
        removeItem(best.grid as never, best.item.uid);
        raid.invVersion++;
        return;
      }
    }
  }
}
