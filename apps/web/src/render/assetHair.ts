import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HAIR_COLOR_BY_HEX } from '@ashfall/engine';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import type { HeadClip } from './hairGen';

/**
 * Asset hair: MakeHuman's CC0 hair meshes (alpha-textured cards with real hairlines), fitted to each MPFB base
 * body in Blender (tools/assets/mpfb-pilot/build_identities.py, add_identities.mjs -> public/models/hair_mh.glb, one
 * node per `${sex}_${name}`, in the body's model space). Mounted on the body's skeleton (the head; what hangs below
 * the neck blends onto the upper spine), shaped with the body like everything else (bodyShape.ts: the face identity's
 * field and the body shape move it), tinted by the hair colour, tucked under helmets as the procedural hair is.
 * Loaded on first use (~1.7 MB).
 */

/** Engine hair id -> the asset and the procedural style whose scalp underlay goes under it. */
export const ASSET_HAIR: Record<string, { asset: string; underlay: string }> = {
  mh_bob01: { asset: 'bob01', underlay: 'bob' },
  mh_bob02: { asset: 'bob02', underlay: 'bob' },
  mh_long01: { asset: 'long01', underlay: 'long' },
  mh_ponytail01: { asset: 'ponytail01', underlay: 'ponytail' },
  mh_short01: { asset: 'short01', underlay: 'short' },
  mh_short02: { asset: 'short02', underlay: 'short' },
  mh_short03: { asset: 'short03', underlay: 'crew' },
  mh_short04: { asset: 'short04', underlay: 'crew' },
  mh_afro01: { asset: 'afro01', underlay: 'short' },
  // MakeHuman community packs (refs/HAIR_ASSETS.md; CC0 / CC BY, credited in public/models/CREDITS.txt)
  mh_bluntbob: { asset: 'toigo_blunt_bob', underlay: 'bob' },
  mh_curledbob: { asset: 'toigo_curled_under_bob_with_bangs', underlay: 'fringebob' },
  mh_wavybob: { asset: 'elvs_wavy_bob', underlay: 'bob' },
  mh_hazel: { asset: 'elvs_hazel_hair', underlay: 'wavy' },
  mh_updo: { asset: 'elvs_50s_updo', underlay: 'ponytail' },
  mh_katherine: { asset: 'elvs_katherine_hair', underlay: 'abob' },
};

let lib: Map<string, THREE.Mesh> | null = null;
let pending: Promise<Map<string, THREE.Mesh>> | null = null;
export function assetHairLoaded(): boolean {
  return !!lib;
}
export function loadAssetHair(): Promise<Map<string, THREE.Mesh>> {
  if (lib) return Promise.resolve(lib);
  pending ??= new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL}models/hair_mh.glb`)
    .then((g) => {
      const m = new Map<string, THREE.Mesh>();
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Positions as stored are dequantised by the node's transform: bake it in (model space, metres).
        // (quantised attributes as floats first: applyMatrix4 on a normalised int16 one would clamp to [-1, 1])
        const geo = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(mesh.geometry.attributes)) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          geo.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
        }
        geo.setIndex(mesh.geometry.index);
        geo.applyMatrix4(mesh.matrixWorld);
        const name = (mesh.parent && mesh.parent !== g.scene ? mesh.parent.name : mesh.name) || mesh.name;
        m.set(name, new THREE.Mesh(geo, mesh.material));
      });
      lib = m;
      return m;
    })
    .catch(() => (lib = new Map()));
  return pending;
}

const GEOS = new Map<string, THREE.BufferGeometry>();
/**
 * The asset's geometry in the body's bind space, skinned: rigidly to the head, what hangs below the neck blended
 * onto spine_03 (so long hair and a ponytail stay on the back when the head turns), or null if not loaded.
 * The skeleton must be at rest.
 */
export function assetHairGeometry(body: THREE.SkinnedMesh, model: THREE.Object3D, sex: 'm' | 'f', id: string): THREE.BufferGeometry | null {
  const a = ASSET_HAIR[id];
  const src = a && lib?.get(`${sex}_${a.asset}`);
  if (!src) return null;
  const key = `${body.geometry.uuid}|${(body.userData.neutralGeo as THREE.BufferGeometry | undefined)?.uuid}|${id}`;
  const hit = GEOS.get(key);
  if (hit) return hit;
  model.updateMatrixWorld(true);
  const sk = body.skeleton;
  const bi = (n: string) => sk.bones.findIndex((b) => b.name === n);
  const iH = bi('Head');
  const iS = bi('spine_03');
  const iN = bi('neck_01');
  if (iH < 0) return null;
  const bmInv = body.bindMode === 'attached' ? new THREE.Matrix4().copy(body.matrixWorld).invert() : body.bindMatrixInverse;
  const pre = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(body.matrixWorld).multiply(bmInv);
  const B = (i: number) => new THREE.Matrix4().multiplyMatrices(pre, sk.bones[i]!.matrixWorld).multiply(sk.boneInverses[i]!).multiply(body.bindMatrix);
  const BH = B(iH);
  const BS = iS >= 0 ? B(iS) : BH;
  // Where the neck joint stands (model space): below it the hair blends onto the spine.
  const neckY = iN >= 0 ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(pre, sk.bones[iN]!.matrixWorld)).y : -Infinity;
  const g = src.geometry;
  const pos = g.attributes.position!;
  const nrm = g.attributes.normal;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const SI = new Uint16Array(n * 4);
  const SW = new Float32Array(n * 4);
  const M = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const wH = iS >= 0 ? THREE.MathUtils.smoothstep(v.y, neckY - 0.1, neckY + 0.03) : 1;
    // Linear blend of the two skin matrices, inverted: the bind-space point that skins to v.
    const eh = BH.elements, es = BS.elements, e = M.elements;
    for (let k = 0; k < 16; k++) e[k] = eh[k]! * wH + es[k]! * (1 - wH);
    inv.copy(M).invert();
    v.applyMatrix4(inv).toArray(P, i * 3);
    if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm.getNormalMatrix(inv)).normalize().toArray(N, i * 3);
    SI[i * 4] = iH;
    SI[i * 4 + 1] = Math.max(0, iS);
    SW[i * 4] = wH;
    SW[i * 4 + 1] = 1 - wH;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (g.attributes.uv) out.setAttribute('uv', g.attributes.uv);
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  out.setIndex(g.index);
  out.computeBoundingSphere();
  GEOS.set(key, out);
  return out;
}

const MATS = new Map<string, THREE.MeshStandardMaterial>();
const clipKey = (c: HeadClip | null | undefined) =>
  c ? [c.c.x, c.c.y, c.c.z, c.r.x, c.r.y, c.r.z, c.rim, c.slope, c.pivotZ, c.band, c.fringeY].map((x) => x.toFixed(4)).join(',') : '';

/** The cards' material: the asset's grey strands tinted by the hair colour (lighter ends / grown-out roots by the
 * palette's treatment), alpha-cut, both sides; squashed under the rim of a helmet or cap (as hairGen's HeadClip). */
export function assetHairMaterial(id: string, color: number, u: WorldUniforms, clip?: HeadClip | null): THREE.MeshStandardMaterial | null {
  const a = ASSET_HAIR[id];
  const src = a && [...(lib?.values() ?? [])].find((m) => (m.material as THREE.Material).name === `mhhair_${a.asset}`);
  if (!src) return null;
  const key = `${a.asset}|${color}|${clipKey(clip)}`;
  let m = MATS.get(key);
  if (m) return m;
  m = (src.material as THREE.MeshStandardMaterial).clone();
  m.name = 'mhhair';
  // The texture is grey strands normalised to ~0.7: a little over the colour, so the mean reads as the colour.
  m.color = new THREE.Color(color).multiplyScalar(1.3);
  m.alphaTest = 0.42;
  m.transparent = false;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.roughness = 0.62;
  m.metalness = 0;
  const def = HAIR_COLOR_BY_HEX.get(color);
  const grey = def?.grey ?? 0;
  const on = clip ? 1 : 0;
  patchWorldMaterial(m, u, {
    key: `mhhair${on}`,
    pre: (sh) => {
      sh.uniforms.uClipOn = { value: on };
      sh.uniforms.uClipC = { value: clip?.c ?? new THREE.Vector3() };
      sh.uniforms.uClipR = { value: clip?.r ?? new THREE.Vector3(1, 1, 1) };
      sh.uniforms.uClipRim = { value: new THREE.Vector4(clip?.rim ?? 0, clip?.slope ?? 0, clip?.pivotZ ?? 0, clip?.band ?? 0.01) };
      sh.uniforms.uGrey = { value: grey };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uClipOn;\nuniform vec3 uClipC;\nuniform vec3 uClipR;\nuniform vec4 uClipRim;\nvarying vec3 vHairP;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vHairP = position;
          if (uClipOn > 0.5) {
            float rimY = uClipRim.x + uClipRim.y * (transformed.z - uClipRim.z);
            float above = smoothstep(rimY - uClipRim.w, rimY + uClipRim.w * 0.25, transformed.y);
            vec3 hq = (transformed - uClipC) / uClipR;
            float L = length(hq);
            float maxL = mix(1.0 + max(0.0, rimY - transformed.y) / (uClipRim.w * 2.0), 0.96, above);
            if (L > maxL) transformed = uClipC + (transformed - uClipC) * (maxL / L);
          }`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGrey;\nvarying vec3 vHairP;\nfloat mhH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // Grey strands through it (the palette's greying), by texel so they follow the cards' strands.
          if (uGrey > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75) * (0.6 + 0.6 * sampledDiffuseColor.r), step(1.0 - uGrey, mhH(floor(vMapUv * 512.0))));`,
        );
    },
  });
  MATS.set(key, m);
  return m;
}

export function disposeAssetHair(): void {
  for (const g of GEOS.values()) g.dispose();
  GEOS.clear();
  MATS.clear();
}
