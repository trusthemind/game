// In-game shots of the AI athletic build (CharLab `shapes` view, the dev server must be running):
//   node ai_body_shots.mjs <out_dir> [port=5174] [presets=average,ai_athletic] [wear=] [extra hash params]
// -> <out_dir>/game_<sex>_<front|side|back>.jpg (one cell per preset, whole figure) and game_<sex>.jpg (stacked).
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, port = '5174', presets = 'average,ai_athletic', wear = '', extra = '', tag = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PX = 560;
const n = presets.split(',').length;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const sex of (process.env.SEXES ?? 'm,f').split(',')) {
  const page = await browser.newPage({ viewport: { width: Math.max(800, PX * n), height: PX + 40 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${port}/?r=${Date.now()}&mute=1${process.env.QUERY ? `&${process.env.QUERY}` : ''}#charlab?view=shapes&sex=${sex}&wear=${wear}&armor=0&presets=${presets}${extra}`);
  await page.waitForFunction(() => window.__mpfb || window.__labReady, null, { timeout: 120000 });
  await page.waitForTimeout(+(process.env.WAIT ?? 4000));
  const files = [];
  for (const mode of (process.env.MODES ?? 'front,side,back').split(',')) {
    await page.evaluate(`__sheet(['${mode}'], ${process.env.DIST ?? 3.1}, ${PX}, ${process.env.DY ?? 0}, ${process.env.AIM ? (isNaN(+process.env.AIM) ? `'${process.env.AIM}'` : process.env.AIM) : 0.9})`);
    await page.waitForTimeout(400);
    const f = path.join(outDir, `game${tag}_${sex}_${mode}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: PX * n, height: PX } });
    files.push(f);
  }
  await sharp({ create: { width: PX * n, height: PX * files.length, channels: 3, background: '#111' } })
    .composite(files.map((f, i) => ({ input: f, left: 0, top: i * PX })))
    .jpeg({ quality: 88 })
    .toFile(path.join(outDir, `game${tag}_${sex}.jpg`));
  await page.close();
}
await browser.close();
