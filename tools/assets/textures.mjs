#!/usr/bin/env node
/**
 * Ground textures from ambientCG (CC0 1.0, https://ambientcg.com) → apps/web/public/textures/<kind>.webp.
 *
 *   node tools/assets/textures.mjs
 *
 * Downloads each material's 1K JPG set into a temp folder (or reuses $TEX_SRC), takes the colour map, and
 * writes a 512 px WebP. render/textures.ts loads these over its procedural stand-ins.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/web/public/textures');
const SRC = process.env.TEX_SRC ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ashfall-tex-'));

/** Game texture kind → ambientCG material (and a tint: multiply, to sit the photos in the game's palette). */
const PICKS = {
  grass: ['Grass004', [0.82, 0.86, 0.8]],
  forest: ['Ground078', [0.8, 0.8, 0.78]],
  moss: ['Ground037', [0.6, 0.66, 0.56]],
  dirt: ['Ground106', [0.92, 0.9, 0.88]],
  asphalt: ['Asphalt031', [0.72, 0.72, 0.74]],
  concrete: ['Concrete031', [1, 1, 1]],
  pad: ['Concrete042A', [1, 1, 0.98]],
  gravel: ['Gravel043', [0.9, 0.9, 0.9]],
  cobbles: ['PavingStones138', [0.85, 0.85, 0.85]],
  wood: ['WoodFloor043', [0.95, 0.92, 0.88]],
};

fs.mkdirSync(OUT, { recursive: true });
for (const [kind, [id, tint]] of Object.entries(PICKS)) {
  const dir = path.join(SRC, id);
  if (!fs.existsSync(dir)) {
    const zip = path.join(SRC, `${id}.zip`);
    const r = await fetch(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`);
    if (!r.ok) throw new Error(`${id}: ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-qo', zip, '-d', dir]);
    fs.rmSync(zip);
  }
  const color = fs.readdirSync(dir).find((n) => /_Color\.jpg$/.test(n));
  if (!color) throw new Error(`${id}: no colour map`);
  const out = path.join(OUT, `${kind}.webp`);
  await sharp(path.join(dir, color))
    .resize(512, 512)
    .linear(tint, [0, 0, 0])
    .webp({ quality: 80 })
    .toFile(out);
  console.log(`  ${kind.padEnd(9)} ← ${id}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
