import { describe, expect, it } from 'vitest';
import { generateMap, type GameMap, type Room } from '../src/index';

const inRoom = (r: Room, x: number, y: number) => x >= r.x - 1 && y >= r.y - 1 && x < r.x + r.w + 1 && y < r.y + r.h + 1;
const furnitureIn = (map: GameMap, r: Room) => map.furniture.filter((f) => inRoom(r, f.x, f.y)).map((f) => f.kind);

describe('rooms', () => {
  it('every room has a purpose, and the base buildings have theirs', () => {
    for (const mapId of ['outskirts', 'zavadsk'] as const) {
      const map = generateMap(1, { mapId, botDensity: 0 });
      for (const b of map.buildings) for (const r of b.rooms) expect(r.type, `${b.kind} room`).toBeTruthy();
      const site = map.sites[0]!;
      const roles = (id: number | undefined) => map.buildings.find((b) => b.id === id)!.rooms.map((r) => r.type);
      expect(roles(site.buildings.barracks)).toContain('dorm');
      expect(roles(site.buildings.hq)).toContain('command');
      expect(new Set(roles(site.buildings.armoury))).toEqual(new Set(['armoury']));
      // Homes: a living room, and a kitchen or bathroom once there's room for them.
      const homes = map.buildings.filter((b) => (b.kind === 'house' || b.kind === 'apartment') && b.rooms.length >= 3);
      expect(homes.length).toBeGreaterThan(0);
      for (const h of homes) expect(h.rooms.map((r) => r.type), `home ${h.id}`).toContain('living');
      expect(homes.some((h) => h.rooms.some((r) => r.type === 'kitchen'))).toBe(true);
    }
  });

  it('furniture and loot follow the room', () => {
    const map = generateMap(1, { mapId: 'zavadsk', botDensity: 0 });
    const rooms = map.buildings.flatMap((b) => b.rooms);
    const kitchens = rooms.filter((r) => r.type === 'kitchen');
    expect(kitchens.some((r) => furnitureIn(map, r).includes('gas_stove'))).toBe(true);
    const dorms = rooms.filter((r) => r.type === 'dorm');
    expect(dorms.some((r) => furnitureIn(map, r).includes('bed'))).toBe(true);
    for (const r of rooms.filter((x) => x.type === 'armoury')) expect(furnitureIn(map, r)).not.toContain('bed');
    const boxes = (t: string) => map.containers.filter((c) => rooms.some((r) => r.type === t && inRoom(r, c.x, c.y))).map((c) => c.kind);
    const k = boxes('kitchen');
    expect(k.filter((c) => c === 'fridge').length).toBeGreaterThan(k.length * 0.3);
    expect(boxes('bathroom').every((c) => c === 'medcabinet' || c === 'drawer')).toBe(true);
    // The HUD names the room you're in.
    const hq = map.buildings.find((b) => b.id === map.sites[0]!.buildings.hq)!;
    const cmd = hq.rooms.find((r) => r.type === 'command')!;
    expect(map.placeAt(cmd.x + 0.5, cmd.y + 0.5)).toContain("Commander's office");
  });
});
