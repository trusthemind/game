// Put the MPFB base bodies (build_base.py output, already T-posed to our bone directions) on OUR skeleton contract:
// our joint names (root, Head), every joint's rest rotation exactly as in apps/web/public/models/human_{m,f}.glb (so
// our rotation-only clips drive it the same way), joint positions from the MPFB body, scaled so the Head joint is at
// our height (1.60 m male, 1.55 m female). Inverse binds are rebuilt for the new rest, so the mesh doesn't move.
//   node fix_skeleton.mjs [dir]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? path.join(here, 'base'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const RENAME = { Root: 'root', head: 'Head' };

// Minimal column-major 4x4 / quaternion helpers.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const trs = (t, q) => {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    t[0], t[1], t[2], 1,
  ];
};
const invRigid = (t, q) => {
  const qi = qinv(q);
  const ti = qrot(qi, t).map((v) => -v);
  return trs(ti, qi);
};

for (const sex of ['m', 'f']) {
  const ours = await io.read(path.join(here, `../../../apps/web/public/models/human_${sex}.glb`));
  const ourRot = new Map(ours.getRoot().listSkins()[0].listJoints().map((j) => [j.getName(), j.getRotation()]));
  const file = path.join(dir, `human_${sex}_mpfb.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const skins = root.listSkins();
  const joints = skins[0].listJoints();
  for (const j of joints) j.setName(RENAME[j.getName()] ?? j.getName());
  const missing = [...ourRot.keys()].filter((n) => !joints.some((j) => j.getName() === n));
  const extra = joints.filter((j) => !ourRot.has(j.getName())).map((j) => j.getName());
  const world = new Map(joints.map((j) => [j, j.getWorldTranslation()]));
  const head = world.get(joints.find((j) => j.getName() === 'Head'));
  const k = (sex === 'm' ? 1.6 : 1.55) / head[1];
  // Parents first.
  const parent = new Map();
  for (const j of joints) for (const c of j.listChildren()) parent.set(c, j);
  const order = [];
  const visit = (j) => {
    order.push(j);
    for (const c of j.listChildren()) if (joints.includes(c)) visit(c);
  };
  joints.filter((j) => !parent.has(j)).forEach(visit);
  const wq = new Map();
  const wp = new Map();
  for (const j of order) {
    const p = parent.get(j);
    const q = ourRot.get(j.getName()) ?? j.getRotation();
    const pos = world.get(j).map((v) => v * k);
    const pq = p ? wq.get(p) : [0, 0, 0, 1];
    const pp = p ? wp.get(p) : [0, 0, 0];
    j.setRotation(q).setScale([1, 1, 1]).setTranslation(qrot(qinv(pq), sub(pos, pp)));
    wq.set(j, qmul(pq, q));
    wp.set(j, pos);
  }
  for (const skin of skins) {
    const js = skin.listJoints();
    const acc = skin.getInverseBindMatrices();
    const arr = new Float32Array(js.length * 16);
    js.forEach((j, i) => arr.set(invRigid(wp.get(j), wq.get(j)), i * 16));
    acc.setArray(arr);
  }
  const done = new Set();
  for (const m of root.listMeshes())
    for (const prim of m.listPrimitives()) {
      const a = prim.getAttribute('POSITION');
      if (done.has(a)) continue;
      done.add(a);
      const v = a.getArray().slice();
      for (let i = 0; i < v.length; i++) v[i] *= k;
      a.setArray(v);
    }
  await io.write(file, doc);
  console.log(sex, { scale: +k.toFixed(4), missing, extra, joints: joints.length });
}
