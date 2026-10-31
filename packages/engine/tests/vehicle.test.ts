import { describe, expect, it } from 'vitest';
import { GameMap, Raid, Tile, VEHICLE_DEFS, createVehicle, emptyIntent, generateMap, starterKit, stepVehicle, vehicleBlocked, type ActorIntent } from '../src/index';

const open = (w = 40, h = 20) => {
  const m = new GameMap(w, h, 1);
  m.tiles.fill(Tile.Grass);
  return m;
};
const gas = { throttle: 1, steer: 0, handbrake: false };

describe('vehicle physics', () => {
  it('accelerates towards top speed and turns with the wheel', () => {
    const map = open(400, 400);
    const v = createVehicle(1, { def: 'uaz469', x: 50, y: 200, heading: 0, variant: 0, wreck: false, fuel: 1 });
    v.engineOn = true;
    for (let i = 0; i < 60 * 3; i++) stepVehicle(v, map, gas, 1 / 60, []);
    expect(v.speed).toBeGreaterThan(8);
    expect(v.speed).toBeLessThanOrEqual(VEHICLE_DEFS.uaz469.maxSpeed);
    expect(v.pos.x).toBeGreaterThan(60);
    const h0 = v.heading;
    for (let i = 0; i < 30; i++) stepVehicle(v, map, { throttle: 0.5, steer: 1, handbrake: false }, 1 / 60, []);
    // Positive steer turns towards +angle (clockwise on screen).
    expect(v.heading).toBeGreaterThan(h0 + 0.1);
  });

  it('does not move with the engine off, and burns fuel when driven', () => {
    const map = open();
    const v = createVehicle(1, { def: 'uaz469', x: 10, y: 10, heading: 0, variant: 0, wreck: false, fuel: 0.5 });
    for (let i = 0; i < 60; i++) stepVehicle(v, map, gas, 1 / 60, []);
    expect(v.pos.x).toBeCloseTo(10, 5);
    v.engineOn = true;
    const f0 = v.fuel;
    for (let i = 0; i < 60; i++) stepVehicle(v, map, gas, 1 / 60, []);
    expect(v.fuel).toBeLessThan(f0);
  });

  it('stops at a wall instead of passing through it, and reports the impact', () => {
    const map = open();
    for (let y = 0; y < 20; y++) map.set(25, y, Tile.Wall);
    const v = createVehicle(1, { def: 'uaz469', x: 8, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    v.engineOn = true;
    let hardest = 0;
    for (let i = 0; i < 60 * 6; i++) {
      stepVehicle(v, map, gas, 1 / 60, []);
      hardest = Math.max(hardest, v.impact);
      expect(vehicleBlocked(v, map, [])).toBe(false);
    }
    expect(v.pos.x + VEHICLE_DEFS.uaz469.length / 2).toBeLessThanOrEqual(25.5 - 0.16 + 1e-6);
    expect(hardest).toBeGreaterThan(4);
  });

  it('collides with a wreck', () => {
    const map = open();
    const wreck = createVehicle(2, { def: 'zhiguli', x: 24, y: 10, heading: Math.PI / 2, variant: 0, wreck: true, fuel: 0 });
    const v = createVehicle(1, { def: 'uaz469', x: 8, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    v.engineOn = true;
    for (let i = 0; i < 60 * 5; i++) stepVehicle(v, map, gas, 1 / 60, [v, wreck]);
    expect(vehicleBlocked(v, map, [wreck])).toBe(false);
    expect(v.pos.x).toBeLessThan(24);
    expect(wreck.pos.x).toBe(24);
  });
});

describe('vehicles in a raid', () => {
  const drive = (raid: Raid, intent: ActorIntent, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) raid.tick(1 / 60, intent);
  };
  const setup = (seed: number) => {
    const raid = new Raid({ seed, playerEq: starterKit(), mapId: 'outskirts', botDensity: 0, events: false, timeOfDay: 'day' });
    const car = raid.vehicles.find((v) => !v.wreck)!;
    return { raid, car };
  };

  it('every map parks a drivable car near the spawn and keeps wrecks clear of walls', () => {
    for (const id of ['outskirts', 'pinehollow', 'portkirov', 'testsite'] as const) {
      const map = generateMap(5, { mapId: id });
      const cars = map.vehicleSpawns.filter((s) => !s.wreck);
      expect(cars.length, id).toBeGreaterThan(0);
      const sp = { x: map.playerSpawn.x + 0.5, y: map.playerSpawn.y + 0.5 };
      expect(Math.min(...cars.map((c) => Math.hypot(c.x - sp.x, c.y - sp.y))), id).toBeLessThan(30);
      const all = map.vehicleSpawns.map((s, i) => createVehicle(i, s));
      for (const v of all) expect(vehicleBlocked(v, map, all), `${id} ${v.def} @${v.pos.x.toFixed(1)},${v.pos.y.toFixed(1)}`).toBe(false);
    }
  });

  it('get in, drive, get out', () => {
    const { raid, car } = setup(11);
    const p = raid.player;
    p.pos.x = car.pos.x;
    p.pos.y = car.pos.y + 2.2;
    expect(raid.enterVehicle(p, car.id)).toBe(true);
    expect(p.vehicle?.seat).toBe(0);
    expect(car.engineOn).toBe(true);
    expect(raid.nearestInteractable()?.kind).toBe('vehicle');
    const start = { ...car.pos };
    const it = { ...emptyIntent(), moveY: -1 };
    drive(raid, it, 2);
    expect(Math.hypot(car.pos.x - start.x, car.pos.y - start.y)).toBeGreaterThan(3);
    // Rides along in its seat.
    expect(Math.hypot(p.pos.x - car.pos.x, p.pos.y - car.pos.y)).toBeLessThan(1.2);
    // Can't jump out at speed.
    if (Math.abs(car.speed) > 3) expect(raid.exitVehicle(p)).toBe(false);
    drive(raid, { ...emptyIntent(), moveY: 1 }, 1.5);
    drive(raid, { ...emptyIntent(), sprint: true }, 2);
    expect(raid.exitVehicle(p)).toBe(true);
    expect(p.vehicle).toBeNull();
    expect(car.engineOn).toBe(false);
    expect(Math.hypot(p.pos.x - car.pos.x, p.pos.y - car.pos.y)).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const run = () => {
      const { raid, car } = setup(23);
      raid.player.pos.x = car.pos.x;
      raid.player.pos.y = car.pos.y;
      raid.enterVehicle(raid.player, car.id);
      const it = { ...emptyIntent(), moveY: -1, moveX: 0.4 };
      drive(raid, it, 4);
      return [car.pos.x, car.pos.y, car.heading, car.hp, car.fuel];
    };
    expect(run()).toEqual(run());
  });

  it('runs people over', () => {
    const { raid, car } = setup(11);
    const p = raid.player;
    p.pos.x = car.pos.x;
    p.pos.y = car.pos.y;
    raid.enterVehicle(p, car.id);
    // Somebody standing 8 m ahead of the bonnet.
    const victim = raid.actors.find((a) => a !== p && !a.companion) ?? null;
    const target = victim ?? p;
    if (target === p) return;
    const ahead = { x: car.pos.x + Math.cos(car.heading) * 9, y: car.pos.y + Math.sin(car.heading) * 9 };
    target.pos.x = ahead.x;
    target.pos.y = ahead.y;
    const hp0 = target.hp;
    target.brain = null;
    drive(raid, { ...emptyIntent(), moveY: -1 }, 2.5);
    expect(target.hp).toBeLessThan(hp0);
  });
});
