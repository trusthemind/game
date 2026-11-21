// ai3d core: repo paths, subject configs, content hashing + stage cache, Blender / node runners, small formatters.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB = path.dirname(fileURLToPath(import.meta.url));
export const AI3D = path.dirname(LIB); // tools/assets/mpfb-pilot/ai3d
export const PILOT = path.dirname(AI3D); // tools/assets/mpfb-pilot
export const ROOT = path.resolve(PILOT, '../../..'); // repo root
export const SUBJECTS = path.join(AI3D, 'subjects');
export const rel = (p) => path.relative(ROOT, p);
export const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(PILOT, p)); // config paths are relative to the pilot dir

// ── subject configs ──
export function listSubjects() {
  return fs.existsSync(SUBJECTS) ? fs.readdirSync(SUBJECTS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
}
export function loadSubject(id) {
  const f = path.join(SUBJECTS, `${id}.json`);
  if (!fs.existsSync(f)) throw new Error(`no subject '${id}' (ai3d list; ai3d init ${id} --kind face|body --sex m|f --glb <file>)`);
  const S = JSON.parse(fs.readFileSync(f, 'utf8'));
  validate(S, id);
  return S;
}
export function saveSubject(S) {
  fs.mkdirSync(SUBJECTS, { recursive: true });
  fs.writeFileSync(path.join(SUBJECTS, `${S.id}.json`), JSON.stringify(S, null, 2) + '\n');
}
function validate(S, id) {
  const bad = [];
  if (S.id !== id) bad.push(`id '${S.id}' != file name`);
  if (!['face', 'body'].includes(S.kind)) bad.push('kind must be face|body');
  if (!['m', 'f'].includes(S.sex)) bad.push('sex must be m|f');
  if (!S.source?.glb) bad.push('source.glb missing');
  if (bad.length) throw new Error(`subject ${id}: ${bad.join('; ')}`);
}

// ── run context: where things are read / written (real repo or a scratch --out dir) ──
export function context(S, opts = {}) {
  const out = opts.out ? path.resolve(opts.out) : null;
  const ctx = { S, out, opts };
  ctx.fitRoot = out ? path.join(out, 'fit') : path.join(PILOT, 'ai', 'fit');
  ctx.identDir = out ? path.join(out, 'ident') : path.join(PILOT, 'ident');
  ctx.ship = out ? path.join(out, 'ship') : null; // null = the real shipped locations
  ctx.baseDir = ctx.ship ? path.join(ctx.ship, 'base') : path.join(PILOT, 'base');
  ctx.texDir = ctx.ship ? path.join(ctx.ship, 'textures') : path.join(ROOT, 'apps/web/public/textures');
  ctx.cacheDir = out ? path.join(out, '.ai3d', S.id) : path.join(PILOT, 'ai', '.ai3d', S.id);
  ctx.workDir = S.kind === 'face' ? (out ? path.join(out, 'work', S.id) : abs(S.work ?? `ai/work/${S.id}`)) : path.join(ctx.fitRoot, S.sex);
  ctx.env = {
    ...process.env,
    AI3D_FIT_ROOT: ctx.fitRoot,
    AI3D_IDENT_DIR: ctx.identDir,
    ...(ctx.ship ? { AI3D_SHIP_OUT: ctx.ship } : {}),
  };
  return ctx;
}

// ── hashing ──
const hcache = new Map();
export function hashFile(f) {
  const st = fs.statSync(f);
  const k = `${f}:${st.size}:${st.mtimeMs}`;
  if (hcache.has(k)) return hcache.get(k);
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(f, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  const d = h.digest('hex');
  hcache.set(k, d);
  return d;
}
/** Hash of files / dirs (dirs: names + sizes, recursively; the big scratch dumps are not worth reading twice). */
export function hashPaths(list, extra = '') {
  const h = crypto.createHash('sha1');
  h.update(String(extra));
  for (const p of list) {
    if (!p) continue;
    if (!fs.existsSync(p)) {
      h.update(`${p}:missing;`);
    } else if (fs.statSync(p).isDirectory()) {
      const walk = (d) => fs.readdirSync(d).sort().forEach((n) => {
        const q = path.join(d, n);
        const st = fs.statSync(q);
        if (st.isDirectory()) walk(q);
        else h.update(`${path.relative(p, q)}:${st.size};`);
      });
      walk(p);
    } else h.update(`${path.basename(p)}:${hashFile(p)};`);
  }
  return h.digest('hex').slice(0, 16);
}
export const sha = (f) => hashFile(f).slice(0, 12);

// ── stage cache ──
const stampFile = (ctx, name) => path.join(ctx.cacheDir, `${name}.json`);
export const readStamp = (ctx, name) => {
  try { return JSON.parse(fs.readFileSync(stampFile(ctx, name), 'utf8')); } catch { return null; }
};
export function writeStamp(ctx, name, rec) {
  fs.mkdirSync(ctx.cacheDir, { recursive: true });
  fs.writeFileSync(stampFile(ctx, name), JSON.stringify(rec, null, 1));
}

/**
 * Run stages in order. stage = { name, scripts[], inputs[], params, outputs[], adoptable, run(ctx, log) }.
 * A stage's hash = scripts + inputs + params + the hashes of the stages before it; unchanged hash + outputs present
 * -> skipped. opts: force, from, only, adopt, dry.
 */
export async function runStages(ctx, stages, opts = {}) {
  const t00 = Date.now();
  const results = [];
  let chain = '';
  let go = !opts.from;
  for (const st of stages) {
    if (opts.from === st.name) go = true;
    const hash = hashPaths([...(st.scripts ?? []), ...(st.inputs ?? [])], JSON.stringify(st.params ?? {}) + chain);
    chain = hash;
    const stamp = readStamp(ctx, st.name);
    const have = (st.outputs ?? []).every((o) => fs.existsSync(o));
    const wanted = go && (!opts.only || opts.only.includes(st.name));
    let status;
    if (!wanted) status = 'skip';
    else if (!opts.force && stamp?.hash === hash && have) status = 'cached';
    else if (opts.adopt && have && st.adoptable !== false) status = 'adopt';
    else status = 'run';
    if ((opts.dry || opts.quiet) && status === 'run') status = 'would-run';
    if (opts.quiet && status === 'adopt') status = 'cached';
    let ms = 0, note = '';
    if (status === 'run' && !opts.dry && !opts.quiet) {
      const t0 = Date.now();
      try {
        note = (await st.run(ctx)) ?? '';
      } catch (e) {
        console.log(line(st.name, 'FAIL', Date.now() - t0, e.message));
        throw e;
      }
      ms = Date.now() - t0;
      const miss = (st.outputs ?? []).filter((o) => !fs.existsSync(o));
      if (miss.length) throw new Error(`${st.name}: outputs missing: ${miss.map(rel).join(', ')}`);
    }
    if (!opts.quiet && !opts.dry && (status === 'run' || status === 'adopt')) writeStamp(ctx, st.name, { hash, at: new Date().toISOString(), ms, status, outputs: (st.outputs ?? []).map((o) => rel(o)) });
    if (status !== 'skip' && !opts.quiet) console.log(line(st.name, status, ms, note));
    results.push({ name: st.name, status, ms, hash });
  }
  if (!opts.quiet) console.log(`  total ${((Date.now() - t00) / 1000).toFixed(1)}s`);
  return results;
}
const line = (n, s, ms, note) => `  ${n.padEnd(8)} ${s.padEnd(9)} ${(ms / 1000).toFixed(1).padStart(6)}s  ${note}`;

// ── process runners ──
export function blenderBin() {
  if (process.env.BLENDER) return process.env.BLENDER;
  for (const c of ['/opt/homebrew/bin/blender', '/Applications/Blender.app/Contents/MacOS/Blender', 'blender']) {
    if (c === 'blender' || fs.existsSync(c)) return c;
  }
  return 'blender';
}
/** Blender --background --python <script> -- args; log to <ctx.cacheDir>/logs/<name>.log; returns the log's lines. */
export function blender(ctx, name, script, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.join(ctx.cacheDir, 'logs'), { recursive: true });
    const logf = path.join(ctx.cacheDir, 'logs', `${name}.log`);
    const fd = fs.openSync(logf, 'w');
    const p = spawn(blenderBin(), ['-b', '-P', script, '--', ...args], { env: { ...ctx.env, ...env }, cwd: PILOT, stdio: ['ignore', fd, fd] });
    p.on('error', reject);
    p.on('close', (code) => {
      fs.closeSync(fd);
      const text = fs.readFileSync(logf, 'utf8');
      if (code !== 0 || /Traceback \(most recent call last\)/.test(text)) {
        reject(new Error(`blender ${path.basename(script)} failed (exit ${code}); log ${rel(logf)}:\n${text.split('\n').slice(-12).join('\n')}`));
      } else resolve(text.split('\n'));
    });
  });
}
export function node(ctx, name, script, args = [], env = {}) {
  fs.mkdirSync(path.join(ctx.cacheDir, 'logs'), { recursive: true });
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...ctx.env, ...env }, cwd: PILOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(path.join(ctx.cacheDir, 'logs', `${name}.log`), (r.stdout ?? '') + (r.stderr ?? ''));
  if (r.status !== 0) throw new Error(`node ${path.basename(script)} failed:\n${(r.stderr || r.stdout).split('\n').slice(-12).join('\n')}`);
  return (r.stdout ?? '').split('\n');
}
export const grep = (lines, re) => lines.filter((l) => re.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());

// ── misc ──
export const fmtKB = (f) => (fs.statSync(f).size / 1024).toFixed(0);
export const exists = (...p) => fs.existsSync(path.join(...p));
export function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  fs.cpSync(a, b, { recursive: true });
}
