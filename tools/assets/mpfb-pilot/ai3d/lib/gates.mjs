// Acceptance gates of `ai3d check`: each returns { id, status: PASS|WARN|FAIL|SKIP, value, limit, note }.
// Offline gates read the fit outputs / the shipped files; browser gates (kit, marks, bench) live in browser.mjs.
// Thresholds are the subject's `budgets` (ai3d/subjects/<id>.json) over the defaults below.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PILOT, ROOT, rel, fmtKB } from './core.mjs';
import { readNpz, readNpy } from './glb.mjs';
import { skinningMetrics } from './skin.mjs';
import { load, cut, blobs, measureData } from '../../measure_body.mjs';
import { armTaper } from '../../arm_taper.mjs';
import { bodyDirs, faceDirs } from './stages.mjs';

export const DEFAULTS = {
  rmsMm: { torso: 10, arms: 8, legs: 3 }, // body: RMS to the target per region, outside the underwear zones
  distP95Mm: 25, // body: p95 of our surface -> target, outside held parts
  iouBelowHead: { pass: 0.9, warn: 0.85 }, // silhouette front / side, below the head
  neckOffsetMm: 20, // neck centre vs shoulder centre, change from the MPFB base (head-over-shoulder +-2 cm)
  bellyVsBaseMm: 6, // belly front minus chest front: not more than the base + this (belly <= chest push)
  upperBackVsBaseMm: 12, // upper back behind the buttocks: not more than the base + this
  armTaper: 1.8, // deltoid : wrist girth
  neckPct: { m: 25, f: 40 }, // neck circumference at least this ANSUR percentile
  toneMean: 0.03, // |mean albedo ratio - 1|
  underwearFrac: 0.02, // share of underwear-zone vertices whose baked ratio is not ~1
  skinning: { stretch: 1.05, flips: 0.01 },
  glbKB: 950, texKB: { n: 450, c: 350, face: 700, eyes: 200, brows: 200 },
  faceRmsMm: 5, faceP95Mm: 10,
  marksMm: 20, // CharLab __marks headVsShoulder (skeleton, posed)
  benchPct: 5, // frame time AI vs average preset
};
const B = (S) => ({ ...DEFAULTS, ...(S.budgets ?? {}), rmsMm: { ...DEFAULTS.rmsMm, ...(S.budgets?.rmsMm ?? {}) }, texKB: { ...DEFAULTS.texKB, ...(S.budgets?.texKB ?? {}) } });
const G = (id, status, value, limit, note = '', extra = {}) => ({ id, status, value, limit, note, ...extra });
const grade = (v, pass, warn, higherBad = true) => (higherBad ? (v <= pass ? 'PASS' : v <= warn ? 'WARN' : 'FAIL') : v >= pass ? 'PASS' : v >= warn ? 'WARN' : 'FAIL');
const read = (f, T, k) => { const b = fs.readFileSync(f); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
export const pctile = (v, [p5, p50, p95]) => { const z = v >= p50 ? (v - p50) / ((p95 - p50) / 1.645) : (v - p50) / ((p50 - p5) / 1.645); return 50 * (1 + erf(z / Math.SQRT2)); };

// ── shared ──
export function gProvenance(S) {
  const p = S.provenance ?? {};
  const miss = ['provider', 'model', 'date', 'tos', 'licence'].filter((k) => !p[k] || /TODO/i.test(String(p[k])));
  const notes = [];
  let st = 'PASS';
  if (miss.length) (st = 'WARN'), notes.push(`fill provenance: ${miss.join(', ')}`);
  if (p.invented !== true) (st = 'FAIL'), notes.push('provenance.invented must be true (invented adult, no real-person likeness)');
  if (p.explicit === true) (st = 'FAIL'), notes.push('explicit imagery');
  if (/hunyuan/i.test(`${p.provider} ${p.model}`)) (st = st === 'FAIL' ? st : 'WARN'), notes.push('Hunyuan licence excludes EU/UK/KR: check before shipping');
  return G('provenance', st, `${p.provider ?? '?'} ${p.model ?? ''} ${p.date ?? ''}`.trim(), 'complete + invented', notes.join('; '));
}

export function gSizes(ctx) {
  const { S } = ctx;
  const b = B(S);
  const ship = ctx.ship ? null : path.join(ROOT, 'apps/web/public');
  const rows = [];
  let st = 'PASS';
  const chk = (label, file, lim) => {
    if (!fs.existsSync(file)) { rows.push(`${label} missing`); st = 'WARN'; return; }
    const kb = +fmtKB(file);
    rows.push(`${label} ${kb}/${lim} KB`);
    if (kb > lim * 1.1) st = 'FAIL'; else if (kb > lim && st !== 'FAIL') st = 'WARN';
  };
  if (S.kind === 'body') {
    const D = bodyDirs(ctx);
    chk('GLB', ctx.ship ? D.aiGlb : path.join(ship, `models/human_${S.sex}.glb`), b.glbKB);
    chk('normal', D.texN, b.texKB.n);
    chk('albedo', D.texC, b.texKB.c);
  } else {
    chk('GLB', ctx.ship ? path.join(ctx.baseDir, `human_${S.sex}_mpfb_id.glb`) : path.join(ship, `models/human_${S.sex}.glb`), b.glbKB);
    chk('face atlas', path.join(ctx.texDir, 'ident', `face_${S.sex}.webp`), b.texKB.face);
    chk('eyes', path.join(ctx.texDir, 'ident', `eyes_${S.sex}.webp`), b.texKB.eyes);
    chk('brows', path.join(ctx.texDir, 'ident', `brows_${S.sex}.webp`), b.texKB.brows);
  }
  return G('sizes', st, rows.join(', '), `GLB<=${b.glbKB} KB, textures per budgets`, ctx.ship ? '(scratch --out build, not the shipped GLB)' : '');
}

// ── body ──
export function gBodyRms(ctx) {
  const b = B(ctx.S);
  const j = JSON.parse(fs.readFileSync(path.join(ctx.workDir, 'fit.json'), 'utf8'));
  const r = j.rms_after_mm;
  const worst = Object.entries(b.rmsMm).map(([k, lim]) => [k, r[k] / lim]).sort((a, c) => c[1] - a[1])[0];
  const st = worst[1] <= 1 ? 'PASS' : worst[1] <= 1.5 ? 'WARN' : 'FAIL';
  return G('rms', st, Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' / ') + ' mm', Object.entries(b.rmsMm).map(([k, v]) => `${k}<=${v}`).join(' '), '', { data: r });
}
export function gBodyDist(ctx) {
  const b = B(ctx.S);
  const dist = readNpy(path.join(ctx.workDir, 'dist_fit.npy')).data;
  const st0 = readNpz(path.join(ctx.workDir, 'fit_state.npz'));
  const hold = st0.hold.data, n = dist.length;
  const v = [];
  for (let i = 0; i < n; i++) if (hold[i] < 0.5 && !st0.uw.data[i]) v.push(dist[i] * 1000);
  v.sort((a, c) => a - c);
  const p50 = v[Math.floor(v.length * 0.5)], p95 = v[Math.floor(v.length * 0.95)];
  return G('dist', grade(p95, b.distP95Mm, b.distP95Mm * 1.5), `p50 ${p50.toFixed(1)} / p95 ${p95.toFixed(1)} mm`, `p95<=${b.distP95Mm}`, 'our surface -> target, held parts + underwear zones excluded');
}
export async function gBodyIou(ctx) {
  const b = B(ctx.S);
  const d = ctx.workDir;
  const res = [];
  for (const view of ['front', 'side']) {
    const a = await sharp(path.join(d, `s_fit_${view}_target.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const c = await sharp(path.join(d, `s_fit_${view}_ours.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = a.info;
    let top = H, bot = 0;
    for (let i = 0; i < W * H; i++) if (a.data[i] > 128) (top = Math.min(top, Math.floor(i / W))), (bot = Math.max(bot, Math.floor(i / W)));
    const cut_ = top + 0.15 * (bot - top);
    let I = 0, U = 0;
    for (let i = 0; i < W * H; i++) if (i / W > cut_) { const t = a.data[i] > 128, u = c.data[i] > 128; if (t && u) I++; if (t || u) U++; }
    res.push(I / U);
  }
  const mn = Math.min(...res);
  return G('iou', grade(mn, b.iouBelowHead.pass, b.iouBelowHead.warn, false), `front ${res[0].toFixed(3)} / side ${res[1].toFixed(3)}`, `>=${b.iouBelowHead.pass}`, 'silhouette IoU below the head', { data: res });
}
export function gBodyKeep(ctx) {
  const st0 = readNpz(path.join(ctx.workDir, 'fit_state.npz'));
  const hold = st0.hold.data;
  const D = read(path.join(ctx.workDir, 'ai_body_delta.bin'), Float32Array);
  let mx = 0;
  for (let i = 0; i < hold.length; i++) if (hold[i] > 0.999) mx = Math.max(mx, Math.hypot(D[3 * i], D[3 * i + 1], D[3 * i + 2]));
  const mm = mx * 1000;
  return G('keep', mm <= 0.5 ? 'PASS' : mm <= 3 ? 'WARN' : 'FAIL', `max |delta| ${mm.toFixed(2)} mm`, '<=0.5 mm', `head / neck / hands / feet stay MPFB (${(ctx.S.keep ?? []).join(', ')})`);
}
export async function gBodyAnsur(ctx) {
  const b = B(ctx.S);
  const S = ctx.S;
  const T = JSON.parse(fs.readFileSync(path.join(PILOT, 'refs/body_targets.json'), 'utf8'))[S.sex];
  const restAi = path.join(ctx.workDir, 'ai_rest.glb');
  const baseGlb = bodyDirs(ctx).baseGlb;
  const dAi = await load(restAi), dBase = await load(baseGlb);
  const m = await measureData(dAi, restAi, S.sex);
  const out = [];
  let st = 'PASS';
  const neckP = pctile(m.neck_circ, T.spread.neck_circ);
  const nlim = b.neckPct[S.sex];
  out.push(`neck P${neckP.toFixed(0)} (>=P${nlim})`);
  if (neckP < nlim) st = neckP < nlim - 15 ? 'FAIL' : 'WARN';
  const off = [];
  for (const k of ['chest_circ', 'waist_circ', 'buttock_circ', 'thigh_circ', 'calf_circ', 'hip_breadth']) {
    const p = pctile(m[k], T.spread[k]);
    out.push(`${k.replace('_circ', '').replace('_breadth', 'W')} P${p.toFixed(0)}`);
    if (p < 3 || p > 97) off.push(k);
  }
  if (off.length && st === 'PASS') st = 'WARN';
  // posture marks of the rest mesh, vs the MPFB base (head-over-shoulder, belly vs chest, upper back)
  const marks = (d) => {
    const { tris, joints } = d;
    let y0 = 1e9, y1 = -1e9;
    for (const t of tris) for (const p of t) (y0 = Math.min(y0, p[1])), (y1 = Math.max(y1, p[1]));
    const Sh = y1 - y0, Y = (f) => y0 + f * Sh;
    const mid = (h) => blobs(cut(tris, h), 0.012 * Sh).sort((a, c) => Math.abs(a.cx) - Math.abs(c.cx))[0];
    const ext = (pts, f) => f(...pts.map((q) => q[1]));
    const front = (h) => ext(mid(h).pts.filter((q) => Math.abs(q[0]) < 0.06), Math.max);
    const rear = (h) => ext(mid(h).pts.filter((q) => Math.abs(q[0]) < 0.06), Math.min);
    const cz = (b_) => (ext(b_.pts, Math.max) + ext(b_.pts, Math.min)) / 2;
    const neckZ = cz(mid((joints.neck_01[1] + joints.Head[1]) / 2)), shZ = cz(mid(joints.upperarm_l[1] - 0.02));
    return { neckOff: (neckZ - shZ) * 1000, belly: (front(Y(T.waist_h)) - front(Y(T.chest_h))) * 1000, back: (rear(Y(T.chest_h + 0.03)) - rear(Y(0.52))) * 1000 };
  };
  const a = marks(dAi), c = marks(dBase);
  const dn = a.neckOff - c.neckOff, db = a.belly - c.belly, dk = a.back - c.back;
  const sub = [
    G('neck-posture', Math.abs(dn) <= b.neckOffsetMm ? 'PASS' : Math.abs(dn) <= 1.5 * b.neckOffsetMm ? 'WARN' : 'FAIL', `${dn >= 0 ? '+' : ''}${dn.toFixed(1)} mm vs MPFB (neck ${a.neckOff.toFixed(0)} / base ${c.neckOff.toFixed(0)})`, `|d|<=${b.neckOffsetMm}`, 'head-over-shoulder, rest mesh'),
    G('belly', grade(db, b.bellyVsBaseMm, 2.5 * b.bellyVsBaseMm), `${db >= 0 ? '+' : ''}${db.toFixed(1)} mm vs MPFB (belly-chest ${a.belly.toFixed(0)} / base ${c.belly.toFixed(0)})`, `<=+${b.bellyVsBaseMm}`, 'belly front vs chest front'),
    G('back', grade(dk, b.upperBackVsBaseMm, 2 * b.upperBackVsBaseMm), `${dk >= 0 ? '+' : ''}${dk.toFixed(1)} mm vs MPFB`, `<=+${b.upperBackVsBaseMm}`, 'upper back vs buttock rear (rounded back)'),
  ];
  const tp = await armTaper(restAi, S.sex);
  sub.push(G('arm-taper', tp.ratio >= b.armTaper ? 'PASS' : tp.ratio >= b.armTaper - 0.2 ? 'WARN' : 'FAIL', `${tp.ratio} (deltoid ${tp.deltoid_cm} / wrist ${tp.wrist_cm} cm)`, `>=${b.armTaper}`));
  return [G('ansur', st, out.join(', '), `neck >=P${nlim}, others P3..P97`, off.length ? `outside P3-P97: ${off.join(',')}` : '', { data: m }), ...sub];
}
export async function gBodyTone(ctx) {
  const b = B(ctx.S);
  const D = ctx.workDir;
  const img = await sharp(path.join(D, 'ai_c.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = img.info;
  const uv = read(path.join(D, 'body_uv.bin'), Float32Array);
  const st0 = readNpz(path.join(D, 'fit_state.npz'));
  const n = uv.length / 2;
  const sum = [0, 0, 0], samples = [[], [], []];
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (st0.hold.data[i] > 0.5) continue; // held parts carry ratio 1 by construction
    const x = Math.min(W - 1, Math.max(0, Math.floor(uv[2 * i] * W))), y = Math.min(H - 1, Math.max(0, Math.floor(uv[2 * i + 1] * H)));
    for (let k = 0; k < 3; k++) { const r = (img.data[(y * W + x) * channels + k] / 255) * 2; sum[k] += r; samples[k].push(r); }
    cnt++;
  }
  const mean = sum.map((s) => s / cnt);
  const dev = Math.max(...mean.map((m) => Math.abs(m - 1)));
  const spread = Math.max(...mean) - Math.min(...mean);
  const p = samples.map((s) => { s.sort((a, c) => a - c); return [s[Math.floor(0.01 * s.length)], s[Math.floor(0.99 * s.length)]]; });
  const st = dev <= b.toneMean && spread <= b.toneMean ? 'PASS' : dev <= 2 * b.toneMean ? 'WARN' : 'FAIL';
  return G('tone', st, `ratio mean ${mean.map((m) => m.toFixed(3)).join('/')}, p1..p99 ${p[1][0].toFixed(2)}..${p[1][1].toFixed(2)}`, `|mean-1|<=${b.toneMean}`, 'albedo ratio over the game skin: the tone selector keeps working');
}
export async function gBodyUnderwear(ctx) {
  const b = B(ctx.S);
  const D = ctx.workDir;
  const img = await sharp(path.join(D, 'ai_c.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const nimg = await sharp(path.join(D, 'ai_n.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = img.info;
  const uv = read(path.join(D, 'body_uv.bin'), Float32Array);
  const uw = readNpz(path.join(D, 'fit_state.npz')).uw.data;
  let n = 0, bad = 0;
  for (let i = 0; i < uw.length; i++) {
    if (!uw[i]) continue;
    const x = Math.min(W - 1, Math.floor(uv[2 * i] * W)), y = Math.min(H - 1, Math.floor(uv[2 * i + 1] * H));
    const o = (y * W + x) * channels;
    const r = [0, 1, 2].map((k) => (img.data[o + k] / 255) * 2);
    n++;
    if (Math.max(...r.map((v) => Math.abs(v - 1))) > 0.08 || nimg.data[o + 2] > 128) bad++; // B of the normal map = how much applies (zone-edge vertices blend up to ~45%)
  }
  const f = n ? bad / n : 0;
  return G('underwear', grade(f, b.underwearFrac, 3 * b.underwearFrac), `${bad}/${n} underwear-zone vertices carry AI colour/normal (${(f * 100).toFixed(1)}%)`, `<=${(b.underwearFrac * 100).toFixed(0)}%`, `fabric rule luma<${ctx.S.underwear?.luma ?? 0.35}, r-b<${ctx.S.underwear?.rb ?? 0.06}`);
}
export async function gSkinning(ctx) {
  const b = B(ctx.S);
  const D = bodyDirs(ctx);
  const clips = path.join(ROOT, 'apps/web/public/models/character.glb');
  const r = await skinningMetrics(D.aiGlb, clips, [['Idle_Loop', [0, 0.5]], ['Walk_Loop', [0.25, 0.75]], ['Pistol_Aim_Neutral', [0.5]], ['Crouch_Idle_Loop', [0.5]]]);
  const rs = r.ai.stretch / r.base.stretch, df = r.ai.flips - r.base.flips;
  const missing = r.poses.filter((p) => p.missing).map((p) => p.clip);
  const st = rs <= b.skinning.stretch && df <= b.skinning.flips ? 'PASS' : rs <= 1.15 && df <= 0.05 ? 'WARN' : 'FAIL';
  return G('skinning', st, `stretch x${rs.toFixed(3)} vs MPFB, flipped tris ${df >= 0 ? '+' : ''}${(df * 100).toFixed(2)}%`, `<=x${b.skinning.stretch}, <=+${b.skinning.flips * 100}%`, `Idle/Walk/Aim/Crouch, CPU skin of the ai_body morph at 1 vs 0${missing.length ? '; missing clips ' + missing : ''}`, { data: r.poses.filter((p) => p.variant) });
}

// ── face ──
export function gFaceRms(ctx) {
  const b = B(ctx.S);
  const D = faceDirs(ctx);
  const m = JSON.parse(fs.readFileSync(path.join(D.sd, 'meta.json'), 'utf8')).identities.find((e) => e.id === ctx.S.id)?.ai3d;
  if (!m) return G('rms', 'FAIL', 'no ai3d stats in meta.json', '', 'run ai3d fit');
  const st = m.ours_to_ai_rms_mm <= b.faceRmsMm && m.ours_to_ai_p95_mm <= b.faceP95Mm ? 'PASS' : m.ours_to_ai_rms_mm <= 1.5 * b.faceRmsMm ? 'WARN' : 'FAIL';
  return G('rms', st, `ours->AI ${m.ours_to_ai_rms_mm.toFixed(2)} mm (p95 ${m.ours_to_ai_p95_mm.toFixed(1)}), AI->ours ${m.ai_to_ours_rms_mm.toFixed(2)}, ICP ${m.icp_rms_mm.toFixed(2)}`, `rms<=${b.faceRmsMm} p95<=${b.faceP95Mm} mm`, `matched ${m.ours_matched}/${m.ours_face} face verts`, { data: m });
}
export function gFaceKeep(ctx) {
  const D = faceDirs(ctx);
  const dl = read(path.join(D.sd, `body_${ctx.S.id}.bin`), Float32Array);
  const hw = read(path.join(D.sd, 'body_headw.bin'), Float32Array);
  let mx = 0;
  for (let i = 0; i < hw.length; i++) if (hw[i] < 1e-4) mx = Math.max(mx, Math.hypot(dl[3 * i], dl[3 * i + 1], dl[3 * i + 2]));
  const mm = mx * 1000;
  return G('keep', mm <= 0.1 ? 'PASS' : mm <= 1 ? 'WARN' : 'FAIL', `max |delta| outside the head+neck weights ${mm.toFixed(3)} mm`, '<=0.1 mm', 'body below the neck, hands, feet stay MPFB');
}
export function gFaceTone(ctx) {
  const b = B(ctx.S);
  const D = faceDirs(ctx);
  const t = read(path.join(D.sd, `skin_${ctx.S.id}.bin`), Uint8Array);
  let s = [0, 0, 0], n = 0;
  for (let i = 0; i < t.length; i += 4) { if (t[i + 3] === 0 && t[i] === 0 && t[i + 1] === 0) continue; for (let k = 0; k < 3; k++) s[k] += (t[i + k] / 255) * 2; n++; }
  const mean = s.map((v) => v / n);
  const dev = Math.max(...mean.map((m) => Math.abs(m - 1)));
  const meta = JSON.parse(fs.readFileSync(path.join(D.sd, 'meta.json'), 'utf8')).identities.find((e) => e.id === ctx.S.id);
  const mn = Math.min(...mean), mxv = Math.max(...mean);
  return G('tone', mn >= 0.5 && mxv <= 1.5 ? 'PASS' : mn >= 0.35 && mxv <= 1.8 ? 'WARN' : 'FAIL', `face-tile ratio mean ${mean.map((m) => m.toFixed(3)).join('/')}; tint ${(meta?.tint ?? []).join('/')}`, 'channel means 0.5..1.5', 'the face tile is detail over the game skin at the identity tone; the hue goes through tint');
}
export function gFaceRender(ctx) {
  const f = path.join(ctx.workDir, 'chk_rms.json');
  if (!fs.existsSync(f)) return G('heat', 'SKIP', '', '', 'render stage not run');
  const r = JSON.parse(fs.readFileSync(f, 'utf8')).rms_m * 1000;
  return G('heat', r <= 12 ? 'PASS' : r <= 16 ? 'WARN' : 'FAIL', `head rms to the AI mesh ${r.toFixed(2)} mm (ai3d_check: whole head incl. scalp)`, '<=12 mm');
}
