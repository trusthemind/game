// AI body build, step 3: ship it.
//   * the `ai_body` morph target (rest-space POSITION deltas of ai_body_fit.py) on the body of
//     base/human_{m,f}_mpfb_id.glb -> base/human_{m,f}_mpfb_ai.glb (build.mjs ONLY=mpfb compresses that one into
//     apps/web/public/models/human_{m,f}.glb; quantised like the identities' targets)
//   * its skin (ai_body_bake.py) as apps/web/public/textures/ai_body/{n,c}_{m,f}.webp: n = RG normal xy + B how much
//     applies, c = albedo ratio / 2 (both linear, our body UVs). Loaded only when a character wears the AI build.
//   node ai_body_add.mjs [m|f] [texSize=1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
// ai3d.mjs --out: AI3D_FIT_ROOT = a scratch work root (default ai/fit), AI3D_SHIP_OUT = where the shipped files go instead
const SHIP = process.env.AI3D_SHIP_OUT ? path.resolve(process.env.AI3D_SHIP_OUT) : null;
const FIT_ROOT = process.env.AI3D_FIT_ROOT ? path.resolve(process.env.AI3D_FIT_ROOT) : path.join(here, 'ai', 'fit');
const TEX = SHIP ? path.join(SHIP, 'textures/ai_body') : path.join(ROOT, 'apps/web/public/textures/ai_body');
const BASE_OUT = SHIP ? path.join(SHIP, 'base') : path.join(here, 'base');
fs.mkdirSync(TEX, { recursive: true });
fs.mkdirSync(BASE_OUT, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const SIZE = Number(process.argv[3] ?? 1024);

for (const sex of process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['m', 'f']) {
  const dir = path.join(FIT_ROOT, sex);
  const b = fs.readFileSync(path.join(dir, 'ai_body_delta.bin'));
  const D = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const doc = await io.read(path.join(here, 'base', `human_${sex}_mpfb_id.glb`));
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getName() === 'body');
  const mesh = node.getMesh();
  const prim = mesh.listPrimitives()[0];
  if (prim.getAttribute('POSITION').getCount() * 3 !== D.length) throw new Error(`${sex}: delta length ${D.length / 3} != body verts`);
  for (const t of prim.listTargets()) if (t.getName() === 'ai_body') prim.removeTarget(t);
  const acc = doc.createAccessor('body_ai_body').setType('VEC3').setArray(D).setBuffer(root.listBuffers()[0]);
  prim.addTarget(doc.createPrimitiveTarget('ai_body').setAttribute('POSITION', acc));
  const names = prim.listTargets().map((t) => t.getName());
  mesh.setExtras({ ...(mesh.getExtras() ?? {}), targetNames: names });
  mesh.setWeights(names.map(() => 0));
  let mx = 0;
  for (const v of D) mx = Math.max(mx, Math.abs(v));
  await io.write(path.join(BASE_OUT, `human_${sex}_mpfb_ai.glb`), doc);
  // (for measure_body.mjs: the build at weight 1 baked into the rest positions, local only)
  const P = prim.getAttribute('POSITION');
  const base = P.getArray().slice();
  P.setArray(base.map((v, i) => v + D[i]));
  await io.write(path.join(dir, 'ai_rest.glb'), doc);
  P.setArray(base);
  console.log(sex, 'targets', names.join(','), 'max |d| mm', (mx * 1000).toFixed(1));
  for (const k of ['n', 'c']) {
    const out = path.join(TEX, `${k}_${sex}.webp`);
    await sharp(path.join(dir, `ai_${k}.png`)).resize(SIZE, SIZE, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: k === 'n' ? 90 : 88, smartSubsample: false }).toFile(out);
    console.log('  ', path.relative(ROOT, out), (fs.statSync(out).size / 1024).toFixed(0), 'KB');
  }
}
