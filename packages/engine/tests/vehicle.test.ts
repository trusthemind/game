import { describe, expect, it } from 'vitest';
import { GameMap, Raid, Tile, VEHICLE_DEFS, createVehicle, emptyIntent, generateMap, shootVehicle, starterKit, stepVehicle, vehicleBlocked, type ActorIntent } from '../src/index';

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

  it('rams a wreck: shoves it a little (dead wheels make it heavy) and stops behind it', () => {
    const map = open();
    const wreck = createVehicle(2, { def: 'zhiguli', x: 24, y: 10, heading: Math.PI / 2, variant: 0, wreck: true, fuel: 0 });
    const v = createVehicle(1, { def: 'uaz469', x: 8, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    v.engineOn = true;
    for (let i = 0; i < 60 * 5; i++) {
      stepVehicle(v, map, gas, 1 / 60, [v, wreck]);
      stepVehicle(wreck, map, { throttle: 0, steer: 0, handbrake: false }, 1 / 60, [v, wreck]);
    }
    expect(vehicleBlocked(v, map, [wreck])).toBe(false);
    expect(v.pos.x).toBeLessThan(wreck.pos.x);
    expect(wreck.pos.x).toBeGreaterThan(24.2);
    expect(wreck.pos.x).toBeLessThan(28);
  });

  it('the heavier car wins a head-on: it rolls on, the lighter one is knocked back', () => {
    const map = open();
    const uaz = createVehicle(1, { def: 'uaz469', x: 10, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    const lada = createVehicle(2, { def: 'zhiguli', x: 30, y: 10, heading: Math.PI, variant: 0, wreck: false, fuel: 0 });
    uaz.vel.x = 8;
    lada.vel.x = -8;
    const coast = { throttle: 0, steer: 0, handbrake: false };
    let after: { uaz: number; lada: number } | null = null;
    for (let i = 0; i < 60 * 3 && !after; i++) {
      stepVehicle(uaz, map, coast, 1 / 60, [uaz, lada]);
      stepVehicle(lada, map, coast, 1 / 60, [uaz, lada]);
      if (uaz.impact > 0 || lada.impact > 0) after = { uaz: uaz.vel.x, lada: lada.vel.x };
    }
    expect(after).not.toBeNull();
    expect(after!.uaz).toBeGreaterThan(0);
    expect(after!.lada).toBeGreaterThan(0);
    expect(vehicleBlocked(uaz, map, [lada])).toBe(false);
  });

  it('is slower on grass than on tarmac, and a 4x4 minds it less than its top speed would say', () => {
    const run = (tile: Tile) => {
      const map = open();
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.get(x, y) !== Tile.Border) map.set(x, y, tile);
      const v = createVehicle(1, { def: 'uaz469', x: 6, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
      v.engineOn = true;
      for (let i = 0; i < 60 * 3; i++) stepVehicle(v, map, gas, 1 / 60, [v]);
      return v.speed;
    };
    const road = run(Tile.Road);
    const grass = run(Tile.Grass);
    expect(grass).toBeLessThan(road * 0.97);
    expect(grass).toBeGreaterThan(road * 0.7);
  });

  it('takes bullets where they land: the bonnet, a wheel, the tank', () => {
    const fresh = () => createVehicle(1, { def: 'uaz469', x: 20, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    const d = VEHICLE_DEFS.uaz469;
    const v = fresh();
    expect(shootVehicle(v, 20 + d.length * 0.45, 10, 42, 0.9)).toBe('engine');
    expect(v.engine).toBeLessThan(1);
    const w = fresh();
    expect(shootVehicle(w, 20 + d.wheelbase / 2, 10 + d.width * 0.45, 42, 0.1)).toBe('tire');
    expect(w.tires.filter((t) => t <= 0).length).toBe(1);
    const t = fresh();
    expect(shootVehicle(t, 20 - d.length * 0.45, 10, 42, 0.1)).toBe('tank');
    const fuel = t.fuel;
    stepVehicle(t, open(), { throttle: 0, steer: 0, handbrake: false }, 1, [t]);
    expect(t.fuel).toBeLessThan(fuel);
    // Three rounds through the bonnet stop the engine.
    const e = fresh();
    e.engineOn = true;
    for (let i = 0; i < 4; i++) shootVehicle(e, 20 + d.length * 0.45, 10, 42, 0.9);
    expect(e.engine).toBe(0);
    expect(e.engineOn).toBe(false);
  });

  it('a shot-out front tyre pulls the car towards that side', () => {
    const map = open();
    const v = createVehicle(1, { def: 'uaz469', x: 6, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    v.engineOn = true;
    v.tires[1] = 0;
    for (let i = 0; i < 60 * 3; i++) stepVehicle(v, map, gas, 1 / 60, [v]);
    // Right side flat: the nose swings right (towards +heading on screen).
    expect(v.heading).toBeGreaterThan(0.05);
  });

  it("small arms don't reach a BTR's engine, wheels or tank", () => {
    const d = VEHICLE_DEFS.btr80;
    const v = createVehicle(1, { def: 'btr80', x: 20, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
    expect(shootVehicle(v, 20 + d.length * 0.45, 10, 60, 0.1)).toBe('body');
    expect(shootVehicle(v, 20 + d.wheelbase / 2, 10 + d.width * 0.45, 60, 0.1)).toBe('body');
    expect(v.engine).toBe(1);
    expect(v.tires.every((t) => t === 1)).toBe(true);
    expect(v.hp).toBeGreaterThan(d.hp * 0.99);
  });

  it('every new vehicle drives off and stops on its brakes', () => {
    for (const def of ['niva', 'vaz2107', 'uaz452', 'ural4320', 'btr80', 'izh'] as const) {
      const map = open(80, 20);
      const v = createVehicle(1, { def, x: 10, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
      v.engineOn = true;
      for (let i = 0; i < 60 * 2; i++) stepVehicle(v, map, gas, 1 / 60, [v]);
      expect(v.speed, def).toBeGreaterThan(3);
      for (let i = 0; i < 60 * 4; i++) stepVehicle(v, map, { throttle: -1, steer: 0, handbrake: false }, 1 / 60, [v]);
      expect(v.speed, def).toBeLessThan(0.5);
    }
  });

  it('the handbrake swings the back out into a slide', () => {
    const map = open();
    const go = (handbrake: boolean) => {
      const v = createVehicle(1, { def: 'uaz469', x: 6, y: 10, heading: 0, variant: 0, wreck: false, fuel: 1 });
      v.engineOn = true;
      v.vel.x = 12;
      for (let i = 0; i < 30; i++) stepVehicle(v, map, { throttle: 0, steer: 1, handbrake }, 1 / 60, [v]);
      return v.heading;
    };
    expect(go(true)).toBeGreaterThan(go(false));
  });
});

describe('vehicles on the map', () => {
  it('every map has six or more running vehicles (eight on the biggest), spread out, of more than one kind', () => {
    for (const id of ['outskirts', 'pinehollow', 'portkirov', 'zavadsk'] as const)
      for (const seed of [3, 18]) {
        const m = generateMap(seed, { mapId: id });
        const run = m.vehicleSpawns.filter((v) => !v.wreck);
        expect(run.length, `${id} ${seed}`).toBeGreaterThanOrEqual(m.width >= 300 ? 8 : 6);
        expect(new Set(run.map((v) => v.def)).size, `${id} ${seed}`).toBeGreaterThan(1);
        for (const a of run) for (const b of run) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(12);
      }
  }, 60000);
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

describe('cars on the maps', () => {
  it('the drivable one by the spawn stands on a proper road and can drive a long way along it', () => {
    for (const mapId of ['outskirts', 'pinehollow', 'portkirov', 'zavadsk'] as const)
      for (const seed of [1, 2]) {
        const map = generateMap(seed, { mapId, botDensity: 0 });
        const wrecks = map.vehicleSpawns.filter((s) => s.wreck).map((s, i) => createVehicle(1000 + i, s));
        const sp = { x: map.playerSpawn.x + 0.5, y: map.playerSpawn.y + 0.5 };
        const car = map.vehicleSpawns.find((s) => !s.wreck && Math.hypot(s.x - sp.x, s.y - sp.y) < 50);
        expect(car, `${mapId} ${seed}`).toBeDefined();
        const isRoad = (x: number, y: number) => map.get(x, y) === Tile.Road || map.get(x, y) === Tile.Dirt;
        const cx = Math.floor(car!.x);
        const cy = Math.floor(car!.y);
        expect(isRoad(cx, cy), `${mapId} ${seed}`).toBe(true);
        // Across the car (perpendicular to its heading) the road is at least a street wide.
        const [ax, ay] = Math.abs(Math.cos(car!.heading)) > 0.5 ? [0, 1] : [1, 0];
        let w = 1;
        for (const sg of [1, -1]) for (let k = 1; k < 8 && isRoad(cx + ax * k * sg, cy + ay * k * sg); k++) w++;
        expect(w, `${mapId} ${seed}`).toBeGreaterThanOrEqual(4);
        // Along road tiles a UAZ fits on (either way round), past the wrecks, it gets well away.
        const fits = (x: number, y: number) =>
          [0, Math.PI / 2].some((h) => !vehicleBlocked(createVehicle(1, { def: 'uaz469', x: x + 0.5, y: y + 0.5, heading: h, variant: 0, wreck: false, fuel: 1 }), map, wrecks));
        const seen = new Set([map.idx(cx, cy)]);
        const q = [[cx, cy]];
        let far = 0;
        while (q.length && far < 150) {
          const [x, y] = q.pop()!;
          far = Math.max(far, Math.hypot(x! - cx, y! - cy));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x! + dx;
            const ny = y! + dy;
            const i = map.idx(nx, ny);
            if (!map.inBounds(nx, ny) || seen.has(i) || !isRoad(nx, ny)) continue;
            seen.add(i);
            if (fits(nx, ny)) q.push([nx, ny]);
          }
        }
        expect(far, `${mapId} ${seed}`).toBeGreaterThanOrEqual(150);
      }
  }, 60000);
});
