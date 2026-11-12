import * as THREE from 'three';
import type { TorsoField } from './gearFit';

/**
 * Which real body armour and chest rig each item is: the vest, plate carrier or pouches of a licensed rigged soldier
 * in models/bodies (credited in models/CREDITS.txt), carried onto our own body at load like the clothes are
 * (fitToRest in rebind.ts, CLOTH_KIT in clothKit.ts) and then laid over what is worn under it (CharacterView
 * wearArmor). `part` matches "<glTF mesh name> <material name>" of the pieces to take, as in clothKit.ts.
 *
 * A body worn whole keeps its own vest hidden (SF_KIT in character.ts); these are the same meshes, on our bodies.
 * `caps`: the piece has shoulder caps, which keep following the upper arms (otherwise everything is held to the
 * spine, so plates and pouches keep their shape).
 */
export interface ArmorPiece {
  body: string;
  part: string;
}
export interface ArmorKit {
  pieces: ArmorPiece[];
  caps?: boolean;
}

// The soft vest of the SWAT/FSB soldiers: front and back panels, collar, groin flap and side straps (their jacket,
// trousers, duty belt and buckles are other meshes of the same material). Same model, two prints: black and olive.
const SWAT_VEST = '^Object_(1[89]|2[0-24-57]|29|3[01]) uniform$';
const FSB_VEST = '^Object_(1[0-46-79]|2[1-3]) uniform$';

// The heavy soldier's pouches: on the chest and belly (over his carrier), and on his belt and thighs.
const HEAVY_CHEST = '^RetopoFlow_01(4\\.01[4-7]|5\\.001)_Mark_Pouches_1';
const HEAVY_BELT = '^RetopoFlow_014\\.(009|01[0-3]|018)_Mark_Pouches_1';

export const ARMOR_KIT: Record<string, ArmorKit> = {
  // Body armour: soft vests, then plate carriers (the plain one and with its own pouches).
  paca: { pieces: [{ body: 'swat', part: SWAT_VEST }] },
  '6b23': { pieces: [{ body: 'fsb', part: FSB_VEST }] },
  trooper: { pieces: [{ body: 'pmc_a', part: '__Plate$' }] },
  pc_tan: { pieces: [{ body: 'pmc_a', part: '__Plate$' }, { body: 'pmc_a', part: '^Mil_Suit_R5_Puches_' }] },
  slick6: { pieces: [{ body: 'pmc_heavy', part: 'Mark_Plate_1$' }] },
  gzhel: { pieces: [{ body: 'pmc_heavy', part: 'Mark_Plate_1$' }, { body: 'pmc_heavy', part: HEAVY_CHEST }] },
  // Chest rigs and belts.
  r_scav: { pieces: [{ body: 'pmc_a', part: '^Mil_Suit_R5_Puches\\.00[12]_' }] },
  r_mbss: { pieces: [{ body: 'swat', part: ' (pouch|lambert1\\.003)$' }] },
  r_alpha: { pieces: [{ body: 'pmc_heavy', part: HEAVY_CHEST }] },
  r_bank: { pieces: [{ body: 'pmc_heavy', part: HEAVY_BELT }] },
};

/** Every rigged model an armour or rig item's pieces come from. */
export const armorSources = (defId: string): string[] => [...new Set(ARMOR_KIT[defId]?.pieces.map((p) => p.body) ?? [])];

// ─────────────────────────────────────────────────────────────────────────────
// Fitting a carried piece as armour: held to the spine, laid over what is under it
// ─────────────────────────────────────────────────────────────────────────────

const ARM = /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/i;

/**
 * Plates and pouches are stiff: a piece carried from a soldier (fitToRest) is reweighted onto the spine, so it
 * keeps its shape as the arms move. What followed an arm follows that side's clavicle (half of it the chest), the
 * neck and head the top of the chest; what hangs on a thigh (a drop-leg pouch, a groin flap) keeps following it. With `caps` (shoulder caps) the arms keep
 * theirs. Returns a new geometry.
 */
export function holdToSpine(src: THREE.BufferGeometry, bones: THREE.Bone[], caps = false): THREE.BufferGeometry {
  const g = src.clone();
  const at = (n: string) => bones.findIndex((b) => b.name === n);
  const chest = at('spine_03');
  const clav = { l: at('clavicle_l'), r: at('clavicle_r') };
  const si = g.attributes.skinIndex!;
  const sw = g.attributes.skinWeight!;
  const NI = new Uint16Array(si.count * 4);
  const NW = new Float32Array(si.count * 4);
  const acc = new Map<number, number>();
  const put = (b: number, w: number) => b >= 0 && acc.set(b, (acc.get(b) ?? 0) + w);
  for (let i = 0; i < si.count; i++) {
    acc.clear();
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (!w) continue;
      const b = si.getComponent(i, c);
      const name = bones[b]?.name ?? '';
      const side = /_l$/i.test(name) ? clav.l : clav.r;
      const keep = caps ? 1 : 0;
      if (ARM.test(name)) (put(b, w * keep), put(side, w * (1 - keep) * 0.5), put(chest, w * (1 - keep) * 0.5));
      else if (/^clavicle_/i.test(name)) (put(b, w * (0.5 + keep * 0.5)), put(chest, w * (1 - keep) * 0.5));
      else if (/^(neck_01|head)$/i.test(name)) put(chest, w);
      else put(b, w);
    }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = top.reduce((a, t) => a + t[1], 0) || 1;
    top.forEach(([b, w], c) => ((NI[i * 4 + c] = b), (NW[i * 4 + c] = w / s)));
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(NI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(NW, 4));
  return g;
}

// The torso surface's cells (gearFit.ts TorsoField): NT directions round the spine, a slice every DY.
const NT = 48;
const DY = 0.01;
function fieldAt(f: TorsoField, th: number, y: number): number {
  const fy = (y - f.y0) / DY;
  if (fy < 0 || fy > f.ny - 1) return 0;
  const iy = Math.min(f.ny - 2, Math.floor(fy));
  const ty = fy - iy;
  let ft = ((((th / (2 * Math.PI)) % 1) + 1) % 1) * NT - 0.5;
  if (ft < 0) ft += NT;
  const t0 = Math.floor(ft) % NT;
  const tt = ft - Math.floor(ft);
  const row = (j: number) => f.r[j * NT + t0]! * (1 - tt) + f.r[j * NT + ((t0 + 1) % NT)]! * tt;
  const a = row(iy);
  const b = row(iy + 1);
  return a > 0 && b > 0 ? a * (1 - ty) + b * ty : Math.max(a, b);
}

/**
 * Lay a piece over what is worn under it (`under`: the dressed torso, or that with armour on, in the body's bind
 * space; `toBind` takes the piece's positions there). The piece was modelled over its soldier's own jacket, so it
 * already stands a jacket's thickness off our body; over something bulkier it would sink in. Wherever any of it is
 * closer to the spine than the surface under it plus `gap`, it is moved out radially, by a smooth field (by
 * direction round the spine and height) rather than vertex by vertex, so plates stay flat and pouches square.
 * Only what follows the torso moves. Returns a new geometry.
 */
export function layerOver(src: THREE.BufferGeometry, toBind: THREE.Matrix4, under: TorsoField, gap: number, bones: THREE.Bone[], maxPush: number): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.attributes.position!;
  const si = g.attributes.skinIndex!;
  const sw = g.attributes.skinWeight!;
  const torsoBones = new Set(bones.map((b, i) => (/^(pelvis|spine_0[123]|clavicle_[lr])$/i.test(b.name) ? i : -1)).filter((i) => i >= 0));
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const W = new Float32Array(n);
  const v = new THREE.Vector3();
  let ylo = Infinity;
  let yhi = -Infinity;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toBind).toArray(P, i * 3);
    let w = 0;
    for (let c = 0; c < 4; c++) if (torsoBones.has(si.getComponent(i, c))) w += sw.getComponent(i, c);
    W[i] = w;
    if (w > 0.5) (ylo = Math.min(ylo, v.y)), (yhi = Math.max(yhi, v.y));
  }
  if (!(yhi > ylo)) return g;
  // The push wanted per cell: the most any of the piece in it is short of the surface plus the gap.
  const NA = 32;
  const SY = 0.03;
  const ny = Math.max(2, Math.ceil((yhi - ylo) / SY) + 1);
  const need = new Float32Array(NA * ny).fill(-Infinity);
  const cellOf = (x: number, y: number, z: number) => {
    const a = Math.floor(((((Math.atan2(z - under.z0, x - under.x0) / (2 * Math.PI)) % 1) + 1) % 1) * NA) % NA;
    const iy = THREE.MathUtils.clamp(Math.round((y - ylo) / SY), 0, ny - 1);
    return iy * NA + a;
  };
  for (let i = 0; i < n; i++) {
    if (W[i]! < 0.5) continue;
    const x = P[i * 3]!;
    const y = P[i * 3 + 1]!;
    const z = P[i * 3 + 2]!;
    const th = Math.atan2(z - under.z0, x - under.x0);
    const u = fieldAt(under, th, y);
    if (!(u > 0)) continue;
    const k = cellOf(x, y, z);
    need[k] = Math.max(need[k]!, u + gap - Math.hypot(x - under.x0, z - under.z0));
  }
  // Only out (a piece never pulled in), at most maxPush; cells with none of the piece take their neighbours'.
  for (let k = 0; k < need.length; k++) need[k] = Number.isFinite(need[k]!) ? THREE.MathUtils.clamp(need[k]!, 0, maxPush) : NaN;
  const at = (iy: number, a: number) => need[THREE.MathUtils.clamp(iy, 0, ny - 1) * NA + ((a + NA) % NA)]!;
  for (let pass = 0; pass < 8; pass++) {
    const src2 = need.slice();
    for (let iy = 0; iy < ny; iy++)
      for (let a = 0; a < NA; a++) {
        if (!Number.isNaN(src2[iy * NA + a]!)) continue;
        let s = 0;
        let c = 0;
        for (const [dy, da] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const q = src2[THREE.MathUtils.clamp(iy + dy, 0, ny - 1) * NA + ((a + da + NA) % NA)]!;
          if (!Number.isNaN(q)) (s += q), c++;
        }
        if (c) need[iy * NA + a] = s / c;
      }
  }
  for (let k = 0; k < need.length; k++) if (Number.isNaN(need[k]!)) need[k] = 0;
  // Smoothed (spread to the cells round each first, so smoothing never leaves any of it short).
  const grown = need.map((_, k) => {
    const iy = Math.floor(k / NA);
    const a = k % NA;
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let da = -1; da <= 1; da++) m = Math.max(m, at(iy + dy, a + da));
    return m;
  });
  need.set(grown);
  for (let pass = 0; pass < 2; pass++) {
    const s0 = need.slice();
    for (let iy = 0; iy < ny; iy++)
      for (let a = 0; a < NA; a++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let da = -1; da <= 1; da++) s += s0[THREE.MathUtils.clamp(iy + dy, 0, ny - 1) * NA + ((a + da + NA) % NA)]!;
        need[iy * NA + a] = s / 9;
      }
  }
  const fromBind = toBind.clone().invert();
  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!;
    const y = P[i * 3 + 1]!;
    const z = P[i * 3 + 2]!;
    const dx = x - under.x0;
    const dz = z - under.z0;
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const fa = ((((Math.atan2(dz, dx) / (2 * Math.PI)) % 1) + 1) % 1) * NA - 0.5;
    const a0 = Math.floor(fa);
    const ta = fa - a0;
    const fy = THREE.MathUtils.clamp((y - ylo) / SY, 0, ny - 1);
    const iy = Math.min(ny - 2, Math.floor(fy));
    const ty = fy - iy;
    const d =
      (at(iy, a0) * (1 - ta) + at(iy, a0 + 1) * ta) * (1 - ty) + (at(iy + 1, a0) * (1 - ta) + at(iy + 1, a0 + 1) * ta) * ty;
    const push = d * Math.min(1, W[i]!);
    if (push <= 0) continue;
    v.set(x + (dx / r) * push, y, z + (dz / r) * push).applyMatrix4(fromBind);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
