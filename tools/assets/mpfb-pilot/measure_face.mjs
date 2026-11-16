// Facial ratios of our heads, in the terms of refs/face_targets.py (London Face Set templates), for the neutral face
// and every FACE_PRESETS face: landmarks are found on the GLB at rest (pupils, eye openings by eyeball visibility,
// brows, the midline profile, mouth corners, nose wings, the face's outline at the cheekbones / jaw angles), then
// moved by the game's own face field (apps/web/src/render/bodyShape.ts, loaded through Vite) for each preset.
//   node measure_face.mjs <human_x.glb> <m|f> [preset,...]   -> table (+ JSON with --json)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const mmul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xf = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

export async function loadGroups(file, pose = null, identity = null) {
  const doc = await io.read(file);
  if (pose) for (const n of doc.getRoot().listNodes()) if (pose[n.getName()]) n.setRotation(pose[n.getName()]);
  const out = { body: [], eyes: [], brows: [], joints: {} };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const name = (mesh.getName() + ' ' + node.getName()).toLowerCase();
    const g = /brow|lash/.test(name) ? 'brows' : /eye/.test(name) ? 'eyes' : /underwear|anatomy|trunk|panties|hair/.test(name) ? null : 'body';
    if (!g) continue;
    const ibm = skin.getInverseBindMatrices();
    const mats = skin.listJoints().map((j, i) => mmul(j.getWorldMatrix(), ibm.getElement(i, [])));
    for (const j of skin.listJoints()) out.joints[j.getName()] = j.getWorldTranslation();
    // A face identity (add_identities.mjs): its morph target added to the rest positions.
    const ti = identity ? (mesh.getExtras()?.targetNames ?? []).indexOf(identity) : -1;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const D = ti >= 0 ? prim.listTargets()[ti]?.getAttribute('POSITION') : null;
      const P = [];
      for (let i = 0; i < pos.getCount(); i++) {
        const p = pos.getElement(i, []), j = J.getElement(i, []), w = W.getElement(i, []);
        if (D) { const d = D.getElement(i, []); for (let c = 0; c < 3; c++) p[c] += d[c]; }
        const a = [0, 0, 0];
        for (let k = 0; k < 4; k++) if (w[k] > 0) { const q = xf(mats[j[k]], p); for (let c = 0; c < 3; c++) a[c] += w[k] * q[c]; }
        P.push(a);
      }
      const idx = prim.getIndices();
      if (g === 'body') for (let t = 0; t < idx.getCount(); t += 3) out.body.push([P[idx.getScalar(t)], P[idx.getScalar(t + 1)], P[idx.getScalar(t + 2)]]);
      else out[g].push(...P);
    }
  }
  return out;
}

// Plane cuts of triangles: axis 0 (x = v) or 1 (y = v) -> 3D points.
export function cut(tris, axis, v) {
  const pts = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    if ((a[axis] - v) * (b[axis] - v) < 0) { const s = (v - a[axis]) / (b[axis] - a[axis]); pts.push(a.map((c, i) => c + s * (b[i] - c))); }
  }
  return pts;
}
// Does a ray from p along +z hit a triangle (Möller–Trumbore)?
function hitZ(tris, p) {
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h = [-e2[1], e2[0], 0]; // d x e2 with d = (0,0,1)
    const det = e1[0] * h[0] + e1[1] * h[1];
    if (Math.abs(det) < 1e-12) continue;
    const s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const u = (s[0] * h[0] + s[1] * h[1]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const vv = q[2] / det;
    if (vv < 0 || u + vv > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 1e-5) return true;
  }
  return false;
}

export function landmarks(G) {
  const { body, eyes, brows } = G;
  // Eye mark as character.ts eyeMark(): the eye points' mean, at their front; eyeX = mean |dx|.
  const n = eyes.length;
  const mean = eyes.reduce((s, p) => s.map((v, i) => v + p[i]), [0, 0, 0]).map((v) => v / n);
  const E = [mean[0], mean[1], Math.max(...eyes.map((p) => p[2]))];
  const eyeX = eyes.reduce((s, p) => s + Math.abs(p[0] - mean[0]), 0) / n;
  const head = body.filter((t) => t.some((p) => p[1] > E[1] - 0.16 && p[1] < E[1] + 0.13 && p[2] > E[2] - 0.13));
  const L = { E };
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    const ep = eyes.filter((p) => (p[0] - E[0]) * sg > 0);
    const zm = Math.max(...ep.map((p) => p[2]));
    const front = ep.filter((p) => p[2] > zm - 0.0015);
    L[`pupil_${s}`] = front.reduce((a, p) => a.map((v, i) => v + p[i] / front.length), [0, 0, 0]);
    // the eye opening: the lids' hole round the pupil (0.4 mm grid: a ray forward from just behind the eyeball's front
    // meets no skin), grown from the pupil.
    const pp = L[`pupil_${s}`];
    const near = head.filter((t) => t.some((p) => Math.abs(p[0] - pp[0]) < 0.03 && Math.abs(p[1] - pp[1]) < 0.025));
    const st = 0.0004, open = new Map(), q = [[0, 0]];
    open.set('0,0', true);
    while (q.length) {
      const [i, j] = q.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${i + di},${j + dj}`;
        if (open.has(k) || Math.abs(i + di) > 45 || Math.abs(j + dj) > 25) continue;
        const ok = !hitZ(near, [pp[0] + (i + di) * st, pp[1] + (j + dj) * st, pp[2] - 0.006]);
        open.set(k, ok);
        if (ok) q.push([i + di, j + dj]);
      }
    }
    const cells = [...open].filter(([, v]) => v).map(([k]) => k.split(',').map(Number)).map(([i, j]) => [pp[0] + i * st, pp[1] + j * st, pp[2]]);
    const ax = (p) => Math.abs(p[0] - E[0]);
    // corners: the outermost columns still 1.2 mm open (thin strands into the socket's corners don't count)
    const colN = new Map();
    for (const p of cells) { const k = Math.round(p[0] / st); colN.set(k, (colN.get(k) || 0) + 1); }
    const wide = cells.filter((p) => colN.get(Math.round(p[0] / st)) >= 3);
    const ends = (pick) => { const v = pick(...wide.map(ax)); const e = wide.filter((p) => Math.abs(ax(p) - v) < 1e-6); return e.reduce((a2, p) => a2.map((c, i) => c + p[i] / e.length), [0, 0, 0]); };
    L[`inner_${s}`] = ends(Math.min);
    L[`outer_${s}`] = ends(Math.max);
    const mid = cells.filter((p) => Math.abs(p[0] - pp[0]) < st / 2);
    L[`lidtop_${s}`] = mid.reduce((a2, p) => (p[1] > a2[1] ? p : a2));
    L[`lidbot_${s}`] = mid.reduce((a2, p) => (p[1] < a2[1] ? p : a2));
    // brow: lowest brow-card point above the pupil, 1 cm+ over it (lashes sit lower)
    const bp = brows.filter((p) => Math.abs(p[0] - L[`pupil_${s}`][0]) < 0.006 && p[1] > L[`pupil_${s}`][1] + 0.012);
    L[`brow_${s}`] = bp.length ? bp.reduce((a, p) => (p[1] < a[1] ? p : a)) : null;
  }
  // Midline profile: front-most z per 0.5 mm of y.
  const prof = new Map();
  const xs = cut(head, 0, E[0] + 0.0007).filter((p) => p[2] > E[2] - 0.06);
  // front-most per 0.5 mm, from the cut points within 1.5 mm (sparse decimated edges; the mouth's inside stays out)
  for (let y = E[1] + 0.1; y > E[1] - 0.16; y -= 0.0005) { const b = xs.filter((p) => Math.abs(p[1] - y) < 0.0015); if (b.length) { const f = b.reduce((a, p) => (p[2] > a[2] ? p : a)); prof.set(y, [E[0], y, f[2]]); } }
  const P0 = [...prof.values()].sort((a, b) => b[1] - a[1]);
  // median of 7 bins (3.5 mm): nostril / mouth-corner strays out
  const P = P0.map((p, i) => { const w = P0.slice(Math.max(0, i - 3), i + 4).map((q) => q[2]).sort((a, b) => a - b); return [p[0], p[1], w[w.length >> 1]]; });
  const inY = (a, b) => P.filter((p) => p[1] <= a && p[1] >= b);
  const maxZ = (s) => s.reduce((a, p) => (p[2] > a[2] ? p : a));
  const minZ = (s) => s.reduce((a, p) => (p[2] < a[2] ? p : a));
  L.noseTip = maxZ(inY(E[1] - 0.02, E[1] - 0.07));
  L.subnasale = minZ(inY(L.noseTip[1] - 0.006, L.noseTip[1] - 0.03));
  L.labSup = maxZ(inY(L.subnasale[1] - 0.004, L.subnasale[1] - 0.025));
  L.stomion = minZ(inY(L.labSup[1] - 0.001, L.labSup[1] - 0.016));
  L.labInf = maxZ(inY(L.stomion[1] - 0.002, L.stomion[1] - 0.02));
  // lower vermilion border ~ the deepest point of the lip-chin fold below the lower lip
  L.mentolabial = minZ(inY(L.labInf[1] - 0.003, L.labInf[1] - 0.025));
  L.pogonion = maxZ(inY(L.mentolabial[1] - 0.003, L.mentolabial[1] - 0.04));
  L.menton = P.filter((p) => p[1] < L.pogonion[1] && p[2] > L.pogonion[2] - 0.025).reduce((a, p) => (p[1] < a[1] ? p : a));
  // upper vermilion border: halfway between subnasale and the upper lip's front, where the profile turns out
  L.vermSup = inY(L.subnasale[1], L.labSup[1]).reduce((a, p) => (Math.abs(p[2] - (L.subnasale[2] + L.labSup[2]) / 2 - 0.25 * (L.labSup[2] - L.subnasale[2])) < Math.abs(a[2] - (L.subnasale[2] + L.labSup[2]) / 2 - 0.25 * (L.labSup[2] - L.subnasale[2])) ? p : a));
  // mouth corners: lip-fold triangles (facing back into the mouth) in the lip band
  const lipCut = cut(head, 1, L.stomion[1]).filter((p) => p[2] > L.stomion[2] - 0.04);
  const cz = (x) => { const b2 = lipCut.filter((p) => Math.abs(Math.abs(p[0] - E[0]) - x) < 0.0015); return b2.length ? Math.max(...b2.map((p) => p[2])) : -1; };
  const band = head.filter((t) => t.every((p) => Math.abs(p[1] - L.stomion[1]) < 0.006 && Math.abs(p[0] - E[0]) < 0.045));
  let cornerX = 0, corner = null;
  for (const [a, b, c] of band) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz) || 1;
    const m = [a, b, c].reduce((s2, p) => s2.map((v, i) => v + p[i] / 3), [0, 0, 0]);
    if (nz / nl < -0.2 && m[2] > cz(Math.abs(m[0] - E[0])) - 0.006) for (const p of [a, b, c]) if (Math.abs(p[0] - E[0]) > cornerX) { cornerX = Math.abs(p[0] - E[0]); corner = p; }
  }
  L.mouthCorner = corner;
  // nose wing: steepest fall of the (median-filtered) front contour sideways, 6 mm over the subnasale
  {
    const sec = cut(head, 1, L.subnasale[1] + 0.006).filter((p) => p[2] > L.subnasale[2] - 0.03);
    const raw = (x) => { const b2 = sec.filter((p) => Math.abs(Math.abs(p[0] - E[0]) - x) < 0.00075); return b2.length ? Math.max(...b2.map((p) => p[2])) : null; };
    const med = (x) => { const v = [raw(x - 0.0015), raw(x), raw(x + 0.0015)].filter((q) => q != null).sort((a2, b2) => a2 - b2); return v.length ? v[Math.floor(v.length / 2)] : null; };
    let best = 0, bx = 0.017;
    for (let x = 0.012; x < 0.028; x += 0.0005) { const a2 = med(x - 0.0015), b2 = med(x + 0.0015); if (a2 != null && b2 != null && a2 - b2 > best) { best = a2 - b2; bx = x; } }
    L.alar = [E[0] + bx, L.subnasale[1] + 0.006, med(bx) ?? L.subnasale[2]];
  }
  return L;
}

// The face's outline (frontal silhouette, ears excluded) at a height: half width.
function outline(tris, E, y, zMin) {
  const s = cut(tris, 1, y).filter((p) => p[2] > E[2] - zMin);
  return s.reduce((a, p) => (Math.abs(p[0] - E[0]) > Math.abs(a[0] - E[0]) ? p : a));
}

export function ratios(L, tris, T) {
  const ipd = Math.abs(L.pupil_l[0] - L.pupil_r[0]);
  const py = (L.pupil_l[1] + L.pupil_r[1]) / 2;
  const fh = py - L.menton[1];
  const zyg = L.zyg ?? outline(tris, L.E, py - T.zyg_level * fh, 0.065);
  const gon = L.gon ?? outline(tris, L.E, py - T.gon_level * fh, 0.105);
  const faceW = 2 * Math.abs(zyg[0] - L.E[0]), jawW = 2 * Math.abs(gon[0] - L.E[0]);
  const eyeW = (Math.abs(L.outer_l[0] - L.inner_l[0]) + Math.abs(L.outer_r[0] - L.inner_r[0])) / 2;
  const eyeH = (L.lidtop_l[1] - L.lidbot_l[1] + L.lidtop_r[1] - L.lidbot_r[1]) / 2;
  const tilt = (Math.atan2(L.outer_l[1] - L.inner_l[1], Math.abs(L.outer_l[0] - L.inner_l[0])) + Math.atan2(L.outer_r[1] - L.inner_r[1], Math.abs(L.outer_r[0] - L.inner_r[0]))) / 2 * 180 / Math.PI;
  const up = L.labSup[1] - L.stomion[1], lo = 2 * (L.stomion[1] - L.labInf[1]);
  const mouthW = 2 * Math.abs(L.mouthCorner[0] - L.E[0]);
  const brow = L.brow_l && L.brow_r ? ((L.brow_l[1] + L.brow_r[1]) / 2 - py) / ipd : null;
  return {
    face_w_ipd: faceW / ipd, jaw_face: jawW / faceW, face_h_w: fh / faceW, eye_w_ipd: eyeW / ipd, eye_aspect: eyeH / eyeW, tilt_deg: tilt,
    intercanthal_ipd: Math.abs(L.inner_l[0] - L.inner_r[0]) / ipd, nose_w_ipd: (2 * Math.abs(L.alar[0] - L.E[0])) / ipd,
    nose_len_ipd: (py - L.subnasale[1]) / ipd, mouth_w_ipd: mouthW / ipd, lips_mouth: (up + lo) / mouthW, upper_lower: up / lo,
    brow_ipd: brow, mouth_y_ipd: (py - L.stomion[1]) / ipd, chin_ipd: (L.stomion[1] - L.menton[1]) / ipd,
    _zyg: zyg, _gon: gon,
  };
}

async function main() {
  const [file, sex, presetArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const G = await loadGroups(file);
  const T = JSON.parse(fs.readFileSync(path.join(here, 'refs/face_targets.json'), 'utf8'));
  const tgt = T.all[sex];
  const L0 = landmarks(G);
  const r0 = ratios(L0, G.body, tgt);
  // landmark points carried through the face field: zygion / gonion as found on the neutral face
  L0.zyg = r0._zyg;
  L0.gon = r0._gon;
  const mk = process.argv.find((a) => a.startsWith('--marks='));
  if (mk) fs.writeFileSync(mk.slice(8), JSON.stringify(L0));
  const vite = await createServer({ root: path.join(ROOT, 'apps/web'), configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  const { ShapeField } = await vite.ssrLoadModule('/src/render/bodyShape.ts');
  const eng = await vite.ssrLoadModule('@ashfall/engine');
  const THREE = await vite.ssrLoadModule('three');
  const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const J = G.joints;
  const n = G.eyes.length;
  const mean = G.eyes.reduce((s, p) => s.map((v, i) => v + p[i]), [0, 0, 0]).map((v) => v / n);
  const marks = {
    pelvis: V(J.pelvis), s1: V(J.spine_01), s2: V(J.spine_02), s3: V(J.spine_03), neck: V(J.neck_01),
    ua: [V(J.upperarm_l), V(J.upperarm_r)], la: [V(J.lowerarm_l), V(J.lowerarm_r)], hand: [V(J.hand_l), V(J.hand_r)],
    thigh: [V(J.thigh_l), V(J.thigh_r)], calf: [V(J.calf_l), V(J.calf_r)], foot: [V(J.foot_l), V(J.foot_r)],
    eye: V(L0.E), eyeX: /_ubc/.test(file) ? undefined : G.eyes.reduce((s, p) => s + Math.abs(p[0] - mean[0]), 0) / n, // old bodies: EYE_X / EYE_R (character.ts)
  };
  const evalFace = (face) => {
    if (!face) return ratios(L0, G.body, tgt);
    const f = new ShapeField(marks, eng.NEUTRAL_SHAPE, sex, { ...eng.NEUTRAL_FACE, ...face });
    const fe = f.eyesOnly();
    const d = new THREE.Vector3();
    const mv = (p, fld) => { if (!p) return p; fld.at(V(p), d); return [p[0] + d.x, p[1] + d.y, p[2] + d.z]; };
    const L = Object.fromEntries(Object.entries(L0).map(([k, p]) => [k, k === 'E' ? p : mv(p, /^pupil_/.test(k) ? fe : f)]));
    return ratios(L, G.body, tgt);
  };
  if (process.argv.includes('--fit')) {
    // Slider values per archetype: least squares on the London archetype's ratios *relative to the London median of
    // the sex* (our base face stands for that median), pulled towards the taste prior (REFERENCES.md section 7).
    const W = { face_w_ipd: 1, jaw_face: 1.2, face_h_w: 1, eye_w_ipd: 0.6, eye_aspect: 0.8, tilt_deg: 0.08, nose_w_ipd: 0.5, nose_len_ipd: 0.8,
      mouth_w_ipd: 0.7, lips_mouth: 0.6, brow_ipd: 0.6, mouth_y_ipd: 0.6, chin_ipd: 0.8 };
    const PRIOR = JSON.parse(fs.readFileSync(path.join(here, 'refs/face_priors.json'), 'utf8'));
    const base = evalFace(null);
    const keys = Object.keys(W);
    const S = eng.FACE_KEYS;
    const Jac = {};
    for (const k of S) {
      const a = evalFace({ [k]: 0.5 }), b = evalFace({ [k]: -0.5 });
      Jac[k] = Object.fromEntries(keys.map((q) => [q, a[q] - b[q]]));
    }
    const out = {};
    for (const [name, arch] of Object.entries(T.arch).filter(([n]) => n.startsWith(sex + '_'))) {
      const goal = Object.fromEntries(keys.map((q) => [q, base[q] * (arch[q] / tgt[q])]));
      const prior = PRIOR[name] ?? {};
      let x = Object.fromEntries(S.map((k) => [k, prior[k] ?? 0]));
      const LAM = 0.02;
      for (let it = 0; it < 400; it++) {
        // linearised residual + prior; gradient step
        const r = Object.fromEntries(keys.map((q) => [q, S.reduce((acc, k) => acc + Jac[k][q] * x[k], base[q]) - goal[q]]));
        for (const k of S) {
          let g = 0;
          for (const q of keys) g += 2 * W[q] * W[q] * r[q] * Jac[k][q] / (Math.abs(base[q]) + 1e-6) ** 2;
          g += 2 * LAM * (x[k] - (prior[k] ?? 0));
          x[k] = Math.max(-0.85, Math.min(0.85, x[k] - 0.02 * g));
        }
      }
      x = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Math.round(v * 20) / 20]).filter(([, v]) => v !== 0));
      const got = evalFace(x);
      out[name] = { sliders: x, err: Object.fromEntries(keys.map((q) => [q, +((got[q] / goal[q] - 1) * 100).toFixed(1)])) };
      console.log(name, JSON.stringify(x));
      console.log('  err%', JSON.stringify(out[name].err));
    }
    const fo = process.argv.find((a) => a.startsWith('--out='));
    if (fo) fs.writeFileSync(fo.slice(6), JSON.stringify(out, null, 1));
    await vite.close();
    return;
  }
  if (process.argv.includes('--ids')) {
    // Variety: the face identities (each re-landmarked on its own morphed head) against the slider presets (the
    // neutral head moved by the face field): per ratio min / max / stdev across each set.
    const pre = {};
    for (const name of Object.keys(eng.FACE_PRESETS)) {
      const f = new ShapeField(marks, eng.NEUTRAL_SHAPE, sex, eng.FACE_PRESETS[name]);
      const fe = f.eyesOnly();
      const d = new THREE.Vector3();
      const mv = (p, fld = f) => { if (!p) return p; fld.at(V(p), d); return [p[0] + d.x, p[1] + d.y, p[2] + d.z]; };
      pre[name] = ratios(Object.fromEntries(Object.entries(L0).map(([k, p]) => [k, k === 'E' ? p : mv(p, /^pupil_/.test(k) ? fe : f)])), G.body, tgt);
    }
    const ids = eng.IDENTITIES[sex].map((d) => d.id);
    const idr = {};
    for (const id of ids) {
      const Gi = await loadGroups(file, null, id);
      const Li = landmarks(Gi);
      const miss = Object.entries(Li).filter(([, v]) => v == null).map(([k]) => k);
      // (a landmark not found on this head: the base head's, carried by the identity's own displacement nearby)
      for (const k of miss) console.log('  ', id, 'landmark not found:', k);
      for (const k of miss) Li[k] = L0[k];
      idr[id] = ratios(Li, Gi.body, tgt);
    }
    await vite.close();
    const keys = ['face_w_ipd', 'face_h_w', 'jaw_face', 'nose_w_ipd', 'nose_len_ipd', 'eye_w_ipd', 'eye_aspect', 'tilt_deg', 'intercanthal_ipd', 'mouth_w_ipd', 'lips_mouth', 'upper_lower', 'brow_ipd', 'chin_ipd'];
    const st = (rows, k) => {
      const v = Object.values(rows).map((r) => r[k]).filter((x) => x != null && Number.isFinite(x));
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return { min: Math.min(...v), max: Math.max(...v), sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), mean: m };
    };
    const f3 = (x) => x.toFixed(3).padStart(7);
    console.log(`${sex}: ${Object.keys(pre).length} slider presets vs ${ids.length} identities`);
    console.log('key'.padEnd(17) + ' | presets min    max     sd   (sd/mean%) | identities min max sd (sd/mean%) | sd ratio');
    const out = {};
    for (const k of keys) {
      const a = st(pre, k), b = st(idr, k);
      out[k] = { presets: a, identities: b };
      console.log(k.padEnd(17) + ' |' + f3(a.min) + f3(a.max) + f3(a.sd) + ` (${((a.sd / Math.abs(a.mean)) * 100).toFixed(1)}%)`.padStart(9) + ' |' + f3(b.min) + f3(b.max) + f3(b.sd) + ` (${((b.sd / Math.abs(b.mean)) * 100).toFixed(1)}%)`.padStart(9) + ' | x' + (b.sd / (a.sd || 1e-9)).toFixed(2));
    }
    if (process.argv.includes('--rows')) for (const id of ids) console.log(id.padEnd(8), keys.map((k) => (idr[id][k] ?? NaN).toFixed(3)).join(' '));
    const fo = process.argv.find((a) => a.startsWith('--out='));
    if (fo) fs.writeFileSync(fo.slice(6), JSON.stringify({ presets: pre, identities: idr, stats: out }, (k, v) => (k.startsWith('_') ? undefined : v), 1));
    return;
  }
  const names = presetArg ? presetArg.split(',') : Object.keys(eng.FACE_PRESETS);
  const rows = {};
  for (const name of ['neutral', ...names]) {
    const face = name === 'neutral' ? null : eng.FACE_PRESETS[name] ?? JSON.parse(name);
    let L = L0;
    if (face) {
      const f = new ShapeField(marks, eng.NEUTRAL_SHAPE, sex, face);
      const fe = f.eyesOnly();
      const d = new THREE.Vector3();
      const mv = (p, fld = f) => { if (!p) return p; fld.at(V(p), d); return [p[0] + d.x, p[1] + d.y, p[2] + d.z]; };
      L = Object.fromEntries(Object.entries(L0).map(([k, p]) => [k, k === 'E' ? p : mv(p, /^pupil_/.test(k) ? fe : f)]));
    }
    rows[name] = ratios(L, G.body, tgt);
  }
  await vite.close();
  const keys = T.keys.filter((k) => !/level/.test(k));
  const cols = Object.keys(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, L0 }));
  console.log('key'.padEnd(18) + 'London'.padStart(8) + cols.map((c) => c.slice(0, 10).padStart(11)).join(''));
  for (const k of keys) console.log(k.padEnd(18) + tgt[k].toFixed(3).padStart(8) + cols.map((c) => (rows[c][k] == null ? '-' : rows[c][k].toFixed(3)).padStart(11)).join(''));
}
if (process.argv[1]?.endsWith('measure_face.mjs')) await main();
