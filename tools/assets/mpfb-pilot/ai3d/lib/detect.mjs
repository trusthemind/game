// Auto-detection for `ai3d init`: facing (yaw) of a head GLB from its texture (the eye whites exist on the front only),
// a skin-tone estimate, and the body GLB's axes / size. Heuristics: init prints what it chose and the confidence.
import fs from 'node:fs';
import { allWorldPositions, bounds } from './glb.mjs';
import { readNpz } from './glb.mjs';

const lin2s = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** mesh.npz of ai3d_prep.py at yaw 0 (Blender frame, Z up). Returns the yaw (deg) that turns the face to -Y. */
export function faceYaw(meshNpz) {
  const z = readNpz(meshNpz);
  const V = z.V.data, VC = z.VC.data, n = V.length / 3;
  let hi = -1e9, lo = 1e9;
  for (let i = 0; i < n; i++) (hi = Math.max(hi, V[3 * i + 2])), (lo = Math.min(lo, V[3 * i + 2]));
  const H = hi - lo;
  const dirs = [[1, 0, '+X', -90], [-1, 0, '-X', 90], [0, 1, '+Y', 180], [0, -1, '-Y', 0]];
  let best = null;
  const rows = [];
  for (const frac of [0.45, 0.55]) {
    const z0 = hi - frac * H;
    const sc = dirs.map(([dx, dy, name, yaw]) => {
      let white = 0, tot = 0;
      for (let i = 0; i < n; i++) {
        if (V[3 * i + 2] < z0 || V[3 * i] * dx + V[3 * i + 1] * dy < 0.15) continue;
        tot++;
        const r = VC[3 * i], g = VC[3 * i + 1], b = VC[3 * i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if ((r + g + b) / 3 > 0.55 && (mx - mn) / mx < 0.2) white++;
      }
      return { name, yaw, white, share: tot ? white / tot : 0 };
    }).sort((a, b) => b.share - a.share);
    rows.push(...sc.slice(0, 1).map((s) => `${s.name} ${(s.share * 1000).toFixed(1)}`));
    if (sc[0].share > 0 && (!best || sc[0].share > best.share)) best = { ...sc[0], second: sc[1].share };
  }
  if (!best) return { yaw: 0, confidence: 'none', note: 'no eye whites found in the texture: set orientation.yawDeg by hand (ai3d_inspect.py renders the mesh)' };
  const ratio = best.second > 0 ? best.share / best.second : Infinity;
  return { yaw: best.yaw, face: best.name, confidence: ratio > 4 ? 'high' : ratio > 2 ? 'medium' : 'low', note: `eye whites on ${best.name} (x${Number.isFinite(ratio) ? ratio.toFixed(1) : 'inf'} over the next side)` };
}

/** Median sRGB of front-facing skin-like vertices around the face band (a start for `tone`, check it). */
export function faceTone(meshNpz) {
  const z = readNpz(meshNpz);
  const V = z.V.data, VC = z.VC.data, n = V.length / 3;
  let hi = -1e9, lo = 1e9;
  for (let i = 0; i < n; i++) (hi = Math.max(hi, V[3 * i + 2])), (lo = Math.min(lo, V[3 * i + 2]));
  const H = hi - lo, ch = [[], [], []];
  for (let i = 0; i < n; i++) {
    const zz = (V[3 * i + 2] - lo) / H;
    if (zz < 0.62 || zz > 0.8 || V[3 * i + 1] > -0.02 || Math.abs(V[3 * i]) > 0.06) continue; // front, centre strip, nose..brow
    const r = VC[3 * i], g = VC[3 * i + 1], b = VC[3 * i + 2];
    if ((r + g + b) / 3 > 0.8) continue;
    ch[0].push(r); ch[1].push(g); ch[2].push(b);
  }
  if (ch[0].length < 50) return null;
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return [0, 1, 2].map((k) => Math.round(lin2s(med(ch[k]))).toString(16).padStart(2, '0')).join('');
}

/** A body GLB: which axis is up, its size, the width / depth axes (the fit decides the facing by the toe test). */
export async function bodyInfo(glb) {
  const P = await allWorldPositions(glb);
  const [lo, hi] = bounds(P);
  const ext = hi.map((h, k) => h - lo[k]);
  const up = ext.indexOf(Math.max(...ext));
  const notes = [];
  if (up !== 1) notes.push(`tallest axis is ${'XYZ'[up]}, not Y: the fit expects glTF Y-up (re-export or rotate the GLB)`);
  const h = ext[up];
  const unit = h > 100 ? 'millimetres?' : h > 8 ? 'centimetres?' : h > 0.5 ? 'metres' : 'tiny';
  if (unit !== 'metres') notes.push(`height ${h.toFixed(2)} looks like ${unit}: the fit rescales by the neck height, so this is fine unless the figure is not a standing human`);
  const wideAxis = ext[0] >= ext[2] ? 'x' : 'z';
  return { verts: P.length / 3, extent: ext.map((v) => +v.toFixed(3)), height: +h.toFixed(3), upAxis: 'XYZ'[up], widthAxis: wideAxis, yawHint: ext[2] > ext[0] ? 90 : 0, notes };
}
