#!/usr/bin/env node
/**
 * Asset pipeline: CC0 source packs (Quaternius) → compact, game-ready GLBs in apps/web/public/models.
 *
 *   ASSET_SRC=/path/to/extracted/packs node tools/assets/build.mjs
 *
 * Expects under ASSET_SRC:
 *   ual/      Universal Animation Library [Standard]   (Unreal FBX: 45 animations)
 *   ual2/     Universal Animation Library 2 [Standard] (glTF: male + female mannequin, 43 animations)
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
function normalise(obj, targetLength, opts = {}) {
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
  // Point the muzzle/blade at +Z: the slimmer end (barrel, blade tip) is the front, the bulkier end
  // (stock, grip, handle) is the back. Compare vertical extent of the two end slices.
  if (opts.autoFlip) {
    const b = new THREE.Box3().setFromObject(wrapper);
    const len = b.max.z - b.min.z;
    const ends = { front: [Infinity, -Infinity], back: [Infinity, -Infinity] };
    const v = new THREE.Vector3();
    wrapper.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const e = v.z > b.max.z - len * 0.18 ? ends.front : v.z < b.min.z + len * 0.18 ? ends.back : null;
        if (!e) continue;
        e[0] = Math.min(e[0], v.y);
        e[1] = Math.max(e[1], v.y);
      }
    });
    const hFront = ends.front[1] - ends.front[0];
    const hBack = ends.back[1] - ends.back[0];
    // 'slim': barrel/blade forward. 'heavy': axe/hammer head forward.
    if (opts.autoFlip === 'heavy' ? hFront < hBack : hFront > hBack) wrapper.rotation.y += Math.PI;
    wrapper.updateMatrixWorld(true);
  }
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
  pm: ['Pistol_1.fbx', 0.3],
  mp443: ['Pistol_3.fbx', 0.32],
  mp133: ['Shotgun_1.fbx', 1.05],
  aks74u: ['AssaultRifle_2.fbx', 0.68],
  sks: ['AssaultRifle_5.fbx', 1.0],
  ak74m: ['AssaultRifle_1.fbx', 0.94],
  akm: ['AssaultRifle_4.fbx', 0.92],
  m4a1: ['AssaultRifle2_1.fbx', 0.9],
  svd: ['SniperRifle_1.fbx', 1.2],
  pkm: ['AssaultRifle2_4.fbx', 1.15],
  glock17: ['Pistol_2.fbx', 0.3],
  rhino: ['Revolver_2.fbx', 0.3],
  toz: ['Shotgun_SawedOff.fbx', 0.58],
  pp19: ['SubmachineGun_2.fbx', 0.66],
  mp5: ['SubmachineGun_1.fbx', 0.64],
  vector: ['SubmachineGun_3.fbx', 0.6],
  saiga12: ['Shotgun_3.fbx', 1.0],
  vepr: ['AssaultRifle_3.fbx', 1.0],
  aug: ['Bullpup_1.fbx', 0.78],
  hk416: ['AssaultRifle2_2.fbx', 0.92],
  rpk16: ['AssaultRifle2_3.fbx', 1.06],
  mosin: ['SniperRifle_2.fbx', 1.25],
  sv98: ['SniperRifle_3.fbx', 1.2],
};
// Attachments (model, length in metres). Orientation: +Z forward like the guns.
const MODS = {
  sup_short: ['Silencer_Short.fbx', 0.13],
  sup_mid: ['Silencer_2.fbx', 0.19],
  sup_long: ['Silencer_long.fbx', 0.26],
  brake: ['Silencer_1.fbx', 0.08],
  scope_dot: ['Scope_1.fbx', 0.12],
  scope_mid: ['Scope_2.fbx', 0.22],
  scope_long: ['Scope_3.fbx', 0.32],
  grip: ['Grip.fbx', 0.1],
  stock: ['Stock.fbx', 0.24],
  light: ['Flashlight.fbx', 0.12],
};
const MELEE = {
  knife: ['Knife.fbx', 0.4],
  karambit: ['Knife.fbx', 0.32],
  machete: ['Knife.fbx', 0.7],
  axe: ['Axe.fbx', 0.9],
  crowbar: ['Shovel.fbx', 1.0],
  bat: ['Axe_Small.fbx', 0.85],
  sledge: ['Axe.fbx', 1.05],
};
const HEAVY_FRONT = new Set(['axe', 'sledge', 'bat', 'crowbar']);

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
    const g = normalise(loadFbx(src), len, { autoFlip: HEAVY_FRONT.has(id) ? 'heavy' : 'slim' });
    g.name = id;
    scene.add(g);
  }
  await exportGlb(scene, path.join(OUT, `${name}.glb`));
}

// ── Character (mannequin + animations) ───────────────────────────────────────
// UAL2 (glTF, Unreal-style skeleton) is the base: male mannequin + 43 clips (climb, loot, consume, zombie
// locomotion, melee…). UAL1's Unreal FBX uses the identical skeleton and rest pose, so its 45 clips
// (locomotion, crouch, pistol, death, hits…) are copied straight onto the same joints by name.
// The female mannequin shares the skeleton and is exported mesh-only.
async function buildCharacter() {
  console.log('character:');
  const ual2 = find(path.join(SRC, 'ual2'), 'UAL2_Standard.glb');
  const ual1 = find(path.join(SRC, 'ual'), 'AL_Standard.fbx');
  const female = find(path.join(SRC, 'ual2'), 'Mannequin_F.glb');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(ual2);
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const have = new Set(root.listAnimations().map((a) => a.getName()));
  const buffer = root.listBuffers()[0];
  const fbx = loadFbx(ual1);
  let added = 0;
  for (const clip of fbx.animations) {
    const name = clip.name.replace(/^.*\|/, '');
    if (have.has(name)) continue;
    const anim = doc.createAnimation(name);
    for (const track of clip.tracks) {
      const [bone, prop] = track.name.split('.');
      const node = nodes.get(bone);
      const pathName = prop === 'quaternion' ? 'rotation' : prop === 'position' ? 'translation' : prop === 'scale' ? 'scale' : null;
      // The FBX root carries the Z-up→Y-up conversion; the glTF root already has its own. Skip it.
      if (!node || !pathName || bone === 'root') continue;
      // Only the hips carry translation; dropping the rest keeps limbs from drifting with FBX unit noise.
      if (pathName === 'translation' && bone !== 'pelvis') continue;
      if (pathName === 'scale') continue;
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(track.times)).setBuffer(buffer);
      const output = doc
        .createAccessor()
        .setType(pathName === 'rotation' ? 'VEC4' : 'VEC3')
        .setArray(new Float32Array(track.values))
        .setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
    }
    added++;
  }
  // Top-down camera: finger curls are invisible, and a lot of clips are irrelevant for this game.
  const DROP = /^(Swim|Driving|Dance|Farm_|Fishing|Shield_|Idle_Shield|NinjaJump|Slide_|Spell_|TreeChopping|Idle_Rail|Idle_Lantern|Jump_|Roll|Sword_Dash|Walk_Formal|A_TPose|Hit_Knockback_RM|Idle_Torch)/;
  const FINGER = /^(index|middle|pinky|ring|thumb)_/;
  for (const anim of root.listAnimations()) {
    if (DROP.test(anim.getName())) {
      anim.dispose();
      continue;
    }
    for (const ch of anim.listChannels()) {
      if (FINGER.test(ch.getTargetNode()?.getName() ?? '')) {
        const sm = ch.getSampler();
        ch.dispose();
        sm?.dispose();
      }
    }
  }
  console.log(`  merged ${added} UAL1 clips → ${root.listAnimations().length} kept`);
  const tmp = path.join(OUT, 'character.raw.glb');
  await io.write(tmp, doc);
  await optimise(tmp, path.join(OUT, 'character.glb'), { skinned: true });
  fs.rmSync(tmp);
  // Female body: mesh + skin only.
  const fdoc = await io.read(female);
  for (const a of fdoc.getRoot().listAnimations()) a.dispose();
  const ftmp = path.join(OUT, 'character_f.raw.glb');
  await io.write(ftmp, fdoc);
  await optimise(ftmp, path.join(OUT, 'character_f.glb'), { skinned: true });
  fs.rmSync(ftmp);
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

// ── Humans (Universal Base Characters: modelled faces, eyes, eyebrows, PBR skin) ───────────────────────
// Same 65-joint skeleton as the animation libraries. Bodies become human_m / human_f; every hairstyle and
// the beard go into hair.glb as separate skinned meshes (the renderer rebinds them to the body's bones).
async function buildHumans() {
  console.log('humans:');
  const root = find(path.join(SRC, 'ubc'), 'Superhero_Male_FullBody.gltf');
  if (!root) return console.warn('  ! ubc missing');
  const dir = path.dirname(root);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const tex = textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 });
  for (const [file, out] of [['Superhero_Male_FullBody.gltf', 'human_m'], ['Superhero_Female_FullBody.gltf', 'human_f']]) {
    const doc = await io.read(path.join(dir, file));
    // Roughness maps add little from a top-down camera.
    for (const m of doc.getRoot().listMaterials()) m.setMetallicRoughnessTexture(null);
    await doc.transform(prune(), tex);
    const tmp = path.join(OUT, `${out}.raw.glb`);
    await io.write(tmp, doc);
    await optimise(tmp, path.join(OUT, `${out}.glb`), { skinned: true });
    fs.rmSync(tmp);
  }
  // Hair: one document, one named root per style.
  // The "Rigged to Head Bone" variants are skinned; "Origin at 0" ones are static.
  const hairDir = path.dirname(find(fs.readdirSync(path.join(SRC, 'ubc'), { recursive: true }).map(String).filter((f) => /Rigged to Head Bone.*glTF/.test(f) && f.endsWith('Hair_Long.gltf')).map((f) => path.join(SRC, 'ubc', path.dirname(f)))[0], 'Hair_Long.gltf'));
  const styles = ['Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard', 'Eyebrows_Regular', 'Eyebrows_Female'];
  const { mergeDocuments, unpartition } = await import('@gltf-transform/functions');
  const base = new (await import('@gltf-transform/core')).Document();
  base.createBuffer();
  for (const st of styles) {
    const d = await io.read(path.join(hairDir, `${st}.gltf`));
    for (const sc of d.getRoot().listScenes()) for (const n of sc.listChildren()) n.setName(st);
    mergeDocuments(base, d);
  }
  const scenes = base.getRoot().listScenes();
  const main = scenes[0];
  for (const sc of scenes.slice(1)) {
    for (const n of sc.listChildren()) main.addChild(n);
    sc.dispose();
  }
  base.getRoot().setDefaultScene(main);
  for (const m of base.getRoot().listMaterials()) m.setMetallicRoughnessTexture(null);
  await base.transform(unpartition(), dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }));
  const tmp = path.join(OUT, 'hair.raw.glb');
  await io.write(tmp, base);
  await optimise(tmp, path.join(OUT, 'hair.glb'), { skinned: true });
  fs.rmSync(tmp);
}

// ONLY=character,weapons… rebuilds a subset.
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !only || only.has(k);
if (want('character')) await buildCharacter();
if (want('humans')) await buildHumans();
if (want('weapons')) await buildSet('weapons', WEAPONS, [path.join(SRC, 'guns')]);
if (want('melee')) await buildSet('melee', MELEE, [path.join(SRC, 'survival')]);
if (want('mods')) await buildSet('mods', MODS, [path.join(SRC, 'guns')]);
if (want('props')) await buildSet('props', PROPS, [path.join(SRC, 'survival')]);
if (want('nature')) await buildNature();
fs.writeFileSync(
  path.join(OUT, 'CREDITS.txt'),
  'All 3D models: Quaternius (https://quaternius.com) — CC0 1.0 Universal.\nUniversal Animation Library, Ultimate Gun Pack, Survival Pack, Stylized Nature MegaKit.\n',
);
console.log('done');
