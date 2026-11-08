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
  [Tile.Water]: [26, 44, 58],
  [Tile.Rail]: [84, 74, 64],
  [Tile.Container]: [140, 82, 52],
};

/**
 * The whole map (you have it from the start): what you can see right now is brighter. Bosses are always marked.
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
      // World events (airdrop zone, crash site) and your own body.
      for (const ev of raid.mapEvents) {
        ctx.fillStyle = ev.kind === 'airdrop' ? '#6dff8a' : '#ff8a3a';
        ctx.fillRect(ev.x - 1.6, ev.y - 1.6, 3.2, 3.2);
      }
      for (const c of raid.corpses) {
        if (c.actorId >= 0) continue;
        ctx.strokeStyle = '#e0b050';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(c.pos.x - 1.5, c.pos.y - 1.5);
        ctx.lineTo(c.pos.x + 1.5, c.pos.y + 1.5);
        ctx.moveTo(c.pos.x + 1.5, c.pos.y - 1.5);
        ctx.lineTo(c.pos.x - 1.5, c.pos.y + 1.5);
        ctx.stroke();
      }
      // The big map names things: districts faintly, places and their spots, every exit.
      const label = (text: string, x: number, y: number, px: number, fill: string, weight = 600) => {
        ctx.font = `${weight} ${(px * dpr) / scale}px sans-serif`;
        // Near the edge, hang the text inwards so it isn't cut off.
        const edge = 24;
        ctx.textAlign = x < edge ? 'left' : x > map.width - edge ? 'right' : 'center';
        x = Math.min(map.width - 3, Math.max(3, x));
        ctx.lineWidth = (3 * dpr) / scale;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
      };
      if (full) {
        for (const d of map.districts) label(d.name.toUpperCase(), d.x, d.y, 10, 'rgba(232, 220, 184, 0.45)', 500);
        // The spots inside a big place (the base's barracks and gate) would crowd its name: those show in the HUD.
        const majors = map.places.filter((pl) => pl.major);
        for (const pl of map.places) {
          if (!pl.major && majors.some((m) => Math.hypot(m.x - pl.x, m.y - pl.y) < m.r)) continue;
          label(pl.name, pl.x, pl.y, pl.major ? 12 : 9.5, pl.major ? '#f3e6c0' : 'rgba(243, 230, 192, 0.8)', pl.major ? 700 : 500);
        }
      }
      for (const e of map.extractions) {
        ctx.fillStyle = '#4dff9a';
        ctx.beginPath();
        ctx.arc(e.x, e.y, full ? 1.6 : 1.2, 0, Math.PI * 2);
        ctx.fill();
        if (full) {
          const open = !raid.extractBlocked(e);
          const need = e.rule?.kind === 'power' ? 'power' : e.rule?.kind === 'fee' ? `${e.rule.amount} CR` : e.rule?.kind === 'train' ? raid.trainLabel() : 'no backpack';
          label(e.rule && !open ? `${e.name} (${need})` : e.name, e.x, e.y - 2.6, 10, open ? '#7dffb0' : '#ffb27a');
        }
      }
      for (const a of raid.actors) {
        if (!a.alive || a === raid.player || a.bossId) continue;
        // Hostiles your spotter companion has eyes on show up even outside your own sight.
        const spotted = (a.spottedUntil ?? 0) > raid.time;
        if (!a.companion && !spotted && !raid.isVisibleToPlayer(a.pos.x, a.pos.y)) continue;
        ctx.fillStyle = a.companion ? '#7fd1b9' : a.npcId ? '#f0c46a' : '#e05a4a';
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // Bosses: wherever they are, seen or not.
      for (const a of raid.actors) {
        if (!a.alive || !a.bossId) continue;
        const r = full ? 2.4 : 1.6;
        ctx.fillStyle = '#ff3b2f';
        ctx.strokeStyle = '#ffd2c8';
        ctx.lineWidth = full ? 0.7 : 0.5;
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (full) {
          ctx.font = `600 ${(11 * dpr) / scale}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = (3 * dpr) / scale;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.strokeText(a.name, a.pos.x, a.pos.y - r - 1.2);
          ctx.fillStyle = '#ffb0a6';
          ctx.fillText(a.name, a.pos.x, a.pos.y - r - 1.2);
        }
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
