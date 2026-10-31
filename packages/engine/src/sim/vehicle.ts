import { clamp, type Vec2 } from '../core/math';
import { solidBoxes, type Box } from '../world/collision';
import type { GameMap } from '../world/map';

/**
 * Vehicles: a box on four wheels driven by a kinematic bicycle model. Deterministic (no randomness in
 * here), stepped in the raid's fixed tick. The body is an oriented box that collides with the same wall,
 * tree, fence and furniture boxes people do, with other vehicles, and pushes people out of the way.
 */
export type VehicleDefId = 'uaz469' | 'zhiguli';

export interface VehicleDef {
  name: string;
  /** Body box in metres (collision; the model is scaled to match). */
  length: number;
  width: number;
  wheelbase: number;
  /** Top speed forward / in reverse, m/s. */
  maxSpeed: number;
  maxReverse: number;
  /** Engine pull at standstill and brake deceleration, m/s². */
  accel: number;
  brake: number;
  /** Rolling resistance (m/s²) and air drag (per m). */
  roll: number;
  drag: number;
  /** Front-wheel lock (rad), how fast the wheel turns (rad/s), and the speed (m/s) at which lock halves. */
  maxSteer: number;
  steerRate: number;
  steerFade: number;
  /** How fast sideways sliding dies out (1/s): lower drifts more. */
  grip: number;
  hp: number;
  /** Litres. */
  fuelCap: number;
  /** Litres per metre at full throttle. */
  fuelPerM: number;
  /** Seats as [forward, right] offsets from the body centre. Seat 0 drives. */
  seats: [number, number][];
  drivable: boolean;
}

export const VEHICLE_DEFS: Record<VehicleDefId, VehicleDef> = {
  uaz469: {
    name: 'UAZ-469',
    length: 3.95,
    width: 1.74,
    wheelbase: 2.38,
    maxSpeed: 17,
    maxReverse: 4.5,
    accel: 5.2,
    brake: 10,
    roll: 1.2,
    drag: 0.0035,
    maxSteer: 0.6,
    steerRate: 2.4,
    steerFade: 11,
    grip: 7,
    hp: 600,
    fuelCap: 40,
    fuelPerM: 0.0035,
    seats: [[0.05, -0.42], [0.05, 0.42], [-0.85, -0.42], [-0.85, 0.42]],
    drivable: true,
  },
  zhiguli: {
    name: 'Zhiguli',
    length: 4.05,
    width: 1.62,
    wheelbase: 2.42,
    maxSpeed: 0,
    maxReverse: 0,
    accel: 0,
    brake: 10,
    roll: 4,
    drag: 0.004,
    maxSteer: 0,
    steerRate: 0,
    steerFade: 1,
    grip: 8,
    hp: 400,
    fuelCap: 0,
    fuelPerM: 0,
    seats: [],
    drivable: false,
  },
};

export interface Vehicle {
  id: number;
  def: VehicleDefId;
  /** Model variant (paint) for the renderer. */
  variant: number;
  pos: Vec2;
  vel: Vec2;
  /** Direction the nose points (radians, world x/y). */
  heading: number;
  /** Signed speed along the heading, m/s. */
  speed: number;
  angVel: number;
  /** Front wheel angle (rad), positive turns towards +heading. */
  steer: number;
  hp: number;
  fuel: number;
  engineOn: boolean;
  /** Burnt-out wreck: never moves (the roadside cars). */
  wreck: boolean;
  /** Actor id per seat (seat 0 is the driver). */
  seats: (number | null)[];
  /** Hardest impact (m/s) in the last step: the raid turns it into damage and noise. */
  impact: number;
  noiseT: number;
}

export interface VehicleSpawn {
  def: VehicleDefId;
  x: number;
  y: number;
  heading: number;
  variant: number;
  wreck: boolean;
  /** Share of a full tank (drivable ones). */
  fuel: number;
}

export interface DriveControl {
  /** −1..1: forward throttle, negative brakes then reverses. */
  throttle: number;
  /** −1..1: steering, positive turns clockwise on screen (towards +angle). */
  steer: number;
  handbrake: boolean;
}

export function createVehicle(id: number, s: VehicleSpawn): Vehicle {
  const def = VEHICLE_DEFS[s.def];
  return {
    id,
    def: s.def,
    variant: s.variant,
    pos: { x: s.x, y: s.y },
    vel: { x: 0, y: 0 },
    heading: s.heading,
    speed: 0,
    angVel: 0,
    steer: 0,
    hp: def.hp,
    fuel: def.fuelCap * clamp(s.fuel, 0, 1),
    engineOn: false,
    wreck: s.wreck,
    seats: def.seats.map(() => null),
    impact: 0,
    noiseT: 0,
  };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Oriented box: centre, unit forward axis (fx, fy), half length / half width. */
interface Obb {
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  hl: number;
  hw: number;
}

function obbOf(v: Vehicle, o: Obb = { cx: 0, cy: 0, fx: 1, fy: 0, hl: 0, hw: 0 }): Obb {
  const d = VEHICLE_DEFS[v.def];
  o.cx = v.pos.x;
  o.cy = v.pos.y;
  o.fx = Math.cos(v.heading);
  o.fy = Math.sin(v.heading);
  o.hl = d.length / 2;
  o.hw = d.width / 2;
  return o;
}

function boxObb(b: Box, o: Obb): Obb {
  o.cx = (b[0] + b[2]) / 2;
  o.cy = (b[1] + b[3]) / 2;
  o.fx = 1;
  o.fy = 0;
  o.hl = (b[2] - b[0]) / 2;
  o.hw = (b[3] - b[1]) / 2;
  return o;
}

/** Half extent of a box projected on a unit axis. */
const extent = (o: Obb, ax: number, ay: number) => o.hl * Math.abs(o.fx * ax + o.fy * ay) + o.hw * Math.abs(-o.fy * ax + o.fx * ay);

const mtv = { nx: 0, ny: 0, depth: 0 };

/** Separating-axis test. On overlap fills `mtv` with the shortest push that moves `a` out of `b`. */
function overlap(a: Obb, b: Obb): boolean {
  const axes = [a.fx, a.fy, -a.fy, a.fx, b.fx, b.fy, -b.fy, b.fx];
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  let best = Infinity;
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i]!;
    const ay = axes[i + 1]!;
    const d = dx * ax + dy * ay;
    const o = extent(a, ax, ay) + extent(b, ax, ay) - Math.abs(d);
    if (o <= 0) return false;
    if (o < best) {
      best = o;
      const s = d < 0 ? -1 : 1;
      mtv.nx = ax * s;
      mtv.ny = ay * s;
    }
  }
  mtv.depth = best;
  return true;
}

/** World AABB of a vehicle's body. */
export function vehicleBounds(v: Vehicle): [number, number, number, number] {
  const o = obbOf(v);
  const ex = extent(o, 1, 0);
  const ey = extent(o, 0, 1);
  return [o.cx - ex, o.cy - ey, o.cx + ex, o.cy + ey];
}

/** True if the body overlaps any wall, tree, fence, furniture or other vehicle. */
export function vehicleBlocked(v: Vehicle, map: GameMap, others: readonly Vehicle[]): boolean {
  const a = obbOf(v, scratchA);
  for (const b of nearBoxes(map, v)) if (overlap(a, boxObb(b, scratchB))) return true;
  for (const w of others) if (w !== v && overlap(a, obbOf(w, scratchB))) return true;
  return false;
}

const scratchA: Obb = { cx: 0, cy: 0, fx: 1, fy: 0, hl: 0, hw: 0 };
const scratchB: Obb = { cx: 0, cy: 0, fx: 1, fy: 0, hl: 0, hw: 0 };
const tileBoxes: Box[] = [];
const near: Box[] = [];

function nearBoxes(map: GameMap, v: Vehicle): Box[] {
  near.length = 0;
  const [x0, y0, x1, y1] = vehicleBounds(v);
  for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++)
    for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      for (const b of solidBoxes(map, tx, ty, tileBoxes)) near.push(b);
      const furn = map.furnitureTouching(tx, ty);
      if (furn) for (const f of furn) if (!near.includes(f.box)) near.push(f.box);
    }
  return near;
}

/** Push the body out of everything it overlaps; returns the hardest impact speed (m/s). */
function resolve(v: Vehicle, map: GameMap, others: readonly Vehicle[]): number {
  let impact = 0;
  const hit = () => {
    v.pos.x += mtv.nx * mtv.depth;
    v.pos.y += mtv.ny * mtv.depth;
    const vn = v.vel.x * mtv.nx + v.vel.y * mtv.ny;
    if (vn < 0) {
      // Kill the speed into the obstacle with a small bounce, and scrub some along it.
      v.vel.x -= mtv.nx * vn * 1.25;
      v.vel.y -= mtv.ny * vn * 1.25;
      v.vel.x *= 0.92;
      v.vel.y *= 0.92;
      impact = Math.max(impact, -vn);
    }
  };
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const b of nearBoxes(map, v))
      if (overlap(obbOf(v, scratchA), boxObb(b, scratchB))) {
        hit();
        any = true;
      }
    for (const w of others)
      if (w !== v && overlap(obbOf(v, scratchA), obbOf(w, scratchB))) {
        hit();
        any = true;
      }
    if (!any) break;
  }
  return impact;
}

const towards = (cur: number, target: number, step: number) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));

/** Advance one vehicle by `dt`. Sets `v.impact` to the hardest hit this step. */
export function stepVehicle(v: Vehicle, map: GameMap, ctl: DriveControl, dt: number, others: readonly Vehicle[]): void {
  v.impact = 0;
  if (v.wreck) return;
  const d = VEHICLE_DEFS[v.def];
  const powered = v.engineOn && v.fuel > 0 && v.hp > 0;
  const throttle = powered ? clamp(ctl.throttle, -1, 1) : 0;

  // Steering: the wheel follows the input at a finite rate, and locks less the faster you go.
  const lock = d.maxSteer / (1 + Math.abs(v.speed) / d.steerFade);
  v.steer = towards(v.steer, clamp(ctl.steer, -1, 1) * lock, d.steerRate * dt);

  let fx = Math.cos(v.heading);
  let fy = Math.sin(v.heading);
  let vf = v.vel.x * fx + v.vel.y * fy;
  let vr = -v.vel.x * fy + v.vel.y * fx;

  const top = d.maxSpeed * (v.hp < d.hp * 0.3 ? 0.6 : 1);
  if (throttle > 0) {
    if (vf < -0.2) vf = towards(vf, 0, d.brake * dt);
    else vf += d.accel * throttle * Math.max(0, 1 - Math.max(0, vf) / top) * dt;
  } else if (throttle < 0) {
    if (vf > 0.2) vf = towards(vf, 0, d.brake * -throttle * dt);
    else vf = Math.max(-d.maxReverse, vf + d.accel * 0.7 * throttle * dt);
  } else vf = towards(vf, 0, d.roll * dt);
  vf -= vf * Math.abs(vf) * d.drag * dt;
  let grip = d.grip;
  if (ctl.handbrake) {
    vf = towards(vf, 0, d.brake * 0.55 * dt);
    grip *= 0.22;
  }
  vr *= Math.exp(-grip * dt);

  v.angVel = (vf * Math.tan(v.steer)) / d.wheelbase;
  v.heading += v.angVel * dt;
  if (v.heading > Math.PI) v.heading -= Math.PI * 2;
  else if (v.heading < -Math.PI) v.heading += Math.PI * 2;
  fx = Math.cos(v.heading);
  fy = Math.sin(v.heading);
  v.vel.x = fx * vf - fy * vr;
  v.vel.y = fy * vf + fx * vr;

  if (powered) {
    v.fuel = Math.max(0, v.fuel - (d.fuelPerM * Math.abs(vf) * (0.35 + 0.65 * Math.abs(throttle)) + 0.0004) * dt);
    if (v.fuel <= 0) v.engineOn = false;
  }

  // Move in sub-steps of ≤ 0.2 m so the body never skips through a 32 cm wall.
  const steps = Math.max(1, Math.ceil((Math.hypot(v.vel.x, v.vel.y) * dt) / 0.2));
  for (let s = 0; s < steps; s++) {
    v.pos.x += (v.vel.x * dt) / steps;
    v.pos.y += (v.vel.y * dt) / steps;
    v.impact = Math.max(v.impact, resolve(v, map, others));
  }
  v.speed = v.vel.x * fx + v.vel.y * fy;
}

/**
 * Circle (a person) against the body. Returns the push that moves the circle out, or null when clear.
 * `nx, ny` point away from the vehicle.
 */
export function pushOutOfVehicle(v: Vehicle, px: number, py: number, r: number): { nx: number; ny: number; depth: number } | null {
  const d = VEHICLE_DEFS[v.def];
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const dx = px - v.pos.x;
  const dy = py - v.pos.y;
  const lf = dx * fx + dy * fy;
  const lr = -dx * fy + dy * fx;
  const hl = d.length / 2;
  const hw = d.width / 2;
  const cf = clamp(lf, -hl, hl);
  const cr = clamp(lr, -hw, hw);
  let nf = lf - cf;
  let nr = lr - cr;
  let dist = Math.hypot(nf, nr);
  if (dist >= r) return null;
  let depth: number;
  if (dist < 1e-6) {
    // Centre inside the body: out through the nearest side.
    const outF = hl - Math.abs(lf);
    const outR = hw - Math.abs(lr);
    if (outF < outR) {
      nf = lf < 0 ? -1 : 1;
      nr = 0;
      depth = outF + r;
    } else {
      nf = 0;
      nr = lr < 0 ? -1 : 1;
      depth = outR + r;
    }
    dist = 1;
  } else depth = r - dist;
  nf /= dist;
  nr /= dist;
  return { nx: nf * fx - nr * fy, ny: nf * fy + nr * fx, depth };
}

/** Ray (origin, unit dir) against the body: distance to the hit, or −1. */
export function rayVehicle(v: Vehicle, ox: number, oy: number, dx: number, dy: number, maxT: number): number {
  const d = VEHICLE_DEFS[v.def];
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const rx = ox - v.pos.x;
  const ry = oy - v.pos.y;
  // Into the body's frame: slab test against [-hl, hl] × [-hw, hw].
  const o = [rx * fx + ry * fy, -rx * fy + ry * fx];
  const dir = [dx * fx + dy * fy, -dx * fy + dy * fx];
  const half = [d.length / 2, d.width / 2];
  let t0 = 0;
  let t1 = maxT;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(dir[k]!) < 1e-9) {
      if (Math.abs(o[k]!) > half[k]!) return -1;
      continue;
    }
    let a = (-half[k]! - o[k]!) / dir[k]!;
    let b = (half[k]! - o[k]!) / dir[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** World position of a seat. */
export function seatPos(v: Vehicle, seat: number): Vec2 {
  const [f, r] = VEHICLE_DEFS[v.def].seats[seat] ?? [0, 0];
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  return { x: v.pos.x + fx * f - fy * r, y: v.pos.y + fy * f + fx * r };
}

/** Where someone getting out of `seat` stands, best first: their own side, the other side, behind, in front. */
export function exitSpots(v: Vehicle, seat: number): Vec2[] {
  const d = VEHICLE_DEFS[v.def];
  const [f, r] = d.seats[seat] ?? [0, -1];
  const side = r < 0 ? -1 : 1;
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const at = (lf: number, lr: number) => ({ x: v.pos.x + fx * lf - fy * lr, y: v.pos.y + fy * lf + fx * lr });
  const out = d.width / 2 + 0.55;
  return [at(f, side * out), at(f, -side * out), at(-d.length / 2 - 0.6, 0), at(d.length / 2 + 0.6, 0)];
}

/** Door handle position for a seat (where the "get in" prompt sits). */
export function doorPos(v: Vehicle, seat: number): Vec2 {
  const d = VEHICLE_DEFS[v.def];
  const [f, r] = d.seats[seat] ?? [0, -1];
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const lr = (r < 0 ? -1 : 1) * (d.width / 2 + 0.15);
  return { x: v.pos.x + fx * f - fy * lr, y: v.pos.y + fy * f + fx * lr };
}
