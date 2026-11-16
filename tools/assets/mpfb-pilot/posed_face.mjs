// Face pitch in a clip's pose (frame 0): the angle of eye-front -> subnasale from vertical (+ = nose base ahead of
// the eyes, i.e. the face tipped down) at rest and posed.   node posed_face.mjs <clip.glb> <clip> <body.glb> [...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { loadGroups } from './measure_face.mjs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [clipFile, clipName, ...bodies] = process.argv.slice(2);
const anim = (await io.read(clipFile)).getRoot().listAnimations().find((a) => a.getName() === clipName);
const pose = {};
for (const ch of anim.listChannels()) if (ch.getTargetPath() === 'rotation') pose[ch.getTargetNode().getName()] = ch.getSampler().getOutput().getElement(0, []);
for (const f of bodies) {
  const res = [];
  for (const P of [null, pose]) {
    const G = await loadGroups(f, P);
    // eye front: the eyes' front-most points; nose base: the face's front-most body point 4-6 cm below them
    const eyes = G.eyes; const ez = Math.max(...eyes.map((p) => p[2])); const e = eyes.filter((p) => p[2] > ez - 0.003);
    const E = [0, e.reduce((a, p) => a + p[1], 0) / e.length, ez];
    const chin = G.body.flat().filter((p) => Math.abs(p[0]) < 0.004 && p[1] < E[1] - 0.09 && p[1] > E[1] - 0.13);
    const pog = chin.reduce((a, p) => (p[2] > a[2] ? p : a));
    const brow = G.body.flat().filter((p) => Math.abs(p[0]) < 0.004 && p[1] > E[1] + 0.01 && p[1] < E[1] + 0.04).reduce((a, p) => (p[2] > a[2] ? p : a));
    res.push(+(Math.atan2(brow[2] - pog[2], brow[1] - pog[1]) * 180 / Math.PI).toFixed(1));
  }
  console.log(f.split('/').slice(-2).join('/'), 'brow->chin lean (deg, + = chin tucked): rest', res[0], 'posed', res[1]);
}
