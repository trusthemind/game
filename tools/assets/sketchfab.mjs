#!/usr/bin/env node
/**
 * Download the Sketchfab models listed in tools/assets/sketchfab.json (glTF archives) into
 * $ASSET_SRC/sketchfab/<slug>/, and write their attribution to tools/assets/sketchfab-credits.txt.
 *
 *   SKETCHFAB_TOKEN=… ASSET_SRC=/path/to/packs node tools/assets/sketchfab.mjs [slug…]
 *
 * The token is your own API token (sketchfab.com/settings/password → API Token). It is read from the
 * environment or from ~/.sketchfab_token and is never written anywhere. Only models whose licence is CC0 or
 * CC BY are fetched; anything else is skipped with a warning, since everything here ships in a public repo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.ASSET_SRC;
if (!SRC) throw new Error('Set ASSET_SRC to the folder with extracted packs');
const tokenFile = path.join(os.homedir(), '.sketchfab_token');
const TOKEN = process.env.SKETCHFAB_TOKEN ?? (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
if (!TOKEN) throw new Error('Set SKETCHFAB_TOKEN or put the token in ~/.sketchfab_token');

const OK_LICENCES = /^(CC0|CC Attribution)$/;
const list = JSON.parse(fs.readFileSync(path.join(HERE, 'sketchfab.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const out = path.join(SRC, 'sketchfab');
fs.mkdirSync(out, { recursive: true });

const api = async (url, auth = true) => {
  const r = await fetch(url, { headers: auth ? { Authorization: `Token ${TOKEN}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url.replace(/\?.*/, '')}`);
  return r;
};

const credits = [];
for (const m of list) {
  if (only.size && !only.has(m.slug)) continue;
  const info = await (await api(`https://api.sketchfab.com/v3/models/${m.uid}`, false)).json();
  const licence = info.license?.label ?? '';
  if (!OK_LICENCES.test(licence)) {
    console.warn(`  ! ${m.slug}: licence "${licence}" is not CC0 / CC BY, skipped`);
    continue;
  }
  const dir = path.join(out, m.slug);
  if (!fs.existsSync(path.join(dir, 'scene.gltf'))) {
    const dl = await (await api(`https://api.sketchfab.com/v3/models/${m.uid}/download`)).json();
    const zip = Buffer.from(await (await api(dl.gltf.url, false)).arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, 'model.zip');
    fs.writeFileSync(tmp, zip);
    execFileSync('unzip', ['-qo', tmp, '-d', dir]);
    fs.rmSync(tmp);
    console.log(`  ${m.slug}: ${(zip.length / 1e6).toFixed(1)} MB`);
  } else console.log(`  ${m.slug}: already there`);
  credits.push(`"${info.name}" by ${info.user.displayName} (${info.viewerUrl}) — ${licence === 'CC0' ? 'CC0 1.0' : 'CC BY 4.0'}${m.use ? ` — ${m.use}` : ''}`);
}
fs.writeFileSync(path.join(HERE, 'sketchfab-credits.txt'), credits.join('\n') + '\n');
console.log(`${credits.length} models, credits in tools/assets/sketchfab-credits.txt`);
