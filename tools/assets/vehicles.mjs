#!/usr/bin/env node
/**
 * Sketchfab vehicles and furniture (CC BY, see tools/assets/sketchfab.json) → apps/web/public/models/
 * vehicles.glb, furniture_sf.glb and gear.glb (worn armour and helmets).
 *
 *   ASSET_SRC=/path/to/packs node tools/assets/vehicles.mjs [vehicles|furniture]
 *
 * Reads the glTF downloads in $ASSET_SRC/sketchfab/<slug>/, puts each one under a root node named by its id,
 * shrinks textures to WebP and meshopt-compresses the lot. Orientation and scale are fixed up at load time
 * (render/vehicle.ts, render/furnitureSf.ts), where they can be checked against the sim's boxes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, metalRough, prune, quantize, reorder, simplify, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = process.env.ASSET_SRC;
if (!SRC) throw new Error('Set ASSET_SRC to the folder with extracted packs');

/** id in the game → Sketchfab download slug. */
const PACKS = {
  vehicles: {
    // Seen from above and some way off: 512 px is plenty (1024 made the eight cars 5 MB).
    size: 512,
    models: {
      uaz469: 'veh_uaz469_grox',
      zhiguli: 'veh_zhiguli_pack',
      niva: 'veh_niva_livagof',
      vaz2107: 'veh_vaz2107_prephonat',
      uaz452: 'veh_uaz452_egelsky',
      ural4320: 'veh_ural4320_broutian',
      btr80: 'veh_btr80_broutian',
      izh: 'veh_izh_taras',
    },
  },
  // Small props seen from above: 512 px is plenty.
  furniture_sf: {
    size: 512,
    models: {
      gas_stove: 'furn_gas_stove',
      fridge_old: 'furn_fridge_crate',
      bathtub: 'furn_bathtub_old',
      toilet: 'furn_toilet_dirty',
      tv: 'furn_tv_old',
      radiator: 'furn_radiator_old',
      wardrobe_old: 'furn_wardrobe_1983',
      chair_old: 'furn_chair_soviet',
      bunk_bed: 'furn_bunk_bed',
      locker: 'furn_locker',
      metal_cabinet: 'furn_metal_cabinet',
      metal_table: 'furn_metal_table',
      office_chair: 'furn_office_chair',
      metal_shelf: 'furn_metal_shelf',
      store_shelf: 'furn_store_shelf',
      gun_rack: 'furn_gun_rack',
      filing_cabinet: 'furn_filing_cabinet',
      server_rack: 'furn_server_rack',
      hospital_bed: 'furn_hospital_bed',
      med_cupboard: 'furn_med_cupboard',
      sofa_soviet: 'furn_sofa_soviet',
      armchair_soviet: 'furn_armchair_soviet',
      table_wood: 'furn_table_wood',
      rifle_box: 'furn_rifle_box',
      generator: 'furn_generator',
      school_desk: 'furn_school_desk',
      bookshelf_soviet: 'furn_bookshelf_soviet',
    },
  },
  // Body armour and helmets worn on characters (render/gearModels.ts fits them to the head / chest at load).
  gear: {
    size: 512,
    // Some are sculpt-density: halve them (helmets stay round at 40 px tall).
    simplify: 0.55,
    models: {
      altyn: 'ar_altyn',
      ssh40: 'ar_ssh40',
      ssh36: 'ar_ssh36',
      fast: 'ar_fast',
      wz2005: 'ar_wz2005',
      helmet_headset: 'ar_helmet_headset',
      v_6b43: 'ar_6b43',
      plate_carrier: 'ar_plate_carrier',
      vest_danly: 'cloth_armor_vest',
      vest_pack: 'ar_vest_pack',
    },
  },
};
const want = process.argv[2];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const [name, pack] of Object.entries(PACKS)) {
  if (want && !name.startsWith(want)) continue;
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene(name);
  for (const [id, slug] of Object.entries(pack.models)) {
    const file = path.join(SRC, 'sketchfab', slug, 'scene.gltf');
    if (!fs.existsSync(file)) {
      console.warn(`  ! missing ${slug}`);
      continue;
    }
    const src = await io.read(file);
    mergeDocuments(doc, src);
    // The merged scene is the newest one: hang its roots under one node named after the model.
    const added = doc.getRoot().listScenes().at(-1);
    const holder = doc.createNode(id);
    for (const n of added.listChildren()) holder.addChild(n);
    scene.addChild(holder);
    added.dispose();
    console.log(`  ${id} ← ${slug}`);
  }
  // One buffer for the whole file.
  const [buffer, ...rest] = doc.getRoot().listBuffers();
  for (const b of rest) {
    for (const a of doc.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(buffer);
    b.dispose();
  }
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(
    // Some exports use the spec-gloss extension, which three.js no longer reads (they'd come out white).
    metalRough(),
    dedup(),
    prune(),
    weld(),
    ...(pack.simplify ? [simplify({ simplifier: MeshoptSimplifier, ratio: pack.simplify, error: 0.003 })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [pack.size, pack.size], quality: 82 }),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizeNormal: 10, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(ROOT, `apps/web/public/models/${name}.glb`);
  await io.write(out, doc);
  console.log(`  → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
