// Our fitted head over an AI sheet (fit_ai.py's <dump>/<sheet>_ov.json): front view (x/z, placed by the pupils)
// and profile (y/z, placed by the eye and scaled eye-to-menton), as dots + landmarks (ours green, the sheet's red).
//   [OV=0: the base face, before the fit] node ai_overlay.mjs <dump_dir> <sheet> <out.jpg> [label]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dump, sheet, out, label = ''] = process.argv.slice(2);
const ov = JSON.parse(fs.readFileSync(path.join(dump, `${sheet}_ov${process.env.OV ?? ""}.json`), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'refs/ai/ai_fit.json'), 'utf8'));
const F = cfg.front[sheet], PC = cfg.profile[sheet];
const A = ov.aux;
const img = path.join(here, `refs/ai/sheet_${sheet}_nb.png`);

async function panel(x0, y0, x1, y1, pts, marks, sheetMarks) {
  const S = 0.75, w = Math.round((x1 - x0) * S), h = Math.round((y1 - y0) * S);
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (const [x, y] of pts) svg += `<circle cx="${((x - x0) * S).toFixed(1)}" cy="${((y - y0) * S).toFixed(1)}" r="0.9" fill="#3cf" fill-opacity="0.35"/>`;
  const cross = (x, y, c) => { const X = (x - x0) * S, Y = (y - y0) * S; return `<path d="M${X - 5} ${Y}h10M${X} ${Y - 5}v10" stroke="${c}" stroke-width="2"/>`; };
  for (const [x, y] of sheetMarks) svg += cross(x, y, '#f33');
  for (const [x, y] of marks) svg += cross(x, y, '#3f3');
  svg += '</svg>';
  return sharp(img).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize(w, h).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

// front: sheet = (cx + s*x, py - s*(z - pz)), s from the pupils
const spl = F.pupil_l, spr = F.pupil_r;
const s = Math.abs(spr[0] - spl[0]) / A.ipd;
const cx = (spl[0] + spr[0]) / 2, py = (spl[1] + spr[1]) / 2;
const fx = (x, z) => [cx + s * x, py - s * (z - A.pz)];
const front = ov.front.map(([x, z]) => fx(x, z));
const fm = [fx(A.pl[0], A.pl[2]), fx(A.pr[0], A.pr[2]), fx(A.il[0], A.il[2]), fx(A.ol[0], A.ol[2]), fx(A.ir[0], A.ir[2]), fx(A.or_[0], A.or_[2]),
  fx(A.alar / 2, A.sn_z), fx(-A.alar / 2, A.sn_z), fx(A.mouth_w / 2, A.st_z), fx(-A.mouth_w / 2, A.st_z), fx(0, A.me_z), fx(0, A.sn_z), fx(0, A.st_z),
  fx(A.face_w / 2, A.zyg_z), fx(-A.face_w / 2, A.zyg_z), fx(A.jaw_w / 2, A.gon_z), fx(-A.jaw_w / 2, A.gon_z), fx(A.pl[0], A.brow_z), fx(A.pr[0], A.brow_z)];
const sfm = ['pupil_l', 'pupil_r', 'outer_l', 'inner_l', 'inner_r', 'outer_r', 'alar_l', 'alar_r', 'mouth_l', 'mouth_r', 'menton', 'subnasale', 'stomion', 'zyg_l', 'zyg_r', 'gon_l', 'gon_r'].map((k) => F[k]).filter(Boolean);
sfm.push([spl[0], F.brow], [spr[0], F.brow]);
const fxs = [...sfm, ...fm].map((p) => p[0]), fys = [...sfm, ...fm].map((p) => p[1]);
const pad = 140;
const fb = [Math.max(0, Math.round(Math.min(...fxs) - pad)), Math.max(0, Math.round(Math.min(...fys) - pad * 2)), Math.round(Math.max(...fxs) + pad), Math.min(1536, Math.round(Math.max(...fys) + pad / 2))];

// profile: sheet = (ex + d*s2*(fwd - fwd_eye), ey + s2*(down - down_eye)), s2 from eye-to-menton
const P = ov.P, PS = ov.Psheet;
const d = PC.dir;
const s2 = (PS.me[0] - PS.eye[0]) / (P.me[0] - P.eye[0]);
const ex = PC.eye[0], ey = PC.eye[1];
const sx = (down, fwd) => [ex + d * s2 * (fwd - P.eye[1]), ey + s2 * (down - P.eye[0])];
const side = ov.side.map(([y, z]) => sx(A.top - z, -y));
const keys = ['gla', 'nas', 'prn', 'sn', 'ls', 'st', 'li', 'sm', 'pg', 'me', 'eye', 'ear'];
const pm = keys.filter((k) => P[k]).map((k) => sx(P[k][0], P[k][1]));
const spm = keys.filter((k) => PS[k]).map((k) => [d * PS[k][1], PS[k][0]]);
const pxs = [...pm, ...spm].map((p) => p[0]), pys = [...pm, ...spm].map((p) => p[1]);
const pb = [Math.max(0, Math.round(Math.min(...pxs) - pad)), Math.max(0, Math.round(Math.min(...pys) - pad * 2)), Math.min(2752, Math.round(Math.max(...pxs) + pad)), Math.min(1536, Math.round(Math.max(...pys) + pad / 2))];

const a = await panel(...fb, front, fm, sfm);
const b = await panel(...pb, side, pm, spm);
const ma = await sharp(a).metadata(), mb = await sharp(b).metadata();
const H = Math.max(ma.height, mb.height) + 28;
const lab = `<svg width="${ma.width + mb.width + 8}" height="28" xmlns="http://www.w3.org/2000/svg"><text x="6" y="20" font-size="18" fill="#fff" font-family="sans-serif">${sheet} ${label} -- dots: our head; green: our landmarks; red: the sheet's</text></svg>`;
await sharp({ create: { width: ma.width + mb.width + 8, height: H, channels: 3, background: '#111' } })
  .composite([{ input: Buffer.from(lab), left: 0, top: 0 }, { input: a, left: 0, top: 28 }, { input: b, left: ma.width + 8, top: 28 }])
  .jpeg({ quality: 85 }).toFile(out);
console.log('wrote', out);
