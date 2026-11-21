// Skinning sanity (offline, CPU): the shipped body with the AI morph at weight 1 vs weight 0, posed by the game's clips
// (Idle / Walk / Aim / Crouch from apps/web/public/models/character.glb): edge stretch and flipped triangles. The
// topology / weights are MPFB's either way, so the AI build must not be worse than the base by more than a margin.
import { io } from './glb.mjs';

const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
function compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return Float64Array.from([(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1]);
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) { const o = a.map((v, i) => v + t * (bb[i] - v)); const l = Math.hypot(...o); return o.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => wa * v + wb * bb[i]);
}
function sample(ch, time) {
  const T = ch.getSampler().getInput().getArray(), O = ch.getSampler().getOutput();
  const n = T.length, comps = O.getElementSize();
  const t = Math.min(Math.max(time, T[0]), T[n - 1]);
  let i = 0;
  while (i < n - 2 && T[i + 1] < t) i++;
  const f = n === 1 ? 0 : (t - T[i]) / Math.max(T[i + 1] - T[i], 1e-9);
  const a = O.getElement(i, []), b = O.getElement(Math.min(i + 1, n - 1), []);
  if (ch.getTargetPath() === 'rotation' && comps === 4) return slerp(a, b, f);
  return a.map((v, k) => v + f * (b[k] - v));
}

export async function skinningMetrics(aiGlb, clipsGlb, clips) {
  const doc = await io.read(aiGlb);
  const root = doc.getRoot();
  const bodyNode = root.listNodes().find((n) => n.getName() === 'body' && n.getMesh());
  const prim = bodyNode.getMesh().listPrimitives()[0];
  const skin = bodyNode.getSkin() ?? root.listSkins()[0];
  const joints = skin.listJoints();
  const names = joints.map((j) => j.getName());
  const par = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) par.set(c, n);
  const pIdx = joints.map((j) => joints.indexOf(par.get(j)));
  const ibm = skin.getInverseBindMatrices().getArray();
  const P = prim.getAttribute('POSITION').getArray();
  const nv = P.length / 3;
  const J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0').getArray();
  const idx = prim.getIndices().getArray();
  const tgt = prim.listTargets().find((t) => t.getName() === 'ai_body');
  if (!tgt) throw new Error('no ai_body morph target in ' + aiGlb);
  const D = tgt.getAttribute('POSITION').getArray();
  const variants = { base: Float64Array.from(P), ai: Float64Array.from(P, (v, i) => v + D[i]) };
  const cdoc = await io.read(clipsGlb);
  const anims = new Map(cdoc.getRoot().listAnimations().map((a) => [a.getName(), a]));
  // unique edges + their rest lengths per variant
  const edges = new Set();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = idx[t + k], b = idx[t + (k + 1) % 3]; edges.add(a < b ? a * 65536 + b : b * 65536 + a); }
  const E = [...edges].map((e) => [Math.floor(e / 65536), e % 65536]);
  const fn = (X, t) => { const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3; const u = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], v = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
  const out = { base: { stretch: 0, flips: 0 }, ai: { stretch: 0, flips: 0 }, poses: [] };
  for (const [clip, fracs] of clips) {
    const an = anims.get(clip);
    if (!an) { out.poses.push({ clip, missing: true }); continue; }
    const ch = new Map();
    for (const c of an.listChannels()) ch.set(`${c.getTargetNode()?.getName()}.${c.getTargetPath()}`, c);
    const dur = Math.max(...an.listSamplers().map((s) => s.getInput().getArray().at(-1)));
    for (const fr of fracs) {
      const world = new Array(joints.length);
      const sk = new Array(joints.length);
      // (parents resolved lazily: the joint list is not guaranteed parents-first)
      const done = new Array(joints.length).fill(false);
      const resolve = (i) => { if (done[i]) return; if (pIdx[i] >= 0) resolve(pIdx[i]); world[i] = pIdx[i] >= 0 ? mul(world[pIdx[i]], local[i]) : local[i]; done[i] = true; };
      const local = joints.map((j, i) => {
        const T = ch.has(`${names[i]}.translation`) && names[i] !== 'root' && names[i] !== 'pelvis' ? sample(ch.get(`${names[i]}.translation`), fr * dur) : j.getTranslation();
        const R = ch.has(`${names[i]}.rotation`) ? sample(ch.get(`${names[i]}.rotation`), fr * dur) : j.getRotation();
        const S = ch.has(`${names[i]}.scale`) ? sample(ch.get(`${names[i]}.scale`), fr * dur) : j.getScale();
        return compose(T, R, S);
      });
      for (let i = 0; i < joints.length; i++) resolve(i);
      for (let i = 0; i < joints.length; i++) sk[i] = mul(world[i], ibm.subarray(i * 16, i * 16 + 16));
      for (const [vn, X0] of Object.entries(variants)) {
        const X = new Float64Array(nv * 3);
        for (let v = 0; v < nv; v++) {
          const x = X0[3 * v], y = X0[3 * v + 1], z = X0[3 * v + 2];
          let ax = 0, ay = 0, az = 0, ws = 0;
          for (let k = 0; k < 4; k++) {
            const w = W[4 * v + k];
            if (w <= 0) continue;
            const m = sk[J[4 * v + k]];
            ax += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); ay += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); az += w * (m[2] * x + m[6] * y + m[10] * z + m[14]); ws += w;
          }
          X[3 * v] = ax / ws; X[3 * v + 1] = ay / ws; X[3 * v + 2] = az / ws;
        }
        const r = E.map(([a, b]) => Math.hypot(X[3 * a] - X[3 * b], X[3 * a + 1] - X[3 * b + 1], X[3 * a + 2] - X[3 * b + 2]) / Math.max(Math.hypot(X0[3 * a] - X0[3 * b], X0[3 * a + 1] - X0[3 * b + 1], X0[3 * a + 2] - X0[3 * b + 2]), 1e-6));
        r.sort((p, q) => p - q);
        const hi = r[Math.floor(0.999 * r.length)], lo = r[Math.floor(0.001 * r.length)];
        let flips = 0, nt = 0;
        for (let t = 0; t < idx.length; t += 3) { const a = fn(X0, t), b = fn(X, t); nt++; if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) flips++; }
        out[vn].stretch = Math.max(out[vn].stretch, hi, 1 / lo);
        out[vn].flips = Math.max(out[vn].flips, flips / nt);
        out.poses.push({ clip, at: fr, variant: vn, stretchP999: +hi.toFixed(3), shrinkP001: +lo.toFixed(3), flips: +(flips / nt).toFixed(5) });
      }
    }
  }
  return out;
}
