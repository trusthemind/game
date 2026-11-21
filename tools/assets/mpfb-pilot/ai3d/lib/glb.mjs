// glTF helpers shared by the ai3d tools (ai3d.mjs, ai_body_dump.mjs, ai_body_target.mjs, the gates): the NodeIO with
// meshopt, world-space primitives, the raw-array dumps the Blender scripts read, bounds, an .npz/.npy reader.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

await MeshoptDecoder.ready;
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

export function worldPrims(doc) {
  const out = [];
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    const M = n.getWorldMatrix();
    for (const p of m.listPrimitives()) out.push({ node: n.getName(), mesh: m.getName(), p, M });
  }
  return out;
}

export const xf = (M, a) => {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    o[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    o[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    o[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  }
  return o;
};

export function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], pos[i + k])), (hi[k] = Math.max(hi[k], pos[i + k]));
  return [lo, hi];
}

/** Our shipped MPFB body (base/human_<sex>_mpfb_id.glb) as raw arrays for ai_body_fit.py (was ai_body_dump.mjs). */
export async function dumpBody(baseGlb, out) {
  const doc = await io.read(baseGlb);
  const root = doc.getRoot();
  fs.mkdirSync(out, { recursive: true });
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const meta = { joints: joints.map((j) => j.getName()), parents: [], meshes: {} };
  const par = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) par.set(c, n);
  meta.parents = joints.map((j) => joints.indexOf(par.get(j)));
  const W = new Float32Array(joints.length * 16);
  joints.forEach((j, i) => W.set(j.getWorldMatrix(), i * 16)); // column-major
  fs.writeFileSync(path.join(out, 'joints_world.bin'), Buffer.from(W.buffer));
  const ibm = skin.getInverseBindMatrices().getArray();
  fs.writeFileSync(path.join(out, 'ibm.bin'), Buffer.from(new Float32Array(ibm).buffer));
  for (const n of root.listNodes()) {
    const m = n.getMesh();
    if (!m || !['body', 'underwear', 'anatomy'].includes(n.getName())) continue;
    const p = m.listPrimitives()[0];
    const w = (name, arr, T = Float32Array) => fs.writeFileSync(path.join(out, `${n.getName()}_${name}.bin`), Buffer.from(new T(arr).buffer));
    w('pos', p.getAttribute('POSITION').getArray());
    w('nrm', p.getAttribute('NORMAL').getArray());
    if (p.getAttribute('TEXCOORD_0')) w('uv', p.getAttribute('TEXCOORD_0').getArray());
    w('idx', p.getIndices().getArray(), Uint32Array);
    w('joints', p.getAttribute('JOINTS_0').getArray(), Uint16Array);
    w('weights', p.getAttribute('WEIGHTS_0').getArray());
    meta.meshes[n.getName()] = { verts: p.getAttribute('POSITION').getCount(), tris: p.getIndices().getCount() / 3 };
    if (n.getName() === 'body') {
      const tex = p.getMaterial().getBaseColorTexture();
      fs.writeFileSync(path.join(out, 'albedo.webp'), tex.getImage());
      meta.targets = p.listTargets().map((t) => t.getName());
    }
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta));
  return { meta, joints: joints.length };
}

/** The AI 3D body mesh (one primitive) as raw arrays + albedo + target.json for ai_body_fit.py (was ai_body_target.mjs). */
export async function dumpTarget(glb, out) {
  fs.mkdirSync(out, { recursive: true });
  const doc = await io.read(glb);
  const prims = worldPrims(doc);
  if (prims.length !== 1) throw new Error(`${glb}: ${prims.length} primitives (expected 1)`);
  const { p, M } = prims[0];
  const pos = xf(M, p.getAttribute('POSITION').getArray());
  fs.writeFileSync(path.join(out, 'target_pos.bin'), Buffer.from(pos.buffer));
  fs.writeFileSync(path.join(out, 'target_idx.bin'), Buffer.from(new Uint32Array(p.getIndices().getArray()).buffer));
  fs.writeFileSync(path.join(out, 'target_uv.bin'), Buffer.from(new Float32Array(p.getAttribute('TEXCOORD_0').getArray()).buffer));
  const mat = p.getMaterial();
  const tex = mat.getBaseColorTexture();
  const ext = tex.getMimeType() === 'image/png' ? 'png' : tex.getMimeType() === 'image/webp' ? 'webp' : 'jpg';
  fs.writeFileSync(path.join(out, `target_albedo.${ext}`), tex.getImage());
  const info = { file: path.basename(glb), verts: pos.length / 3, tris: p.getIndices().getCount() / 3, albedo: `target_albedo.${ext}`, size: tex.getSize(), factor: mat.getBaseColorFactor(),
    other: { normal: !!mat.getNormalTexture(), mr: !!mat.getMetallicRoughnessTexture() } };
  info.bounds = bounds(pos);
  fs.writeFileSync(path.join(out, 'target.json'), JSON.stringify(info));
  return info;
}

/** SAM 3D Body: one person of a parametric pair (proportion cross-check), written as sam_{pos,idx}.bin. */
export async function dumpSam(glb, nodeName, out) {
  const doc = await io.read(glb);
  for (const pr of worldPrims(doc)) {
    if (pr.node !== nodeName) continue;
    const pos = xf(pr.M, pr.p.getAttribute('POSITION').getArray());
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < pos.length; i += 3) (lo = Math.min(lo, pos[i])), (hi = Math.max(hi, pos[i]));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'sam_pos.bin'), Buffer.from(pos.buffer));
    fs.writeFileSync(path.join(out, 'sam_idx.bin'), Buffer.from(new Uint32Array(pr.p.getIndices().getArray()).buffer));
    return { node: pr.node, mesh: pr.mesh, verts: pos.length / 3, y: [lo, hi] };
  }
  throw new Error(`${glb}: node ${nodeName} not found`);
}

/** Positions of every mesh primitive of a GLB in world space (any orientation), for orientation / scale detection. */
export async function allWorldPositions(glb) {
  const doc = await io.read(glb);
  const parts = worldPrims(doc).map(({ p, M }) => xf(M, p.getAttribute('POSITION').getArray()));
  const n = parts.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const a of parts) (out.set(a, o), (o += a.length));
  return out;
}

// ── .npy / .npz (numpy) reader: stored and deflated members ──
function parseNpy(b) {
  const major = b[6];
  const hl = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const off = (major === 1 ? 10 : 12) + hl;
  const hdr = b.subarray(major === 1 ? 10 : 12, off).toString('latin1');
  const descr = /'descr':\s*'([^']+)'/.exec(hdr)[1];
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(hdr)[1].split(',').map((s) => s.trim()).filter(Boolean)).map(Number);
  const T = { '<f4': Float32Array, '<f8': Float64Array, '<i4': Int32Array, '<i8': BigInt64Array, '|u1': Uint8Array, '<u2': Uint16Array, '|b1': Uint8Array, '<u4': Uint32Array }[descr];
  if (!T) throw new Error('npy dtype ' + descr);
  const data = new T(b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length));
  return { shape, data: descr === '<i8' ? Array.from(data, Number) : data };
}
export function readNpy(file) {
  return parseNpy(fs.readFileSync(file));
}
export function readNpz(file) {
  const b = fs.readFileSync(file);
  const out = {};
  let eocd = b.length - 22;
  while (b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString().replace(/\.npy$/, '');
    const lnl = b.readUInt16LE(lo + 26), lel = b.readUInt16LE(lo + 28);
    const raw = b.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + csize);
    out[name] = parseNpy(method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nl + el + cl;
  }
  return out;
}
