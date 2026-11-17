// Screenshots of dev views for the ai3d identity checks: node ai3d_shots.mjs <port> <out.png> "<query>" "<hash>" [w h waitMs] ...
// (repeat the 5..7-tuple for more shots; waits for window.__labReady when the view sets it, else waitMs;
// AI3D_EVAL=<js> runs in the page before each shot)
import { chromium } from 'playwright';

const [port, ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (let i = 0; i < rest.length; ) {
  const [out, q, hash] = rest.slice(i, i + 3);
  const nums = [];
  i += 3;
  while (i < rest.length && /^\d+$/.test(rest[i])) nums.push(Number(rest[i++]));
  const [w = 900, h = 900, wait = 9000] = nums;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${port}/?mute=1&r=${Date.now()}${q}#${hash}`);
  await Promise.race([page.waitForFunction(() => window.__labReady, null, { timeout: 240000 }).then(() => page.waitForTimeout(2500)), page.waitForTimeout(wait)]);
  await page.waitForTimeout(1500);
  // AI3D_EVAL: a script run before the shot (e.g. hiding a dev view's info bar)
  if (process.env.AI3D_EVAL) await page.evaluate(process.env.AI3D_EVAL);
  await page.screenshot({ path: out });
  console.log('shot', out);
  await page.close();
}
await browser.close();
