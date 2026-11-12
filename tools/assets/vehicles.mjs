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
import { compactPrimitive, dedup, mergeDocuments, meshopt, metalRough, prune, quantize, reorder, simplify, textureCompress, weld } from '@gltf-transform/functions';
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
      vest_soft: 'ar_vest_riikonen',
      body_armor: 'ar_body_armor_cz',
      tactic_vest: 'ar_tactic_vest',
      // Rigs and backpacks
      chest_rig: 'ar_chest_rig',
      lpc: 'ar_lpc',
      combat_vest: 'ar_combat_vest',
      // Gzhel-K: cut out of a whole soldier (one mesh, see `cut`).
      heavy_armor: 'ar_spetsnaz',
      bp_daypack: 'bp_daypack',
      bp_camping: 'bp_camping',
      bp_tactical: 'bp_tactical',
      bp_messenger: 'bp_messenger',
    },
    // Models that are more than the item: the triangles to keep, by their centroid in the source mesh's own
    // space (x, y, z; Z up, front to -Y) and texture pixel (u, r: column, and row up from the bottom, in the 512 atlas).
    cut: {
      // The Spetsnaz soldier is one mesh. Kept: the vest (its khaki plate-carrier panels and collar, atlas
      // left middle) and the two shoulder caps (separate shells on top of the deltoids, centre x ≈ 43);
      // gone: body, helmet, sleeves, pouches, groin flap, legs, and the glove tips that share the vest's atlas area.
      heavy_armor: {
        keep: (x, y, z, u, r) =>
          (u < 212 && r > 128 && r < 352 && z > 95 && x > 18 && x < 69) || (u > 150 && u < 236 && r > 80 && r < 182 && z > 138 && z < 156 && Math.abs(x - 43.3) > 18),
        // The caps sit on an A-posed arm (about 45° below level): swung 55° up about the shoulder joint, they
        // stand 10° above the level arms of our bind pose (T), so on an arm hanging at the side they still cap
        // the shoulder's top rather than its side. Meshes of their own ('cap'): seated on the dressed shoulder
        // and skinned to the upper arm alone (gearFit.ts fitVest), so they turn with the arm, rigid.
        split: 'cap',
        move: (cx) => (Math.abs(cx - 43.3) > 25 ? CAP_SWING[cx < 43.3 ? 0 : 1] : null),
      },
    },
  },
};

/** The Spetsnaz's two shoulder caps' swings (one per side: a side's pieces make one mesh). */
const CAP_SWING = [swing([22, 146], (-55 * Math.PI) / 180), swing([64.6, 146], (55 * Math.PI) / 180)];

/** Rotation about the Y axis (front to back in a Z-up export) through `[x, z]`, by `a` radians. */
function swing([px, pz], a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (v, isDir) => {
    const dx = v[0] - (isDir ? 0 : px);
    const dz = v[2] - (isDir ? 0 : pz);
    return [(isDir ? 0 : px) + dx * c - dz * s, v[1], (isDir ? 0 : pz) + dx * s + dz * c];
  };
}

/** Drops every triangle `cut.keep` refuses and the vertices left unused; then moves each connected piece that
 * `cut.move` (given the piece's centre) returns a transform for. */
function cutTris(doc, cut) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION').getArray();
      const uvA = prim.getAttribute('TEXCOORD_0');
      const UV = uvA ? uvA.getArray() : null;
      const idx = prim.getIndices();
      const I = idx ? idx.getArray() : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
      const out = [];
      for (let t = 0; t < I.length; t += 3) {
        const c = [0, 0, 0, 0, 0];
        for (const v of [I[t], I[t + 1], I[t + 2]]) {
          for (let k = 0; k < 3; k++) c[k] += P[3 * v + k] / 3;
          if (UV) {
            c[3] += (UV[2 * v] * 512) / 3;
            c[4] += (Math.abs(UV[2 * v + 1]) * 512) / 3;
          }
        }
        if (cut.keep(...c)) out.push(I[t], I[t + 1], I[t + 2]);
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(out)));
      compactPrimitive(prim);
      if (!cut.move) continue;
      // Pieces welded by position (UV seams split vertices).
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const Q = pos.getArray();
      const J = prim.getIndices().getArray();
      const n = Q.length / 3;
      const par = Int32Array.from({ length: n }, (_, i) => i);
      const find = (x) => {
        while (par[x] !== x) x = par[x] = par[par[x]];
        return x;
      };
      const at = new Map();
      for (let i = 0; i < n; i++) {
        const key = `${Q[3 * i].toFixed(3)},${Q[3 * i + 1].toFixed(3)},${Q[3 * i + 2].toFixed(3)}`;
        if (at.has(key)) par[find(i)] = find(at.get(key));
        else at.set(key, i);
      }
      for (let t = 0; t < J.length; t += 3) {
        par[find(J[t + 1])] = find(J[t]);
        par[find(J[t + 2])] = find(J[t]);
      }
      const box = new Map();
      for (let i = 0; i < n; i++) {
        const r = find(i);
        const b = box.get(r) ?? { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
        for (let k = 0; k < 3; k++) {
          b.lo[k] = Math.min(b.lo[k], Q[3 * i + k]);
          b.hi[k] = Math.max(b.hi[k], Q[3 * i + k]);
        }
        box.set(r, b);
      }
      const fn = new Map();
      for (const [r, b] of box) fn.set(r, cut.move(...b.lo.map((v, k) => (v + b.hi[k]) / 2)));
      for (let i = 0; i < n; i++) {
        const f = fn.get(find(i));
        if (!f) continue;
        pos.setElement(i, f(pos.getElement(i, []), false));
        if (nrm) nrm.setElement(i, f(nrm.getElement(i, []), true));
      }
      if (!cut.split) continue;
      // Each moved piece becomes a mesh of its own, `cut.split` by name, beside the mesh's node (the fitting
      // treats it as one rigid part). Not under it: quantize gives every mesh node a transform of its own.
      const node = mesh.listParents().find((x) => x.propertyType === 'Node');
      const holder = node.getParentNode();
      if (node.getMatrix().some((v, i) => v !== (i % 5 === 0 ? 1 : 0))) throw new Error('cut.split: mesh node must have no transform');
      const rest = [];
      const parts = new Map();
      for (let t = 0; t < J.length; t += 3) {
        const f = fn.get(find(J[t]));
        if (!f) rest.push(J[t], J[t + 1], J[t + 2]);
        else {
          if (!parts.has(f)) parts.set(f, []);
          parts.get(f).push(J[t], J[t + 1], J[t + 2]);
        }
      }
      for (const tris of parts.values()) {
        const piece = prim.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(tris)));
        compactPrimitive(piece);
        holder.addChild(doc.createNode(cut.split).setMesh(doc.createMesh(cut.split).addPrimitive(piece)));
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(rest)));
      compactPrimitive(prim);
    }
}

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
    if (pack.cut?.[id]) {
      cutTris(src, pack.cut[id]);
      // The Spetsnaz export lights itself (emissive = its diffuse texture) and is mirror-glossy: in our light it
      // came out near white. Plain diffuse, matte.
      for (const m of src.getRoot().listMaterials()) {
        m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
        const sg = m.getExtension('KHR_materials_pbrSpecularGlossiness');
        if (sg) {
          m.setBaseColorTexture(sg.getDiffuseTexture());
          m.setExtension('KHR_materials_pbrSpecularGlossiness', null);
        }
        m.setMetallicFactor(0).setRoughnessFactor(0.85);
      }
    }
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
