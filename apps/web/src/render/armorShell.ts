import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Body armour and rigs that follow the body instead of being boxes strapped to it.
 *
 * A shell is cut from the character's own torso mesh (bind pose), pushed out along the normals, given a
 * rim so its edges have real thickness, and keeps the body's skin weights — so it deforms with every
 * animation exactly like the torso under it. Each item is a "cut": which part of the torso it covers
 * (armholes, neckline, plate area, cummerbund…), how far it stands off the body, and what's sewn on top
 * (plates, MOLLE webbing, pouches), which are placed on the shell surface along its normal.
 */

/** Torso-local coordinates of a point: u ∈ [-1, 1] left→right, v ∈ [0, 1] waist→base of neck, front = facing +Z. */
export interface TorsoUV {
  u: number;
  v: number;
  front: boolean;
  /** −1 at the back centre, 1 at the front centre (cos of the angle around the torso). */
  c: number;
}

export interface Cut {
  /** Extra stand-off at this point (metres, on top of the base offset), or null to leave it uncovered. */
  cover(p: TorsoUV): number | null;
  /** Base stand-off from the skin (metres) — clears clothing. */
  offset: number;
  /** Rim depth (metres): how thick the edges look. */
  thick: number;
  /** 0–1: how much the cross-section is pulled to a clean ellipse (stiff armour ≈ 0.75, cloth ≈ 0.4). */
  rigid?: number;
}

interface Frame {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  /** Metres per bind-space unit is 1/k (the pack is close to metres; k corrects any drift). */
  k: number;
}

const TORSO = /^(pelvis|spine_0[123]|clavicle_[lr])$/;

interface Prepared {
  geo: THREE.BufferGeometry;
  dominant: string[];
  frame: Frame;
}
const prepared = new WeakMap<THREE.BufferGeometry, Prepared>();

function prepare(body: THREE.SkinnedMesh): Prepared {
  const hit = prepared.get(body.geometry);
  if (hit) return hit;
  const geo = body.geometry;
  const pos = geo.attributes.position!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const bones = body.skeleton.bones;
  const dominant: string[] = new Array(pos.count);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    // GLTFLoader may suffix duplicate names ("spine_03_1").
    const name = (bones[best]?.name ?? '').replace(/_\d+$/, (m) => (/^_0\d$/.test(m) ? m : ''));
    dominant[i] = name;
    if (/^spine_0[23]$/.test(name)) box.expandByPoint(v.fromBufferAttribute(pos, i));
  }
  const size = box.getSize(new THREE.Vector3());
  // Waist sits a little below the spine_02 region; the neck base at its top.
  const frame: Frame = {
    cx: (box.min.x + box.max.x) / 2,
    cz: (box.min.z + box.max.z) / 2,
    hw: size.x / 2,
    hd: size.z / 2,
    y0: box.min.y - size.y * 0.55,
    y1: box.max.y,
    k: size.x / 0.34,
  };
  const out = { geo, dominant, frame };
  prepared.set(body.geometry, out);
  return out;
}

function uvOf(f: Frame, x: number, y: number, z: number): TorsoUV {
  const dx = (x - f.cx) / f.hw;
  const dz = (z - f.cz) / f.hd;
  const len = Math.hypot(dx, dz) || 1;
  return { u: Math.max(-1.2, Math.min(1.2, dx)), v: (y - f.y0) / (f.y1 - f.y0), front: z > f.cz, c: dz / len };
}

export interface Shell {
  geometry: THREE.BufferGeometry;
  /** Rim (edge band) as separate geometry so it can take a darker binding colour. */
  rim: THREE.BufferGeometry;
  frame: Frame;
  /** Find the outer surface point and normal nearest a torso coordinate (for pouches, plates…). */
  surface(u: number, v: number, front: boolean): { p: THREE.Vector3; n: THREE.Vector3 } | null;
}

const shellCache = new WeakMap<THREE.BufferGeometry, Map<string, Shell>>();

/** Cut a shell out of `body`'s torso. Skin attributes are kept, so the result can be skinned to the same skeleton. */
export function buildShell(body: THREE.SkinnedMesh, key: string, cut: Cut): Shell {
  let byKey = shellCache.get(body.geometry);
  if (!byKey) shellCache.set(body.geometry, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  const { geo, dominant, frame: f } = prepare(body);
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const index = geo.index ? (geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const tmp = new THREE.Vector3();

  // 1. Which triangles are covered, and how far each used vertex stands off.
  const extra = new Float32Array(pos.count).fill(NaN);
  const coverAt = (i: number) => {
    if (!Number.isNaN(extra[i]!)) return extra[i]!;
    tmp.fromBufferAttribute(pos, i);
    const e = TORSO.test(dominant[i]!) ? cut.cover(uvOf(f, tmp.x, tmp.y, tmp.z)) : null;
    extra[i] = e === null ? -1 : e;
    return extra[i]!;
  };
  const tris: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]!;
    const b = index[t + 1]!;
    const c = index[t + 2]!;
    // Decide by the centroid so edges follow the cut's curves, not the triangle soup.
    tmp
      .fromBufferAttribute(pos, a)
      .add(new THREE.Vector3().fromBufferAttribute(pos, b))
      .add(new THREE.Vector3().fromBufferAttribute(pos, c))
      .multiplyScalar(1 / 3);
    if (!(TORSO.test(dominant[a]!) && TORSO.test(dominant[b]!) && TORSO.test(dominant[c]!))) continue;
    if (cut.cover(uvOf(f, tmp.x, tmp.y, tmp.z)) === null) continue;
    coverAt(a);
    coverAt(b);
    coverAt(c);
    tris.push(a, b, c);
  }

  // 2. Weld vertices that share a position (glTF splits them at UV seams) so the shell is one surface
  //    and the rim only runs along the real boundary.
  const weld = new Map<string, number>();
  const remap = new Map<number, number>();
  const srcOf: number[] = [];
  const q = (n: number) => Math.round(n * 2000);
  for (const i of tris) {
    if (remap.has(i)) continue;
    tmp.fromBufferAttribute(pos, i);
    const key = `${q(tmp.x)},${q(tmp.y)},${q(tmp.z)}`;
    let j = weld.get(key);
    if (j === undefined) {
      j = srcOf.length;
      srcOf.push(i);
      weld.set(key, j);
    }
    remap.set(i, j);
  }
  const idx = tris.map((i) => remap.get(i)!);
  const n = srcOf.length;

  // 3. Outer positions: skin + normal × (offset + per-point extra). Normals averaged over welded copies.
  const normals = new Float32Array(n * 3);
  for (const [i, j] of remap) {
    normals[j * 3] += nor.getX(i);
    normals[j * 3 + 1] += nor.getY(i);
    normals[j * 3 + 2] += nor.getZ(i);
  }
  const outer = new Float32Array(n * 3);
  const inner = new Float32Array(n * 3);
  const k = f.k;
  for (let j = 0; j < n; j++) {
    const i = srcOf[j]!;
    const nn = new THREE.Vector3(normals[j * 3]!, normals[j * 3 + 1]!, normals[j * 3 + 2]!).normalize();
    tmp.fromBufferAttribute(pos, i);
    const e = Math.max(0, extra[i]!);
    const o = (cut.offset + e) * k;
    outer.set([tmp.x + nn.x * o, tmp.y + nn.y * o, tmp.z + nn.z * o], j * 3);
    const o2 = Math.max(0.002 * k, o - cut.thick * k);
    inner.set([tmp.x + nn.x * o2, tmp.y + nn.y * o2, tmp.z + nn.z * o2], j * 3);
  }

  // 4. Boundary edges (used by exactly one triangle), then smooth the boundary loop so the hem is a
  //    clean curve instead of following individual triangles.
  const edgeCount = new Map<string, [number, number, number]>();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cur = edgeCount.get(key);
      if (cur) cur[2]++;
      else edgeCount.set(key, [a, b, 1]);
    }
  const boundary = [...edgeCount.values()].filter((e) => e[2] === 1);
  const nbr = new Map<number, number[]>();
  for (const [a, b] of boundary) {
    (nbr.get(a) ?? nbr.set(a, []).get(a)!).push(b);
    (nbr.get(b) ?? nbr.set(b, []).get(b)!).push(a);
  }
  // Stiff armour doesn't follow pecs and lats: pull every horizontal cross-section towards an ellipse
  // (mean radius of its height band), keeping each vertex's angle around the torso.
  const rigid = cut.rigid ?? 0.6;
  if (rigid > 0)
    for (const arr of [outer, inner]) {
      const band = (y: number) => Math.floor(((y - f.y0) / (f.y1 - f.y0)) * 24);
      const sum = new Map<number, [number, number]>();
      const rad: number[] = [];
      for (let j = 0; j < n; j++) {
        const dx = (arr[j * 3]! - f.cx) / f.hw;
        const dz = (arr[j * 3 + 2]! - f.cz) / f.hd;
        const r = Math.hypot(dx, dz);
        rad.push(r);
        const b = band(arr[j * 3 + 1]!);
        const cur = sum.get(b) ?? [0, 0];
        cur[0] += r;
        cur[1]++;
        sum.set(b, cur);
      }
      for (let j = 0; j < n; j++) {
        const b = band(arr[j * 3 + 1]!);
        // Average with the neighbouring bands so the profile is smooth top to bottom.
        let acc = 0;
        let cnt = 0;
        for (const bb of [b - 1, b, b + 1]) {
          const v = sum.get(bb);
          if (v) {
            acc += v[0];
            cnt += v[1];
          }
        }
        const target = acc / cnt;
        const r = rad[j]!;
        if (r < 1e-4) continue;
        const k2 = (r + (target - r) * rigid) / r;
        arr[j * 3] = f.cx + (arr[j * 3]! - f.cx) * k2;
        arr[j * 3 + 2] = f.cz + (arr[j * 3 + 2]! - f.cz) * k2;
      }
    }

  // Iron out the anatomy (the base body is muscular): Taubin smoothing over the whole surface, so
  // vests read as stiff fabric and plates instead of a muscle suit. Boundary vertices are smoothed
  // only along the hem below.
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      adj[a]!.add(b);
      adj[b]!.add(a);
    }
  const onEdge = new Set<number>();
  for (const [a, b] of boundary) {
    onEdge.add(a);
    onEdge.add(b);
  }
  for (const arr of [outer, inner])
    for (let it = 0; it < 24; it++) {
      const lambda = it % 2 === 0 ? 0.55 : -0.58;
      const next = arr.slice();
      for (let j = 0; j < n; j++) {
        if (onEdge.has(j) || !adj[j]!.size) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        for (const m of adj[j]!) {
          x += arr[m * 3]!;
          y += arr[m * 3 + 1]!;
          z += arr[m * 3 + 2]!;
        }
        const c = adj[j]!.size;
        next[j * 3] = arr[j * 3]! + lambda * (x / c - arr[j * 3]!);
        next[j * 3 + 1] = arr[j * 3 + 1]! + lambda * (y / c - arr[j * 3 + 1]!);
        next[j * 3 + 2] = arr[j * 3 + 2]! + lambda * (z / c - arr[j * 3 + 2]!);
      }
      arr.set(next);
    }
  for (let it = 0; it < 4; it++)
    for (const arr of [outer, inner]) {
      const next = arr.slice();
      for (const [vtx, ns] of nbr) {
        if (ns.length !== 2) continue;
        for (let c = 0; c < 3; c++)
          next[vtx * 3 + c] = arr[vtx * 3 + c]! * 0.5 + (arr[ns[0]! * 3 + c]! + arr[ns[1]! * 3 + c]!) * 0.25;
      }
      arr.set(next);
    }

  // 5. Assemble: outer surface, and the rim band joining outer and inner along the boundary.
  const skinI = new Uint16Array(n * 4);
  const skinW = new Float32Array(n * 4);
  for (let j = 0; j < n; j++)
    for (let c = 0; c < 4; c++) {
      skinI[j * 4 + c] = si.getComponent(srcOf[j]!, c);
      skinW[j * 4 + c] = sw.getComponent(srcOf[j]!, c);
    }
  // Distance from the hem along the surface (metres): drives the binding tape and stitch lines.
  const edgeDist = new Float32Array(n).fill(1e9);
  for (const j of onEdge) edgeDist[j] = 0;
  for (let it = 0; it < 40; it++) {
    let changed = false;
    for (let j = 0; j < n; j++) {
      for (const m of adj[j]!) {
        const d =
          Math.hypot(
            outer[j * 3]! - outer[m * 3]!,
            outer[j * 3 + 1]! - outer[m * 3 + 1]!,
            outer[j * 3 + 2]! - outer[m * 3 + 2]!,
          ) / k;
        if (edgeDist[m]! + d < edgeDist[j]!) {
          edgeDist[j] = edgeDist[m]! + d;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const torso = new Float32Array(n * 2);
  for (let j = 0; j < n; j++) {
    tmp.fromBufferAttribute(pos, srcOf[j]!);
    // Angle round the torso + height (quilting runs along height).
    torso[j * 2] = Math.atan2((tmp.x - f.cx) / f.hw, (tmp.z - f.cz) / f.hd);
    torso[j * 2 + 1] = uvOf(f, tmp.x, tmp.y, tmp.z).v;
  }
  const surfaceGeo = new THREE.BufferGeometry();
  surfaceGeo.setAttribute('position', new THREE.BufferAttribute(outer, 3));
  surfaceGeo.setAttribute('aEdge', new THREE.BufferAttribute(edgeDist, 1));
  surfaceGeo.setAttribute('aTorso', new THREE.BufferAttribute(torso, 2));
  surfaceGeo.setAttribute('skinIndex', new THREE.BufferAttribute(skinI, 4));
  surfaceGeo.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  surfaceGeo.setIndex(idx);
  surfaceGeo.computeVertexNormals();

  // Rim: two copies of every boundary vertex (outer/inner) → quads.
  const rimPos: number[] = [];
  const rimTorso: number[] = [];
  const rimSI: number[] = [];
  const rimSW: number[] = [];
  const rimIdx: number[] = [];
  const rimVert = new Map<number, [number, number]>();
  const rv = (j: number): [number, number] => {
    let r = rimVert.get(j);
    if (r) return r;
    const o = rimPos.length / 3;
    rimPos.push(
      outer[j * 3]!,
      outer[j * 3 + 1]!,
      outer[j * 3 + 2]!,
      inner[j * 3]!,
      inner[j * 3 + 1]!,
      inner[j * 3 + 2]!,
    );
    rimTorso.push(torso[j * 2]!, torso[j * 2 + 1]!, torso[j * 2]!, torso[j * 2 + 1]!);
    for (let rep = 0; rep < 2; rep++)
      for (let c = 0; c < 4; c++) {
        rimSI.push(skinI[j * 4 + c]!);
        rimSW.push(skinW[j * 4 + c]!);
      }
    r = [o, o + 1];
    rimVert.set(j, r);
    return r;
  };
  for (const [a, b] of boundary) {
    const [ao, ai] = rv(a);
    const [bo, bi] = rv(b);
    rimIdx.push(ao, bo, bi, ao, bi, ai);
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rim.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(rimSI, 4));
  rim.setAttribute('skinWeight', new THREE.Float32BufferAttribute(rimSW, 4));
  rim.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Array(rimPos.length / 3).fill(0), 1));
  rim.setAttribute('aTorso', new THREE.Float32BufferAttribute(rimTorso, 2));
  rim.setIndex(rimIdx);
  rim.computeVertexNormals();

  const sn = surfaceGeo.attributes.normal!;
  const surface = (u: number, v: number, front: boolean) => {
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < n; j++) {
      const p = uvOf(f, outer[j * 3]!, outer[j * 3 + 1]!, outer[j * 3 + 2]!);
      if (p.front !== front) continue;
      const d = (p.u - u) ** 2 + (p.v - v) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best < 0) return null;
    return {
      p: new THREE.Vector3(outer[best * 3]!, outer[best * 3 + 1]!, outer[best * 3 + 2]!),
      n: new THREE.Vector3().fromBufferAttribute(sn, best).normalize(),
    };
  };
  const shell: Shell = { geometry: surfaceGeo, rim, frame: f, surface };
  byKey.set(key, shell);
  return shell;
}

// ── Cuts ─────────────────────────────────────────────────────────────────────

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Armhole: the sides are cut away from `from` (v) upward, deeper the further out you go. */
const armhole = (p: TorsoUV, from: number, width = 0.62) =>
  Math.abs(p.u) > width && p.v > from + (1 - Math.abs(p.u)) * 0.6;
/** Neckline: a scoop at the front (and a shallower one at the back). */
const neck = (p: TorsoUV, front: number, back: number) =>
  Math.abs(p.u) < 0.42 && p.v > 1 - (p.front ? front : back) * (1 - (Math.abs(p.u) / 0.42) ** 2);

export type ArmorPrint = 'plain' | 'flora' | 'multicam' | 'digital';

export interface ArmorSpec {
  cut: Cut;
  color: number;
  rim: number;
  /** Fabric print and its dark accent colour. */
  print?: ArmorPrint;
  accent?: number;
  /** Quilting: horizontal stitched channels every 1/n of the torso height (soft armour panels). */
  quilt?: number;
  /** Raised panels (plate pockets) built as their own shells, so they get their own edge and stitching. */
  layers?: { key: string; cut: Cut; color?: number }[];
  pouches?: { u: number; v: number; w: number; h: number; d: number; color?: number; front?: boolean }[];
  /** Horizontal webbing rows: v positions within |u| < width. */
  molle?: { v: number[]; width: number };
  collar?: boolean;
  groin?: boolean;
}

const OD = 0x4f5a3c;

export const ARMOR_SPECS: Record<string, ArmorSpec> = {
  // Soft vest worn under/over a jacket: long, thin, low armholes, round neck.
  paca: {
    color: 0x3e4a56,
    rim: 0x23292f,
    quilt: 7,
    cut: {
      offset: 0.018,
      thick: 0.012,
      rigid: 0.45,
      cover: (p) => (p.v < 0.08 || p.v > 1.02 || armhole(p, 0.55) || neck(p, 0.2, 0.06) ? null : 0),
    },
  },
  // Russian infantry vest: thick, high collar, groin flap, covers the whole torso.
  '6b23': {
    color: 0x6a7a52,
    rim: 0x3a3d2c,
    print: 'flora',
    accent: 0x3e4a2e,
    quilt: 6,
    collar: true,
    groin: true,
    cut: {
      offset: 0.022,
      thick: 0.026,
      rigid: 0.8,
      cover: (p) =>
        p.v < 0.0 || p.v > 1.04 || armhole(p, 0.6, 0.66) || neck(p, 0.16, 0.05) ? null : 0.004 * smooth(0.2, 0.6, p.v),
    },
    molle: { v: [0.3, 0.38, 0.46], width: 0.5 },
  },
  gzhel: {
    color: 0x5a6448,
    rim: 0x2c3326,
    print: 'digital',
    accent: 0x2e3324,
    quilt: 6,
    collar: true,
    groin: true,
    cut: {
      offset: 0.022,
      thick: 0.028,
      rigid: 0.8,
      cover: (p) => (p.v < 0.0 || p.v > 1.04 || armhole(p, 0.6, 0.66) || neck(p, 0.16, 0.05) ? null : 0.004),
    },
    pouches: [
      { u: -0.32, v: 0.18, w: 0.075, h: 0.13, d: 0.05 },
      { u: 0, v: 0.18, w: 0.075, h: 0.13, d: 0.05 },
      { u: 0.32, v: 0.18, w: 0.075, h: 0.13, d: 0.05 },
    ],
  },
  // Plate carrier: front/back plate bags + a cummerbund; shoulders are just straps.
  trooper: {
    color: 0x8a7552,
    rim: 0x5e4f36,
    print: 'multicam',
    accent: 0x4f5a3c,
    cut: {
      offset: 0.022,
      thick: 0.02,
      rigid: 0.8,
      cover: (p) => {
        const plate = Math.abs(p.u) < 0.66 && p.v > 0.24 && p.v < 0.94 - Math.max(0, Math.abs(p.u) - 0.3) * 0.5;
        const band = p.v > 0.22 && p.v < 0.46;
        const strap = Math.abs(Math.abs(p.u) - 0.42) < 0.11 && p.v >= 0.9;
        return plate || band || strap ? 0 : null;
      },
    },
    // The plate pockets stand proud of the carrier with their own seams.
    layers: [
      {
        key: 'plates',
        cut: {
          offset: 0.036,
          thick: 0.016,
          rigid: 0.9,
          cover: (p) =>
            Math.abs(p.c) > 0.45 &&
            Math.abs(p.u) < 0.58 &&
            p.v > 0.3 &&
            p.v < 0.9 - Math.max(0, Math.abs(p.u) - 0.28) * 0.6
              ? 0
              : null,
        },
      },
    ],
    molle: { v: [0.4, 0.47, 0.54, 0.61], width: 0.48 },
    pouches: [
      { u: -0.3, v: 0.27, w: 0.075, h: 0.14, d: 0.05 },
      { u: 0, v: 0.27, w: 0.075, h: 0.14, d: 0.05 },
      { u: 0.3, v: 0.27, w: 0.075, h: 0.14, d: 0.05 },
      { u: 0, v: 0.68, w: 0.15, h: 0.08, d: 0.025 },
    ],
  },
  // Slick carrier: plates and straps, nothing else.
  slick6: {
    color: 0x3a3e40,
    rim: 0x1c1e20,
    cut: {
      offset: 0.02,
      thick: 0.018,
      rigid: 0.8,
      cover: (p) => {
        const plate = Math.abs(p.u) < 0.62 && p.v > 0.3 && p.v < 0.93 - Math.max(0, Math.abs(p.u) - 0.3) * 0.5;
        const band = p.v > 0.3 && p.v < 0.42;
        const strap = Math.abs(Math.abs(p.u) - 0.42) < 0.09 && p.v >= 0.88;
        return plate || band || strap ? 0 : null;
      },
    },
    layers: [
      {
        key: 'plates',
        cut: {
          offset: 0.032,
          thick: 0.016,
          rigid: 0.92,
          cover: (p) =>
            Math.abs(p.c) > 0.45 &&
            Math.abs(p.u) < 0.55 &&
            p.v > 0.36 &&
            p.v < 0.89 - Math.max(0, Math.abs(p.u) - 0.26) * 0.6
              ? 0
              : null,
        },
      },
    ],
  },
};

export const RIG_SPECS: Record<string, ArmorSpec> = {
  // Fishing-style vest, open front, pockets.
  r_scav: {
    color: 0x6a5a3e,
    rim: 0x45392a,
    cut: {
      offset: 0.034,
      thick: 0.01,
      rigid: 0.4,
      cover: (p) =>
        p.v < 0.12 || p.v > 1.0 || armhole(p, 0.6) || neck(p, 0.3, 0.05) || (p.front && Math.abs(p.u) < 0.09)
          ? null
          : 0,
    },
    pouches: [
      { u: -0.42, v: 0.22, w: 0.1, h: 0.09, d: 0.03 },
      { u: 0.42, v: 0.22, w: 0.1, h: 0.09, d: 0.03 },
      { u: -0.4, v: 0.5, w: 0.09, h: 0.08, d: 0.025 },
      { u: 0.4, v: 0.5, w: 0.09, h: 0.08, d: 0.025 },
    ],
  },
  // Chest rigs: a chest panel of mag pouches, X-harness at the back.
  r_bank: {
    color: 0x6a7a52,
    rim: 0x262b20,
    print: 'flora',
    accent: 0x3e4a2e,
    cut: {
      offset: 0.044,
      thick: 0.012,
      rigid: 0.7,
      cover: (p) => {
        const panel = p.front && Math.abs(p.u) < 0.72 && p.v > 0.3 && p.v < 0.52;
        const strap = Math.abs(Math.abs(p.u) - 0.36) < 0.09 && p.v > 0.5;
        const x = !p.front && Math.abs(Math.abs(p.u) - (p.v - 0.3) * 0.9) < 0.1 && p.v > 0.3;
        return panel || strap || x ? 0 : null;
      },
    },
    pouches: [-0.45, -0.15, 0.15, 0.45].map((u) => ({ u, v: 0.3, w: 0.07, h: 0.15, d: 0.045 })),
  },
  r_alpha: {
    color: 0x8a7552,
    rim: 0x4a3f2c,
    print: 'multicam',
    accent: 0x4f5a3c,
    cut: {
      offset: 0.044,
      thick: 0.012,
      rigid: 0.7,
      cover: (p) => {
        const panel = p.front && Math.abs(p.u) < 0.8 && p.v > 0.26 && p.v < 0.55;
        const strap = Math.abs(Math.abs(p.u) - 0.36) < 0.1 && p.v > 0.52;
        const x = !p.front && Math.abs(Math.abs(p.u) - (p.v - 0.26) * 0.9) < 0.11 && p.v > 0.26;
        return panel || strap || x ? 0 : null;
      },
    },
    pouches: [
      ...[-0.48, -0.16, 0.16, 0.48].map((u) => ({ u, v: 0.27, w: 0.075, h: 0.16, d: 0.05 })),
      { u: 0, v: 0.5, w: 0.16, h: 0.06, d: 0.025 },
    ],
  },
  // Belt rig: padded belt with pouches round the hips.
  r_mbss: {
    color: 0x4a4f38,
    rim: 0x2e3224,
    cut: { offset: 0.04, thick: 0.02, rigid: 0.9, cover: (p) => (p.v > -0.08 && p.v < 0.07 ? 0 : null) },
    pouches: [
      { u: -0.55, v: -0.12, w: 0.08, h: 0.12, d: 0.05 },
      { u: 0.55, v: -0.12, w: 0.08, h: 0.12, d: 0.05 },
      { u: -0.85, v: -0.1, w: 0.07, h: 0.11, d: 0.045 },
      { u: 0.85, v: -0.1, w: 0.07, h: 0.11, d: 0.045 },
      { u: 0, v: -0.1, w: 0.1, h: 0.09, d: 0.04, front: false },
    ],
  },
};

// ── Sewn-on details ──────────────────────────────────────────────────────────

const rbox = (w: number, h: number, d: number, r: number) =>
  new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));

function shade(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}

/** A pouch with a flap and a webbing strip, its back on the shell surface, facing out along the normal. */
export function pouchMesh(
  w: number,
  h: number,
  d: number,
  color: number,
  mat: (c: number) => THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(rbox(w, h, d, Math.min(w, d) * 0.3), mat(color));
  body.position.set(0, 0, d / 2);
  const flap = new THREE.Mesh(rbox(w * 1.05, h * 0.3, d * 1.1, Math.min(w, d) * 0.25), mat(shade(color, 0.82)));
  flap.position.set(0, h * 0.36, d * 0.55);
  const strip = new THREE.Mesh(rbox(w * 0.16, h * 0.62, 0.006, 0.002), mat(shade(color, 0.65)));
  strip.position.set(0, -h * 0.05, d + 0.003);
  for (const m of [body, flap, strip]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * Everything sewn on top of a shell, as meshes in the shell's (bind) space: pouches and webbing.
 * Plates/raised layers are shells themselves (see ArmorSpec.layers) and are built by the caller.
 */
export function details(shell: Shell, spec: ArmorSpec, mat: (c: number) => THREE.Material): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const k = shell.frame.k;
  const up = new THREE.Vector3(0, 1, 0);
  const place = (obj: THREE.Object3D, u: number, v: number, front: boolean, lift = 0) => {
    const s = shell.surface(u, v, front);
    if (!s) return;
    // Face along the surface normal, upright.
    const z = s.n.clone().setY(0).normalize();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    obj.scale.setScalar(k);
    obj.position.copy(s.p).addScaledVector(z, lift * k);
    out.push(obj);
  };
  for (const p of spec.pouches ?? []) {
    const g = pouchMesh(p.w, p.h, p.d, p.color ?? shade(spec.color, 0.95), mat);
    g.position.y = p.h / 2;
    const wrap = new THREE.Group();
    wrap.add(g);
    place(wrap, p.u, p.v, p.front ?? true);
  }
  if (spec.collar) {
    // Padded collar: a tube through points around the neckline.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const s = shell.surface(-0.42 + (i / 8) * 0.84, 0.97, true);
      if (s) pts.push(s.p.clone().addScaledVector(s.n, 0.01 * k));
    }
    for (let i = 0; i <= 8; i++) {
      const s = shell.surface(0.42 - (i / 8) * 0.84, 1.0, false);
      if (s)
        pts.push(
          s.p
            .clone()
            .addScaledVector(s.n, 0.012 * k)
            .setY(s.p.y + 0.02 * k),
        );
    }
    if (pts.length > 6) {
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 48, 0.024 * k, 10, true),
        mat(shade(spec.color, 0.9)),
      );
      tube.castShadow = true;
      out.push(tube);
    }
  }
  if (spec.groin) {
    const flap = new THREE.Mesh(rbox(0.15, 0.13, 0.022, 0.03), mat(spec.color));
    flap.position.y = -0.07;
    const wrap = new THREE.Group();
    wrap.add(flap);
    place(wrap, 0, 0.02, true, 0.008);
  }
  if (spec.molle)
    for (const front of [true, false])
      for (const v of spec.molle.v) {
        // Short webbing tabs following the curve rather than one straight bar.
        for (let u = -spec.molle.width; u <= spec.molle.width + 1e-6; u += 0.13) {
          const tab = new THREE.Mesh(rbox(0.04, 0.012, 0.005, 0.002), mat(shade(spec.color, 0.72)));
          tab.castShadow = true;
          place(tab, u, v, front, 0.002);
        }
      }
  return out;
}

export { OD };

// ── Fabric shader ────────────────────────────────────────────────────────────

const PRINT_ID: Record<ArmorPrint, number> = { plain: 0, flora: 1, multicam: 2, digital: 3 };

/**
 * Turns a MeshStandardMaterial into armour fabric: camo print, Cordura weave, dark binding tape along
 * every edge with a dashed stitch line beside it, and quilted channels on soft panels. Everything comes
 * from the shell's attributes (aEdge, aTorso), so it's crisp at any distance without textures.
 */
export function shellShader(
  shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string },
  spec: ArmorSpec,
  k: number,
  color = spec.color,
): void {
  shader.uniforms.uInvK = { value: 1 / k };
  shader.uniforms.uBase = { value: new THREE.Color(color) };
  shader.uniforms.uAccent = { value: new THREE.Color(spec.accent ?? shade(color, 0.6)) };
  shader.uniforms.uTape = { value: new THREE.Color(spec.rim) };
  shader.uniforms.uPrint = { value: PRINT_ID[spec.print ?? 'plain'] };
  shader.uniforms.uQuilt = { value: spec.quilt ?? 0 };
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aEdge;\nattribute vec2 aTorso;\nvarying float vEdge;\nvarying vec2 vTorso;\nvarying vec3 vSPos;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvTorso = aTorso;\nvSPos = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform vec3 uBase; uniform vec3 uAccent; uniform vec3 uTape; uniform int uPrint; uniform float uQuilt; uniform float uInvK;
      varying float vEdge; varying vec2 vTorso; varying vec3 vSPos;
      float sh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float svn(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), f.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), f.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), f.x), f.y), f.z);
      }`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      vec3 col = uBase;
      vec3 p = vSPos * uInvK;
      if (uPrint == 1) { float s = svn(vec3(p.x * 22.0, p.y * 3.0, p.z * 22.0)) * 0.7 + svn(p * 40.0) * 0.3; col = s > 0.58 ? uAccent : s < 0.36 ? mix(uBase, vec3(0.2, 0.15, 0.08), 0.5) : uBase; }
      if (uPrint == 2) { float a = svn(p * 9.0) * 0.65 + svn(p * 23.0) * 0.35; float b = svn(p * 14.0 + 7.3);
        col = a > 0.6 ? uAccent : a < 0.33 ? mix(uBase, vec3(0.32, 0.26, 0.17), 0.45) : uBase; if (b > 0.72) col = vec3(0.045, 0.035, 0.025); }
      if (uPrint == 3) { vec3 q = floor(p * 70.0) / 70.0; float a = svn(q * 11.0); col = a > 0.6 ? uAccent : a < 0.35 ? mix(uBase, vec3(0.22, 0.2, 0.14), 0.45) : uBase; }
      // Cordura weave.
      float weave = svn(vec3(p.x * 520.0 + p.z * 520.0, p.y * 520.0, 0.0));
      col *= 0.93 + weave * 0.12;
      // Quilted channels (stitched seams across soft panels).
      if (uQuilt > 0.0) { float q = abs(fract(vTorso.y * uQuilt) - 0.5); col *= 1.0 - (1.0 - smoothstep(0.0, 0.035, 0.5 - q)) * 0.35; }
      // Binding tape on the hem, then a dashed stitch line beside it.
      float tape = 1.0 - smoothstep(0.011, 0.014, vEdge);
      col = mix(col, uTape, tape);
      float dash = step(0.42, fract((p.x + p.y * 1.3 + p.z) * 70.0));
      float stitch = (smoothstep(0.019, 0.021, vEdge) - smoothstep(0.024, 0.026, vEdge)) * dash;
      col = mix(col, uTape * 0.6, stitch * 0.8);
      // A touch of occlusion near edges so panels read as separate pieces.
      col *= 0.8 + 0.2 * smoothstep(0.0, 0.045, vEdge);
      diffuseColor.rgb = col;`,
    );
}

/** The shell plus its raised layers (plate pockets), each with its own colour. */
export function shellParts(body: THREE.SkinnedMesh, id: string, spec: ArmorSpec): { shell: Shell; color: number }[] {
  const out = [{ shell: buildShell(body, id, spec.cut), color: spec.color }];
  for (const l of spec.layers ?? [])
    out.push({ shell: buildShell(body, `${id}:${l.key}`, l.cut), color: l.color ?? spec.color });
  return out;
}
