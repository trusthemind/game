import { describe, expect, it } from 'vitest';
import { EXTRACT_SOLIDS, extractKind, extractSolids, floodFill, generateMap, ROAD_EXTRACTS, Tile, type ExtractKind, type MapId } from '../src/index';

describe('extraction points', () => {
  it('know what they are from their name', () => {
    expect(extractKind('Checkpoint ZB-013')).toBe('checkpoint');
    expect(extractKind('Outpost Kordon-7')).toBe('outpost');
    expect(extractKind('Old Gas Station')).toBe('station');
    expect(extractKind('Collapsed Tunnel')).toBe('tunnel');
    expect(extractKind('Smugglers Boat')).toBe('boat');
    expect(extractKind('Hunters’ Trail')).toBe('path');
    expect(extractKind('North Overpass')).toBe('overpass');
    expect(extractKind('Somewhere')).toBe('gate');
  });

  it('stand where their kind belongs and face out of the map', () => {
    let roadKinds = 0;
    let onRoad = 0;
    for (const mapId of ['outskirts', 'pinehollow', 'portkirov'] as MapId[])
      for (const seed of [1, 2, 3]) {
        const map = generateMap(seed, { mapId, botDensity: 0 });
        expect(map.extractions.length).toBeGreaterThan(0);
        for (const e of map.extractions) {
          expect(e.kind).toBe(extractKind(e.name));
          const t = map.get(Math.floor(e.x), Math.floor(e.y));
          if (ROAD_EXTRACTS.has(e.kind)) {
            roadKinds++;
            if (t === Tile.Road || t === Tile.Dirt) onRoad++;
          }
          // Leaving direction points at the nearest edge.
          const ox = e.x + Math.cos(e.dir) * 10;
          const oy = e.y + Math.sin(e.dir) * 10;
          const edge = (x: number, y: number) => Math.min(x, y, map.width - x, map.height - y);
          expect(edge(ox, oy)).toBeLessThan(edge(e.x, e.y));
        }
        const names = map.extractions.map((e) => e.name);
        expect(new Set(names).size).toBe(names.length);
      }
    // Checkpoints, gates and overpasses sit where a road leaves the map (unless a map edge has none).
    expect(onRoad / Math.max(1, roadKinds)).toBeGreaterThan(0.8);
  });

  it('keep the way out clear of their solid set dressing', () => {
    for (const [kind, boxes] of Object.entries(EXTRACT_SOLIDS) as [ExtractKind, readonly (readonly number[])[]][])
      for (const [x0, z0, x1, z1] of boxes) {
        // Nothing solid in the heart of the circle, and a walkway at least 2 m wide (a pier, a footbridge, the
        // pipe of an outfall) from it out to the edge.
        const cx = Math.max(x0, Math.min(0, x1));
        const cz = Math.max(z0, Math.min(0, z1));
        expect(Math.hypot(cx, cz), `${kind} box ${[x0, z0, x1, z1]} in the circle`).toBeGreaterThan(1.6);
        expect(x1 > -1.0 && x0 < 1.0 && z1 > 0 && z0 < 9.5, `${kind} box ${[x0, z0, x1, z1]} on the way out`).toBe(false);
      }
  });

  it('are solid where the set dressing stands and still reachable', () => {
    for (const mapId of ['outskirts', 'pinehollow', 'portkirov'] as MapId[])
      for (const seed of [1, 2]) {
        const map = generateMap(seed, { mapId, botDensity: 0 });
        const reach = floodFill(map, map.playerSpawn);
        for (const e of map.extractions) {
          expect(reach[map.idx(Math.floor(e.x), Math.floor(e.y))]).toBe(1);
          for (const [x0, y0, x1, y1] of extractSolids(e)) {
            if (x1 - x0 < 1.5 || y1 - y0 < 1.5) continue; // thin walls and sandbag lines only collide
            const cx = Math.floor((x0 + x1) / 2);
            const cy = Math.floor((y0 + y1) / 2);
            if (!map.inBounds(cx, cy) || map.get(cx, cy) === Tile.Border) continue;
            expect(map.isWalkable(cx, cy), `${e.kind} at ${cx},${cy}`).toBe(false);
            expect(map.furnitureTouching(cx, cy)?.length).toBeGreaterThan(0);
          }
        }
      }
  });
});
