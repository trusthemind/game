// Headless screenshots of CharLab views (the dev server must be running).
//   node shot.mjs <out.jpg> '<hash after #charlab?>' [w h] [port]
// EVAL='__sheet(["front"], 2.4, 200, 0, 0.92)' runs that in the page first (any CharLab view); QUERY='body=ubc' more URL
// params (the old bodies).
// e.g. node shot.mjs base/m_full.jpg 'view=mpfbbase&sex=m' 1600 900
import { chromium } from 'playwright';

const [out, hash, w = '1600', h = '900', port = '5175'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`http://localhost:${port}/?r=${Date.now()}&mute=1${process.env.QUERY ? `&${process.env.QUERY}` : ''}#charlab?${hash}`);
await page.waitForFunction(() => (window).__mpfb || (window).__labReady, null, { timeout: 120000 });
await page.waitForTimeout(+(process.env.WAIT ?? 2500));
if (process.env.EVAL) {
  await page.evaluate(process.env.EVAL);
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: out.endsWith('.png') ? undefined : 90 });
await browser.close();
console.log('wrote', out);
