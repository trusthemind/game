import { useEffect, useRef } from 'react';
import { Tile, type Raid } from '@ashfall/engine';

const COLORS: Record<number, [number, number, number]> = {
  [Tile.Grass]: [44, 56, 36],
  [Tile.Road]: [58, 60, 58],
  [Tile.Wood]: [92, 72, 52],
  [Tile.Concrete]: [96, 96, 90],
  [Tile.Wall]: [190, 184, 168],
  [Tile.Window]: [120, 160, 180],
  [Tile.Tree]: [28, 44, 26],
  [Tile.Car]: [120, 70, 50],
  [Tile.Fence]: [130, 130, 120],
  [Tile.Dirt]: [70, 58, 44],
  [Tile.Border]: [16, 24, 16],
};

/**
 * Explored-only minimap (exploration matters: you only see what you've seen).
 * Pixels are rebuilt at 4 Hz into an ImageData, then drawn rotated/cropped around the player.
 */
export function Minimap({ raid, size = 196, full = false }: { raid: Raid; size?: number; full?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const map = raid.map;
    const off = document.createElement('canvas');
    off.width = map.width;
    off.height = map.height;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(map.width, map.height);
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    let raf = 0;
    let t = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - t < 250) return;
      t = now;
      const d = img.data;
      for (let i = 0; i < map.tiles.length; i++) {
        const o = i * 4;
        if (!raid.explored[i]) {
          d[o] = d[o + 1] = d[o + 2] = 8;
          d[o + 3] = 255;
          continue;
        }
        const c = COLORS[map.tiles[i]!] ?? [60, 60, 60];
        const k = raid.playerFov[i] ? 1 : 0.55;
        d[o] = c[0] * k;
        d[o + 1] = c[1] * k;
        d[o + 2] = c[2] * k;
        d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      const p = raid.player.pos;
      const span = full ? map.width : 56;
      const scale = (size * dpr) / span;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#060807';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const ox = full ? 0 : p.x - span / 2;
      const oy = full ? 0 : p.y - span / 2;
      ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
      ctx.drawImage(off, 0, 0);
      // Extractions are always known (you have the intel).
      for (const e of map.extractions) {
        ctx.fillStyle = '#4dff9a';
        ctx.beginPath();
        ctx.arc(e.x, e.y, full ? 1.6 : 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const a of raid.actors) {
        if (!a.alive || a === raid.player) continue;
        if (!a.companion && !raid.isVisibleToPlayer(a.pos.x, a.pos.y)) continue;
        ctx.fillStyle = a.companion ? '#7fd1b9' : a.npcId ? '#f0c46a' : '#e05a4a';
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.translate(p.x, p.y);
      ctx.rotate(raid.player.facing);
      ctx.fillStyle = '#f0c46a';
      ctx.beginPath();
      ctx.moveTo(1.6, 0);
      ctx.lineTo(-1, 1);
      ctx.lineTo(-0.5, 0);
      ctx.lineTo(-1, -1);
      ctx.closePath();
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [raid, size, full]);
  return <canvas ref={ref} className="minimap" style={{ width: size, height: size }} />;
}
