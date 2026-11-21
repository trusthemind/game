// Arm taper of a T-posed body GLB (rest pose): tape girth (convex hull) of cuts across the left arm, from the deltoid
// to the wrist, and the deltoid / wrist ratio; plus waist / buttock (WHR) from measure_body.
//   node arm_taper.mjs <body.glb> [...]
import { load, measureData } from './measure_body.mjs';

const hull = (P) => {
  P = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return 0;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (hi.length >= 2 && cr(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
  const h = lo.slice(0, -1).concat(hi.slice(0, -1));
  let s = 0; for (let i = 0; i < h.length; i++) s += Math.hypot(h[i][0] - h[(i + 1) % h.length][0], h[i][1] - h[(i + 1) % h.length][1]);
  return s;
};
export async function armTaper(file, sex) {
  const data = await load(file);
  const { tris, joints } = data;
  const ua = joints.upperarm_l, hand = joints.hand_l;
  const prof = [];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const x = ua[0] + (hand[0] - ua[0]) * t, yc = ua[1] + (hand[1] - ua[1]) * t, zc = ua[2] + (hand[2] - ua[2]) * t;
    const pts = [];
    for (const tr of tris) for (let k = 0; k < 3; k++) {
      const a = tr[k], c = tr[(k + 1) % 3];
      if ((a[0] - x) * (c[0] - x) < 0) { const s = (x - a[0]) / (c[0] - a[0]); const y = a[1] + s * (c[1] - a[1]), z = a[2] + s * (c[2] - a[2]); if (Math.hypot(y - yc, z - zc) < 0.09) pts.push([y, z]); }
    }
    prof.push([+t.toFixed(2), +(hull(pts) * 100).toFixed(1)]);
  }
  const delt = Math.max(...prof.filter(([t]) => t >= 0.1 && t <= 0.35).map((p) => p[1]));
  const wrist = Math.min(...prof.filter(([t]) => t >= 0.85 && t <= 0.97).map((p) => p[1]));
  const m = await measureData(data, file, sex);
  return { file: file.split('/').slice(-2).join('/'), deltoid_cm: delt, wrist_cm: wrist, ratio: +(delt / wrist).toFixed(2), whr: +(m.waist_circ / m.buttock_circ).toFixed(3), profile: prof.map((p) => p[1]).join(' ') };
}

if (process.argv[1] && process.argv[1].endsWith('arm_taper.mjs')) {
  for (const file of process.argv.slice(2)) console.log(JSON.stringify(await armTaper(file, /_f|woman|female/i.test(file) ? 'f' : 'm')));
}
