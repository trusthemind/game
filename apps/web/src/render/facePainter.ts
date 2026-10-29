import * as THREE from 'three';
import { Rng } from '@ashfall/engine';

/**
 * Hand-tuned procedural face painter. Produces a transparent 512² texture that the character shader projects
 * onto the front of the head (planar projection in bind space), so faces read as painted portraits instead of
 * primitive blobs. One texture per appearance, cached.
 *
 * Texture space: u ∈ [0,1] across the head's width, v ∈ [0,1] from chin (bottom) to crown (top).
 */
export interface FaceSpec {
  sex: 'm' | 'f';
  skin: number;
  hairColor: number;
  eyes: number;
  age: 0 | 1 | 2;
  beard: boolean;
  scars: boolean;
  zombie: boolean;
  seed: number;
}

const S = 512;
// Feature layout (v measured from chin). Tuned against the mannequin's head proportions.
const EYE_V = 0.5;
const EYE_U = 0.15;
const BROW_V = 0.6;
const NOSE_V = 0.355;
const MOUTH_V = 0.235;

const cache = new Map<string, THREE.CanvasTexture>();

const X = (u: number) => u * S;
const Y = (v: number) => (1 - v) * S;
const hex = (c: number, a = 1) => {
  const col = new THREE.Color(c);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
};
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

export function faceTexture(f: FaceSpec): THREE.CanvasTexture {
  const key = JSON.stringify(f);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  paint(g, f);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

export function faceDataUrl(f: FaceSpec): string {
  return (faceTexture(f).image as HTMLCanvasElement).toDataURL();
}

function paint(g: CanvasRenderingContext2D, f: FaceSpec): void {
  const rng = new Rng(f.seed);
  const skin = f.zombie ? f.skin : f.skin;
  const dark = shade(skin, f.zombie ? 0.55 : 0.72);
  const deep = shade(skin, 0.5);
  g.clearRect(0, 0, S, S);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // ── Soft modelling: temples, cheekbones, jaw shadow ──
  radial(g, X(0.5), Y(0.5), S * 0.42, hex(skin, 0), hex(deep, 0.0));
  for (const side of [-1, 1]) {
    radial(g, X(0.5 + side * 0.33), Y(0.55), S * 0.16, hex(dark, 0.32), hex(dark, 0));
    radial(g, X(0.5 + side * 0.24), Y(0.36), S * 0.12, hex(dark, 0.18), hex(dark, 0));
  }
  radial(g, X(0.5), Y(0.1), S * 0.22, hex(dark, 0.3), hex(dark, 0));

  if (f.sex === 'f' && !f.zombie) for (const side of [-1, 1]) radial(g, X(0.5 + side * 0.2), Y(0.38), S * 0.075, 'rgba(210,90,90,0.22)', 'rgba(210,90,90,0)');

  // ── Eyes ──
  for (const side of [-1, 1]) {
    const cx = X(0.5 + side * EYE_U);
    const cy = Y(EYE_V);
    const w = S * 0.085;
    const h = S * (f.sex === 'f' ? 0.036 : 0.031);
    // socket shadow
    radial(g, cx, cy - h * 0.2, w * 1.5, hex(deep, f.zombie ? 0.75 : 0.35), hex(deep, 0));
    // sclera (almond)
    g.save();
    almond(g, cx, cy, w, h, side);
    g.fillStyle = f.zombie ? '#d6cfa0' : '#efe9e1';
    g.fill();
    g.clip();
    // iris + pupil
    const ir = h * 0.95;
    const ix = cx + side * -w * 0.06;
    g.fillStyle = hex(f.zombie ? 0xb8b28a : f.eyes);
    g.beginPath();
    g.arc(ix, cy + h * 0.05, ir, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = hex(shade(f.zombie ? 0xb8b28a : f.eyes, 0.55));
    g.lineWidth = 2;
    g.stroke();
    if (!f.zombie) {
      g.fillStyle = '#0d0b0a';
      g.beginPath();
      g.arc(ix, cy + h * 0.05, ir * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(ix - ir * 0.35, cy - ir * 0.3, ir * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    // upper lid shadow inside the eye
    g.fillStyle = 'rgba(40,25,20,0.25)';
    g.fillRect(cx - w, cy - h, w * 2, h * 0.6);
    g.restore();
    // upper lid line (+ lashes)
    g.strokeStyle = f.zombie ? hex(deep, 0.9) : 'rgba(28,18,14,0.95)';
    g.lineWidth = f.sex === 'f' ? 5 : 3.5;
    g.beginPath();
    g.moveTo(cx - w, cy + h * 0.1);
    g.quadraticCurveTo(cx, cy - h * 1.55, cx + w, cy + h * 0.1);
    g.stroke();
    if (f.sex === 'f' && !f.zombie) {
      g.lineWidth = 3;
      const outer = cx + side * w;
      g.beginPath();
      g.moveTo(outer, cy);
      g.lineTo(outer + side * w * 0.28, cy - h * 0.7);
      g.stroke();
    }
    // lower lid + crease
    g.strokeStyle = hex(dark, 0.55);
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx - w * 0.85, cy + h * 0.35);
    g.quadraticCurveTo(cx, cy + h * 1.35, cx + w * 0.85, cy + h * 0.35);
    g.stroke();
    g.strokeStyle = hex(dark, 0.45);
    g.beginPath();
    g.moveTo(cx - w * 0.8, cy - h * 1.15);
    g.quadraticCurveTo(cx, cy - h * 2.1, cx + w * 0.85, cy - h * 1.0);
    g.stroke();
    if (f.age >= 2) {
      // crow's feet + bags
      g.strokeStyle = hex(dark, 0.4);
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(cx + side * w * 1.1, cy + k * h * 0.6);
        g.lineTo(cx + side * w * 1.45, cy + k * h * 1.1);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(cx - w * 0.7, cy + h * 1.8);
      g.quadraticCurveTo(cx, cy + h * 2.6, cx + w * 0.7, cy + h * 1.8);
      g.stroke();
    }
  }

  // ── Brows ──
  const browCol = f.zombie ? shade(f.hairColor, 0.6) : f.hairColor;
  for (const side of [-1, 1]) {
    const cx = X(0.5 + side * (EYE_U + 0.005));
    const cy = Y(BROW_V);
    const w = S * 0.098;
    const thick = f.sex === 'f' ? 7 : 12;
    g.fillStyle = hex(browCol, 0.92);
    g.beginPath();
    const inner = cx - side * w;
    const outer = cx + side * w;
    const arch = f.sex === 'f' ? S * 0.022 : S * 0.01;
    g.moveTo(inner, cy + thick * 0.2);
    g.quadraticCurveTo(cx, cy - arch - thick * 0.6, outer, cy + thick * 0.3);
    g.quadraticCurveTo(cx, cy - arch + thick * 0.55, inner, cy + thick * 0.9);
    g.closePath();
    g.fill();
  }

  // ── Nose ──
  {
    const cx = X(0.5);
    const cy = Y(NOSE_V);
    g.strokeStyle = hex(dark, 0.5);
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - S * 0.018, Y(EYE_V - 0.02));
    g.quadraticCurveTo(cx - S * 0.03, cy - S * 0.05, cx - S * 0.036, cy - S * 0.004);
    g.stroke();
    radial(g, cx + S * 0.012, cy + S * 0.012, S * 0.05, hex(dark, 0.35), hex(dark, 0));
    g.fillStyle = hex(deep, 0.75);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + side * S * 0.022, cy + S * 0.012, S * 0.011, S * 0.006, side * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    radial(g, cx - S * 0.008, cy - S * 0.012, S * 0.018, 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0)');
  }

  // ── Mouth ──
  {
    const cx = X(0.5);
    const cy = Y(MOUTH_V);
    const w = S * (f.sex === 'f' ? 0.07 : 0.078);
    const lip = f.zombie ? 0x5a2a24 : f.sex === 'f' ? 0xb05a5a : shade(skin, 0.68);
    // upper lip
    g.fillStyle = hex(shade(lip, 0.82));
    g.beginPath();
    g.moveTo(cx - w, cy);
    g.quadraticCurveTo(cx - w * 0.5, cy - S * 0.016, cx - w * 0.12, cy - S * 0.012);
    g.quadraticCurveTo(cx, cy - S * 0.006, cx + w * 0.12, cy - S * 0.012);
    g.quadraticCurveTo(cx + w * 0.5, cy - S * 0.016, cx + w, cy);
    g.closePath();
    g.fill();
    // lower lip
    g.fillStyle = hex(lip, f.sex === 'f' ? 1 : 0.85);
    g.beginPath();
    g.moveTo(cx - w * 0.9, cy + 1);
    g.quadraticCurveTo(cx, cy + S * (f.sex === 'f' ? 0.03 : 0.022), cx + w * 0.9, cy + 1);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(40,20,18,0.85)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(cx - w, cy);
    g.quadraticCurveTo(cx, cy + S * 0.004, cx + w, cy);
    g.stroke();
    radial(g, cx, cy + S * 0.05, S * 0.035, hex(dark, 0.25), hex(dark, 0));
    if (f.age >= 1) {
      // nasolabial folds
      g.strokeStyle = hex(dark, f.age >= 2 ? 0.55 : 0.3);
      g.lineWidth = 2;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(0.5 + side * 0.06), Y(NOSE_V - 0.01));
        g.quadraticCurveTo(X(0.5 + side * 0.1), Y(MOUTH_V + 0.06), X(0.5 + side * 0.085), Y(MOUTH_V - 0.03));
        g.stroke();
      }
    }
  }

  // ── Forehead lines for older faces ──
  if (f.age >= 2) {
    g.strokeStyle = hex(dark, 0.4);
    g.lineWidth = 1.8;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(X(0.36), Y(0.73 + i * 0.035));
      g.quadraticCurveTo(X(0.5), Y(0.745 + i * 0.035), X(0.64), Y(0.73 + i * 0.035));
      g.stroke();
    }
  }

  // ── Facial hair: stubble everywhere on men, full beard if `beard` ──
  if (f.sex === 'm' && !f.zombie) {
    const density = f.beard ? 7000 : 1100;
    const alpha = f.beard ? 0.7 : 0.18;
    if (f.beard) {
      // Base fill so the beard reads as a mass, then strands on top.
      g.save();
      g.beginPath();
      g.moveTo(X(0.22), Y(0.42));
      g.quadraticCurveTo(X(0.24), Y(0.02), X(0.5), Y(-0.02));
      g.quadraticCurveTo(X(0.76), Y(0.02), X(0.78), Y(0.42));
      g.lineTo(X(0.66), Y(0.4));
      g.quadraticCurveTo(X(0.6), Y(MOUTH_V + 0.06), X(0.5), Y(NOSE_V - 0.04));
      g.quadraticCurveTo(X(0.4), Y(MOUTH_V + 0.06), X(0.34), Y(0.4));
      g.closePath();
      g.fillStyle = hex(f.hairColor, 0.55);
      g.fill();
      g.restore();
    }
    g.fillStyle = hex(f.hairColor, alpha);
    for (let i = 0; i < density; i++) {
      const u = 0.5 + rng.range(-0.3, 0.3);
      const v = rng.range(0.04, NOSE_V - 0.02);
      const du = Math.abs(u - 0.5);
      // Jaw band + moustache, leave the lips clear.
      const nearMouth = Math.abs(v - MOUTH_V) < 0.03 && du < 0.07;
      const inBand = v < 0.22 || du > 0.15 - v * 0.2 || (f.beard && v > MOUTH_V + 0.02 && v < NOSE_V - 0.02 && du < 0.09);
      if (!inBand || nearMouth) continue;
      g.fillRect(X(u), Y(v), 2, 2.6);
    }
  }

  // ── Grit: scars, dirt, zombie decay ──
  if (f.scars) {
    g.strokeStyle = 'rgba(235,205,190,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    const side = rng.chance(0.5) ? -1 : 1;
    g.moveTo(X(0.5 + side * 0.08), Y(0.68));
    g.lineTo(X(0.5 + side * 0.17), Y(0.47));
    g.stroke();
    g.strokeStyle = 'rgba(120,60,50,0.35)';
    g.lineWidth = 1;
    g.stroke();
  }
  for (let i = 0; i < 6; i++) radial(g, X(rng.range(0.25, 0.75)), Y(rng.range(0.15, 0.8)), S * rng.range(0.02, 0.05), 'rgba(60,45,30,0.12)', 'rgba(60,45,30,0)');
  if (f.zombie) {
    g.strokeStyle = 'rgba(70,40,70,0.45)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      let x = X(rng.range(0.3, 0.7));
      let y = Y(rng.range(0.25, 0.75));
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += rng.range(-14, 14);
        y += rng.range(-14, 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    radial(g, X(0.5), Y(MOUTH_V - 0.03), S * 0.07, 'rgba(90,10,8,0.7)', 'rgba(90,10,8,0)');
  }
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function almond(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number): void {
  g.beginPath();
  g.moveTo(cx - w, cy + h * 0.15 * side);
  g.quadraticCurveTo(cx - w * 0.1, cy - h * 1.6, cx + w, cy - h * 0.05 * side);
  g.quadraticCurveTo(cx + w * 0.05, cy + h * 1.25, cx - w, cy + h * 0.15 * side);
  g.closePath();
}
