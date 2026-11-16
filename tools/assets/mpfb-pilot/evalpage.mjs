// Evaluate an expression in a CharLab page once ready: node evalpage.mjs "<extra query>" <sex> "<expr>" ["<hash>"]
import { chromium } from 'playwright';
const q = process.argv[2] ?? '';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
await page.goto(`http://localhost:5175/?r=${Date.now()}&mute=1${q}#charlab?${process.argv[5] ?? `view=hair&sex=${process.argv[3] ?? "m"}&only=crew&size=100`}`);
await page.waitForFunction(() => window.__labReady, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(process.argv[4] ?? 'window.__hairFrames')));
await browser.close();
