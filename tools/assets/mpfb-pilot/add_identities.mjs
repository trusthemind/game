// Face identities (build_identities.py output in ./ident) onto the game's MPFB bodies:
//   * head-only morph targets (one per identity, POSITION deltas, sparse) on body / eyes / brows / lashes of
//     base/human_{m,f}_mpfb.glb  ->  base/human_{m,f}_mpfb_id.glb  (build.mjs ONLY=mpfb compresses that one)
//   * per-identity face textures as atlases in apps/web/public/textures/ident/: face_{sex}.webp (RGB: the identity's
//     skin detail ratio / 2 over the face's UV rect, A: roughness), eyes_{sex}.webp (iris), brows_{sex}.webp (brow card,
//     resampled into the shipped brow mesh's UVs)
//   * apps/web/src/render/identityData.ts: ids, labels, atlas layout, the face's UV rect.
// The Blender humans are matched to the shipped (decimated, scan-fitted, T-posed, rescaled) ones by a similarity
// transform fitted on the eyes and lashes (never decimated), then each shipped vertex takes the delta of the nearest
// point on the full-res head surface (barycentric, same-facing triangles only, so the lips and lids don't mix).
//   node add_identities.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const ID = path.join(here, 'ident');
const TEX_OUT = path.join(ROOT, 'apps/web/public/textures/ident');
fs.mkdirSync(TEX_OUT, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const raw = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const f32 = (p) => new Float32Array(raw(p));
const u32 = (p) => new Uint32Array(raw(p));
// Blender Z-up -> glTF Y-up
const yup = (a) => {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) (o[i] = a[i]), (o[i + 1] = a[i + 2]), (o[i + 2] = -a[i + 1]);
  return o;
};

/** Similarity (s, R, t) with dst ~ s R src + t (Umeyama), from paired points. */
function umeyama(src, dst) {
  const n = src.length;
  const ms = [0, 0, 0], md = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) (ms[k] += src[i][k] / n), (md[k] += dst[i][k] / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let vs = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i].map((v, k) => v - ms[k]);
    const b = dst[i].map((v, k) => v - md[k]);
    vs += (a[0] ** 2 + a[1] ** 2 + a[2] ** 2) / n;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += (b[r] * a[c]) / n;
  }
  // Polar decomposition by iteration (C = R S): R = lim (R + R^-T)/2
  let R = C.map((r) => r.slice());
  for (let it = 0; it < 60; it++) {
    const inv = inv3(R);
    const iT = [[inv[0][0], inv[1][0], inv[2][0]], [inv[0][1], inv[1][1], inv[2][1]], [inv[0][2], inv[1][2], inv[2][2]]];
    R = R.map((r, i) => r.map((v, j) => (v + iT[i][j]) / 2));
  }
  // trace(R^T C) / var
  let tr = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += R[r][c] * C[r][c];
  const s = tr / vs;
  const t = [0, 1, 2].map((k) => md[k] - s * (R[k][0] * ms[0] + R[k][1] * ms[1] + R[k][2] * ms[2]));
  return { s, R, t };
}
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const apply = (T, p) => [0, 1, 2].map((k) => T.s * (T.R[k][0] * p[0] + T.R[k][1] * p[1] + T.R[k][2] * p[2]) + T.t[k]);
const rot = (T, d) => [0, 1, 2].map((k) => T.s * (T.R[k][0] * d[0] + T.R[k][1] * d[1] + T.R[k][2] * d[2]));

/** Uniform grid over points for nearest queries. */
function grid(pts, cell) {
  const m = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  pts.forEach((p, i) => {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(i);
  });
  return {
    near(p, r = 1) {
      const out = [];
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
        const a = m.get(key(cx + x, cy + y, cz + z));
        if (a) out.push(...a);
      }
      return out;
    },
  };
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function nearest(g, pts, p) {
  for (let r = 1; r < 6; r++) {
    const c = g.near(p, r);
    if (!c.length) continue;
    let best = -1, bd = Infinity;
    for (const i of c) {
      const d = d2(pts[i], p);
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  }
  return -1;
}
/** Closest point on triangle abc to p: barycentrics. */
function closestBary(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2_ = dot(ac, ap);
  if (d1 <= 0 && d2_ <= 0) return [1, 0, 0];
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2_;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2_ - d1 * d6;
  if (vb <= 0 && d2_ >= 0 && d6 <= 0) { const w = d2_ / (d2_ - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return [1 - v - w, v, w];
}

const COLS = 4;
const out = { m: null, f: null };
/** MakeHuman CC0 hair meshes fitted to each base body (build_identities.py), in the body's model space. */
const hairParts = [];
for (const sex of ['m', 'f']) {
  const dir = path.join(ID, sex);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const ids = meta.identities.map((i) => i.id);
  const B = {};
  for (const g of ['body', 'eyes', 'brows', 'lashes']) {
    const a = yup(f32(path.join(dir, `${g}_base.bin`)));
    B[g] = { pts: Array.from({ length: a.length / 3 }, (_, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]), d: {} };
    for (const id of ids) {
      const p = path.join(dir, `${g}_${id}.bin`);
      B[g].d[id] = fs.existsSync(p) ? yup(f32(p)) : null;
    }
  }
  const hw = f32(path.join(dir, 'body_headw.bin'));
  const tris = u32(path.join(dir, 'body_tris.bin'));

  const file = path.join(here, 'base', `human_${sex}_mpfb.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const prims = {};
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial()?.getName() ?? '';
      const g = n.getName() === 'body' ? 'body' : /^eyes/.test(mat) ? 'eyes' : /^lashes/.test(mat) ? 'lashes' : /^brows/.test(mat) ? 'brows' : null;
      if (g) prims[g] = { p, mesh, node: n };
    }
  }
  const get = (g) => {
    const a = prims[g].p.getAttribute('POSITION');
    return Array.from({ length: a.getCount() }, (_, i) => a.getElement(i, [0, 0, 0]));
  };
  // ── alignment on the eyes + lashes ──
  const src = [], dst = [];
  for (const g of ['eyes', 'lashes']) {
    const P = get(g);
    const S = B[g].pts;
    const mp = P.reduce((a, p) => a.map((v, k) => v + p[k] / P.length), [0, 0, 0]);
    const ms = S.reduce((a, p) => a.map((v, k) => v + p[k] / S.length), [0, 0, 0]);
    const off = mp.map((v, k) => v - ms[k]);
    const gS = grid(S.map((p) => p.map((v, k) => v + off[k])), 0.01);
    const Sh = S.map((p) => p.map((v, k) => v + off[k]));
    for (const p of P) {
      const i = nearest(gS, Sh, p);
      if (i >= 0) (src.push(S[i]), dst.push(p));
    }
  }
  let T = umeyama(src, dst);
  // one refinement pass with the fitted transform's matches
  {
    const s2 = [], d2_ = [];
    for (const g of ['eyes', 'lashes']) {
      const P = get(g);
      const Sh = B[g].pts.map((p) => apply(T, p));
      const gS = grid(Sh, 0.01);
      for (const p of P) {
        const i = nearest(gS, Sh, p);
        if (i >= 0) (s2.push(B[g].pts[i]), d2_.push(p));
      }
    }
    T = umeyama(s2, d2_);
    let err = 0;
    for (let i = 0; i < s2.length; i++) err = Math.max(err, Math.sqrt(d2(apply(T, s2[i]), d2_[i])));
    console.log(sex, 'align scale', T.s.toFixed(4), 'max err (mm)', (err * 1000).toFixed(2), 'pairs', s2.length);
  }
  // ── asset hair: into the shipped body's space; corners welded by (vertex, uv); normals half radial ──
  const hd = path.join(ID, 'hair');
  const lmk = meta.landmarks;
  const headC = apply(T, [lmk.mid[0], lmk.mid[2], -lmk.mid[1]].map((v, k) => v + [0, 0.01, -0.07][k]));
  // Only what the creator offers each body: the women's styles on hers, the short ones on his (+ unisex).
  const OFFER = { m: /^(short0[1-4]|afro01)$/, f: /^(?!short0[124]$|braid01$)/ };
  // (+ an identity's own hair cut out of its image-to-3D head: ai3d_hair.py, ident/hair/<sex>_ai_*.json)
  const own = fs.existsSync(hd) ? fs.readdirSync(hd).filter((f) => f.startsWith(`${sex}_ai_`) && f.endsWith('.json')).map((f) => f.slice(sex.length + 1, -5)) : [];
  for (const name of [...(meta.hair ?? []).filter((n) => OFFER[sex].test(n)), ...own]) {
    const info = JSON.parse(fs.readFileSync(path.join(hd, `${sex}_${name}.json`), 'utf8'));
    const P = yup(f32(path.join(hd, `${sex}_${name}_pos.bin`)));
    const I = u32(path.join(hd, `${sex}_${name}_idx.bin`));
    const UV = f32(path.join(hd, `${sex}_${name}_uv.bin`));
    const Pt = Array.from({ length: P.length / 3 }, (_, i) => apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
    const fn = Pt.map(() => [0, 0, 0]);
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [Pt[I[t]], Pt[I[t + 1]], Pt[I[t + 2]]];
      const u = b.map((v, k) => v - a[k]), w = c.map((v, k) => v - a[k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const vi of [I[t], I[t + 1], I[t + 2]]) for (let k = 0; k < 3; k++) fn[vi][k] += n[k];
    }
    const key = new Map();
    const pos = [], nrm = [], uv = [], idx = [];
    for (let c = 0; c < I.length; c++) {
      const vi = I[c];
      const u = UV[c * 2], v = 1 - UV[c * 2 + 1];
      const k = `${vi}|${u.toFixed(5)}|${v.toFixed(5)}`;
      let o = key.get(k);
      if (o === undefined) {
        o = pos.length / 3;
        key.set(k, o);
        const p = Pt[vi];
        pos.push(...p);
        const r = p.map((x, q) => x - headC[q]);
        const rl = Math.hypot(...r) || 1;
        let g = fn[vi];
        const gl = Math.hypot(...g) || 1;
        g = g.map((x) => x / gl);
        if (g[0] * r[0] + g[1] * r[1] + g[2] * r[2] < 0) g = g.map((x) => -x);
        const n = g.map((x, q) => x * 0.4 + (r[q] / rl) * 0.6);
        const nl = Math.hypot(...n) || 1;
        nrm.push(...n.map((x) => x / nl));
        uv.push(u, v);
      }
      idx.push(o);
    }
    hairParts.push({ sex, name, tex: info.texture, pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) });
  }
  // ── per group: shipped vertex -> deltas ──
  const deltas = {};
  for (const g of ['eyes', 'brows', 'lashes']) {
    const P = get(g);
    const Sh = B[g].pts.map((p) => apply(T, p));
    const gS = grid(Sh, 0.01);
    const map = P.map((p) => nearest(gS, Sh, p));
    deltas[g] = {};
    for (const id of ids) {
      const D = B[g].d[id];
      const o = new Float32Array(P.length * 3);
      if (D) map.forEach((i, v) => { if (i >= 0) o.set(rot(T, [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]]), v * 3); });
      deltas[g][id] = o;
    }
  }
  {
    // Body: the full-res head's triangles (those with any head weight) in the shipped space.
    const Sh = B.body.pts.map((p) => apply(T, p));
    const tl = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      if (a >= 13380 || b >= 13380 || c >= 13380) continue;
      if (hw[a] + hw[b] + hw[c] <= 0) continue;
      tl.push([a, b, c]);
    }
    const cent = tl.map(([a, b, c]) => [0, 1, 2].map((k) => (Sh[a][k] + Sh[b][k] + Sh[c][k]) / 3));
    const gT = grid(cent, 0.01);
    const tn = tl.map(([a, b, c]) => {
      const u = Sh[b].map((v, k) => v - Sh[a][k]), w = Sh[c].map((v, k) => v - Sh[a][k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      return n.map((v) => v / l);
    });
    const pr = prims.body.p;
    const P = get('body');
    const Nrm = pr.getAttribute('NORMAL');
    const ymin = Math.min(...Sh.filter((_, i) => hw[i] > 0).map((p) => p[1])) - 0.02;
    deltas.body = Object.fromEntries(ids.map((id) => [id, new Float32Array(P.length * 3)]));
    let n = 0, far = 0;
    P.forEach((p, v) => {
      if (p[1] < ymin) return;
      const nv = Nrm ? Nrm.getElement(v, [0, 0, 0]) : null;
      let best = null, bd = Infinity;
      for (const ti of gT.near(p, 2)) {
        if (nv && tn[ti][0] * nv[0] + tn[ti][1] * nv[1] + tn[ti][2] * nv[2] < 0.2) continue;
        const [a, b, c] = tl[ti];
        const w = closestBary(p, Sh[a], Sh[b], Sh[c]);
        const q = [0, 1, 2].map((k) => w[0] * Sh[a][k] + w[1] * Sh[b][k] + w[2] * Sh[c][k]);
        const dd = d2(q, p);
        if (dd < bd) (bd = dd), (best = [a, b, c, w]);
      }
      if (!best) return;
      if (bd > 0.012 ** 2) far++;
      n++;
      const [a, b, c, w] = best;
      for (const id of ids) {
        const D = B.body.d[id];
        const dl = [0, 1, 2].map((k) => w[0] * D[a * 3 + k] + w[1] * D[b * 3 + k] + w[2] * D[c * 3 + k]);
        deltas.body[id].set(rot(T, dl), v * 3);
      }
    });
    console.log(sex, 'body verts mapped', n, 'farther than 12 mm', far);
  }
  // ── morph targets ──
  for (const g of ['body', 'eyes', 'brows', 'lashes']) {
    const { p, mesh } = prims[g];
    for (const t of p.listTargets()) p.removeTarget(t);
    for (const id of ids) {
      const acc = doc.createAccessor(`${g}_${id}`).setType('VEC3').setArray(deltas[g][id]).setSparse(true).setBuffer(root.listBuffers()[0]);
      p.addTarget(doc.createPrimitiveTarget(id).setAttribute('POSITION', acc));
    }
    mesh.setExtras({ ...(mesh.getExtras() ?? {}), targetNames: ids });
    if (!mesh.getWeights().length || mesh.getWeights().length !== ids.length) mesh.setWeights(ids.map(() => 0));
    let mx = 0;
    for (const id of ids) for (const v of deltas[g][id]) mx = Math.max(mx, Math.abs(v));
    console.log(sex, g, 'targets', ids.length, 'max |d| mm', (mx * 1000).toFixed(1));
  }
  // The brows mesh holds brows + lashes: every primitive of a mesh needs the same targets (done above for both).
  await io.write(path.join(here, 'base', `human_${sex}_mpfb_id.glb`), doc);

  // ── atlases ──
  const [TW, TH] = meta.tile;
  const rows = Math.ceil(ids.length / COLS);
  const face = Buffer.alloc(TW * COLS * TH * rows * 4, 128);
  ids.forEach((id, k) => {
    const t = fs.readFileSync(path.join(dir, `skin_${id}.bin`));
    const ox = (k % COLS) * TW, oy = Math.floor(k / COLS) * TH;
    for (let y = 0; y < TH; y++) t.copy(face, ((oy + y) * TW * COLS + ox) * 4, y * TW * 4, (y + 1) * TW * 4);
  });
  await sharp(face, { raw: { width: TW * COLS, height: TH * rows, channels: 4 } }).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(TEX_OUT, `face_${sex}.webp`));
  const ES = 256;
  const eyes = await sharp({ create: { width: ES * COLS, height: ES * rows, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(await Promise.all(ids.map(async (id, k) => ({ input: await sharp(path.join(dir, `eyes_${id}.png`)).resize(ES, ES).toBuffer(), left: (k % COLS) * ES, top: Math.floor(k / COLS) * ES }))))
    .webp({ quality: 88 })
    .toBuffer();
  fs.writeFileSync(path.join(TEX_OUT, `eyes_${sex}.webp`), eyes);
  // Brows: each identity's card texture resampled into the shipped brow mesh's UVs (the brow assets share topology,
  // not UVs): per triangle, an affine map from the base asset's UVs to the identity asset's.
  const buv = JSON.parse(fs.readFileSync(path.join(dir, 'brow_uv.json'), 'utf8'));
  const BS = 256;
  const brow = Buffer.alloc(BS * COLS * BS * rows * 4, 0);
  for (const [k, id] of ids.entries()) {
    const img = await sharp(path.join(dir, `brow_${id}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = img.info.width, H = img.info.height;
    const sample = (u, v) => {
      const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor((1 - v) * H)));
      const o = (y * W + x) * 4;
      return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
    };
    const base = buv.base, me = buv[id];
    const ox = (k % COLS) * BS, oy = Math.floor(k / COLS) * BS;
    for (let f = 0; f < base.uv.length; f++) {
      const A = base.uv[f], C = me.uv[f];
      for (let t = 1; t < A.length - 1; t++) {
        const tri = [0, t, t + 1];
        const a = tri.map((i) => A[i]), c = tri.map((i) => C[i]);
        const xs = a.map((q) => q[0] * BS), ys = a.map((q) => (1 - q[1]) * BS);
        const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
        if (Math.abs(den) < 1e-9) continue;
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(BS - 1, Math.ceil(Math.max(...ys))); y++)
          for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(BS - 1, Math.ceil(Math.max(...xs))); x++) {
            const px = x + 0.5, py = y + 0.5;
            const l0 = ((ys[1] - ys[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (py - ys[2])) / den;
            const l1 = ((ys[2] - ys[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (py - ys[2])) / den;
            const l2 = 1 - l0 - l1;
            if (l0 < -0.05 || l1 < -0.05 || l2 < -0.05) continue;
            const u = l0 * c[0][0] + l1 * c[1][0] + l2 * c[2][0], v = l0 * c[0][1] + l1 * c[1][1] + l2 * c[2][1];
            const s = sample(u, v);
            const o = ((oy + y) * BS * COLS + ox + x) * 4;
            for (let q = 0; q < 4; q++) brow[o + q] = s[q];
          }
      }
    }
  }
  await sharp(brow, { raw: { width: BS * COLS, height: BS * rows, channels: 4 } }).webp({ quality: 90, alphaQuality: 95 }).toFile(path.join(TEX_OUT, `brows_${sex}.webp`));
  out[sex] = {
    ids: meta.identities.map((i) => ({ id: i.id, label: i.label, desc: i.desc, age: i.age, race: i.race, ...(i.tint ? { tint: i.tint } : {}) })),
    cols: COLS,
    rows,
    faceRect: meta.rect_gltf,
  };
  for (const f of [`face_${sex}.webp`, `eyes_${sex}.webp`, `brows_${sex}.webp`]) console.log('  ', f, (fs.statSync(path.join(TEX_OUT, f)).size / 1024).toFixed(0), 'KB');
}

// ── asset hair GLB: apps/web/public/models/hair_mh.glb (one node per sex + style, `${sex}_${name}`) ──
if (hairParts.length) {
  const { Document } = await import('@gltf-transform/core');
  const { quantize, meshopt, reorder } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready;
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('hair');
  const mats = new Map();
  for (const h of hairParts) {
    let mat = mats.get(h.name);
    if (!mat) {
      // The texture as grey strands on alpha (the game tints it): luminance normalised to a mean of ~0.7 where opaque.
      // (1024 for the long women's styles, whose strands read up close; 512 for the short ones)
      const R = /^(bob|long|ponytail|braid)/.test(h.name) ? 768 : 512;
      const img = await sharp(h.tex).ensureAlpha().resize(R, R, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      const d = img.data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) (sum += (d[i] + d[i + 1] + d[i + 2]) / 3), n++;
      const k = (0.7 * 255) / Math.max(1, sum / Math.max(1, n));
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.min(255, ((d[i] + d[i + 1] + d[i + 2]) / 3) * k);
        d[i] = d[i + 1] = d[i + 2] = l;
      }
      const webp = await sharp(d, { raw: { width: R, height: R, channels: 4 } }).webp({ quality: 72, alphaQuality: 80 }).toBuffer();
      const tex = doc.createTexture(h.name).setImage(new Uint8Array(webp)).setMimeType('image/webp');
      mat = doc.createMaterial(`mhhair_${h.name}`).setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true).setRoughnessFactor(0.6).setMetallicFactor(0);
      mats.set(h.name, mat);
    }
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(h.pos).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(h.nrm).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(h.uv).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(h.idx).setBuffer(buf))
      .setMaterial(mat);
    const mesh = doc.createMesh(`${h.sex}_${h.name}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`${h.sex}_${h.name}`).setMesh(mesh));
  }
  // (positions stay float: the game re-skins them into the body's bind space by the head bone)
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const wio = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const file = path.join(ROOT, 'apps/web/public/models/hair_mh.glb');
  await wio.write(file, doc);
  console.log('hair_mh.glb', hairParts.length, 'meshes', (fs.statSync(file).size / 1024).toFixed(0), 'KB');
}

const ts = `// Generated by tools/assets/mpfb-pilot/add_identities.mjs -- do not edit. Face identities on the MPFB bodies:
// morph targets named by id in human_{m,f}.glb, face / eye / brow atlases in public/textures/ident/.
export interface IdentityInfo { id: string; label: string; desc: string; age: number; race: number[]; /** The skin's hue (linear multipliers on the tone, the whole body): ai3d_fit.py. */ tint?: number[] }
export interface IdentitySet { ids: IdentityInfo[]; cols: number; rows: number; faceRect: [number, number, number, number] }
export const IDENTITY_DATA: Record<'m' | 'f', IdentitySet | null> = ${JSON.stringify(out, null, 1)};
`;
fs.writeFileSync(path.join(ROOT, 'apps/web/src/render/identityData.ts'), ts);
console.log('identityData.ts written');
