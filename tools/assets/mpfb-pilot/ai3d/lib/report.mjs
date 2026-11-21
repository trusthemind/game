// `ai3d report`: ONE contact sheet (jpg) + the gate table (md). Clothed in-game frames, silhouette overlay, heat map
// (heads: always; bodies: only with --heat, it is the untextured nude mannequin), game distance, Customize.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { PILOT, rel } from './core.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (t, w, h = 28) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16161a"/><text x="8" y="${h - 9}" font-size="${h - 11}" fill="#ddd" font-family="Helvetica,Arial,sans-serif">${esc(t)}</text></svg>`);
const COL = { PASS: '#4caf50', WARN: '#e0a030', FAIL: '#e04545', SKIP: '#777' };

async function rowOf(items, H, gap = 6) {
  const parts = [];
  for (const it of items) {
    const b = await sharp(it.buf ?? it.file).resize({ height: H }).jpeg({ quality: 90 }).toBuffer();
    const m = await sharp(b).metadata();
    parts.push({ b, w: m.width, t: it.label });
  }
  const W = parts.reduce((s, p) => s + p.w + gap, -gap);
  const comp = [];
  let x = 0;
  for (const p of parts) { comp.push({ input: p.b, left: x, top: 28 }); comp.push({ input: label(p.t ?? '', p.w), left: x, top: 0 }); x += p.w + gap; }
  return { buf: await sharp({ create: { width: W, height: H + 28, channels: 3, background: '#0c0c0e' } }).composite(comp).jpeg({ quality: 90 }).toBuffer(), w: W, h: H + 28 };
}

export async function silhouetteOverlay(dir) {
  const tiles = [];
  for (const view of ['front', 'side']) {
    const a = await sharp(path.join(dir, `s_fit_${view}_target.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(path.join(dir, `s_fit_${view}_ours.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = a.info;
    const o = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) { o[i * 3] = a.data[i] > 128 ? 230 : 20; o[i * 3 + 1] = b.data[i] > 128 ? 200 : 20; o[i * 3 + 2] = 20; }
    tiles.push(await sharp(o, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
  }
  const m = await sharp(tiles[0]).metadata();
  return sharp({ create: { width: m.width * 2, height: m.height, channels: 3, background: '#000' } }).composite(tiles.map((t, i) => ({ input: t, left: i * m.width, top: 0 }))).png().toBuffer();
}

export async function buildReport(ctx, gates, shots, outDir, opts = {}) {
  const { S } = ctx;
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  const R = (f) => path.join(ctx.workDir, f);
  if (S.kind === 'body') {
    const items = [];
    if (shots.game_body) items.push({ file: shots.game_body, label: 'in game: average | AI build (front, 3/4, side, back)' });
    if (fs.existsSync(R('s_fit_front_ours.png'))) items.push({ buf: await silhouetteOverlay(ctx.workDir), label: 'silhouette: target red, ours green, overlap yellow' });
    rows.push(await rowOf(items, 1000));
    const r2 = [];
    for (const [k, t] of [['armour', 'with armour + helmet + rig'], ['closeup', 'head close-up'], ['game_distance', 'game distance']]) if (shots[k]) r2.push({ file: shots[k], label: t });
    if (r2.length) rows.push(await rowOf(r2, 460));
    if (opts.heat) rows.push(await rowOf(['front', 'side', 'back'].filter((v) => fs.existsSync(R(`r_fit_${v}_heat.png`))).map((v) => ({ file: R(`r_fit_${v}_heat.png`), label: `heat ${v} (green < 6 mm, red >= 12 mm; unclothed mannequin)` })), 700));
  } else {
    const r1 = [];
    for (const [k, t] of [['customize', 'Customize framing'], ['helmets', 'with helmets'], ['closeup', 'look grid: front / 3/4 / profile / game distance']]) if (shots[k]) r1.push({ file: shots[k], label: t });
    if (r1.length) rows.push(await rowOf(r1, 700));
    const r2 = [];
    for (const [k, t] of [['ai_0', 'AI head front'], ['ours_0', 'ours front'], ['heat_0', 'heat front'], ['overlay_35', 'wire over AI 3/4'], ['heat_90', 'heat profile'], ['ours_90', 'ours profile'], ['ai_90', 'AI profile']]) {
      const f = path.join(ctx.workDir, `chk_${k}.png`);
      if (fs.existsSync(f)) r2.push({ file: f, label: t });
    }
    if (r2.length) rows.push(await rowOf(r2, 420));
  }
  // gate table
  const flat = gates.flatMap((g) => g);
  const h = 22 + flat.length * 20;
  const W = Math.max(...rows.map((r) => r.w), 1400);
  const svg = Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16161a"/>${flat.map((g, i) => `<text x="8" y="${16 + i * 20}" font-size="13" font-family="Menlo,monospace" fill="${COL[g.status]}">${g.status.padEnd(4)}</text><text x="56" y="${16 + i * 20}" font-size="13" font-family="Menlo,monospace" fill="#ddd">${esc(g.id.padEnd(13))} ${esc(g.value)}   [${esc(g.limit)}]</text>`).join('')}</svg>`);
  rows.push({ buf: await sharp(svg).jpeg().toBuffer(), w: W, h });
  const head = label(`${S.id} (${S.kind}, ${S.sex}) -- ${S.provenance?.provider ?? '?'} ${S.provenance?.model ?? ''} -- ${new Date().toISOString().slice(0, 10)}`, W, 30);
  let y = 30;
  const comp = [{ input: head, left: 0, top: 0 }];
  for (const r of rows) { comp.push({ input: r.buf, left: 0, top: y }); y += r.h + 6; }
  const jpg = path.join(outDir, 'report.jpg');
  await sharp({ create: { width: W, height: y, channels: 3, background: '#0c0c0e' } }).composite(comp).jpeg({ quality: 88 }).toFile(jpg);
  const md = gateMd(S, flat, ctx);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  fs.writeFileSync(path.join(outDir, 'gates.json'), JSON.stringify({ subject: S.id, at: new Date().toISOString(), gates: flat }, null, 1));
  return { jpg, md: path.join(outDir, 'report.md') };
}

export function gateMd(S, flat, ctx) {
  const cnt = (s) => flat.filter((g) => g.status === s).length;
  return [
    `# ai3d report: ${S.id} (${S.kind}, ${S.sex})`,
    '',
    `Gates: ${cnt('PASS')} PASS, ${cnt('WARN')} WARN, ${cnt('FAIL')} FAIL, ${cnt('SKIP')} SKIP.`,
    `Provenance: ${S.provenance?.provider ?? '?'} ${S.provenance?.model ?? ''} (${S.provenance?.date ?? '?'}); ${S.provenance?.tos ?? ''}; ${S.provenance?.licence ?? ''}.`,
    '',
    '| status | gate | value | limit | note |',
    '|---|---|---|---|---|',
    ...flat.map((g) => `| ${g.status} | ${g.id} | ${g.value} | ${g.limit} | ${g.note ?? ''} |`),
    '',
    'Human eyes still needed: likeness / identity read, hair and eyes in the game light, how the figure reads at game distance, whether the pose / stance looks natural in motion.',
    '',
  ].join('\n');
}
export { PILOT, rel };
