// Head / spine pitch of a body GLB in a clip's pose (frame 0) vs its rest: how far the clip tips the face down.
//   node posecheck.mjs <clip.glb> <clipName> <body.glb> [...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const p = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]); return p.slice(0, 3); };
const [clipFile, clipName, ...bodies] = process.argv.slice(2);
const cdoc = await io.read(clipFile);
const anim = cdoc.getRoot().listAnimations().find((a) => a.getName() === clipName);
const rot = {};
for (const ch of anim.listChannels()) if (ch.getTargetPath() === 'rotation') rot[ch.getTargetNode().getName()] = ch.getSampler().getOutput().getElement(0, []);
for (const f of bodies) {
  const doc = await io.read(f);
  const joints = doc.getRoot().listSkins()[0].listJoints();
  const world = (j, pose) => { let q = [0, 0, 0, 1]; const chain = []; for (let n = j; n; n = n.getParentNode?.() ?? null) { chain.unshift(n); } for (const n of chain) q = qmul(q, pose && rot[n.getName()] ? rot[n.getName()] : n.getRotation()); return q; };
  // getParentNode isn't on Node: build parent map
  const parent = new Map();
  for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const W = (j, pose) => { const chain = []; for (let n = j; n; n = parent.get(n)) chain.unshift(n); let q = [0, 0, 0, 1]; for (const n of chain) q = qmul(q, pose && rot[n.getName()] ? rot[n.getName()] : n.getRotation()); return q; };
  const out = {};
  for (const name of ['pelvis', 'spine_03', 'neck_01', 'Head']) {
    const j = joints.find((x) => x.getName() === name);
    const qr = W(j, false), qp = W(j, true);
    const d = qmul(qp, [-qr[0], -qr[1], -qr[2], qr[3]]);
    const fwd = qrot(d, [0, 0, 1]);
    out[name] = +(Math.atan2(-fwd[1], fwd[2]) * 180 / Math.PI).toFixed(1); // + = tipped down
  }
  console.log(f.split('/').slice(-2).join('/'), 'pitch down (deg):', JSON.stringify(out));
}
