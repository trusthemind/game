#!/usr/bin/env node
// ONE entry point for fitting our MPFB bodies / heads to an AI 3D target (Tripo / Hunyuan / SAM 3D via Higgsfield).
// The AI mesh is only a FIT TARGET: our skeleton, UVs, weights and clothing fit stay MPFB's.
//
//   node ai3d.mjs list
//   node ai3d.mjs init <id> --kind face|body --sex m|f --glb <file> [--yaw deg] [--tone hex] [--sam <glb>:<node>] [provenance flags]
//   node ai3d.mjs fit <id> [--out DIR] [--force] [--from stage] [--only a,b] [--dry] [--adopt] [--build]
//   node ai3d.mjs build [--out DIR]                 build.mjs ONLY=mpfb (ASSET_SRC defaulted)
//   node ai3d.mjs check <id> [--skip g,g] [--only g,g] [--shots] [--port N]
//   node ai3d.mjs report <id> [--heat] [--port N]
//   node ai3d.mjs verify <id> --out DIR             fit into DIR, then diff against the current outputs
// Subjects: ai3d/subjects/<id>.json. Docs: docs/art/AI3D_PIPELINE_AUDIT.md, .claude/skills/ai3d-fit/SKILL.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { PILOT, ROOT, rel, abs, listSubjects, loadSubject, saveSubject, context, runStages, blender, hashFile } from './ai3d/lib/core.mjs';
import { stagesFor, renderStageFor } from './ai3d/lib/stages.mjs';
import * as gt from './ai3d/lib/gates.mjs';
import { faceYaw, faceTone, bodyInfo } from './ai3d/lib/detect.mjs';
import { startServer, browserGates, npmGate, reportShots } from './ai3d/lib/browser.mjs';
import { buildReport } from './ai3d/lib/report.mjs';

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) flags[k] = true;
    else flags[k] = argv[++i];
  } else pos.push(a);
}
const csv = (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : undefined);
const COLORS = { PASS: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m', SKIP: '\x1b[90m' };
const paint = (s, st) => (process.stdout.isTTY ? `${COLORS[st] ?? ''}${s}\x1b[0m` : s);
const printGate = (g) => console.log(`${paint(g.status.padEnd(4), g.status)} ${g.id.padEnd(13)} ${g.value}${g.limit ? `   [${g.limit}]` : ''}${g.note ? `   ${g.note}` : ''}`);
const ctxOf = (id) => context(loadSubject(id), { out: flags.out });

async function main() {
  switch (cmd) {
    case 'list': return list();
    case 'init': return init(pos[0]);
    case 'fit': return fit(pos[0]);
    case 'build': return build();
    case 'check': return check(pos[0]);
    case 'report': return report(pos[0]);
    case 'verify': return verify(pos[0]);
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 14).map((l) => l.slice(3)).join('\n'));
      process.exit(cmd ? 1 : 0);
  }
}

async function list() {
  for (const id of listSubjects()) {
    const S = loadSubject(id);
    const ctx = context(S, {});
    const res = await runStages(ctx, stagesFor(ctx), { quiet: true });
    console.log(`${id.padEnd(14)} ${S.kind.padEnd(5)} ${S.sex}  ${(S.provenance?.provider ?? '?') + ' ' + (S.provenance?.model ?? '')}`.padEnd(78) + res.map((r) => `${r.name}:${r.status === 'cached' ? 'ok' : 'DIRTY'}`).join(' '));
  }
}

async function init(id) {
  if (!id) throw new Error('ai3d init <id> --kind face|body --sex m|f --glb <file>');
  const kind = flags.kind, sex = flags.sex, glb = flags.glb;
  if (!['face', 'body'].includes(kind) || !['m', 'f'].includes(sex) || !glb) throw new Error('need --kind face|body --sex m|f --glb <file>');
  if (fs.existsSync(path.join(PILOT, 'ai3d/subjects', `${id}.json`)) && !flags.force) throw new Error(`subject ${id} exists (--force to overwrite)`);
  const src = path.resolve(glb);
  if (!fs.existsSync(src)) throw new Error(`no such file ${glb}`);
  const srcRel = path.relative(PILOT, src);
  const prov = {
    provider: flags.provider ?? 'TODO (Higgsfield)', model: flags.model ?? 'TODO (tripo|hunyuan3d|meshy|sam3d)', date: flags.date ?? new Date().toISOString().slice(0, 10),
    tos: flags.tos ?? 'Higgsfield ToS 4.4: outputs usable commercially (re-read before shipping)', licence: flags.licence ?? 'TODO (model licence; Hunyuan excludes EU/UK/KR)',
    invented: true, source2d: flags.sheet ?? 'TODO (refs/ai/... sheet / prompt in refs/ai/PROMPTS.md)',
  };
  const S = { id, kind, sex, source: { glb: srcRel }, provenance: prov };
  console.log(`init ${id}: ${kind} ${sex}, ${srcRel}`);
  if (kind === 'body') {
    const info = await bodyInfo(src);
    Object.assign(S, {
      orientation: { yawDeg: flags.yaw !== undefined ? Number(flags.yaw) : null, note: 'null = auto (the toe-forward test of ai_body_fit.py); set degrees to force' },
      scale: { rule: 'neckHeight', note: 'target scaled so floor-to-neck height equals ours (hair / head size do not count)' },
      underwear: { luma: 0.35, rb: 0.06, note: 'target albedo darker than luma and red-blue under rb = fabric: never copied (inpaint to the surrounding skin)' },
      posture: { abdomenEase: 0.6, upperBackEase: 0.5, neckGirth: sex === 'm' ? 0.13 : 0.08, note: 'upright athletic stance: belly / rounded-back push eased, neck girth towards ANSUR' },
      keep: ['head', 'neck', 'hands', 'feet', 'skeleton', 'uv', 'weights', 'clothing fit'],
      regions: { fit: ['torso', 'arms', 'legs'], hold: ['head', 'neck', 'hands', 'feet'] },
      build: { only: 'mpfb', preset: 'ai_athletic', texSize: 2048, bakeRes: 2048 },
      budgets: { rmsMm: { torso: 10, arms: 8, legs: 3 }, glbKB: 950 },
    });
    if (flags.sam) { const [g, nd] = String(flags.sam).split(':'); S.source.sam = { glb: path.relative(PILOT, path.resolve(g)), node: nd }; }
    console.log(`  size: ${info.extent.join(' x ')} (up ${info.upAxis}, height ${info.height}), ${(info.verts / 1000).toFixed(0)}k verts`);
    console.log(`  orientation: ${S.orientation.yawDeg ?? 'auto'} (width along ${info.widthAxis}: the fit will try yaw ${info.yawHint} / ${info.yawHint + 180} and pick the toe-forward one)`);
    console.log('  scale: neckHeight (the fit prints the factor; expect 1.0-1.9 for a unit-height Tripo mesh)');
    info.notes.forEach((n) => console.log('  ! ' + n));
  } else {
    const ctx = context({ ...S, work: `ai/work/${id}` }, {});
    const work = ctx.workDir;
    fs.mkdirSync(work, { recursive: true });
    console.log('  reading the head (Blender, yaw 0) to find the facing ...');
    await blender(ctx, 'init-prep', path.join(PILOT, 'ai3d_prep.py'), [src, work, '0']);
    const fy = faceYaw(path.join(work, 'mesh.npz'));
    const yaw = flags.yaw !== undefined ? Number(flags.yaw) : fy.yaw;
    const toneEst = faceTone(path.join(work, 'mesh.npz'));
    const bs = fs.readdirSync(path.join(PILOT, 'ai3d/subjects')).map((f) => JSON.parse(fs.readFileSync(path.join(PILOT, 'ai3d/subjects', f), 'utf8'))).find((o) => o.kind === 'face' && o.sex === sex && o.source.baseSkin);
    Object.assign(S, {
      work: `ai/work/${id}`,
      source: { glb: srcRel, baseSkin: bs?.source.baseSkin ?? `ai/work/${id}/base_skin_${sex}.png` },
      orientation: { yawDeg: yaw, note: `turn about Z that brings the face to -Y; ${fy.note} (confidence ${fy.confidence})` },
      scale: { rule: 'landmarks-similarity', note: 'eye openings + midline profile (nose tip, subnasale, stomion, pogonion, menton) -> similarity, then non-rigid ICP' },
      tone: flags.tone ?? '6b4430',
      parts: { face: true, skin: true, irises: true, brows: 'painted in the skin', hair: flags.hair ? { name: String(flags.hair) } : null },
      keep: ['scalp under the hair', 'neck', 'body below the neck', 'hands', 'feet', 'skeleton', 'uv', 'weights'],
      budgets: { faceRmsMm: 5, faceP95Mm: 10, glbKB: 950 },
    });
    if (!S.parts.hair) delete S.parts.hair;
    console.log(`  facing: ${fy.note}; yaw ${yaw} (confidence ${fy.confidence})${fy.confidence === 'low' || fy.confidence === 'none' ? '  <-- CHECK with ai3d_inspect.py' : ''}`);
    console.log(`  scale: landmarks-similarity (automatic)`);
    console.log(`  tone: ${S.tone}${flags.tone ? '' : `  (default; the texture's median reads #${toneEst}, but it carries baked light: pass --tone <hex> of the intended skin)`}`);
    if (!bs) console.log(`  ! base skin map for sex ${sex} not found in any subject: put the game's 2048 skin albedo at ${S.source.baseSkin}`);
    S.identity = { note: `add an entry id '${id}' with an \`ai\` block to ${rel(path.join(PILOT, 'identities.json'))} (label, race, age, skin, eyes, brow) before fit: build_identities.py builds identities from it` };
  }
  saveSubject(S);
  console.log(`  wrote ${rel(path.join(PILOT, 'ai3d/subjects', id + '.json'))}; fill provenance (TODO fields), then: node ai3d.mjs fit ${id}`);
}

async function fit(id) {
  const ctx = ctxOf(id);
  console.log(`[ai3d fit] ${id} (${ctx.S.kind}, ${ctx.S.sex})${ctx.out ? ` -> scratch ${ctx.out}` : ''}`);
  if (ctx.out) prepScratch(ctx);
  await runStages(ctx, stagesFor(ctx), { force: !!flags.force, from: flags.from, only: csv(flags.only), dry: !!flags.dry, adopt: !!flags.adopt });
  if (flags.build && !flags.dry) await build();
  if (!flags.dry) console.log(`next: node ai3d.mjs ${flags.build || ctx.out ? '' : 'build; node ai3d.mjs '}check ${id}`);
}
function prepScratch(ctx) {
  // a scratch --out needs the real ident/ for stages that only add to it, and the sibling base GLBs for build
  fs.mkdirSync(ctx.baseDir, { recursive: true });
  for (const f of fs.readdirSync(path.join(PILOT, 'base'))) if (/^human_[mf]_mpfb(_id|_ai)?\.glb$/.test(f) && !fs.existsSync(path.join(ctx.baseDir, f))) fs.copyFileSync(path.join(PILOT, 'base', f), path.join(ctx.baseDir, f));
}

async function build() {
  const out = flags.out ? path.resolve(flags.out) : null;
  const env = { ...process.env, ONLY: 'mpfb', ASSET_SRC: process.env.ASSET_SRC || path.join(os.tmpdir(), 'ai3d-no-assets') };
  if (out) { env.AI3D_MODELS_OUT = path.join(out, 'ship/models'); env.AI3D_BASE_DIR = path.join(out, 'ship/base'); }
  console.log(`[ai3d build] build.mjs ONLY=mpfb${out ? ` -> ${out}/ship/models` : ''}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/assets/build.mjs')], { cwd: ROOT, env, encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').filter((l) => /human_|→|done|!/.test(l)).join('\n') + '\n');
  if (r.status !== 0) { console.error(r.stderr); throw new Error('build.mjs failed'); }
}

async function check(id) {
  const ctx = ctxOf(id);
  const S = ctx.S;
  const skip = new Set(csv(flags.skip) ?? []), only = csv(flags.only);
  const on = (g) => !skip.has(g) && (!only || only.includes(g));
  console.log(`[ai3d check] ${id} (${S.kind}, ${S.sex})`);
  const t0 = Date.now();
  const res = [];
  const add = async (idOrIds, f) => {
    const ids = [].concat(idOrIds);
    if (!ids.some(on)) return;
    try { const r = await f(); for (const g of [].concat(r)) if (!only || on(g.id) || ids.some(on)) (res.push(g), printGate(g)); }
    catch (e) { const g = { id: ids[0], status: 'FAIL', value: 'gate crashed', limit: '', note: e.message.split('\n')[0] }; res.push(g); printGate(g); }
  };
  // stale outputs?
  const plan = await runStages(ctx, stagesFor(ctx), { quiet: true });
  const dirty = plan.filter((p) => p.status !== 'cached').map((p) => p.name);
  if (dirty.length) console.log(paint(`WARN stale: stages ${dirty.join(', ')} not up to date (ai3d fit ${id}); gates read what is on disk (first use: ai3d fit ${id} --adopt stamps the existing outputs)`, 'WARN'));
  const needRender = ['iou', 'dist', 'heat'].some(on);
  if (needRender) await runStages(ctx, [...stagesFor(ctx), renderStageFor(ctx)], { only: ['render'], quiet: false });
  await add('provenance', () => gt.gProvenance(S));
  await add('sizes', () => gt.gSizes(ctx));
  if (S.kind === 'body') {
    await add('rms', () => gt.gBodyRms(ctx));
    await add('dist', () => gt.gBodyDist(ctx));
    await add('iou', () => gt.gBodyIou(ctx));
    await add('keep', () => gt.gBodyKeep(ctx));
    await add(['ansur', 'neck-posture', 'belly', 'back', 'arm-taper'], () => gt.gBodyAnsur(ctx));
    await add('tone', () => gt.gBodyTone(ctx));
    await add('underwear', () => gt.gBodyUnderwear(ctx));
    await add('skinning', () => gt.gSkinning(ctx));
  } else {
    await add('rms', () => gt.gFaceRms(ctx));
    await add('keep', () => gt.gFaceKeep(ctx));
    await add('tone', () => gt.gFaceTone(ctx));
    await add('heat', () => gt.gFaceRender(ctx));
  }
  const bg = ['marks', 'bench', 'kit'].filter(on);
  if (bg.length && !ctx.out) {
    const srv = await startServer({ port: flags.port });
    try { for (const g of await browserGates(ctx, srv.port, bg)) (res.push(g), printGate(g)); } catch (e) { const g = { id: 'browser', status: 'FAIL', value: 'browser gates crashed', limit: '', note: e.message.split('\n')[0] }; res.push(g); printGate(g); } finally { srv.stop(); }
  } else if (bg.length) console.log('SKIP browser gates (marks, bench, kit) with --out: the dev server shows the shipped GLB');
  for (const [g, args, label] of [['tsc', ['run', 'typecheck'], 'npm run typecheck'], ['tests', ['test'], 'npm test']]) if (on(g) && !skip.has(g) && (only || flags.full)) { const r = npmGate(g, args, label); res.push(r); printGate(r); }
  const cnt = (s) => res.filter((g) => g.status === s).length;
  console.log(`-- ${cnt('PASS')} PASS, ${cnt('WARN')} WARN, ${cnt('FAIL')} FAIL, ${cnt('SKIP')} SKIP in ${((Date.now() - t0) / 1000).toFixed(0)}s${(only || flags.full) ? '' : '  (tsc + npm test only with --full or --only tsc,tests)'}`);
  const dir = path.join(PILOT, 'ai/report', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gates.json'), JSON.stringify({ subject: id, at: new Date().toISOString(), gates: res }, null, 1));
  if (flags.json) console.log(JSON.stringify(res));
  if (flags.shots || (cnt('FAIL') && !ctx.out && !flags['no-shots'])) { console.log('shots on ' + (flags.shots ? 'request' : 'failure') + ': node ai3d.mjs report ' + id); if (flags.shots) await report(id); }
  process.exitCode = cnt('FAIL') ? 2 : 0;
}

async function report(id) {
  const ctx = ctxOf(id);
  const dir = path.join(PILOT, 'ai/report', id);
  console.log(`[ai3d report] ${id}`);
  await runStages(ctx, [...stagesFor(ctx), renderStageFor(ctx)], { only: ['render'] });
  let gates = [];
  try { gates = [JSON.parse(fs.readFileSync(path.join(dir, 'gates.json'), 'utf8')).gates]; } catch { console.log('no gates.json yet: run ai3d check first for the table'); }
  const srv = await startServer({ port: flags.port });
  let shots = {};
  try { shots = await reportShots(ctx, srv.port, path.join(dir, 'shots')); } finally { srv.stop(); }
  const r = await buildReport(ctx, gates, shots, dir, { heat: !!flags.heat });
  console.log(`  ${rel(r.jpg)}\n  ${rel(r.md)}`);
}

// ── verify: fit into a scratch dir and diff against what is on disk ──
function realPath(ctx, p) {
  const o = ctx.out;
  const map = [[path.join(o, 'fit'), path.join(PILOT, 'ai/fit')], [path.join(o, 'ident'), path.join(PILOT, 'ident')], [path.join(o, 'work', ctx.S.id), abs(ctx.S.work ?? '')],
    [path.join(o, 'ship/base'), path.join(PILOT, 'base')], [path.join(o, 'ship/textures'), path.join(ROOT, 'apps/web/public/textures')],
    [path.join(o, 'ship/models'), path.join(ROOT, 'apps/web/public/models')], [path.join(o, 'ship/identityData.ts'), path.join(ROOT, 'apps/web/src/render/identityData.ts')]];
  for (const [a, b] of map) if (p === a || p.startsWith(a + path.sep)) return path.join(b, path.relative(a, p));
  return null;
}
async function cmpFile(a, b) {
  if (!fs.existsSync(b)) return { st: 'NEW', note: 'no counterpart' };
  if (hashFile(a) === hashFile(b)) return { st: 'same' };
  const ext = path.extname(a);
  if (ext === '.bin') {
    const A = fs.readFileSync(a), B = fs.readFileSync(b);
    if (A.length !== B.length) return { st: 'DRIFT', note: `size ${A.length} vs ${B.length}` };
    const fa = new Float32Array(A.buffer.slice(A.byteOffset, A.byteOffset + A.length)), fb = new Float32Array(B.buffer.slice(B.byteOffset, B.byteOffset + B.length));
    let mx = 0; for (let i = 0; i < fa.length; i++) mx = Math.max(mx, Math.abs(fa[i] - fb[i]));
    return { st: mx < 1e-6 ? 'same~' : 'DRIFT', note: `max |d| ${mx.toExponential(2)}` };
  }
  if (['.png', '.webp', '.jpg'].includes(ext)) {
    const ia = await sharp(a).raw().toBuffer({ resolveWithObject: true }), ib = await sharp(b).raw().toBuffer({ resolveWithObject: true });
    if (ia.data.length !== ib.data.length) return { st: 'DRIFT', note: 'size differs' };
    let mx = 0, sum = 0; for (let i = 0; i < ia.data.length; i++) { const d = Math.abs(ia.data[i] - ib.data[i]); mx = Math.max(mx, d); sum += d; }
    const mean = sum / ia.data.length;
    return { st: mx <= 2 && mean < 0.01 ? 'same~' : 'DRIFT', note: `pixels: max ${mx}/255, mean ${mean.toFixed(4)} (Cycles bake threads: +-1 level)` };
  }
  if (ext === '.json') {
    const num = (x) => JSON.stringify(x, (k, v) => (typeof v === 'number' ? +v.toPrecision(7) : v));
    const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
    return { st: num(A) === num(B) ? 'same~' : 'DRIFT', note: 'json (7 digits)' };
  }
  return { st: 'DRIFT', note: `${fs.statSync(a).size} vs ${fs.statSync(b).size} bytes` };
}
async function verify(id) {
  if (!flags.out) throw new Error('verify needs --out DIR (a scratch dir; nothing shipped is touched)');
  const ctx = ctxOf(id);
  const t0 = Date.now();
  flags.build = true; // also the shipped-GLB compression, into <out>/ship/models
  await fit(id);
  const rows = [];
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '.ai3d' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])) : []);
  const scope = ctx.S.kind === 'body'
    ? [path.join(ctx.out, 'fit', ctx.S.sex), path.join(ctx.out, 'ship')]
    : [path.join(ctx.out, 'ident'), ctx.workDir, path.join(ctx.out, 'ship')];
  const skipRe = /(\.log|\/chk_|dbg_|\.cache)/;
  for (const root of scope) for (const f of walk(root)) {
    if (skipRe.test(f)) continue;
    const real = realPath(ctx, f);
    if (!real) continue;
    rows.push({ file: path.relative(ctx.out, f), ...(await cmpFile(f, real)) });
  }
  const by = (s) => rows.filter((r) => r.st === s);
  rows.filter((r) => r.st !== 'same').forEach((r) => console.log(`  ${r.st.padEnd(6)} ${r.file}  ${r.note ?? ''}`));
  console.log(`[ai3d verify] ${id}: ${rows.length} files: ${by('same').length} identical, ${by('same~').length} equal within float noise, ${by('DRIFT').length} DRIFT, ${by('NEW').length} new, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  fs.writeFileSync(path.join(ctx.out, `verify_${id}.json`), JSON.stringify(rows, null, 1));
}

try {
  await main();
} catch (e) {
  console.error(`ai3d: ${e.message}`);
  process.exit(1);
}
