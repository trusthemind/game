import * as THREE from 'three';
import { identityKey, mainIdentity, type IdentityMix } from '@ashfall/engine';
import { IDENTITY_DATA } from './identityData';

/**
 * Face identities on the MPFB bodies (engine identity.ts; tools/assets/mpfb-pilot/add_identities.mjs). The bodies'
 * GLBs carry one head-only morph target per identity on the body, eyes, brows and lashes. They are never morphed
 * on the GPU: the targets are taken off the geometry when the body loads and baked on the CPU with the body shape
 * (bodyShape.ts bakeShape), so a frame costs nothing extra. Everything else fitted to the head (hair, beards, caps,
 * helmets) follows through IdentityField: the head's own displacement, carried to nearby points.
 * The face's skin character (detail ratio + roughness), the irises and the brows come from per-identity atlases.
 */

/** `?ids=0` (dev): the face identities and asset hair off (the base face, procedural hair), to compare. */
export const IDENTITIES_OFF = typeof location !== 'undefined' && /[?&]ids=0(&|#|$)/.test(location.href);

interface Morphs {
  names: string[];
  /** Per identity: geometry-space position deltas (vertex count x 3). */
  data: Float32Array[];
}
const MORPHS = new WeakMap<THREE.BufferGeometry, Morphs>();
const TAKEN = new WeakSet<THREE.Object3D>();
/** The materials of meshes that had identity targets (their UVs are the atlases' layout): only those take them. */
const ID_MATS = new WeakSet<THREE.Material>();

/** Take the identity morph targets off a loaded body (once per source scene; clones then carry none). */
export function takeIdentityMorphs(scene: THREE.Object3D): void {
  if (TAKEN.has(scene)) return;
  TAKEN.add(scene);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.morphAttributes.position;
    if (pos?.length && m.morphTargetDictionary) {
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) ID_MATS.add(mt);
      const names: string[] = [];
      for (const [k, i] of Object.entries(m.morphTargetDictionary)) names[i] = k;
      if (!MORPHS.has(g)) {
        const data = pos.map((a) => {
          const out = new Float32Array(a.count * 3);
          for (let i = 0; i < a.count; i++) {
            out[i * 3] = a.getX(i);
            out[i * 3 + 1] = a.getY(i);
            out[i * 3 + 2] = a.getZ(i);
          }
          // (morphTargetsRelative: the targets are deltas, as glTF stores them)
          return out;
        });
        MORPHS.set(g, { names, data });
      }
      g.morphAttributes = {};
      g.morphTargetsRelative = false;
    }
    if (m.morphTargetInfluences) {
      m.morphTargetInfluences = undefined;
      m.morphTargetDictionary = undefined;
    }
  });
}

export function hasIdentityMorphs(g: THREE.BufferGeometry): boolean {
  return MORPHS.has(g);
}

const BLEND = new WeakMap<THREE.BufferGeometry, Map<string, Float32Array | null>>();
/** Σ w·Δ for a geometry (geometry space), or null when it has no identities (or none of the mix). Cached. */
export function identityDeltas(g: THREE.BufferGeometry, mix: IdentityMix | null | undefined): Float32Array | null {
  const mo = MORPHS.get(g);
  if (!mo || !mix?.length || IDENTITIES_OFF) return null;
  const key = identityKey(mix);
  let per = BLEND.get(g);
  if (!per) BLEND.set(g, (per = new Map()));
  if (per.has(key)) return per.get(key)!;
  let out: Float32Array | null = null;
  for (const { id, w } of mix) {
    const i = mo.names.indexOf(id);
    if (i < 0 || w <= 0) continue;
    const d = mo.data[i]!;
    out ??= new Float32Array(d.length);
    for (let k = 0; k < d.length; k++) out[k]! += d[k]! * w;
  }
  per.set(key, out);
  return out;
}

/**
 * The head's identity displacement as a field over the model's space (rest pose): for meshes without their own
 * targets (hair, beards, caps, gear on the head). Each point takes the inverse-distance mean of its nearest skin
 * points' displacement, fading out beyond ~7 cm from the skin.
 */
export class IdentityField {
  private cell = 0.02;
  private grid = new Map<string, number[]>();
  constructor(
    private P: Float32Array,
    private D: Float32Array,
  ) {
    const n = P.length / 3;
    for (let i = 0; i < n; i++) {
      const k = this.key(P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  private best = new Float64Array(6);
  private bi = new Int32Array(6);
  /** Adds the identity's displacement at p (model space) to out. */
  add(p: THREE.Vector3, out: THREE.Vector3): void {
    const K = 6;
    const best = this.best.fill(Infinity);
    const bi = this.bi.fill(-1);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    const P = this.P;
    for (let r = 1; r <= 4; r++) {
      for (let x = -r; x <= r; x++)
        for (let y = -r; y <= r; y++)
          for (let z = -r; z <= r; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r && r > 1) continue;
            const a = this.grid.get(`${cx + x},${cy + y},${cz + z}`);
            if (!a) continue;
            for (const i of a) {
              const dx = P[i * 3]! - p.x, dy = P[i * 3 + 1]! - p.y, dz = P[i * 3 + 2]! - p.z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d >= best[K - 1]!) continue;
              let j = K - 1;
              while (j > 0 && best[j - 1]! > d) {
                best[j] = best[j - 1]!;
                bi[j] = bi[j - 1]!;
                j--;
              }
              best[j] = d;
              bi[j] = i;
            }
          }
      // Done once the K-th nearest lies within the searched cube.
      if (bi[K - 1]! >= 0 && Math.sqrt(best[K - 1]!) < (r - 0.5) * this.cell) break;
    }
    if (bi[0]! < 0) return;
    const d0 = Math.sqrt(best[0]!);
    const fade = 1 - THREE.MathUtils.smoothstep(d0, 0.04, 0.075);
    if (fade <= 0) return;
    let ws = 0, x = 0, y = 0, z = 0;
    for (let k = 0; k < K; k++) {
      const i = bi[k]!;
      if (i < 0) break;
      const w = 1 / (best[k]! + 1e-6);
      ws += w;
      x += this.D[i * 3]! * w;
      y += this.D[i * 3 + 1]! * w;
      z += this.D[i * 3 + 2]! * w;
    }
    out.x += (x / ws) * fade;
    out.y += (y / ws) * fade;
    out.z += (z / ws) * fade;
  }
}

const FIELDS = new WeakMap<THREE.BufferGeometry, Map<string, IdentityField | null>>();
/** The identity field of a body mesh (skeleton at rest), or null without identities. Cached per geometry + mix. */
export function identityField(body: THREE.SkinnedMesh, model: THREE.Object3D, mix: IdentityMix | null | undefined): IdentityField | null {
  const geo = (body.userData.neutralGeo as THREE.BufferGeometry | undefined) ?? body.geometry;
  const D = identityDeltas(geo, mix);
  if (!D) return null;
  const key = identityKey(mix);
  let per = FIELDS.get(geo);
  if (!per) FIELDS.set(geo, (per = new Map()));
  if (per.has(key)) return per.get(key)!;
  model.updateMatrixWorld(true);
  const sk = body.skeleton;
  const bmInv = body.bindMode === 'attached' ? new THREE.Matrix4().copy(body.matrixWorld).invert() : body.bindMatrixInverse;
  const pre = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(body.matrixWorld).multiply(bmInv);
  const B = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(pre, b.matrixWorld).multiply(sk.boneInverses[i]!).multiply(body.bindMatrix).elements);
  const pos = geo.attributes.position!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const Ps: number[] = [];
  const Ds: number[] = [];
  const M = new THREE.Matrix4();
  const e = M.elements;
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  const m3 = new THREE.Matrix3();
  // The head and neck skin: every vertex any identity moves (zero ones next to them anchor the field's edge).
  const mo = MORPHS.get(geo)!;
  for (let i = 0; i < pos.count; i++) {
    let any = false;
    for (const a of mo.data) if (a[i * 3] || a[i * 3 + 1] || a[i * 3 + 2]) (any = true);
    if (!any) continue;
    e.fill(0);
    let ws = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (!w) continue;
      ws += w;
      const be = B[si.getComponent(i, c)]!;
      for (let k = 0; k < 16; k++) e[k]! += be[k]! * w;
    }
    if (!ws) continue;
    if (Math.abs(ws - 1) > 1e-3) for (let k = 0; k < 16; k++) e[k]! /= ws;
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    Ps.push(v.x, v.y, v.z);
    d.set(D[i * 3]!, D[i * 3 + 1]!, D[i * 3 + 2]!).applyMatrix3(m3.setFromMatrix4(M));
    Ds.push(d.x, d.y, d.z);
  }
  const f = Ps.length ? new IdentityField(new Float32Array(Ps), new Float32Array(Ds)) : null;
  per.set(key, f);
  return f;
}

// ── Per-identity textures ─────────────────────────────────────────────────────

interface IdTex {
  face: THREE.Texture;
  eyes: THREE.Texture;
  brows: THREE.Texture;
}
const TEX: Partial<Record<'m' | 'f', IdTex>> = {};
/** Tile clones made before their atlas arrived: a clone keeps its own version, so it is flagged on load. */
const PENDING = new Map<THREE.Texture, THREE.Texture[]>();
const LOADS: Promise<void>[] = [];
function load(file: string, color: boolean): THREE.Texture {
  let done = () => {};
  LOADS.push(new Promise<void>((r) => (done = r)));
  const t: THREE.Texture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}textures/ident/${file}`,
    () => {
      for (const c of PENDING.get(t) ?? []) c.needsUpdate = true;
      PENDING.delete(t);
      t.userData.loaded = true;
      done();
    },
    undefined,
    () => done(),
  );
  PENDING.set(t, []);
  t.flipY = false;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
function texFor(sex: 'm' | 'f'): IdTex | null {
  if (!IDENTITY_DATA[sex] || typeof document === 'undefined') return null;
  return (TEX[sex] ??= { face: load(`face_${sex}.webp`, false), eyes: load(`eyes_${sex}.webp`, true), brows: load(`brows_${sex}.webp`, true) });
}

/** Starts loading both sexes' atlases; resolves once they are in (or failed): portraits are drawn synchronously. */
export function preloadIdentityTextures(): Promise<void> {
  texFor('m');
  texFor('f');
  return Promise.all(LOADS).then(() => undefined);
}

/** Which atlas tile an identity is in, or -1. */
export function identityTile(sex: 'm' | 'f', id: string | null): number {
  const d = IDENTITY_DATA[sex];
  return d && id ? d.ids.findIndex((x) => x.id === id) : -1;
}

/**
 * The face skin uniforms for a body material: the atlas, the face's UV rect, up to three tiles and their weights.
 * Null when the body has no identities or the mix is empty.
 */
export function faceSkinUniforms(src: THREE.Material, sex: 'm' | 'f', mix: IdentityMix | null | undefined): Record<string, { value: unknown }> | null {
  if (!ID_MATS.has(src) || IDENTITIES_OFF) return null;
  const d = IDENTITY_DATA[sex];
  const t = texFor(sex);
  if (!d || !t || !mix?.length) return null;
  const tiles = new THREE.Vector3(-1, -1, -1);
  const ws = new THREE.Vector3();
  mix.slice(0, 3).forEach((e, k) => {
    const i = identityTile(sex, e.id);
    if (i < 0) return;
    tiles.setComponent(k, i);
    ws.setComponent(k, e.w);
  });
  return {
    uIdFace: { value: t.face },
    uIdRect: { value: new THREE.Vector4(...d.faceRect) },
    uIdGrid: { value: new THREE.Vector2(d.cols, d.rows) },
    uIdTiles: { value: tiles },
    uIdW: { value: ws },
  };
}

/** GLSL (fragment, after the map): the identity's face detail over the albedo, its roughness offset in idRough. */
export const FACE_ID_GLSL = /* glsl */ `
  float idRough = 0.0;
  {
    vec2 idQ = (vMapUv - uIdRect.xy) / (uIdRect.zw - uIdRect.xy);
    float idW = uIdW.x + uIdW.y + uIdW.z;
    if (idW > 0.0 && idQ.x > 0.0 && idQ.x < 1.0 && idQ.y > 0.0 && idQ.y < 1.0) {
      vec3 idRatio = vec3(1.0 - idW);
      for (int k = 0; k < 3; k++) {
        float t = k == 0 ? uIdTiles.x : k == 1 ? uIdTiles.y : uIdTiles.z;
        float w = k == 0 ? uIdW.x : k == 1 ? uIdW.y : uIdW.z;
        if (t < 0.0 || w <= 0.0) continue;
        vec2 cr = vec2(mod(t, uIdGrid.x), floor(t / uIdGrid.x));
        // (half a texel in from the tile's edges: no bleeding from the neighbour)
        vec2 tq = clamp(idQ, vec2(0.002), vec2(0.998));
        vec4 s = texture2D(uIdFace, (cr + tq) / uIdGrid);
        idRatio += s.rgb * 2.0 * w;
        idRough += (s.a - 0.5) * w;
      }
      diffuseColor.rgb = min(diffuseColor.rgb * idRatio, vec3(1.0));
    }
  }
`;

const EYE_MATS = new Map<string, THREE.Material>();
/** The eyes' / brows' material with the dominant identity's iris / brow tile (a clone sharing the atlas image). */
export function identityTexturedMaterial(kind: 'eyes' | 'brows', sex: 'm' | 'f', mix: IdentityMix | null | undefined, src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (!ID_MATS.has(src) || IDENTITIES_OFF) return src;
  const id = mix?.length ? mainIdentity(mix) : null;
  const i = identityTile(sex, id);
  const t = texFor(sex);
  const d = IDENTITY_DATA[sex];
  if (i < 0 || !t || !d || !src.map) return src;
  const key = `${src.uuid}|${kind}|${i}`;
  let m = EYE_MATS.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = src.clone();
  const tex = t[kind].clone();
  tex.repeat.set(1 / d.cols, 1 / d.rows);
  tex.offset.set((i % d.cols) / d.cols, Math.floor(i / d.cols) / d.rows);
  if (t[kind].userData.loaded) tex.needsUpdate = true;
  else PENDING.get(t[kind])?.push(tex);
  m.map = tex;
  m.userData = { ...src.userData };
  EYE_MATS.set(key, m);
  return m;
}
