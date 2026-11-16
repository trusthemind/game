// The game's actual figures: the base body shaped by every SHAPE_PRESETS build and by N random builds
// (randomHumanShape, as Randomize does), through the game's own field (apps/web/src/render/bodyShape.ts, via Vite),
// measured like measure_body.mjs and placed against ANSUR II's 5th / 50th / 95th percentiles (refs/body_targets.json).
//   node measure_shapes.mjs <human_x.glb> <m|f> [--random=N] [--obj=<dir>]   (--obj: the shaped meshes as OBJ, T-pose)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { load, measureData } from './measure_body.mjs';
import { loadGroups } from './measure_face.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const [file, sex] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const N = +(process.argv.find((a) => a.startsWith('--random='))?.slice(9) ?? 0);
const objDir = process.argv.find((a) => a.startsWith('--obj='))?.slice(6);
const T = JSON.parse(fs.readFileSync(path.join(here, 'refs/body_targets.json'), 'utf8'))[sex];
const vite = await createServer({ root: path.join(ROOT, 'apps/web'), configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { ShapeField } = await vite.ssrLoadModule('/src/render/bodyShape.ts');
const eng = await vite.ssrLoadModule('@ashfall/engine');
const THREE = await vite.ssrLoadModule('three');
const base = await load(file);
const J = base.joints;
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const marks = {
  pelvis: V(J.pelvis), s1: V(J.spine_01), s2: V(J.spine_02), s3: V(J.spine_03), neck: V(J.neck_01),
  ua: [V(J.upperarm_l), V(J.upperarm_r)], la: [V(J.lowerarm_l), V(J.lowerarm_r)], hand: [V(J.hand_l), V(J.hand_r)],
  thigh: [V(J.thigh_l), V(J.thigh_r)], calf: [V(J.calf_l), V(J.calf_r)], foot: [V(J.foot_l), V(J.foot_r)], eye: null,
};
// The eye mark as character.ts eyeMark() (the face field, and the old bodies' head fix, hang on it); MPFB: eyeX too.
{
  const eyes = (await loadGroups(file)).eyes;
  const m = eyes.reduce((s, p) => s.map((v, i) => v + p[i] / eyes.length), [0, 0, 0]);
  marks.eye = V([m[0], m[1], Math.max(...eyes.map((p) => p[2]))]);
  if (!/_ubc/.test(file)) marks.eyeX = eyes.reduce((s, p) => s + Math.abs(p[0] - m[0]), 0) / eyes.length;
}
const uniq = [...new Set(base.tris.flat())];
const idx = new Map(uniq.map((p, i) => [p, i]));
function shaped(shape) {
  const f = new ShapeField(marks, shape, sex, null);
  const d = new THREE.Vector3();
  const k = f.k;
  const P = uniq.map((p) => { f.at(V(p), d); return [(p[0] + d.x) * k, (p[1] + d.y) * k, (p[2] + d.z) * k]; });
  return { tris: base.tris.map((t) => t.map((p) => P[idx.get(p)])), joints: Object.fromEntries(Object.entries(J).map(([n, p]) => [n, p.map((v) => v * k)])) };
}
const builds = Object.entries(eng.SHAPE_PRESETS[sex]);
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
for (let i = 0; i < N; i++) builds.push([`rand${i}`, eng.randomHumanShape(sex, rnd)]);
// (chest: 3% S under ANSUR's chest height, the T-posed armpits otherwise cut into it; crotch left out: touching thighs fake it)
const KEYS = ['head_breadth', 'head_h', 'chest_circ', 'waist_circ', 'buttock_circ', 'hip_breadth', 'thigh_circ', 'calf_circ', 'neck_circ'];
const rows = {};
for (const [name, shape] of builds) {
  const data = shaped(shape);
  const r = await measureData(data, file, sex);
  r.chest_breadth = r.chest_breadth_lo;
  r.chest_circ = r.chest_circ_lo;
  rows[name] = r;
  if (objDir) {
    fs.mkdirSync(objDir, { recursive: true });
    const vs = new Map(), lines = [], fl = [];
    for (const t of data.tris) fl.push('f ' + t.map((p) => { if (!vs.has(p)) { vs.set(p, vs.size + 1); lines.push(`v ${p[0].toFixed(5)} ${p[1].toFixed(5)} ${p[2].toFixed(5)}`); } return vs.get(p); }).join(' '));
    fs.writeFileSync(path.join(objDir, `${sex}_${name}.obj`), lines.join('\n') + '\n' + fl.join('\n') + '\n');
  }
}
await vite.close();
// percentile of a value within ANSUR's 5/50/95 (piecewise linear: 5 -> 5, 50 -> 50, 95 -> 95)
const pc = (v, [a, m, b]) => (v <= m ? 5 + (45 * (v - a)) / (m - a) : 50 + (45 * (v - m)) / (b - m));
console.log('build'.padEnd(10) + KEYS.map((k) => k.replace('_circ', '').padStart(13)).join(''));
console.log('ANSUR 5/50/95'.padEnd(10) + KEYS.map((k) => (T.spread[k] ?? [T[k]]).map((v) => v.toFixed(3).slice(1)).join('/').padStart(13)).join(''));
const cell = (k, v) => (T.spread[k] ? `${v.toFixed(3)} p${Math.round(pc(v, T.spread[k]))}` : `${v.toFixed(3)} ${v > T[k] ? '+' : ''}${Math.round((v / T[k] - 1) * 100)}%`);
for (const [name, r] of Object.entries(rows)) console.log(name.padEnd(10) + KEYS.map((k) => cell(k, r[k]).padStart(13)).join(''));
if (process.argv.includes('--json')) fs.writeFileSync(path.join(here, `refs/shapes_${sex}.json`), JSON.stringify(rows, null, 1));
