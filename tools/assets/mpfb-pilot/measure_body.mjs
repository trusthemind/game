// Body proportions of a GLB / glTF in the terms of ANSUR II (refs/ansur_targets.py -> refs/body_targets.json), as
// fractions of stature, so our bodies, the reference scans and the survey compare 1:1. Rest (bind) pose, skinned
// positions; sections are true plane cuts, girths are convex-hull perimeters (a tape measure), split into connected
// blobs so A-posed arms don't count as torso.
//   node measure_body.mjs <file.glb|gltf> [...]          -> JSON per file
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const SKIP = /eye|brow|lash|underwear|anatomy|trunks|panties|hair/i;

const mmul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xf = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

export async function load(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const tris = []; // [[x,y,z]x3]
  const joints = {};
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || SKIP.test(mesh.getName()) || SKIP.test(node.getName())) continue;
    const skin = node.getSkin();
    let mats = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      mats = skin.listJoints().map((j, i) => mmul(j.getWorldMatrix(), ibm.getElement(i, [])));
      for (const j of skin.listJoints()) joints[j.getName()] = j.getWorldTranslation();
    }
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0');
      const n = pos.getCount();
      const P = new Array(n);
      for (let i = 0; i < n; i++) {
        const p = pos.getElement(i, []);
        if (mats && J) {
          const j = J.getElement(i, []), w = Wt.getElement(i, []);
          const acc = [0, 0, 0];
          for (let k = 0; k < 4; k++) if (w[k] > 0) { const q = xf(mats[j[k]], p); for (let a = 0; a < 3; a++) acc[a] += w[k] * q[a]; }
          P[i] = acc;
        } else P[i] = xf(W, p);
      }
      const idx = prim.getIndices();
      const m = idx ? idx.getCount() : n;
      for (let t = 0; t < m; t += 3) tris.push([0, 1, 2].map((k) => P[idx ? idx.getScalar(t + k) : t + k]));
    }
  }
  return { tris, joints };
}

// Plane cut y = h -> points (x, z).
export function cut(tris, h) {
  const pts = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if ((a[1] - h) * (b[1] - h) < 0) { const s = (h - a[1]) / (b[1] - a[1]); pts.push([a[0] + s * (b[0] - a[0]), a[2] + s * (b[2] - a[2])]); }
    }
  }
  return pts;
}
function hull(p) {
  p = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const perim = (h) => h.reduce((s, q, i) => s + Math.hypot(q[0] - h[(i + 1) % h.length][0], q[1] - h[(i + 1) % h.length][1]), 0);
// Split cut points into blobs along x (gap > g).
export function blobs(pts, g) {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const q of s) { if (!out.length || q[0] - out.at(-1).at(-1)[0] > g) out.push([]); out.at(-1).push(q); }
  return out.map((b) => ({ pts: b, x0: b[0][0], x1: b.at(-1)[0], cx: (b[0][0] + b.at(-1)[0]) / 2 }));
}
const girth = (pts) => (pts.length > 2 ? perim(hull(pts)) : 0);

export async function measure(file) {
  return measureData(await load(file), file);
}

export async function measureData({ tris, joints }, file, sexKeyIn) {
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
  for (const t of tris) for (const p of t) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const S = y1 - y0;
  const Y = (f) => y0 + f * S;
  const g = 0.012 * S;
  const center = (h) => { const b = blobs(cut(tris, h), g); return b.sort((a, c) => Math.abs(a.cx) - Math.abs(c.cx))[0]; };
  // Front direction: the nose sticks out of the face more than the back of the skull out of its sides.
  const nose = cut(tris, Y(0.925));
  const score = (sg) => Math.max(...nose.filter((q) => Math.abs(q[0]) < 0.005 * S).map((q) => sg * q[1])) - Math.max(...nose.filter((q) => Math.abs(q[0]) > 0.02 * S && Math.abs(q[0]) < 0.03 * S).map((q) => sg * q[1]));
  const front = score(1) > score(-1) ? 1 : -1;
  // Midline profile (front-most for |x| < 1% S) -> menton (bottom of the chin): below the chin tip the protrusion
  // falls off sharply into the throat.
  const prof = [];
  for (let f = 0.80; f <= 0.99; f += 0.0025) {
    const pts = cut(tris, Y(f)).filter((q) => Math.abs(q[0]) < 0.01 * S);
    if (pts.length) prof.push([f, Math.max(...pts.map((q) => q[1] * front))]);
  }
  // Menton: just above the biggest jump in protrusion going up from the throat to the chin (0.82..0.92 S).
  let menton = 0.87, jump = 0;
  for (let i = 1; i < prof.length; i++) { const [f, z] = prof[i]; if (f > 0.82 && f < 0.92 && z - prof[i - 1][1] > jump) { jump = z - prof[i - 1][1]; menton = f; } }
  const headH = 1 - menton;
  // Head breadth / circumference: above the ears (top 40% of the head).
  let headBreadth = 0, headCirc = 0;
  for (let f = 1 - headH * 0.42; f < 0.995; f += 0.003) { const b = center(Y(f)); if (!b) continue; headBreadth = Math.max(headBreadth, b.x1 - b.x0); headCirc = Math.max(headCirc, girth(b.pts)); }
  // Neck: min girth between the shoulders' top and the menton.
  let neckCirc = 1e9;
  for (let f = 0.80; f < menton - 0.005; f += 0.003) { const b = center(Y(f)); if (b && b.x1 - b.x0 < 0.12 * S && b.x1 - b.x0 > 0.04 * S) neckCirc = Math.min(neckCirc, girth(b.pts)); } // (> 4 % S: not a stray blob of the shoulders' top)
  const sec = (f) => { const b = center(Y(f)); return { girth: girth(b.pts), breadth: b.x1 - b.x0, depth: Math.max(...b.pts.map((q) => q[1])) - Math.min(...b.pts.map((q) => q[1])) }; };
  const T = await import('node:fs').then((fs) => JSON.parse(fs.readFileSync(new URL('./refs/body_targets.json', import.meta.url))));
  const sexKey = sexKeyIn ?? (/_f|woman|female/i.test(file) ? 'f' : 'm');
  const t = T[sexKey];
  // (T-pose lifts the armpits, so the ANSUR chest height cuts the lats there: also the girth 3% S lower.)
  const chest = sec(t.chest_h), chestLo = sec(t.chest_h - 0.03), waist = sec(t.waist_h);
  // Crotch: lowest body point on the x = 0 plane in 0.3..0.6 S.
  let crotch = 1;
  for (const tr of tris) for (let k = 0; k < 3; k++) {
    const a = tr[k], c = tr[(k + 1) % 3];
    if (a[0] * c[0] <= 0 && a[0] !== c[0]) { const s = a[0] / (a[0] - c[0]); const yy = (a[1] + s * (c[1] - a[1]) - y0) / S; if (yy > 0.3 && yy < 0.6) crotch = Math.min(crotch, yy); }
  }
  // Buttock girth / hip breadth: max over crotch..crotch+0.1 of the centre blob (pelvis + both thighs, as the tape goes).
  let buttock = 0, hipB = 0, buttockF = 0;
  for (let f = crotch; f < crotch + 0.1; f += 0.004) { const b = center(Y(f)); const gg = girth(b.pts); if (gg > buttock) { buttock = gg; buttockF = f; } hipB = Math.max(hipB, b.x1 - b.x0); }
  // One leg = the x > 0 blob nearest the centre (A-posed hands are separate blobs further out).
  const leg = (f) => { const p = cut(tris, Y(f)).filter((q) => q[0] > 0 && q[0] < 0.13 * S); return girth(p); };
  const thigh = leg(crotch - 0.012);
  let calf = 0; for (let f = 0.14; f < 0.26; f += 0.004) calf = Math.max(calf, leg(f));
  let knee = 1e9, kneeF = 0.28; for (let f = 0.24; f < 0.33; f += 0.004) { const v = leg(f); if (v && v < knee) { knee = v; kneeF = f; } }
  let span = 0; { let a = 1e9, c = -1e9; for (const tr of tris) for (const p of tr) { a = Math.min(a, p[0]); c = Math.max(c, p[0]); } span = (c - a) / S; }
  const J = (n) => joints[n];
  const d = (a, b) => (J(a) && J(b) ? Math.hypot(...J(a).map((v, i) => v - J(b)[i])) / S : null);
  const r = {
    file, S_m: +S.toFixed(3),
    head_h: headH, head_breadth: headBreadth / S, head_circ: headCirc / S, neck_circ: neckCirc / S,
    gh_spacing: d('upperarm_l', 'upperarm_r'), acromial_h: J('upperarm_l') ? (J('upperarm_l')[1] - y0) / S : null,
    chest_circ: chest.girth / S, chest_circ_lo: chestLo.girth / S, chest_breadth_lo: chestLo.breadth / S, chest_breadth: chest.breadth / S, chest_depth: chest.depth / S,
    waist_circ: waist.girth / S, waist_breadth: waist.breadth / S,
    hip_breadth: hipB / S, buttock_circ: buttock / S, buttock_at: buttockF,
    span, crotch_h: crotch, knee_min_at: kneeF, thigh_circ: thigh / S, calf_circ: calf / S,
    upperarm_len: d('upperarm_l', 'lowerarm_l'), forearm_len: d('lowerarm_l', 'hand_l'),
    thigh_len: d('thigh_l', 'calf_l'), shin_len: d('calf_l', 'foot_l'), hip_joint_h: J('thigh_l') ? (J('thigh_l')[1] - y0) / S : null,
  };
  for (const k in r) if (typeof r[k] === 'number' && k !== 'S_m') r[k] = +r[k].toFixed(4);
  return r;
}

if (process.argv[1] && process.argv[1].endsWith('measure_body.mjs')) {
  const out = [];
  for (const f of process.argv.slice(2)) out.push(await measure(f));
  console.log(JSON.stringify(out, null, 1));
}
