#!/usr/bin/env node
/**
 * Asset pipeline: CC0 source packs (Quaternius) → compact, game-ready GLBs in apps/web/public/models.
 *
 *   ASSET_SRC=/path/to/extracted/packs node tools/assets/build.mjs
 *
 * Expects under ASSET_SRC:
 *   ual/      Universal Animation Library [Standard]   (mannequin + 46 animations)
 *   guns/     Ultimate Gun Pack (FBX)
 *   survival/ Survival Pack (FBX)
 *   nature/   Stylized Nature MegaKit (glTF)
 *
 * FBX is parsed with three.js' FBXLoader and re-exported with GLTFExporter (pure JS, no native tools),
 * then everything goes through glTF-Transform: dedup → weld → resample animations → quantize → meshopt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample, weld, reorder, simplify, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/web/public/models');
const SRC = process.env.ASSET_SRC;
if (!SRC) throw new Error('Set ASSET_SRC to the folder with extracted packs');
fs.mkdirSync(OUT, { recursive: true });

// GLTFExporter's binary path uses FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const find = (dir, name) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = find(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
};

function loadFbx(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const obj = new FBXLoader().parse(ab, '');
  // Strip textures (these packs are vertex/material coloured) and normalise materials to PBR.
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // FBXLoader already linearises colours and they get linearised again on export; undo one pass.
    const conv = mats.map(
      (m) =>
        new THREE.MeshStandardMaterial({
          name: m.name,
          color: (m.color ?? new THREE.Color(0.6, 0.6, 0.6)).clone().convertLinearToSRGB(),
          roughness: /metal/i.test(m.name) ? 0.45 : 0.75,
          metalness: /metal/i.test(m.name) ? 0.25 : 0.0,
        }),
    );
    o.material = Array.isArray(o.material) ? conv : conv[0];
  });
  return obj;
}

/** Bake the FBX unit scale/rotation into a clean group sized in metres, centred at the origin, longest axis on +Z. */
function normalise(obj, targetLength) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  if (size.x === longest) wrapper.rotation.y = -Math.PI / 2;
  else if (size.y === longest) wrapper.rotation.x = Math.PI / 2;
  wrapper.scale.setScalar(targetLength / longest);
  wrapper.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(wrapper);
  const c = box2.getCenter(new THREE.Vector3());
  wrapper.position.sub(c);
  const outer = new THREE.Group();
  outer.add(wrapper);
  return outer;
}

async function exportGlb(scene, file, opts = {}) {
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: opts.animations ?? [] });
  const tmp = `${file}.raw.glb`;
  fs.writeFileSync(tmp, Buffer.from(glb));
  await optimise(tmp, file, opts);
  fs.rmSync(tmp);
}

async function optimise(input, output, { skinned = false, simplifyRatio = 0 } = {}) {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(input);
  await doc.transform(
    dedup(),
    prune(),
    ...(skinned ? [] : [weld()]),
    // Top-down camera: trees never get close enough to justify 5–10k triangles each.
    ...(simplifyRatio ? [simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.015 })] : []),
    resample(),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizeNormal: 10, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(output, doc);
  const kb = (fs.statSync(output).size / 1024).toFixed(0);
  console.log(`  → ${path.relative(ROOT, output)} (${kb} KB)`);
}

// ── Weapons ──────────────────────────────────────────────────────────────────
// item def id → [source FBX, length in metres]
const WEAPONS = {
  pm: ['Pistol_1.fbx', 0.2],
  mp443: ['Pistol_3.fbx', 0.22],
  mp133: ['Shotgun_1.fbx', 1.05],
  aks74u: ['AssaultRifle_2.fbx', 0.68],
  sks: ['AssaultRifle_5.fbx', 1.0],
  ak74m: ['AssaultRifle_1.fbx', 0.94],
  akm: ['AssaultRifle_4.fbx', 0.92],
  m4a1: ['AssaultRifle2_1.fbx', 0.9],
  svd: ['SniperRifle_1.fbx', 1.2],
  pkm: ['AssaultRifle2_4.fbx', 1.15],
};
const MELEE = {
  knife: ['Knife.fbx', 0.3],
  karambit: ['Knife.fbx', 0.2],
  machete: ['Knife.fbx', 0.55],
  axe: ['Axe.fbx', 0.75],
  crowbar: ['Shovel.fbx', 0.8],
  bat: ['Axe_Small.fbx', 0.8],
  sledge: ['Axe.fbx', 0.9],
};
const PROPS = {
  backpack: ['Backpack.fbx', 0.55],
  firstaid: ['FirstAidKit_Hard.fbx', 0.35],
  bandage: ['Bandages.fbx', 0.12],
  gascan: ['GasCan.fbx', 0.45],
  propane: ['PropaneTank.fbx', 0.55],
  trashcan: ['Trashcan.fbx', 0.9],
  water: ['WaterBottle_1.fbx', 0.28],
  can: ['Can_Closed.fbx', 0.12],
  radio: ['Radio.fbx', 0.3],
};

async function buildSet(name, table, dirs) {
  console.log(`${name}:`);
  const scene = new THREE.Scene();
  for (const [id, [file, len]] of Object.entries(table)) {
    const src = dirs.map((d) => find(d, file)).find(Boolean);
    if (!src) {
      console.warn(`  ! missing ${file}`);
      continue;
    }
    const g = normalise(loadFbx(src), len);
    g.name = id;
    scene.add(g);
  }
  await exportGlb(scene, path.join(OUT, `${name}.glb`));
}

// ── Character (mannequin + animations) ───────────────────────────────────────
async function buildCharacter() {
  console.log('character:');
  const src = find(path.join(SRC, 'ual'), 'AnimationLibrary_Godot_Standard.glb');
  await optimise(src, path.join(OUT, 'character.glb'), { skinned: true });
}

// ── Nature ───────────────────────────────────────────────────────────────────
async function buildNature() {
  console.log('nature:');
  const dir = path.join(SRC, 'nature/glTF');
  const keep = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'Pine_1', 'Pine_2', 'Pine_3', 'DeadTree_1', 'DeadTree_2', 'TwistedTree_1', 'Bush_Common', 'Rock_Medium_1', 'Rock_Medium_2'];
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const docs = [];
  for (const k of keep) {
    const doc = await io.read(path.join(dir, `${k}.gltf`));
    const root = doc.getRoot();
    // Name the scene's top node after the file so the runtime can look it up.
    const scene = root.listScenes()[0];
    const top = doc.createNode(k);
    for (const n of scene.listChildren()) {
      scene.removeChild(n);
      top.addChild(n);
    }
    scene.addChild(top);
    docs.push(doc);
  }
  const base = docs[0];
  const { mergeDocuments, unpartition } = await import('@gltf-transform/functions');
  for (const d of docs.slice(1)) mergeDocuments(base, d);
  // Collapse all merged scenes into one.
  const scenes = base.getRoot().listScenes();
  for (const s of scenes.slice(1)) {
    for (const n of s.listChildren()) {
      s.removeChild(n);
      scenes[0].addChild(n);
    }
    s.dispose();
  }
  // Normal maps add little from a top-down camera at this distance; drop them and shrink colour maps.
  for (const m of base.getRoot().listMaterials()) m.setNormalTexture(null);
  await base.transform(unpartition(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }));
  const tmp = path.join(OUT, 'nature.raw.glb');
  await io.write(tmp, base);
  await optimise(tmp, path.join(OUT, 'nature.glb'), { simplifyRatio: 0.22 });
  fs.rmSync(tmp);
}

await buildCharacter();
await buildSet('weapons', WEAPONS, [path.join(SRC, 'guns')]);
await buildSet('melee', MELEE, [path.join(SRC, 'survival')]);
await buildSet('props', PROPS, [path.join(SRC, 'survival')]);
await buildNature();
fs.writeFileSync(
  path.join(OUT, 'CREDITS.txt'),
  'All 3D models: Quaternius (https://quaternius.com) — CC0 1.0 Universal.\nUniversal Animation Library, Ultimate Gun Pack, Survival Pack, Stylized Nature MegaKit.\n',
);
console.log('done');
