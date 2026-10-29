import * as THREE from 'three';
import { Rng } from '@ashfall/engine';

/**
 * Procedural textures painted into canvases at startup — no asset downloads, nothing to cache-bust,
 * and every texture is generated once and memoised.
 */
export type TexKind = 'grass' | 'asphalt' | 'wood' | 'concrete' | 'dirt' | 'plaster' | 'bark' | 'metal';

const cache = new Map<string, THREE.Texture>();
const SIZE = 256;

export function getTexture(kind: TexKind, anisotropy = 4): THREE.Texture {
  const key = `${kind}:${anisotropy}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  PAINTERS[kind](g, new Rng(kind));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, tex);
  return tex;
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

function speckle(g: CanvasRenderingContext2D, rng: Rng, n: number, colors: string[], min: number, max: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rng.pick(colors);
    g.globalAlpha = rng.range(0.15, 0.6);
    const s = rng.range(min, max);
    g.fillRect(rng.range(0, SIZE), rng.range(0, SIZE), s, s);
  }
  g.globalAlpha = 1;
}

function blotches(g: CanvasRenderingContext2D, rng: Rng, n: number, colors: string[], rMin: number, rMax: number, alpha = 0.18): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, SIZE);
    const y = rng.range(0, SIZE);
    const r = rng.range(rMin, rMax);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rng.pick(colors));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha;
    g.fillStyle = grd;
    // Draw wrapped so the texture tiles seamlessly.
    for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
  }
  g.globalAlpha = 1;
}

const PAINTERS: Record<TexKind, (g: CanvasRenderingContext2D, rng: Rng) => void> = {
  grass(g, rng) {
    g.fillStyle = '#3c4a2c';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 40, ['#4c5b33', '#2f3a22', '#55603a', '#3a3a26'], 20, 60, 0.35);
    g.lineWidth = 1;
    for (let i = 0; i < 1600; i++) {
      const x = rng.range(0, SIZE);
      const y = rng.range(0, SIZE);
      g.strokeStyle = rng.pick(['#5d6e3c', '#2a3520', '#6e7448', '#4b5a30']);
      g.globalAlpha = rng.range(0.3, 0.8);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rng.range(-2, 2), y - rng.range(2, 6));
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  asphalt(g, rng) {
    g.fillStyle = '#2b2d2c';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 30, ['#353836', '#232524', '#2f2f2a'], 20, 70, 0.4);
    speckle(g, rng, 3500, ['#4a4c4a', '#1b1c1b', '#5a5a55'], 1, 2);
    g.strokeStyle = '#151615';
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = rng.range(0, SIZE);
      let y = rng.range(0, SIZE);
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += rng.range(-14, 14);
        y += rng.range(-14, 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  wood(g, rng) {
    g.fillStyle = '#4a3726';
    g.fillRect(0, 0, SIZE, SIZE);
    const plank = SIZE / 8;
    for (let i = 0; i < 8; i++) {
      const base = rng.pick(['#5a4330', '#4d3a28', '#634a33', '#46342a']);
      g.fillStyle = base;
      g.fillRect(0, i * plank + 1, SIZE, plank - 2);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = rng.pick(['#3b2b1e', '#6f5439']);
        g.globalAlpha = rng.range(0.15, 0.4);
        g.beginPath();
        const y = i * plank + rng.range(3, plank - 3);
        g.moveTo(0, y);
        g.bezierCurveTo(SIZE * 0.3, y + rng.range(-2, 2), SIZE * 0.6, y + rng.range(-2, 2), SIZE, y);
        g.stroke();
      }
      g.globalAlpha = 0.8;
      g.fillStyle = '#20160e';
      const cut = rng.range(0, SIZE);
      g.fillRect(cut, i * plank, 2, plank);
      g.globalAlpha = 1;
    }
  },
  concrete(g, rng) {
    g.fillStyle = '#6b6c66';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 50, ['#7b7c75', '#5a5b55', '#62645c', '#504f49'], 15, 60, 0.35);
    speckle(g, rng, 2500, ['#8a8b84', '#44443f'], 1, 2);
    g.strokeStyle = '#43443f';
    g.globalAlpha = 0.6;
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath();
      g.moveTo(0, i * 128);
      g.lineTo(SIZE, i * 128);
      g.moveTo(i * 128, 0);
      g.lineTo(i * 128, SIZE);
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  dirt(g, rng) {
    g.fillStyle = '#4a3f30';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 40, ['#5a4c38', '#3a3126', '#544a3a'], 15, 50, 0.4);
    speckle(g, rng, 2500, ['#6a5c48', '#2a231a', '#7a6e5a'], 1, 3);
  },
  plaster(g, rng) {
    g.fillStyle = '#8c8676';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 40, ['#9a9483', '#6f6a5c', '#7d7363', '#5e5a50'], 20, 70, 0.35);
    // Exposed bricks where plaster fell off.
    for (let i = 0; i < 5; i++) {
      const bx = rng.range(0, SIZE - 60);
      const by = rng.range(0, SIZE - 40);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) {
          g.fillStyle = rng.pick(['#7a4a36', '#6a3e2e', '#84523c']);
          g.globalAlpha = 0.85;
          g.fillRect(bx + c * 20 + (r % 2) * 10, by + r * 10, 18, 8);
        }
    }
    g.globalAlpha = 1;
    speckle(g, rng, 1500, ['#a8a290', '#4c483e'], 1, 2);
  },
  bark(g, rng) {
    g.fillStyle = '#3a2c20';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = rng.pick(['#2a2018', '#4a3a2a', '#20180f']);
      g.globalAlpha = 0.6;
      g.beginPath();
      const x = rng.range(0, SIZE);
      g.moveTo(x, 0);
      g.lineTo(x + rng.range(-6, 6), SIZE);
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  metal(g, rng) {
    g.fillStyle = '#565b58';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, rng, 30, ['#6a2f1c', '#7a4a2a', '#3a3f3c'], 10, 50, 0.4);
    speckle(g, rng, 1200, ['#8a8f8a', '#2a2c2a'], 1, 2);
  },
};
