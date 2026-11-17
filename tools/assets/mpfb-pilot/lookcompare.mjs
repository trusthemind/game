// Render-style pilot (apps/web/src/render/lookStyle.ts) screenshots: node lookcompare.mjs <out-prefix> [m|f ...]
// Writes <out-prefix>_<sex>.jpg: #charlab?view=lookcompare (current left, ?look=sculpt right). Dev server on 5175.
import { chromium } from 'playwright';
const [prefix, ...sexes] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const sex of sexes.length ? sexes.filter((x) => x !== 'none') : ['m', 'f']) {
  const page = await browser.newPage({ viewport: { width: 2200, height: 2500 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/502|Failed to load/.test(m.text())) console.error('console', m.text().slice(0, 400)); });
  await page.goto(`http://localhost:5175/?mute=1&r=${Date.now()}#charlab?view=lookcompare&sex=${sex}`);
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].length === 2 && [...document.querySelectorAll('iframe')].every((f) => f.contentWindow?.__labReady), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${prefix}_${sex}.jpg`, quality: 88, type: 'jpeg' });
  console.log('wrote', `${prefix}_${sex}.jpg`);
  await page.close();
}
await browser.close();
// Carousel samples: LOOKCAROUSEL="<id>:<hair>:<sex>:<yaw>:<d>,..." node lookcompare.mjs <prefix> -> <prefix>_car_<id>.jpg
// (current | sculpt side by side, glued with sharp).
if (process.env.LOOKCAROUSEL) {
  const sharp = (await import('sharp')).default;
  const b2 = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const spec of process.env.LOOKCAROUSEL.split(',')) {
    const [id, hair, sex, yaw, d] = spec.split(':');
    const shots = [];
    for (const look of ['', '&look=sculpt']) {
      const page = await b2.newPage({ viewport: { width: 900, height: 900 } });
      await page.goto(`http://localhost:5175/?mute=1&r=${Date.now()}#charlab?view=carousel&sex=${sex}&t=999&id=${id}&hair=${hair}&yaw=${yaw}&d=${d}&skin=1${look}`);
      await page.waitForFunction(() => window.__carousel?.switches >= 1, null, { timeout: 120000 });
      await page.waitForTimeout(3500);
      shots.push(await page.screenshot({ type: 'png' }));
      await page.close();
    }
    const out = `${prefix}_car_${id}.jpg`;
    await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#222' } }).composite([{ input: shots[0], left: 0, top: 0 }, { input: shots[1], left: 900, top: 0 }]).jpeg({ quality: 88 }).toFile(out);
    console.log('wrote', out);
  }
  await b2.close();
}
// Frame cost: LOOKBENCH=1 node lookcompare.mjs x none -> ms per grid draw (32 views), current vs sculpt, both sexes.
if (process.env.LOOKBENCH) {
  const b3 = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const sex of ['m', 'f'])
    for (const look of ['', '&look=sculpt']) {
      const page = await b3.newPage({ viewport: { width: 1280, height: 1600 } });
      await page.goto(`http://localhost:5175/?mute=1&r=${Date.now()}${look}#charlab?view=lookgrid&sex=${sex}`);
      await page.waitForFunction(() => window.__labReady, null, { timeout: 180000 });
      const r = [];
      for (let k = 0; k < 5; k++) r.push(await page.evaluate(() => window.__lookGrid.bench(20)));
      r.sort((a, b) => a - b);
      console.log(sex, look || 'current', 'median ms/grid', r[2].toFixed(2), 'all', r.map((x) => x.toFixed(1)).join(' '));
      await page.close();
    }
  await b3.close();
}
