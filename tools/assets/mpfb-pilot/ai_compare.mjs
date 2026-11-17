// AI-sheet identities, the sheet next to ours: node ai_compare.mjs <out_dir> [port=5175]
// For each sex: #charlab?view=lookgrid&ai=1 (front / 3/4 / profile close-ups + game distance, each pilot identity with
// its designed hair / beard / tone), default look and ?look=sculpt; then per sheet one image: the sheet's three views
// (top), ours default (middle, mirrored where the sheet faces left), ours sculpt (bottom), the game-distance cells
// on the right. Also writes the raw grids (<out>/ai_lookgrid_<sex>[_sculpt].jpg).
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, port = '5175'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'refs/ai/ai_fit.json'), 'utf8'));
// the sheet's three views (x ranges; rows 120..1320)
const VIEWS = {
  f1: [[131, 937], [973, 1789], [1851, 2645]], f2: [[72, 898], [1000, 1840], [1880, 2700]], f3: [[111, 890], [954, 1714], [1793, 2662]],
  m1: [[76, 865], [1013, 1767], [1835, 2667]], m2: [[56, 908], [1022, 1840], [1845, 2730]], m3: [[138, 855], [971, 1698], [1824, 2664]],
};
const C = 420; // cell px
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
// the pilot identities in the game (identities.json entries with an ai block), in their order per sex
const IDJ = JSON.parse(fs.readFileSync(path.join(here, 'identities.json'), 'utf8'));
const PILOT = { f: IDJ.f.filter((e) => e.ai).map((e) => e.ai.sheet), m: IDJ.m.filter((e) => e.ai).map((e) => e.ai.sheet) };
const grids = {};
for (const sex of ['f', 'm'].filter((x) => PILOT[x].length)) {
  for (const look of ['', '&look=sculpt']) {
    const page = await browser.newPage({ viewport: { width: C * 4, height: C * PILOT[sex].length }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`http://localhost:${port}/?mute=1&r=${Date.now()}${look}#charlab?view=lookgrid&sex=${sex}&ai=1`);
    await page.waitForFunction(() => window.__labReady, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    const buf = await page.screenshot({ type: 'png' });
    grids[sex + look] = buf;
    await sharp(buf).jpeg({ quality: 88 }).toFile(path.join(outDir, `ai_lookgrid_${sex}${look ? '_sculpt' : ''}.jpg`));
    await page.close();
  }
}
await browser.close();

const cell = async (buf, row, col, mirror) => {
  let s = sharp(buf).extract({ left: col * C, top: row * C, width: C, height: C });
  if (mirror) s = s.flop();
  return s.png().toBuffer();
};
const label = (t, w) => Buffer.from(`<svg width="${w}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="21" font-size="18" fill="#eee" font-family="sans-serif">${t}</text></svg>`);
for (const [sheet, m] of Object.entries(cfg.macros)) {
  const sex = m.sex;
  const row = PILOT[sex].indexOf(sheet);
  if (row < 0) continue;
  // (the grid's 3/4 and profile face image-left; the sheets' face `dir`)
  const mirror = cfg.profile[sheet].dir > 0;
  const img = path.join(here, `refs/ai/sheet_${sheet}_nb.png`);
  const top = await Promise.all(VIEWS[sheet].map(async ([x0, x1]) => {
    const w = x1 - x0, h = 1200;
    const sq = Math.max(w, h);
    return sharp(img).extract({ left: x0, top: 120, width: w, height: h }).resize(C, C, { fit: 'contain', background: '#808080' }).png().toBuffer();
  }));
  const ours = await Promise.all([0, 1, 2].map((c) => cell(grids[sex], row, c, mirror && c > 0)));
  const sc = await Promise.all([0, 1, 2].map((c) => cell(grids[sex + '&look=sculpt'], row, c, mirror && c > 0)));
  const gd = await cell(grids[sex], row, 3, false);
  const gds = await cell(grids[sex + '&look=sculpt'], row, 3, false);
  const W = C * 4 + 6, H = 30 + C * 3 + 4;
  const comp = [{ input: label(`${sheet} (ai_${sheet}): AI sheet (top) | ours default (middle) | ours ?look=sculpt (bottom) | right: game distance`, W), left: 0, top: 0 }];
  top.forEach((b, i) => comp.push({ input: b, left: i * (C + 2), top: 30 }));
  ours.forEach((b, i) => comp.push({ input: b, left: i * (C + 2), top: 30 + C + 2 }));
  sc.forEach((b, i) => comp.push({ input: b, left: i * (C + 2), top: 30 + 2 * (C + 2) }));
  comp.push({ input: gd, left: 3 * (C + 2), top: 30 + C + 2 }, { input: gds, left: 3 * (C + 2), top: 30 + 2 * (C + 2) });
  const out = path.join(outDir, `ai_compare_${sheet}.jpg`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 86 }).toFile(out);
  console.log('wrote', out);
}
