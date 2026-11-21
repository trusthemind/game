// Browser side of ai3d: a Vite dev server of apps/web (started on a free port unless --port / AI3D_PORT names one that
// answers), the CharLab dev views through Playwright (posture marks, frame time, gear smoke test, report shots), and
// the repo's `npm test` / typecheck gates. The browser sees the SHIPPED GLB (apps/web/public/models), so run
// `ai3d build` first; the gate says so when the shipped GLB is older than the fit outputs.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core.mjs';

const GL = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const G = (id, status, value, limit, note = '', extra = {}) => ({ id, status, value, limit, note, ...extra });

async function reachable(port) {
  try { const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}
const freePort = (from) => new Promise((resolve) => {
  const tryPort = (p) => { const s = net.createServer(); s.once('error', () => tryPort(p + 1)); s.listen(p, () => s.close(() => resolve(p))); };
  tryPort(from);
});

export async function startServer(opts = {}) {
  const want = Number(opts.port ?? process.env.AI3D_PORT ?? 0);
  if (want && (await reachable(want))) return { port: want, stop: () => {}, reused: true };
  const port = await freePort(want || 5290);
  const p = spawn('npm', ['run', 'dev', '-w', '@ashfall/web', '--', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-p.pid); } catch { /* gone */ } };
  process.on('exit', stop);
  for (let i = 0; i < 90; i++) { if (await reachable(port)) return { port, stop, reused: false }; await new Promise((r) => setTimeout(r, 1000)); }
  stop();
  throw new Error('dev server did not start (npm run dev -w @ashfall/web)');
}

async function launch() {
  const { chromium } = await import('playwright');
  return chromium.launch({ args: GL });
}
const url = (port, hash, q = '') => `http://localhost:${port}/?r=${Date.now()}&mute=1${q}#charlab?${hash}`;
async function open(browser, port, hash, { w = 900, h = 600, errs, q = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  if (errs) {
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|manifest|sw\.js|Failed to load resource/i.test(m.text())) errs.push(`console: ${m.text().slice(0, 160)}`); });
  }
  await page.goto(url(port, hash, q));
  await page.waitForFunction(() => window.__labReady, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  return page;
}

/** The CharLab hash of the subject's own figure(s): body -> the shapes view with average + the AI preset. */
export function viewHash(S, { presets, extra = '' } = {}) {
  if (S.kind === 'body') return `view=shapes&sex=${S.sex}&presets=${presets ?? `average,${S.build?.preset ?? 'ai_athletic'}`}${extra}`;
  return `view=helmets&sex=${S.sex}&fid=${S.id}&ids=altyn,ssh68,zsh,h_fast${extra}`;
}

function stale(S, ctx) {
  const shipped = path.join(ROOT, 'apps/web/public/models', `human_${S.sex}.glb`);
  const src = S.kind === 'body' ? path.join(ctx.workDir, 'ai_body_delta.bin') : path.join(ctx.workDir, 'fit.npz');
  if (!fs.existsSync(shipped) || !fs.existsSync(src)) return '';
  return fs.statSync(shipped).mtimeMs < fs.statSync(src).mtimeMs ? 'shipped GLB is older than the fit: run `ai3d build` first' : '';
}

export async function browserGates(ctx, port, only) {
  const { S } = ctx;
  const out = [];
  const want = (id) => !only || only.includes(id);
  const warnStale = stale(S, ctx);
  const browser = await launch();
  try {
    if (want('marks') && S.kind === 'body') {
      const page = await open(browser, port, viewHash(S, { extra: '&wear=&armor=0' }), { q: S.build?.query ? `&${S.build.query}` : '' });
      const acc = [[], []];
      for (let f = 0; f < 6; f++) { for (let i = 0; i < 2; i++) acc[i].push(await page.evaluate((k) => window.__marks(k), i)); await page.waitForTimeout(250); }
      const avg = acc.map((a) => Object.fromEntries(Object.keys(a[0]).map((k) => [k, Math.round(a.reduce((s, m) => s + m[k], 0) / a.length)])));
      await page.close();
      const lim = ctx.S.budgets?.marksMm ?? 20;
      const hv = avg[1].headVsShoulder;
      const ref = Math.max(lim, Math.abs(avg[0].headVsShoulder)); // not worse than the plain MPFB build, or within the limit
      out.push(G('marks', Math.abs(hv) <= ref ? 'PASS' : Math.abs(hv) <= 1.5 * ref ? 'WARN' : 'FAIL', `headVsShoulder ${hv} mm (average ${avg[0].headVsShoulder}), neckLean ${avg[1].neckLean} deg (${avg[0].neckLean}), neckLen ${avg[1].neckLen} (${avg[0].neckLen})`, `|head-over-shoulder|<=max(${lim} mm, average build)`, warnStale, { data: avg }));
    }
    if (want('bench')) {
      const ms = {};
      for (const [tag, presets] of [['avg', 'average'], ['ai', S.build?.preset ?? 'ai_athletic']]) {
        if (S.kind !== 'body' && tag === 'avg') continue;
        const page = await open(browser, port, S.kind === 'body' ? viewHash(S, { presets }) : viewHash(S), { w: 1600, h: 900 });
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push((await page.evaluate(() => window.__bench(120))).ms);
        runs.sort((a, b) => a - b);
        ms[tag] = runs[1];
        await page.close();
      }
      if (ms.avg) {
        const pct = (ms.ai / ms.avg - 1) * 100;
        const lim = ctx.S.budgets?.benchPct ?? 5;
        out.push(G('bench', pct <= lim ? 'PASS' : pct <= 2 * lim ? 'WARN' : 'FAIL', `${ms.ai} ms vs average ${ms.avg} ms (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`, `<=+${lim}%`, 'median of 3 x 120 frames; headless GPU timing is noisy, repeat before believing a WARN', { data: ms }));
      } else out.push(G('bench', 'PASS', `${ms.ai} ms`, '', 'face: no baseline preset'));
    }
    if (want('kit')) {
      const errs = [];
      const variants = S.kind === 'body'
        ? [['idle', ''], ['walk', '&speed=1.6'], ['aim', '&gun=ak74m'], ['crouch', '&crouch=1']].map(([n, q]) => [n, viewHash(S, { presets: S.build?.preset ?? 'ai_athletic', extra: `&wear=c_bomber,c_trousers,c_shoes&armor=1&eq=zsh:helmet,r_alpha:rig${q}` })])
        : [['helmets', viewHash(S)], ['helmets-visor', viewHash(S, { extra: '&visor=1' })]];
      for (const [name, hash] of variants) {
        const e = [];
        try { const page = await open(browser, port, hash, { errs: e }); await page.waitForTimeout(1200); await page.close(); } catch (x) { e.push(`load: ${x.message.slice(0, 120)}`); }
        errs.push(...e.map((m) => `${name}: ${m}`));
      }
      const bad = errs.some((m) => /pageerror|load:/.test(m));
      out.push(G('kit', errs.length === 0 ? 'PASS' : bad ? 'FAIL' : 'WARN', errs.length ? `${errs.length} error(s): ${errs[0]}` : `${variants.length} variants clean (${variants.map((v) => v[0]).join(', ')})`, 'no errors', 'standard kit (bomber, trousers, shoes, trooper armour, zsh helmet, alpha rig) through fitToRest; poses idle / walk / aim / crouch'));
    }
  } finally {
    await browser.close();
  }
  return out;
}

export function npmGate(id, args, label) {
  const t0 = Date.now();
  const r = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const tail = (r.stdout + r.stderr).split('\n').filter((l) => /Tests|passed|failed|error TS|Test Files/i.test(l)).slice(-3).join(' | ');
  return G(id, r.status === 0 ? 'PASS' : 'FAIL', `${label} exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`, 'exit 0', tail.slice(0, 200));
}

/** Report shots (clothed only): returns { name: file }. */
export async function reportShots(ctx, port, outDir) {
  const { S } = ctx;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const files = {};
  try {
    const shot = async (name, hash, evalJs, w, h, clip) => {
      const page = await open(browser, port, hash, { w, h });
      if (evalJs) await page.evaluate(evalJs);
      await page.waitForTimeout(500);
      const f = path.join(outDir, `${name}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 90, ...(clip ? { clip } : {}) });
      await page.close();
      files[name] = f;
    };
    if (S.kind === 'body') {
      const P = `average,${S.build?.preset ?? 'ai_athletic'}`;
      const base = `view=shapes&sex=${S.sex}&armor=0&presets=${P}`; // clothed: default wear (bomber, trousers, shoes)
      await shot('game_body', base, `__sheet(['front','q34','side','back'], 3.1, 520, 0, 0.9)`, 1040, 2080, { x: 0, y: 0, width: 1040, height: 2080 });
      await shot('game_distance', base, `__sheet(['front'], 6.5, 260, 0, 0.9)`, 520, 260, { x: 0, y: 0, width: 520, height: 260 });
      await shot('closeup', base, `__sheet(['front','q34'], 0.62, 300, 0.14, 'head')`, 600, 600, { x: 0, y: 0, width: 600, height: 600 });
      await shot('armour', `view=shapes&sex=${S.sex}&armor=1&eq=zsh:helmet,r_alpha:rig&presets=${P}`, `__sheet(['front','side'], 3.1, 520, 0, 0.9)`, 1040, 1040, { x: 0, y: 0, width: 1040, height: 1040 });
    } else {
      await shot('customize', `view=carousel&sex=${S.sex}&id=${S.id}&yaw=0&d=1.0`, null, 800, 800);
      await shot('closeup', `view=lookgrid&sex=${S.sex}&ai=1`, null, 1680, 420 * 4);
      await shot('helmets', viewHash(S), `__sheet(['front','q34','side'], 0.62, 300, 0.14, 'head')`, 900, 900, { x: 0, y: 0, width: 900, height: 900 });
    }
  } finally {
    await browser.close();
  }
  return files;
}
