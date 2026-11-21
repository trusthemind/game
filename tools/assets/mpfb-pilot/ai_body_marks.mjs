// Posture marks (CharLab __marks) of the `shapes` view's figures over a few frames: node ai_body_marks.mjs [presets] [extra] [port]
import { chromium } from 'playwright';
const [presets = 'average,ai_athletic@0.5,ai_athletic', extra = '', port = '5174'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const sex of ['m', 'f']) {
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  await p.goto(`http://localhost:${port}/?r=${Date.now()}&mute=1${process.env.QUERY ? `&${process.env.QUERY}` : ''}#charlab?view=shapes&sex=${sex}&wear=&armor=0&presets=${presets}${extra}`);
  await p.waitForFunction(() => window.__labReady, null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  const names = presets.split(',');
  const acc = names.map(() => []);
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < names.length; i++) acc[i].push(await p.evaluate((k) => window.__marks(k), i));
    await p.waitForTimeout(300);
  }
  for (let i = 0; i < names.length; i++) {
    const avg = {};
    for (const k of Object.keys(acc[i][0])) avg[k] = Math.round(acc[i].reduce((s, m) => s + m[k], 0) / acc[i].length);
    console.log(sex, names[i].padEnd(16), JSON.stringify(avg));
  }
  await p.close();
}
await b.close();
