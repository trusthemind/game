// Frame time of a CharLab view (dev server running): node bench.mjs '<hash>' [frames]; QUERY='body=ubc' for the old bodies.
import { chromium } from 'playwright';
const [hash, n = '120'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${process.env.PORT ?? 5175}/?r=${Date.now()}&mute=1${process.env.QUERY ? `&${process.env.QUERY}` : ''}#charlab?${hash}`);
await page.waitForFunction(() => window.__labReady, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const runs = [];
for (let i = 0; i < 3; i++) runs.push(await page.evaluate((k) => window.__bench(k), +n));
console.log(JSON.stringify(runs));
await browser.close();
