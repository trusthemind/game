// Dump skeleton / polycount / materials of a GLB (pilot helper).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready; io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const out = {};
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  const skin = r.listSkins()[0];
  const joints = skin ? skin.listJoints() : [];
  const names = joints.map((j) => j.getName());
  const parent = {}; for (const j of joints) for (const c of j.listChildren()) parent[c.getName()] = j.getName();
  const wpos = (n) => n.getWorldTranslation();
  const pos = Object.fromEntries(joints.map((j) => [j.getName(), wpos(j).map((v) => +v.toFixed(3))]));
  let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  let ymin = 1e9, ymax = -1e9;
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); ymin = Math.min(ymin, a.getMin([])[1]); ymax = Math.max(ymax, a.getMax([])[1]); }
  out[f] = { joints: names.length, names, parent, pos, tris, meshes: r.listMeshes().map((m) => m.getName()), height: +(ymax - ymin).toFixed(3),
    materials: r.listMaterials().map((m) => ({ n: m.getName(), base: !!m.getBaseColorTexture(), normal: !!m.getNormalTexture(), mr: !!m.getMetallicRoughnessTexture() })),
    morphs: r.listMeshes().map((m) => m.listPrimitives()[0].listTargets().length) };
}
console.log(JSON.stringify(out));
