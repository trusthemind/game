// Silhouette overlay of the AI body fit (ai_body_render.py masks): target red, ours green, overlap yellow; prints IoU.
//   node ai_body_overlay.mjs <sex> <variant> <out.png>
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [sex, v, out] = process.argv.slice(2);
const dir = path.join(here, 'ai', 'fit', sex);
const tiles = [];
for (const view of ['front', 'side']) {
  const a = await sharp(path.join(dir, `s_${v}_${view}_target.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(path.join(dir, `s_${v}_${view}_ours.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = a.info;
  const o = Buffer.alloc(W * H * 3);
  let I = 0, Un = 0, Ib = 0, Ub = 0;
  // below the head (the heads are the identities'): rows past the figure's top + 15 % of its height
  let top = H, bot = 0;
  for (let i = 0; i < W * H; i++) if (a.data[i] > 128) (top = Math.min(top, Math.floor(i / W))), (bot = Math.max(bot, Math.floor(i / W)));
  const cut = top + 0.15 * (bot - top);
  for (let i = 0; i < W * H; i++) {
    const t = a.data[i] > 128, u = b.data[i] > 128;
    if (t && u) I++;
    if (t || u) Un++;
    if (i / W > cut) (Ib += t && u ? 1 : 0), (Ub += t || u ? 1 : 0);
    o[i * 3] = t ? 230 : 20;
    o[i * 3 + 1] = u ? 200 : 20;
    o[i * 3 + 2] = 20;
  }
  console.log(sex, v, view, 'IoU', (I / Un).toFixed(4), 'below the head', (Ib / Ub).toFixed(4));
  tiles.push(await sharp(o, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
}
const m = await sharp(tiles[0]).metadata();
await sharp({ create: { width: m.width * 2, height: m.height, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * m.width, top: 0 }))).png().toFile(out);
