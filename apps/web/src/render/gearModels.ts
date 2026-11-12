import * as THREE from 'three';
import type { AssetLibrary } from './assets';

/**
 * Which real model each helmet / body armour / rig item is: a root of gear.glb (licensed models, credited in
 * models/CREDITS.txt), or one piece of it. Items not listed here still use the built ones (gear3d.ts, armorShell.ts).
 *
 * `part`: a pack holds several vests, this picks one by node name. `turn`: radians about Y that bring its front to
 * +Z (ours); `tilt` about X the same way for one exported lying down.
 */
export interface GearSpec {
  model: string;
  part?: string;
  turn?: number;
  tilt?: number;
  /** Helmets: bounds to fit to the head, as a fraction of the model's height from its top (chin straps and
   * headsets hang below the shell and mustn't squash it). Default 1: the whole model. */
  shell?: number;
  /** This model's own fit on the body, over the usual one (every vest has its own bounds: shoulder guards widen
   * them, a front pouch band deepens them, so the vest itself comes out too small or too big). `w`, `d`, `h`:
   * multipliers of width, depth and height; `y`: how far up (+) or down (−) it rides, in chest heights. */
  fit?: { w?: number; d?: number; h?: number; y?: number; size?: number; gap?: number };
  /** Helmets: the liner's colour (default dark webbing). The Altyn's shell is open above its faceplate, so its
   * liner takes the shell's paint and the opening reads as shell from above. */
  liner?: number;
  /** Helmets: where the front rim is, as a share of the model's height from its top (found from the shell if not
   * given). */
  brow?: number;
  /** Vests and rigs: where the bottom edge comes, 0 at spine_01 (about the navel) to 1 at spine_02 (lower ribs);
   * default 0.3. */
  hem?: number;
  /** Vests and rigs: 'shoulders' (default) hangs by its straps, 'belt' sits round the waist. */
  anchor?: 'shoulders' | 'belt';
  /** Multiplies the model's colours (plates: one model, a steel, a ceramic and a polyethylene look). */
  tint?: number;
  /** Replaces the texture with one flat colour (plates: the 6B43 texture is one dark print for all four). */
  paint?: number;
  /** Keeps the texture's detail but lifts it onto this colour (a near-black texture, such as the FASTs', reads as a
   * flat black blob in our light). `liftGain`: how strongly the texture's own detail shows over it (default 1.6). */
  lift?: number;
  liftGain?: number;
  /** Recolours the texture: its brightness times this colour (a red-plaid daypack becomes a slate one, its seams
   * and pockets still drawn). `monoGain`: how bright (default 1.5). */
  mono?: number;
  monoGain?: number;
  /** Helmets: drop the loose pieces that stand out sideways past the dome (the SSh-40's chin-strap ends). */
  trim?: boolean;
  /** Helmets: cut away everything below this share of the model's height, from the bottom (the FAST's chin
   * strap hangs as a loose loop round the face). */
  cutBelow?: number;
  /** Backpacks: drop the thin loose pieces when worn (a messenger bag's strap). */
  dropLoose?: boolean;
}

/** Connected pieces of a mesh (welded by position: exports split vertices at UV seams): each triangle's piece. */
export function pieces(g: THREE.BufferGeometry): { of: Int32Array; tri: number; vi: (t: number, c: number) => number } {
  const pos = g.attributes.position!;
  const n = pos.count;
  const id = new Int32Array(n);
  const keyOf = new Map<string, number>();
  const q = (x: number) => Math.round(x * 1e4);
  for (let i = 0; i < n; i++) {
    const key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    let w = keyOf.get(key);
    if (w === undefined) keyOf.set(key, (w = keyOf.size));
    id[i] = w;
  }
  const par = new Int32Array(keyOf.size).map((_, i) => i);
  const find = (a: number): number => {
    while (par[a] !== a) a = par[a] = par[par[a]!]!;
    return a;
  };
  const idx = g.index;
  const tri = idx ? idx.count / 3 : n / 3;
  const vi = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
  for (let t = 0; t < tri; t++) {
    const a = find(id[vi(t, 0)]!);
    par[find(id[vi(t, 1)]!)] = a;
    par[find(id[vi(t, 2)]!)] = a;
  }
  const of = new Int32Array(tri);
  for (let t = 0; t < tri; t++) of[t] = find(id[vi(t, 0)]!);
  return { of, tri, vi };
}

/**
 * Drops the loose pieces of a model (across all its meshes) that reach out sideways past its bulkiest piece, the
 * dome: the SSh-40's chin-strap ends stand out like antennae. Bounds in the model's own frame.
 */
function trimLoose(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  type Piece = { box: THREE.Box3; mesh: THREE.Mesh; key: number };
  const all: Piece[] = [];
  const split = new Map<THREE.Mesh, ReturnType<typeof pieces>>();
  const v = new THREE.Vector3();
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const pc = pieces(m.geometry);
    split.set(m, pc);
    const to = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position!;
    const by = new Map<number, Piece>();
    for (let t = 0; t < pc.tri; t++) {
      let p = by.get(pc.of[t]!);
      if (!p) by.set(pc.of[t]!, (p = { box: new THREE.Box3(), mesh: m, key: pc.of[t]! }));
      for (let k = 0; k < 3; k++) p.box.expandByPoint(v.fromBufferAttribute(pos, pc.vi(t, k)).applyMatrix4(to));
    }
    all.push(...by.values());
  });
  // The dome is the bulkiest piece (not the densest: a pair of strap ends can outnumber it in triangles).
  const bulk = (b: THREE.Box3) => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
  let main: Piece | undefined;
  for (const p of all) if (!main || bulk(p.box) > bulk(main.box)) main = p;
  if (!main || all.length < 2) return;
  const ms = main.box.getSize(new THREE.Vector3());
  const lim = main.box.clone().expandByVector(new THREE.Vector3(ms.x * 0.04, Infinity, ms.z * 0.04));
  const drop = new Map<THREE.Mesh, Set<number>>();
  for (const p of all)
    if (p !== main && !lim.containsBox(p.box)) {
      let s = drop.get(p.mesh);
      if (!s) drop.set(p.mesh, (s = new Set()));
      s.add(p.key);
    }
  for (const [m, s] of drop) {
    const pc = split.get(m)!;
    const keep: number[] = [];
    for (let t = 0; t < pc.tri; t++) if (!s.has(pc.of[t]!)) keep.push(pc.vi(t, 0), pc.vi(t, 1), pc.vi(t, 2));
    if (!keep.length) {
      m.parent?.remove(m);
      continue;
    }
    const g = m.geometry.clone();
    g.setIndex(keep);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.geometry = g;
  }
}

/** Removes the triangles whose centroid lies in the bottom `frac` of the model's height (model frame, y up). */
function cutBelow(root: THREE.Object3D, frac: number): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(root).applyMatrix4(inv);
  const y0 = box.min.y + (box.max.y - box.min.y) * frac;
  const v = new THREE.Vector3();
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const to = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position!;
    const idx = m.geometry.index;
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const at = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
    const keep: number[] = [];
    for (let t = 0; t < tri; t++) {
      let y = 0;
      for (let c = 0; c < 3; c++) y += v.fromBufferAttribute(pos, at(t, c)).applyMatrix4(to).y / 3;
      if (y >= y0) keep.push(at(t, 0), at(t, 1), at(t, 2));
    }
    const g = m.geometry.clone();
    g.setIndex(keep);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.geometry = g;
  });
}

/** The texture's brightness times a colour, per channel (sRGB). */
function monoMap(tex: THREE.Texture, base: number, gain: number): THREE.Texture | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  if (!x) return null;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const bc = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
  for (let i = 0; i < d.data.length; i += 4) {
    const l = ((0.3 * d.data[i]! + 0.59 * d.data[i + 1]! + 0.11 * d.data[i + 2]!) / 255) * gain;
    for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, bc[k]! * l);
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = tex.colorSpace;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.channel = tex.channel;
  t.anisotropy = tex.anisotropy;
  return t;
}

/** The texture's detail over a colour: base + gain × texel, per channel (sRGB). */
function liftMap(tex: THREE.Texture, base: number, gain: number): THREE.Texture | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  if (!x) return null;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const bc = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
  for (let i = 0; i < d.data.length; i += 4)
    for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, bc[k]! + d.data[i + k]! * gain);
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = tex.colorSpace;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.channel = tex.channel;
  t.anisotropy = tex.anisotropy;
  return t;
}

export const GEAR_MODEL: Record<string, GearSpec> = {
  // Helmets
  // (Exported facing all ways: the Altyn backwards, the SSh-40 and both FASTs with their front to +X.)
  // The Altyn comes with its faceplate down: its rim is the top of the faceplate, not the plate's lower edge.
  altyn: { model: 'altyn', turn: Math.PI, brow: 0.33, liner: 0x394934, fit: { w: 0.96, d: 0.88, h: 1.1, y: -0.2 } },
  ssh68: { model: 'ssh40', turn: -Math.PI / 2, trim: true },
  ssh36: { model: 'ssh36' },
  h_kevlar: { model: 'wz2005', shell: 0.6 },
  // Both FASTs' textures are all but black: lifted onto ranger green, with a liner to match.
  h_fast: { model: 'fast', shell: 0.62, turn: -Math.PI / 2, cutBelow: 0.36, lift: 0x4e4d3c, liftGain: 0.7, liner: 0x5a5944 },
  h_fast_headset: { model: 'helmet_headset', shell: 0.7, turn: -Math.PI / 2, cutBelow: 0.28, lift: 0x36352a, liftGain: 1.0, liner: 0x8a8470 },
  // Body armour (soft vests come down to the belt, carriers stop above the navel: `hem`)
  paca: { model: 'vest_pack', part: '^Vest_1_T1', hem: 0, fit: { w: 0.9, d: 0.9, y: -0.02 } },
  '6b23': { model: 'vest_pack', part: '^Vest_1_T2', hem: 0, fit: { w: 0.97, d: 0.95 } },
  trooper: { model: 'plate_carrier', fit: { w: 0.96, d: 1.0 } },
  pc_tan: { model: 'vest_danly', fit: { w: 0.84, d: 1.12, y: 0.02 } },
  gzhel: { model: 'vest_pack', part: '^Vest_1_Prem', hem: 0, fit: { w: 1.3, d: 1.0 } },
  slick6: { model: 'vest_pack', part: '^Vest$|^Vest_Vest', fit: { w: 0.94, d: 1.0 } },
  // Armour plates (a pictured item only: they sit inside a carrier when worn)
  pl_steel3: { model: 'v_6b43', turn: Math.PI / 2, paint: 0x80878d },
  pl_ceramic4: { model: 'v_6b43', turn: Math.PI / 2, paint: 0x59614a },
  pl_poly5: { model: 'v_6b43', turn: Math.PI / 2, paint: 0x33383d },
  pl_ceramic6: { model: 'v_6b43', turn: Math.PI / 2, paint: 0x6c7468 },
  // Rigs
  r_mbss: { model: 'vest_pack', part: '^Vest_T0', hem: 0.75 },
  r_scav: { model: 'chest_rig', lift: 0x3c3b2e, liftGain: 1.0 },
  r_alpha: { model: 'lpc', turn: Math.PI, paint: 0x7a8058 },
  r_bank: { model: 'combat_vest', fit: { w: 0.92 } },
  // Backpacks (outer face, the pockets, to +Z like the vests' fronts: the icon shows it; worn, it faces back)
  b_sling: { model: 'bp_messenger', paint: 0x6b6450, dropLoose: true, fit: { size: 0.6 } },
  b_daypack: { model: 'bp_daypack', turn: -Math.PI / 2, mono: 0x6f8296, monoGain: 3 },
  b_pilgrim: { model: 'bp_camping', lift: 0x4c4632, liftGain: 1.1, dropLoose: true, fit: { h: 1.2 } },
  b_attack: { model: 'bp_tactical', dropLoose: true, fit: { h: 1.1 } },
};

const made = new Map<string, THREE.Object3D | null>();

/**
 * The model for an item, turned to face +Z and centred on its bounds, or null when it has none. A fresh clone each
 * call (materials shared).
 */
export function wornGear(lib: AssetLibrary, itemId: string): THREE.Object3D | null {
  const spec = GEAR_MODEL[itemId];
  if (!spec) return null;
  let proto = made.get(itemId);
  if (proto === undefined) {
    const src = lib.gear.get(spec.model);
    proto = null;
    if (src) {
      const o = src.clone(true);
      if (spec.part) {
        const re = new RegExp(spec.part);
        // Keep the nodes under a matching one; everything else in the pack goes.
        const keep = new Set<THREE.Object3D>();
        o.traverse((n) => {
          if (re.test(n.name)) n.traverse((c) => keep.add(c));
        });
        const drop: THREE.Object3D[] = [];
        o.traverse((n) => {
          if ((n as THREE.Mesh).isMesh && !keep.has(n)) drop.push(n);
        });
        for (const n of drop) n.parent?.remove(n);
      }
      if (spec.trim) trimLoose(o);
      if (spec.cutBelow) cutBelow(o, spec.cutBelow);
      const turned = new THREE.Group();
      turned.add(o);
      turned.rotation.set(spec.tilt ?? 0, spec.turn ?? 0, 0);
      turned.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(turned);
      if (!b.isEmpty()) {
        o.position.sub(turned.worldToLocal(b.getCenter(new THREE.Vector3())));
        // Some exports are in odd units (the 6B43 plate is thousands wide): bring all to about a metre, which
        // is what icon cameras and fitting both expect.
        const size = b.getSize(new THREE.Vector3());
        turned.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
        proto = new THREE.Group();
        proto.add(turned);
        proto.userData.shellFrac = spec.shell ?? 1;
        proto.userData.fit = spec.fit ?? {};
        // Some shells are modelled one-sided (a helmet seen from below would show only its rim).
        const twoSided = new Map<THREE.Material, THREE.Material>();
        proto.traverse((n) => {
          const m = n as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          const src = m.material as THREE.Material;
          let mat = twoSided.get(src);
          if (!mat) {
            mat = src.clone();
            mat.side = THREE.DoubleSide;
            // Some exports come alpha-blended at full opacity (the FASTs: BLEND, no depth write): a blended shell
            // draws in triangle order, so its dark inside and far wall show through the near side as black bands.
            // Opaque with a cut-out keeps any holes in the texture's alpha.
            if (mat.transparent && mat.opacity >= 1) {
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = Math.max(mat.alphaTest, 0.5);
            }
            const std = mat as THREE.MeshStandardMaterial;
            if (spec.tint !== undefined && std.color) std.color.multiply(new THREE.Color(spec.tint));
            if (spec.paint !== undefined && std.color) {
              std.map = null;
              std.color.set(spec.paint);
              std.roughness = 0.7;
              std.metalness = 0.1;
            }
            if (spec.lift !== undefined && std.map) {
              const t = liftMap(std.map, spec.lift, spec.liftGain ?? 1.6);
              if (t) {
                std.map = t;
                std.color.set(0xffffff);
                std.roughness = 0.75;
                std.metalness = 0;
              }
            }
            if (spec.mono !== undefined && std.map) {
              const t = monoMap(std.map, spec.mono, spec.monoGain ?? 1.5);
              if (t) {
                std.map = t;
                std.color.set(0xffffff);
              }
            }
            twoSided.set(src, mat);
          }
          m.material = mat;
        });
      }
    }
    made.set(itemId, proto);
  }
  return proto ? proto.clone(true) : null;
}

export const hasGearModel = (itemId: string) => itemId in GEAR_MODEL;
