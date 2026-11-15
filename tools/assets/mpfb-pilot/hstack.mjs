// node hstack.mjs out.jpg a.jpg b.jpg ... [--v] : glue images side by side (or stacked with --v), sharp.
import sharp from 'sharp';
const args = process.argv.slice(2);
const v = args.includes('--v');
const [out, ...ins] = args.filter((a) => a !== '--v');
const metas = await Promise.all(ins.map((f) => sharp(f).metadata()));
const W = v ? Math.max(...metas.map((m) => m.width)) : metas.reduce((s, m) => s + m.width, 0);
const H = v ? metas.reduce((s, m) => s + m.height, 0) : Math.max(...metas.map((m) => m.height));
let o = 0;
const comp = ins.map((f, i) => { const c = { input: f, left: v ? 0 : o, top: v ? o : 0 }; o += v ? metas[i].height : metas[i].width; return c; });
await sharp({ create: { width: W, height: H, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 88 }).toFile(out);
console.log('wrote', out, W, H);
