#!/usr/bin/env node
/**
 * Guns built from parts (Sketchfab, CC BY, see tools/assets/sketchfab.json) → apps/web/public/models/<platform>.glb.
 *
 *   ASSET_SRC=/path/to/packs node tools/assets/weapons.mjs [ak|ar|attach]
 *
 * Each platform has one frame, in metres: the bore on the Z axis (muzzle towards +Z), up +Y, the gun's left +X,
 * the origin on the bore above the middle of the magazine. Every part is a root node named by its item id with
 * its geometry already in that frame, so a gun is drawn by adding its parts at the identity. Parts from other
 * models are brought into the frame by their magazine (the same AK-74 / STANAG magazine in every model): scale
 * by its height, move its centre onto the base model's (or another part both have, `baseMag`).
 *
 * Sockets for parts that bolt on anywhere (sights, grips, lights, muzzle devices) are empty child nodes named
 * `socket_<id>` (three.js strips ':' from node names); attach.glb holds those parts with their mounting point at the origin (see ATTACH below).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, mergeDocuments, prune, quantize, reorder, simplify, textureCompress, transformPrimitive, unpartition, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'apps/web/public/models');
const SRC = process.env.ASSET_SRC;
if (!SRC) throw new Error('Set ASSET_SRC to the folder with extracted packs');

// ── Small linear algebra (column-major 4×4, like glTF) ────────────────────────
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const axis = (s) => AXES[s.at(-1)].map((v) => (s[0] === '-' ? -v : v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/** Source → frame: rows are the frame's axes (left, up, forward) in source coordinates, then scale, then shift. */
function frameMatrix(forward, up, scale, shift) {
  const f = axis(forward);
  const u = axis(up);
  const l = cross(u, f);
  const rows = [l, u, f];
  const m = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = rows[r][c] * scale;
  m[12] = shift[0];
  m[13] = shift[1];
  m[14] = shift[2];
  m[15] = 1;
  return m;
}

/** Bounds of some nodes in the frame (the corners of their world boxes, through `m`). */
function boundsIn(nodes, m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of nodes) {
    const b = getBounds(n);
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const p = apply(m, [x, y, z]);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
          }
        }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2), size: max.map((v, i) => v - min[i]) };
}

/** A box (download units) in frame `m`. */
function boxIn([lo, hi], m) {
  const ps = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => apply(m, [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]));
  const min = [0, 1, 2].map((a) => Math.min(...ps.map((p) => p[a])));
  const max = [0, 1, 2].map((a) => Math.max(...ps.map((p) => p[a])));
  return { min, max, center: min.map((v, a) => (v + max[a]) / 2), size: max.map((v, a) => v - min[a]) };
}

// ── Platforms ─────────────────────────────────────────────────────────────────
/**
 * Sources: slug, which way the muzzle and the top of the gun point in the download, the magazine (to register
 * it), and for the base model its unit and bore (a node centred on the bore).
 */
/** The Vector's magazine: its body in one mesh (with the charging handle and muzzle), its base plate in another. */
const vectorMag = (c, n) => (/007_0$/.test(n) ? c[0] > -4.1 && c[0] < 0.8 && c[1] < 3.2 : /008_0$/.test(n) && c[1] < -5);

/** The AUG's magazine pieces (body, base plate, rounds): small, behind the grip. Download units. */
const augMag = (i) => i.min[0] > -20 && i.max[0] < -9 && i.max[1] < 9 && i.max[0] - i.min[0] < 11;
/** What's on the AUG that isn't the AUG: the scope over the rail, the foregrip under it, a gadget on its side. */
const augExtra = (i) => i.min[1] > 12.2 || (i.min[0] > 21 && i.max[1] < 3.5) || i.min[2] < -3;

const PLATFORMS = {
  ak: {
    base: 'fjh',
    sources: {
      fjh: { slug: 'gun_ak74m_fjh', forward: '-z', up: 'y', mag: /^Magazine_lowT$/, unit: 0.01, bore: /^Barrel_lowT$/ },
      zenitco: { slug: 'gun_ak74m_zenitco', forward: 'x', up: 'y', mag: /^ak74 30rnd mag \(polymer\)_6$/ },
      custom: { slug: 'gun_ak74_custom', forward: 'z', up: 'y', mag: /^mag(_cap)?_low$/ },
      // Whole guns of their own size: scaled to their real length (stock out), placed by their magazine.
      // AKS-74U in separate parts (all its mesh nodes are 'defaultMaterial'; their parents are named part_N_low).
      aks: { slug: 'gun_aks74u_roma', forward: '-z', up: 'y', mag: /^part_11(_\d)?_low$/ },
      akm: { slug: 'gun_akm_jeandiz', forward: '-z', up: 'y', mag: /^Cube\.004$/, length: 0.88 },
      // RPK-16 (notcplkerry, real size in metres): placed by its pistol grip onto the AK-74's, so AK grips, stocks
      // and magazines go on it where they belong. Three loose rounds lie under it.
      rpk: { slug: 'gun_rpk16_kerry', forward: 'x', up: 'y', mag: /^Object_33$/, baseMag: /^Handle_lowT$/, length: 0.84, only: /^Object_(?!(44|45|52|53|54)$)\d+$/ },
    },
    // item id → [source, node names, options]. `above` / `below`: keep the triangles above / below the bore by
    // that many metres (one mesh holding two parts). `snap`: slide the part along the bore so its rear (front) end
    // meets the factory part's — the end that bolts onto the receiver; 'fit' also stretches it to the same length.
    parts: {
      ak74m: ['fjh', /^(Receiver\d?|Trigger|ModeSwitch|MagHolder\d?|MagHolderLatch|Shutter|SightBlock\d?|SightYoke|DovetailSupport\d?|Barrel|Barrel2|IronsightFront|Ramrod)_lowT$/],
      ak_pg_74: ['fjh', /^Handle_lowT$/],
      ak_dc: ['fjh', /^ReceiverCover\d?_lowT$/],
      ak_gt_74: ['fjh', /^GasOutletPipe_lowT$/],
      ak_hg_74: ['fjh', /^Forend\d?_lowT$/],
      ak_st_74m: ['fjh', /^Stock\d?_lowT$/],
      ak_mz_74: ['fjh', /^Barrel1_lowT$/],
      mag_ak545_30: ['fjh', /^Magazine_lowT$/],
      ak_pg_rk9: ['zenitco', /^rk9 pistol grip/],
      ak_st_pt1: ['zenitco', /^pt1 /, { snap: ['ak_st_74m', 'front'] }],
      ak_gt_b19: ['zenitco', /^b10\+b19 handguard/, { above: 0.004 }],
      ak_hg_b10: ['zenitco', /^b10\+b19 handguard/, { below: 0.004 }],
      ak_st_zhukov: ['custom', /^magpull_stock(_\d+)?_low$/, { snap: ['ak_st_74m', 'front'] }],
      ak_pg_moe: ['custom', /^handle_low$/],
      ak_hg_fab: ['custom', /^Handguard_\d_low$/, { below: 0.006, snap: ['ak_hg_74', 'fit'] }],
      // AKS-74U: receiver with its folding stock, sights and bolt; the wooden handguard apart. Grip and magazine are
      // the AK-74's; its own booster is drawn (weaponAssembly.ts), the download has a PBS-4 on instead.
      aks74u: ['aks', /^(AkWelding|akButt|part_(1|2|4|5|6|6_1|7|8|9|9_1|12|12_1|12_2|13|14|15|16|16_\d))_low$/],
      aks74u_hg: ['aks', /^part_3(_\d)?_low$/],
      // AKM: its own furniture and magazine; it has no dust cover (the AK-74's fits).
      akm: ['akm', /^(RECEIVER|LEVER|IRON_SIGHT|Body\.002|Circle(\.\d+)?|Cube\.00[23])$/],
      ak_pg_akm: ['akm', /^Cube\.001$/],
      ak_gt_akm: ['akm', /^Body\.001$/],
      ak_hg_akm: ['akm', /^Body\.000$/],
      ak_st_akm: ['akm', /^Cube$/],
      mag_akm30: ['akm', /^Cube\.004$/],
      // RPK-16: receiver with its railed dust cover and barrel; its grip, stock, handguard, brake and 95-round drum
      // (fits any AK-74) apart. Its factory 45-round magazine is the AK-74's 30 drawn a half longer.
      rpk16: ['rpk', /^Object_(4|6|10|11|13|15|17|19|21|22|24|26|29|31|36|39|41|42|47|49|50)$/],
      ak_pg_rpk16: ['rpk', /^Object_3[34]$/],
      ak_st_rpk16: ['rpk', /^Object_(8|38)$/],
      rpk16_hg: ['rpk', /^Object_28$/],
      ak_mz_rpk16: ['rpk', /^Object_59$/],
      mag_rpk95: ['rpk', /^Object_5[67]$/],
      mag_ak45: ['fjh', /^Magazine_lowT$/, { stretch: 1.5 }],
    },
    // Where bolt-on parts go: [part, socket id, place on the part's box, kind].
    sockets: [
      ['ak74m', 'side', 'dovetail', 'scope'],
      ['ak74m', 'muzzle', 'muzzleBase', 'muzzle'],
      ['ak_gt_b19', 'sight', 'top', 'scope'],
      ['ak_hg_b10', 'foregrip', 'bottom', 'grip'],
      ['ak_hg_fab', 'foregrip', 'bottom', 'grip'],
      ['ak_hg_fab', 'tactical', 'right', 'light'],
      ['aks74u', 'side', 'dovetail', 'scope'],
      ['aks74u', 'muzzle', 'front', 'muzzle'],
      ['akm', 'side', 'dovetail', 'scope'],
      ['akm', 'muzzle', 'muzzleTip', 'muzzle'],
      ['rpk16', 'sight', 'top', 'scope'],
      ['rpk16', 'muzzle', 'muzzleTip', 'muzzle'],
      ['rpk16_hg', 'foregrip', 'bottom', 'grip'],
      ['rpk16_hg', 'tactical', 'right', 'light'],
    ],
  },
  pistol: {
    base: 'pm',
    sources: {
      // In metres but not to scale (sized by the PM's real length); a spare magazine and a round lie beside it.
      pm: { slug: 'gun_pm_valter', forward: 'z', up: 'y', mag: /^magazin_body_low_/, length: 0.161, bore: /^body_stvol_low_/ },
      // Unnamed nodes (Object_N); two loose rounds lie beside it.
      // Rhino 60DS; its cylinder is the node called 'magazine'.
      rhino: { slug: 'gun_rhino_sasima', forward: 'z', up: 'y', mag: /^magazine_low_/, length: 0.265 },
      // The same maker's style as the MP-443 (unnamed nodes); a loose round lies beside it.
      glock17: { slug: 'gun_g17_kerry', forward: '-z', up: 'y', mag: /^Object_16$/, length: 0.202, only: /^Object_(4|6|8|9|11|12|14|16|17|19|21|22|24|25|26|28|30|36|38|40)$/ },
      mp443: { slug: 'gun_mp443_kerry', forward: '-z', up: 'y', mag: /^Object_35$/, length: 0.198, only: /^Object_(4|5|7|8|9|11|12|14|23|25|27|29|31|33|35|36|38)$/ },
    },
    // The frame is the gun (barrel, trigger, hammer and guard on it); slide and magazine come off.
    parts: {
      pm: ['pm', /^(body|body_skoba|body_trigger|body_button|body_pin|Body_pin2|body_stvol|kurok|magazin_release)_low_/],
      pm_slide: ['pm', /^zatvor(_predohran)?_low_/],
      pm_mag8: ['pm', /^magazin_(body|podavatel|ring|spring)_low_/],
      mp443: ['mp443', /^Object_(4|5|11|12|14|23|25|27|29|31|33|38)$/],
      mp443_slide: ['mp443', /^Object_(7|8|9)$/],
      mp443_mag18: ['mp443', /^Object_3[56]$/],
      glock17: ['glock17', /^Object_(4|6|14|19|24|25|26|28|30|36|38|40)$/],
      glock_slide: ['glock17', /^Object_(8|9|11|12|21|22)$/],
      glock_mag17: ['glock17', /^Object_1[67]$/],
      // The cylinder with what swings out with it (extractor, axle); the crane and everything else is the frame.
      rhino: ['rhino', /^(?!(magazine|Extractor|ExtractorRodHead|ExtractorPlunger|CylinderRotationAxle|Cylinder)_low_)\w+_low_Material/],
      rhino_cyl: ['rhino', /^(magazine|Extractor|ExtractorRodHead|ExtractorPlunger|CylinderRotationAxle|Cylinder)_low_/],
    },
    sockets: [
      ['mp443', 'tactical', 'dustCover', 'light'],
      ['glock17', 'tactical', 'dustCover', 'light'],
      ['glock17', 'muzzle', 'muzzleTip', 'muzzle'],
      ['glock_slide', 'sight', 'top', 'scope'],
    ],
  },
  smg: {
    base: 'pp19',
    sources: {
      // The same maker as the MP-443 (unnamed nodes); three loose rounds lie beside it.
      pp19: { slug: 'gun_pp19_kerry', forward: '-z', up: 'y', mag: /^Object_52$/, length: 0.698, bore: /^Object_62$/, only: /^Object_(?!4[5-7]$)\d+$/ },
      mp5: { slug: 'gun_mp5_kerry', forward: '-z', up: 'y', mag: /^Object_30$/, length: 0.7, only: /^Object_(?!3[2-4]$)\d+$/ },
      // One mesh per material (no textures), each holding bits of several parts: cut apart by where they lie
      // (download units: the stock behind x -10.3, the magazine under the receiver). Its red dot and grip stay out.
      vector: { slug: 'gun_vector_tt', forward: 'x', up: 'y', magBox: [[-4.06, -6.86, -0.64], [0.72, 3.14, 0.64]], length: 0.62 },
    },
    parts: {
      pp19: ['pp19', /^Object_(4|6|7|9|11|13|15|17|18|19|21|24|27|29|31|33|34|36|43|49|50|53|60|62)$/],
      pp19_hg: ['pp19', /^Object_(23|26)$/],
      pp19_st: ['pp19', /^Object_(38|39|41)$/],
      pp19_mag30: ['pp19', /^Object_(52|54|56|57|58)$/],
      mp5: ['mp5', /^Object_(4|5|7|9|13|15|16|18|19|20|22)$/],
      mp5_hg: ['mp5', /^Object_11$/],
      mp5_st: ['mp5', /^Object_(24|25|27|28)$/],
      mp5_mag30: ['mp5', /^Object_30$/],
      vector: ['vector', /^Cube\.005_/, { keep: (c, n) => c[0] >= -10.3 && !vectorMag(c, n) }],
      vector_st: ['vector', /^Cube\.005_/, { keep: (c) => c[0] < -10.3 }],
      vector_mag17: ['vector', /^Cube\.005_Material\.00[78]_0$/, { keep: vectorMag }],
    },
    sockets: [
      ['pp19', 'sight', 'top', 'scope'],
      ['pp19', 'muzzle', 'muzzleTip', 'muzzle'],
      ['mp5', 'sight', 'top', 'scope'],
      ['mp5', 'muzzle', 'muzzleTip', 'muzzle'],
      ['vector', 'sight', 'top', 'scope'],
      ['vector', 'muzzle', 'muzzleTip', 'muzzle'],
      // Where the web of the hand goes on a pistol grip that is part of the receiver (metres, in the frame).
      ['pp19', 'grip', { at: [0, -0.063, -0.18] }],
      ['mp5', 'grip', { at: [0, -0.125, -0.185] }],
      ['vector', 'grip', { at: [0, -0.075, -0.13] }],
      // And the support hand on a gun with no handguard: under the Vector's nose, on its bottom rail (download units).
      ['vector', 'support', [3.2, 2.19, 0]],
      // The Vector's rails under and right of its nose, in download units.
      ['vector', 'foregrip', [3.7, 2.19, 0], 'grip'],
      ['vector', 'tactical', [3.7, 3.38, 1.33], 'light'],
    ],
  },
  rifle: {
    base: 'svd',
    sources: {
      // Each its own gun (no parts shared between them): scaled to its real length, placed by its magazine.
      // A spare magazine and a round lie under it (4, 8–10) and a PSO-1 sits on it (22–27).
      svd: { slug: 'gun_svd_du', forward: 'x', up: 'y', mag: /^Object_6$/, length: 1.225, only: /^Object_(?!(4|8|9|10|22|24|25|26|27)$)\d+$/ },
      sks: { slug: 'gun_sks_jeandiz', forward: '-z', up: 'y', mag: /^magazine_sks_0$/, length: 1.02 },
      vepr: { slug: 'gun_vepr_arg', forward: '-z', up: 'y', mag: /^Mag lowpoly__0$/, length: 1.1 },
      // The scope on it is the 8x (attach.glb).
      sv98: { slug: 'gun_sv98_jeandiz', forward: 'z', up: 'y', mag: /^Magazine_/, length: 1.2, only: /^(?!Scope_)/ },
      // Every node is called 'defaultMaterial'; no magazine to go by (it's in the stock): the trigger guard area.
      mosin: { slug: 'gun_mosin_doink', forward: 'z', up: 'y', magBox: [[-0.03, -0.16, -0.2], [0.03, -0.07, -0.1]], length: 1.287 },
      // A spare box and a loose belt lie beside it.
      pkm: { slug: 'gun_pkm_du', forward: 'x', up: 'y', mag: /^Object_31$/, length: 1.192, only: /^Object_(9|10|11|13|15|17|19|21|23|25|27|29|31|33)$/ },
      // One textured mesh: cut apart by connected pieces (download units). A scope, a foregrip and a side gadget
      // on it stay out.
      aug: { slug: 'gun_aug_mobz', forward: 'x', up: 'y', magBox: [[-19.8, -11.6, -1.7], [-9.4, 8.9, 1.7]], length: 0.79, only: /^Object023_01/ },
    },
    parts: {
      svd: ['svd', /^Object_(12|16|18|20)$/],
      svd_hg: ['svd', /^Object_13$/, { keep: (c) => c[0] > 0 }],
      svd_st: ['svd', /^Object_1[34]$/, { keep: (c) => c[0] < 0 }],
      svd_mag10: ['svd', /^Object_6$/],
      sks: ['sks', /^(?!magazine_).*_sks_0$/],
      sks_mag10: ['sks', /^magazine_sks_0$/],
      vepr: ['vepr', /^(?!(Stock|Mag) ).*[Ll]owpoly__0$/],
      vepr_st: ['vepr', /^Stock lowpoly__0$/],
      vepr_mag10: ['vepr', /^Mag lowpoly__0$/],
      sv98: ['sv98', /^(SV98|Triger|Bolt)_SV 98\.002_0$/],
      sv98_mag10: ['sv98', /^Magazine_SV 98\.002_0$/],
      // Two rounds lie under it (pieces wholly below its stock).
      mosin: ['mosin', /^defaultMaterial$/, { keep: (c, n, i) => i.max[1] > -0.065 }],
      pkm: ['pkm', /^Object_(9|10|13|15|17|19|21|23|25|27|29)$/],
      pkm_st: ['pkm', /^Object_11$/],
      // Its box is twice as wide as a 100-round one.
      pkm_box100: ['pkm', /^Object_3[13]$/, { width: 0.55 }],
      aug: ['aug', /^Object023_01/, { keep: (c, n, i) => !augMag(i) && !augExtra(i) }],
      aug_mag30: ['aug', /^Object023_01/, { keep: (c, n, i) => augMag(i) }],
    },
    sockets: [
      // Their dovetails for a PSO, on the left of the receiver (download units).
      ['svd', 'side', [-0.6, 0.15, -0.16], 'scope'],
      ['pkm', 'side', [-0.1, 0.0, -0.05], 'scope'],
      ['svd', 'sight', 'overMag', 'scope'],
      ['svd', 'muzzle', 'muzzleTip', 'muzzle'],
      ['sks', 'sight', 'overMag', 'scope'],
      ['sks', 'muzzle', 'muzzleTip', 'muzzle'],
      ['vepr', 'sight', 'overMag', 'scope'],
      ['vepr', 'muzzle', 'muzzleTip', 'muzzle'],
      ['sv98', 'sight', 'overMag', 'scope'],
      ['sv98', 'muzzle', 'muzzleTip', 'muzzle'],
      ['mosin', 'sight', 'overMag', 'scope'],
      ['mosin', 'muzzle', 'muzzleTip', 'muzzle'],
      ['pkm', 'sight', 'overMag', 'scope'],
      ['pkm', 'muzzle', 'muzzleTip', 'muzzle'],
      ['aug', 'muzzle', 'muzzleTip', 'muzzle'],
      // The AUG's rails (download units): on top of the receiver, under the barrel.
      ['aug', 'sight', [5, 12.63, 0], 'scope'],
      ['aug', 'foregrip', [24, 3.3, 0], 'grip'],
      // Hands (metres, in the frame): the web of the right hand on the grip; the left under the fore-end where
      // the gun has no handguard part.
      ['svd', 'grip', { at: [0, -0.04, -0.18] }],
      ['sks', 'grip', { at: [0, -0.0375, -0.207] }],
      ['sks', 'support', { at: [0, -0.025, 0.12] }],
      ['vepr', 'grip', { at: [0, -0.023, -0.15] }],
      ['vepr', 'support', { at: [0, -0.025, 0.24] }],
      ['sv98', 'grip', { at: [0, -0.03, -0.117] }],
      ['sv98', 'support', { at: [0, -0.06, 0.18] }],
      ['mosin', 'grip', { at: [0, 0, -0.24] }],
      ['mosin', 'support', { at: [0, 0.015, 0.2] }],
      ['pkm', 'grip', { at: [0, 0, -0.205] }],
      ['pkm', 'support', { at: [0, 0.02, 0.12] }],
      ['aug', 'grip', { at: [0, -0.012, 0.105] }],
      ['aug', 'support', { at: [0, 0, 0.33] }],
    ],
  },
  ar: {
    base: 'kit',
    sources: {
      // A kit: one rifle assembled in the middle, the other parts laid out around it (`snap` brings them over).
      // No barrel: guns draw theirs (weaponAssembly.ts) from the receiver's `barrel` socket.
      kit: { slug: 'gun_m4_kit', forward: 'z', up: 'y', mag: /#Magazine_Light$/, unit: 0.01, bore: /#Keymod_material$/ },
      // HK416 (CloudyRain, no textures): placed by its magazine onto the kit's, so AR grips, stocks and STANAG
      // magazines go on it. Its own magazine stays out (the kit's is the factory one).
      hk: { slug: 'gun_hk416_cloudy', forward: 'x', up: 'y', mag: /^Object_12$/ },
    },
    parts: {
      m4a1: ['kit', /^(Upper|Lower|Trigger)#Body$/],
      ar_hg_mlok: ['kit', /#Keymod_material$/],
      ar_hg_m4: ['kit', /#Handguard_M4$/, { snap: ['ar_hg_mlok', 'rear', 'top'] }],
      ar_hg_ris: ['kit', /#MK18_Guard$/, { snap: ['ar_hg_mlok', 'rear', 'top'] }],
      ar_hg_m16a4: ['kit', /#Handguard_DMR$/, { snap: ['ar_hg_mlok', 'rear', 'top'] }],
      ar_st_m4: ['kit', /#Classic_Stock$/],
      ar_st_ctr: ['kit', /#Stock_Light_V$/, { snap: ['ar_st_m4', 'front', 'top'] }],
      ar_st_a2: ['kit', /#Stock_DMR$/, { snap: ['ar_st_m4', 'front', 'top'] }],
      ar_pg_a2: ['kit', /#Grip_Default$/],
      ar_pg_moe: ['kit', /#Grip_Holes$/, { snap: ['ar_pg_a2', 'front', 'top'] }],
      ar_pg_ergo: ['kit', /#Grip_Elvi$/, { snap: ['ar_pg_a2', 'front', 'top'] }],
      mag_stanag30: ['kit', /#Magazine_Light$/],
      mag_pmag30: ['kit', /#Magazine_Default$/, { snap: ['mag_stanag30', 'front', 'top'] }],
      mag_stanag60: ['kit', /#Magazine_Large$/, { snap: ['mag_stanag30', 'front', 'top'] }],
      hk416: ['hk', /^Object_(4|6|8|10|14|15|17|18|20|22|24|25|27|29|31|32|34|35|41|44|46|47|48|49)$/],
      ar_pg_hk416: ['hk', /^Object_42$/],
      ar_st_hk416: ['hk', /^Object_3[789]$/],
    },
    sockets: [
      ['m4a1', 'sight', 'top', 'scope'],
      ['m4a1', 'barrel', 'front', 'barrel'],
      ['ar_hg_mlok', 'foregrip', 'bottom', 'grip'],
      ['ar_hg_mlok', 'tactical', 'right', 'light'],
      ['ar_hg_ris', 'foregrip', 'bottom', 'grip'],
      ['ar_hg_ris', 'tactical', 'right', 'light'],
      ['ar_hg_m16a4', 'foregrip', 'bottom', 'grip'],
      ['ar_hg_m16a4', 'tactical', 'right', 'light'],
      ['hk416', 'sight', 'top', 'scope'],
      ['hk416', 'muzzle', 'muzzleTip', 'muzzle'],
      // Its rails under and right of the handguard (download units).
      ['hk416', 'foregrip', [1.4, 0.11, 0], 'grip'],
      ['hk416', 'tactical', [1.4, 0.45, 0.29], 'light'],
      ['hk416', 'support', { at: [0, -0.042, 0.15] }],
    ],
  },
};

// ── Bolt-on parts ─────────────────────────────────────────────────────────────
/**
 * attach.glb: one root node per part, its mounting point at the origin, the bore direction +Z, up +Y, in metres:
 * sights stand on the origin (bottom centre), muzzle devices start at it (rear centre), grips hang from it (top
 * centre), lights touch it with their +X face (they go on the right-hand rail). A part goes to its socket as is.
 * id → [slug, nodes, muzzle-ward axis, up axis, real length along the bore in metres (grips: height), mount, options]
 */
const ATTACH = {
  // Its download has the eyepiece towards the muzzle. Mirrored end to end: turned round, the bracket would be on
  // the wrong side for an AK's left-hand dovetail.
  pso1: ['att_pso1', /./, 'z', 'y', 0.375, 'base', { mirror: true }],
  // Window towards the shooter, battery cap forward.
  holo: ['att_eotech', /./, '-z', 'y', 0.1, 'base'],
  red_dot: ['att_reddot', /./, 'z', 'y', 0.07, 'base'],
  // The housing with the fibre optic forward, the eyepiece towards the shooter.
  scope_4x: ['att_acog', /./, '-x', 'y', 0.15, 'base'],
  sup_545: ['att_pbs4', /./, 'z', 'y', 0.2, 'rear'],
  sup_dtk1p: ['att_dtkp', /^wRing#/, 'z', 'y', 0.186, 'rear'],
  sup_556: ['att_suppressors', /^Socom_4#/, 'x', 'y', 0.16, 'rear'],
  sup_762: ['att_suppressors', /^PBS01_5#/, 'x', 'y', 0.2, 'rear'],
  sup_9: ['att_suppressors', /^Sec9mm_2#/, 'x', 'y', 0.17, 'rear'],
  sup_54r: ['att_suppressors', /^PBS5_3#/, 'x', 'y', 0.22, 'rear'],
  brake: ['gun_ak74m_zenitco', /^dtk1 compensator/, 'x', 'y', 0.08, 'rear'],
  fgrip: ['gun_ak74m_zenitco', /^rk1 front grip/, 'x', 'y', 0.1, 'top'],
  // Long along the download's Z, the lens bezel (the tori) at its −Z end.
  tac_light: ['att_perst4', /./, '-z', 'y', 0.12, 'side'],
  // The scope the SV-98 download carries.
  scope_8x: ['gun_sv98_jeandiz', /^Scope_SCOPE_0$/, 'z', 'y', 0.3, 'base'],
};

async function buildAttach() {
  console.log('attach:');
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('attach');
  const loaded = {};
  for (const [id, [slug, re, forward, up, len, mount, opts]] of Object.entries(ATTACH)) {
    if (!loaded[slug]) {
      const file = path.join(SRC, 'sketchfab', slug, 'scene.gltf');
      if (!fs.existsSync(file)) throw new Error(`missing ${slug} (run tools/assets/sketchfab.mjs)`);
      const src = await io.read(file);
      const map = mergeDocuments(doc, src);
      loaded[slug] = src.getRoot().listNodes().map((n) => map.get(n));
    }
    const mats = (n) => [n, ...n.listChildren()].flatMap((c) => c.getMesh()?.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '') ?? []);
    const sel = loaded[slug].filter((n) => n.getMesh() || n.listChildren().length).filter((n) => re.test(n.getName()) || re.test(`${n.getName()}#${mats(n).join(',')}`));
    const meshNodes = new Set();
    const walk = (n) => {
      if (n.getMesh()) meshNodes.add(n);
      n.listChildren().forEach(walk);
    };
    sel.forEach(walk);
    if (!meshNodes.size) throw new Error(`${id}: nothing matches ${re} in ${slug}`);
    const unit = frameMatrix(forward, up, 1, [0, 0, 0]);
    const box = boundsIn([...meshNodes], unit);
    const k = len / (mount === 'top' ? box.size[1] : box.size[2]);
    const o = {
      base: [box.center[0], box.min[1], box.center[2]],
      rear: [box.center[0], box.center[1], box.min[2]],
      top: [box.center[0], box.max[1], box.center[2]],
      side: [box.max[0], box.center[1], box.center[2]],
    }[mount];
    const m = frameMatrix(forward, up, k, o.map((v) => -v * k));
    // `mirror`: flipped end to end (transformPrimitive turns the faces round for a mirroring matrix).
    if (opts?.mirror) for (const i of [2, 6, 10, 14]) m[i] = -m[i];
    const part = doc.createNode(id);
    for (const n of meshNodes) {
      const mtx = mul(m, n.getWorldMatrix());
      const mesh = doc.createMesh(`${id}:${n.getName()}`);
      for (const p of n.getMesh().listPrimitives()) {
        const q = p.clone();
        for (const sem of q.listSemantics()) q.setAttribute(sem, q.getAttribute(sem).clone());
        if (q.getIndices()) q.setIndices(q.getIndices().clone());
        transformPrimitive(q, mtx);
        mesh.addPrimitive(q);
      }
      part.addChild(doc.createNode(n.getName()).setMesh(mesh));
    }
    scene.addChild(part);
  }
  await finish(doc, scene, 'attach', 512, 0.35);
  console.log(`  parts: ${Object.keys(ATTACH).join(' ')}`);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

async function buildPlatform(name, P) {
  console.log(`${name}:`);
  await MeshoptEncoder.ready;
  const doc = new Document();
  doc.createBuffer();
  const nodesOf = {};
  for (const [key, s] of Object.entries(P.sources)) {
    const file = path.join(SRC, 'sketchfab', s.slug, 'scene.gltf');
    if (!fs.existsSync(file)) throw new Error(`missing ${s.slug} (run tools/assets/sketchfab.mjs)`);
    const src = await io.read(file);
    const map = mergeDocuments(doc, src);
    nodesOf[key] = src.getRoot().listNodes().map((n) => map.get(n));
  }
  // Matched against the node's name, then `#` and the materials of its meshes (kits reuse one node name).
  const mats = (n) => [n, ...n.listChildren()].flatMap((c) => c.getMesh()?.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '') ?? []);
  const pick = (key, re) => nodesOf[key].filter((n) => re.test(n.getName()) || re.test(`${n.getName()}#${mats(n).join(',')}`));

  // Frames: the base by its unit and bore, the others by their magazine onto the base's magazine.
  const frames = {};
  const b = P.sources[P.base];
  // A base not to scale gives its real length instead of its unit.
  const unit = b.unit ?? b.length / boundsIn(nodesOf[P.base].filter((n) => n.getMesh() && (!b.only || b.only.test(n.getName()))), frameMatrix(b.forward, b.up, 1, [0, 0, 0])).size[2];
  const raw = frameMatrix(b.forward, b.up, unit, [0, 0, 0]);
  // No node on the bore: the middle of the muzzle's last centimetre.
  const bore = b.bore ? boundsIn(pick(P.base, b.bore), raw).center : tipOf(nodesOf[P.base].filter((n) => n.getMesh() && (!b.only || b.only.test(n.getName()))), raw);
  const magRaw = (b.magBox ? boxIn(b.magBox, raw) : boundsIn(pick(P.base, b.mag), raw)).center;
  frames[P.base] = frameMatrix(b.forward, b.up, unit, [-bore[0], -bore[1], -magRaw[2]]);
  for (const [key, s] of Object.entries(P.sources)) {
    if (key === P.base) continue;
    const mag = boundsIn(pick(P.base, s.baseMag ?? b.mag), frames[P.base]);
    const unit = frameMatrix(s.forward, s.up, 1, [0, 0, 0]);
    // `magBox`: where its magazine is in the download, when no node holds just that.
    const m = s.magBox ? boxIn(s.magBox, unit) : boundsIn(pick(key, s.mag), unit);
    // `only`: the nodes that make up the gun, when the download has other things lying beside it.
    const k = s.length ? s.length / boundsIn(nodesOf[key].filter((n) => n.getMesh() && (!s.only || s.only.test(n.getName()))), unit).size[2] : mag.size[1] / m.size[1];
    frames[key] = frameMatrix(s.forward, s.up, k, mag.center.map((c, i) => c - m.center[i] * k));
  }

  // Parts: each a root node with its meshes baked into the frame.
  const scene = doc.createScene(name);
  const partNodes = {};
  for (const [id, [key, re, split]] of Object.entries(P.parts)) {
    const part = doc.createNode(id);
    const sel = pick(key, re);
    if (!sel.length) throw new Error(`${id}: no nodes match ${re} in ${key}`);
    const meshNodes = [];
    const walk = (n) => {
      if (n.getMesh()) meshNodes.push(n);
      n.listChildren().forEach(walk);
    };
    sel.forEach(walk);
    for (const n of new Set(meshNodes)) {
      const mtx = mul(frames[key], n.getWorldMatrix());
      const mesh = doc.createMesh(`${id}:${n.getName()}`);
      for (const p of n.getMesh().listPrimitives()) {
        const q = p.clone();
        for (const sem of q.listSemantics()) q.setAttribute(sem, q.getAttribute(sem).clone());
        if (q.getIndices()) q.setIndices(q.getIndices().clone());
        // `keep(point, node name)`: the triangles to keep, by their centre where the download has them (one mesh
        // holding several parts).
        if (split?.keep) {
          transformPrimitive(q, n.getWorldMatrix());
          if (!filterPrimitive(doc, q, (c, island) => split.keep(c, n.getName(), island), split.keep.length > 2)) continue;
          transformPrimitive(q, frames[key]);
        } else transformPrimitive(q, mtx);
        if ((split?.above !== undefined || split?.below !== undefined) && !filterPrimitive(doc, q, (c) => (split.above !== undefined ? c[1] > split.above : c[1] < -split.below))) continue;
        mesh.addPrimitive(q);
      }
      if (mesh.listPrimitives().length) part.addChild(doc.createNode(n.getName()).setMesh(mesh));
    }
    scene.addChild(part);
    partNodes[id] = part;
  }
  for (const [id, [, , opts]] of Object.entries(P.parts)) {
    // `stretch`: longer downwards by that factor, its top where it was (a longer magazine).
    if (opts?.stretch) {
      const top = getBounds(partNodes[id]).max[1];
      partNodes[id].setScale([1, opts.stretch, 1]).setTranslation([0, top * (1 - opts.stretch), 0]);
    }
    // `width`: narrower (or wider) across the gun by that factor, about its middle.
    if (opts?.width) {
      const bb = getBounds(partNodes[id]);
      const cx = (bb.min[0] + bb.max[0]) / 2;
      partNodes[id].setScale([opts.width, 1, 1]).setTranslation([cx * (1 - opts.width), 0, 0]);
    }
    if (!opts?.snap) continue;
    const [ref, end, height] = opts.snap;
    const a = getBounds(partNodes[id]);
    const b = getBounds(partNodes[ref]);
    const k = end === 'fit' ? (b.max[2] - b.min[2]) / (a.max[2] - a.min[2]) : 1;
    const dz = end === 'front' ? b.max[2] - a.max[2] : b.min[2] - k * a.min[2];
    // A part lying elsewhere in a kit also comes over sideways and to the same height (top or bottom edge).
    const dx = height ? (b.min[0] + b.max[0]) / 2 - (a.min[0] + a.max[0]) / 2 : 0;
    const dy = height === 'top' ? b.max[1] - a.max[1] : height === 'bottom' ? b.min[1] - a.min[1] : 0;
    partNodes[id].setScale([1, 1, k]).setTranslation([dx, dy, dz]);
  }

  // Sockets.
  for (const [partId, socket, place] of P.sockets) {
    const part = partNodes[partId];
    const bb = getBounds(part);
    const c = bb.min.map((v, i) => (v + bb.max[i]) / 2);
    const at = {
      top: () => [0, railEdge(part, 1), c[2]],
      bottom: () => [0, railEdge(part, -1), c[2]],
      right: () => [bb.min[0], c[1], c[2]],
      // Where the barrel starts: the front face of the receiver, on the bore.
      front: () => [0, 0, bb.max[2]],
      // The AK's muzzle thread: where the factory brake starts.
      muzzleBase: () => [0, 0, getBounds(partNodes.ak_mz_74).min[2]],
      // The tip of a part's own barrel (a gun registered by its magazine has its bore off the base's line).
      muzzleTip: () => muzzleTip(part),
      // A rifle's scope mount: the top of the receiver over the magazine (which sits at 0 along the bore).
      overMag: () => [0, railEdge(part, 1, -0.12, 0.08), -0.02],
      // Under a pistol's dust cover, where its light rail is.
      dustCover: () => frontUnder(part),
      // Outside face of the AK's side rail.
      dovetail: () => {
        const box = boundsIn(pick(P.base, /^DovetailSupport_lowT$/), frames[P.base]);
        return [box.max[0], box.center[1], box.center[2]];
      },
    }[place]?.() ?? (Array.isArray(place) ? apply(frames[P.parts[partId][0]], place) : place.at);
    // `at` is in the frame; the socket sits under the part, which may have been slid along the bore.
    const t = part.getTranslation();
    const sc = part.getScale();
    part.addChild(doc.createNode(`socket_${socket}`).setTranslation(at.map((v, i) => (v - t[i]) / sc[i])));
  }

  await finish(doc, scene, name);
  console.log(`  parts: ${Object.keys(P.parts).join(' ')}`);
}

/**
 * Drop everything that isn't a part, compress (colour at `size` px, the rest at half; `simplifyRatio` of the
 * triangles where they can go without visible change), write <name>.glb.
 */
async function finish(doc, scene, name, size = 1024, simplifyRatio = 0) {
  // Everything that isn't a part goes.
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  doc.getRoot().setDefaultScene(scene);
  for (const n of doc.getRoot().listNodes()) if (!isUnder(n, scene)) n.dispose();
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const sk of doc.getRoot().listSkins()) sk.dispose();

  await doc.transform(
    // Keep the empty socket nodes.
    prune({ keepLeaves: true }),
    unpartition(),
    dedup(),
    weld(),
    ...(simplifyRatio ? [simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.0005 })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [size, size], quality: 82 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!baseColorTexture$)/, resize: [size / 2, size / 2], quality: 80 }),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizeNormal: 10, quantizePosition: 14, quantizeTexcoord: 12 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  console.log(`  → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

/**
 * Height of a part's top (dir 1) or bottom (dir -1) surface along the middle 60% of its length, in the frame: the
 * rail itself, not a sight post, sling loop or charging handle sticking out of it. Takes the top of each 1 cm
 * slice near the centre line and returns the median.
 */
function railEdge(part, dir, from, to) {
  const bb = getBounds(part);
  const z0 = from ?? bb.min[2] + (bb.max[2] - bb.min[2]) * 0.2;
  const z1 = to ?? bb.max[2] - (bb.max[2] - bb.min[2]) * 0.2;
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const slices = new Map();
  const v = [0, 0, 0];
  part.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        const w = apply(m, pos.getElement(i, v));
        if (w[2] < z0 || w[2] > z1 || Math.abs(w[0] - cx) > 0.012) continue;
        const k = Math.round(w[2] * 100);
        slices.set(k, Math.max(slices.get(k) ?? -Infinity, w[1] * dir));
      }
    }
  });
  const tops = [...slices.values()].sort((a, b) => a - b);
  return (tops[tops.length >> 1] ?? (dir > 0 ? bb.max[1] : -bb.min[1])) * dir;
}

/** The centre of a part's front-most 6 mm (frame coordinates): the end of its barrel, on its bore. */
function muzzleTip(part) {
  const bb = getBounds(part);
  const sum = [0, 0];
  let n = 0;
  const v = [0, 0, 0];
  part.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        const w = apply(m, pos.getElement(i, v));
        if (w[2] < bb.max[2] - 0.006) continue;
        sum[0] += w[0];
        sum[1] += w[1];
        n++;
      }
    }
  });
  return [sum[0] / n, sum[1] / n, bb.max[2]];
}

/** Under a part's front quarter, ahead of the trigger guard (frame coordinates): where a pistol's light rail is. */
function frontUnder(part) {
  const bb = getBounds(part);
  const z0 = bb.max[2] - (bb.max[2] - bb.min[2]) / 4;
  let low = Infinity;
  const v = [0, 0, 0];
  part.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        const w = apply(m, pos.getElement(i, v));
        if (w[2] >= z0) low = Math.min(low, w[1]);
      }
    }
  });
  // A light bolts on by its +X face (lights go on a rifle's right-hand rail): move the socket out by half a light's
  // width and down by half its height, so one hangs under the frame, centred.
  return [(bb.min[0] + bb.max[0]) / 2 + 0.034, low - 0.021, (z0 + bb.max[2]) / 2];
}

function isUnder(n, scene) {
  let p = n;
  while (p.getParentNode()) p = p.getParentNode();
  return scene.listChildren().includes(p);
}

/** For each triangle (by its first index), the box of the connected piece it belongs to. */
function islandBoxes(pos, count, index) {
  const key = (i) => pos.getElement(i, [0, 0, 0]).map((x) => x.toFixed(5)).join();
  const parent = new Map();
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  const keys = [];
  for (let t = 0; t < count; t += 3) {
    const k = [0, 1, 2].map((j) => key(index(t + j)));
    for (const x of k) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(k[1]), find(k[0]));
    parent.set(find(k[2]), find(k[0]));
    keys.push(k[0]);
  }
  const boxes = new Map();
  for (let t = 0; t < count; t += 3) {
    const r = find(keys[t / 3]);
    if (!boxes.has(r)) boxes.set(r, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const b = boxes.get(r);
    for (let j = 0; j < 3; j++)
      pos.getElement(index(t + j), [0, 0, 0]).forEach((x, a) => {
        b.min[a] = Math.min(b.min[a], x);
        b.max[a] = Math.max(b.max[a], x);
      });
  }
  return (t) => boxes.get(find(keys[t / 3]));
}

/** The centre of the front-most centimetre of some nodes in frame `m`: the muzzle, on the bore. */
function tipOf(nodes, m) {
  const pts = [];
  for (const n of nodes) {
    const w = mul(m, n.getWorldMatrix());
    for (const p of n.getMesh().listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) pts.push(apply(w, pos.getElement(i, [0, 0, 0])));
    }
  }
  const front = Math.max(...pts.map((p) => p[2]));
  const tip = pts.filter((p) => p[2] > front - 0.01);
  return [0, 1].map((a) => tip.reduce((s, p) => s + p[a], 0) / tip.length).concat(front);
}

/**
 * Keep only the triangles whose centre passes `test`; false when none do. With `islands`, `test` also gets the box
 * ({ min, max }) of the connected piece the triangle is in (pieces joined by shared corner positions).
 */
function filterPrimitive(doc, prim, test, islands = false) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const index = (i) => (idx ? idx.getScalar(i) : i);
  const keep = [];
  const v = [0, 0, 0];
  const boxOf = islands ? islandBoxes(pos, count, index) : null;
  for (let t = 0; t < count; t += 3) {
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) pos.getElement(index(t + k), v).forEach((x, a) => (c[a] += x / 3));
    if (test(c, boxOf?.(t))) for (let k = 0; k < 3; k++) keep.push(index(t + k));
  }
  if (!keep.length) return false;
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(doc.getRoot().listBuffers()[0]));
  return true;
}

const only = process.argv[2];
for (const [name, P] of Object.entries(PLATFORMS)) if (!only || only === name) await buildPlatform(name, P);
if (!only || only === 'attach') await buildAttach();
