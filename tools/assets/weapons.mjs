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

// ── Platforms ─────────────────────────────────────────────────────────────────
/**
 * Sources: slug, which way the muzzle and the top of the gun point in the download, the magazine (to register
 * it), and for the base model its unit and bore (a node centred on the bore).
 */
const PLATFORMS = {
  ak: {
    base: 'fjh',
    sources: {
      fjh: { slug: 'gun_ak74m_fjh', forward: '-z', up: 'y', mag: /^Magazine_lowT$/, unit: 0.01, bore: /^Barrel_lowT$/ },
      zenitco: { slug: 'gun_ak74m_zenitco', forward: 'x', up: 'y', mag: /^ak74 30rnd mag \(polymer\)_6$/ },
      custom: { slug: 'gun_ak74_custom', forward: 'z', up: 'y', mag: /^mag(_cap)?_low$/ },
      aks: { slug: 'gun_aks74u_jeandiz', forward: '-z', up: 'y', mag: /^magazine$/ },
      akm: { slug: 'gun_akm_jeandiz', forward: '-z', up: 'y', mag: /^Cube\.004$/ },
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
      // AKS-74U: receiver, handguard and booster are one mesh; grip and magazine are the AK-74's.
      aks74u: ['aks', /^(body|trigger|bolt carier|safety switch|folding stock)$/],
      // AKM: its own furniture and magazine; it has no dust cover (the AK-74's fits).
      akm: ['akm', /^(RECEIVER|LEVER|IRON_SIGHT|Body\.002|Circle(\.\d+)?|Cube\.00[23])$/],
      ak_pg_akm: ['akm', /^Cube\.001$/],
      ak_gt_akm: ['akm', /^Body\.001$/],
      ak_hg_akm: ['akm', /^Body\.000$/],
      ak_st_akm: ['akm', /^Cube$/],
      mag_akm30: ['akm', /^Cube\.004$/],
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
      ['akm', 'muzzle', 'front', 'muzzle'],
    ],
  },
  ar: {
    base: 'kit',
    sources: {
      // A kit: one rifle assembled in the middle, the other parts laid out around it (`snap` brings them over).
      // No barrel: guns draw theirs (weaponAssembly.ts) from the receiver's `barrel` socket.
      kit: { slug: 'gun_m4_kit', forward: 'z', up: 'y', mag: /#Magazine_Light$/, unit: 0.01, bore: /#Keymod_material$/ },
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
    ],
  },
};

// ── Bolt-on parts ─────────────────────────────────────────────────────────────
/**
 * attach.glb: one root node per part, its mounting point at the origin, the bore direction +Z, up +Y, in metres:
 * sights stand on the origin (bottom centre), muzzle devices start at it (rear centre), grips hang from it (top
 * centre), lights touch it with their +X face (they go on the right-hand rail). A part goes to its socket as is.
 * id → [slug, nodes, muzzle-ward axis, up axis, real length along the bore in metres (grips: height), mount]
 */
const ATTACH = {
  pso1: ['att_pso1', /./, 'z', 'y', 0.375, 'base'],
  holo: ['att_eotech', /./, 'z', 'y', 0.1, 'base'],
  red_dot: ['att_reddot', /./, 'z', 'y', 0.07, 'base'],
  scope_4x: ['att_acog', /./, 'x', 'y', 0.15, 'base'],
  sup_545: ['att_pbs4', /./, 'z', 'y', 0.2, 'rear'],
  sup_dtk1p: ['att_dtkp', /^wRing#/, 'z', 'y', 0.186, 'rear'],
  sup_556: ['att_suppressors', /^Socom_4#/, 'x', 'y', 0.16, 'rear'],
  sup_762: ['att_suppressors', /^PBS01_5#/, 'x', 'y', 0.2, 'rear'],
  sup_9: ['att_suppressors', /^Sec9mm_2#/, 'x', 'y', 0.17, 'rear'],
  sup_54r: ['att_suppressors', /^PBS5_3#/, 'x', 'y', 0.22, 'rear'],
  brake: ['gun_ak74m_zenitco', /^dtk1 compensator/, 'x', 'y', 0.08, 'rear'],
  fgrip: ['gun_ak74m_zenitco', /^rk1 front grip/, 'x', 'y', 0.1, 'top'],
  tac_light: ['att_perst4', /./, 'x', 'y', 0.12, 'side'],
};

async function buildAttach() {
  console.log('attach:');
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('attach');
  const loaded = {};
  for (const [id, [slug, re, forward, up, len, mount]] of Object.entries(ATTACH)) {
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
  const raw = frameMatrix(b.forward, b.up, b.unit, [0, 0, 0]);
  const bore = boundsIn(pick(P.base, b.bore), raw).center;
  const magRaw = boundsIn(pick(P.base, b.mag), raw).center;
  frames[P.base] = frameMatrix(b.forward, b.up, b.unit, [-bore[0], -bore[1], -magRaw[2]]);
  for (const [key, s] of Object.entries(P.sources)) {
    if (key === P.base) continue;
    const mag = boundsIn(pick(P.base, s.baseMag ?? b.mag), frames[P.base]);
    const unit = frameMatrix(s.forward, s.up, 1, [0, 0, 0]);
    const m = boundsIn(pick(key, s.mag), unit);
    const k = mag.size[1] / m.size[1];
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
        transformPrimitive(q, mtx);
        if ((split?.above !== undefined || split?.below !== undefined) && !splitPrimitive(doc, q, split)) continue;
        mesh.addPrimitive(q);
      }
      if (mesh.listPrimitives().length) part.addChild(doc.createNode(n.getName()).setMesh(mesh));
    }
    scene.addChild(part);
    partNodes[id] = part;
  }
  for (const [id, [, , opts]] of Object.entries(P.parts)) {
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
      // Outside face of the AK's side rail.
      dovetail: () => {
        const box = boundsIn(pick(P.base, /^DovetailSupport_lowT$/), frames[P.base]);
        return [box.max[0], box.center[1], box.center[2]];
      },
    }[place]();
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
 * Height of a part's top (dir 1) or bottom (dir -1) surface along the middle 40% of its length, in the frame: the
 * rail itself rather than a sight post or a sling loop at one end.
 */
function railEdge(part, dir) {
  const bb = getBounds(part);
  const z0 = bb.min[2] + (bb.max[2] - bb.min[2]) * 0.3;
  const z1 = bb.max[2] - (bb.max[2] - bb.min[2]) * 0.3;
  let best = -Infinity;
  const v = [0, 0, 0];
  part.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        const w = apply(m, pos.getElement(i, v));
        if (w[2] >= z0 && w[2] <= z1) best = Math.max(best, w[1] * dir);
      }
    }
  });
  return best * dir;
}

function isUnder(n, scene) {
  let p = n;
  while (p.getParentNode()) p = p.getParentNode();
  return scene.listChildren().includes(p);
}

/** Keep only the triangles whose centre is above (or below) the bore by `split.above` / `split.below` metres. */
function splitPrimitive(doc, prim, split) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const index = (i) => (idx ? idx.getScalar(i) : i);
  const keep = [];
  const v = [0, 0, 0];
  for (let t = 0; t < count; t += 3) {
    let y = 0;
    for (let k = 0; k < 3; k++) y += pos.getElement(index(t + k), v)[1] / 3;
    if (split.above !== undefined ? y > split.above : y < -split.below)
      for (let k = 0; k < 3; k++) keep.push(index(t + k));
  }
  if (!keep.length) return false;
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(doc.getRoot().listBuffers()[0]));
  return true;
}

const only = process.argv[2];
for (const [name, P] of Object.entries(PLATFORMS)) if (!only || only === name) await buildPlatform(name, P);
if (!only || only === 'attach') await buildAttach();
