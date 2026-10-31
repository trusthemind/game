import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A jacket dropped on the floor (the 'jacket' loot container), built procedurally like the rest of the gear.
 * Metres, lying on y=0, collar towards −Z, hem towards +Z, centred on X/Z.
 *
 * The geometry carries a vertex colour per part (1 = shell fabric, darker = collar, cuffs, pocket flaps, zip)
 * so one InstancedMesh can tint every jacket differently and still keep the details readable from above.
 */

type Variant = 'field' | 'parka';

const SHELL = 1;
const TRIM = 0.78;
const CUFF = 0.66;
const ZIP = 0.22;

/** Low-frequency creases, so the cloth doesn't read as a flat slab under the top-down light. */
function crease(x: number, z: number): number {
  return 0.006 * Math.sin(x * 23 + z * 7) + 0.005 * Math.sin(z * 31 - x * 11) + 0.0035 * Math.sin((x + z) * 47 + 1.3);
}

function tint(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(k), 3));
  return g;
}

/** Strip to position + colour and smooth-shade, so differently built parts merge cleanly. */
function finish(g: THREE.BufferGeometry, k: number, wrinkle = true): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  for (const a of Object.keys(out.attributes)) if (a !== 'position') out.deleteAttribute(a);
  out = mergeVertices(out, 1e-4);
  if (wrinkle) {
    const p = out.attributes.position!;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.012) p.setY(i, p.getY(i) + crease(p.getX(i), p.getZ(i)));
  }
  out.computeVertexNormals();
  return tint(out.toNonIndexed(), k);
}

/**
 * The torso: a segmented slab squashed into a pillow (thick in the middle, thin at the edges), narrowed at
 * the shoulders and lightly flared at the hem.
 */
function torso(hw: number, hd: number, thick: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(hw * 2, thick, hd * 2, 18, 2, 24);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const z = p.getZ(i);
    const v = (z + hd) / (hd * 2); // 0 at the collar, 1 at the hem
    x *= 0.82 + 0.18 * Math.min(1, v * 3.2) + 0.04 * v;
    const edge = Math.min(1 - Math.abs(x) / hw, 1 - Math.abs(z) / hd);
    const puff = Math.sqrt(Math.max(0.06, Math.min(1, edge * 7)));
    p.setXYZ(i, x, (p.getY(i) + thick / 2) * puff, z);
  }
  return g;
}

/** One sleeve: two flattened tubes (upper arm, forearm) with an elbow bend, from the shoulder seam outwards. */
function sleeve(shoulder: THREE.Vector3, yaw: number, bend: number, lift: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const seg = (len: number, r0: number, r1: number, from: THREE.Vector3, ang: number, k: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 14, 6);
    g.scale(1, 1, 0.5); // flatten: an empty sleeve lies flat
    g.rotateX(Math.PI / 2); // along +Z, flat side up
    g.translate(0, r0 * 0.5, len / 2);
    g.rotateY(ang);
    g.translate(from.x, from.y, from.z);
    parts.push(finish(g, k));
    return from.clone().add(new THREE.Vector3(Math.sin(ang) * len, 0, Math.cos(ang) * len));
  };
  const elbow = seg(0.27, 0.075, 0.066, shoulder, yaw, SHELL);
  const wristFrom = elbow.clone();
  wristFrom.y += lift;
  const wrist = seg(0.25, 0.064, 0.056, wristFrom, yaw + bend, SHELL);
  // Elbow fold and ribbed cuff.
  const fold = new THREE.SphereGeometry(0.07, 14, 8);
  fold.scale(1, 0.32, 1);
  fold.translate(elbow.x, 0.024 + lift / 2, elbow.z);
  parts.push(finish(fold, SHELL));
  const cuff = new THREE.CylinderGeometry(0.058, 0.058, 0.05, 14, 1);
  cuff.scale(1, 1, 0.5);
  cuff.rotateX(Math.PI / 2);
  cuff.translate(0, 0.03, -0.02);
  cuff.rotateY(yaw + bend);
  cuff.translate(wrist.x, wrist.y + lift, wrist.z);
  parts.push(finish(cuff, CUFF, false));
  return parts;
}

function rounded(w: number, h: number, d: number, x: number, y: number, z: number, k: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(Math.min(h, d) / 2, Math.max(0.001, w - Math.min(h, d)), 3, 8);
  g.rotateZ(Math.PI / 2);
  g.scale(1, h / Math.min(h, d), d / Math.min(h, d));
  g.rotateY(yaw);
  g.translate(x, y, z);
  return finish(g, k, false);
}

function build(variant: Variant): THREE.BufferGeometry {
  const hw = 0.25;
  const hd = variant === 'parka' ? 0.38 : 0.33;
  const thick = 0.05;
  const parts: THREE.BufferGeometry[] = [finish(torso(hw, hd, thick), SHELL)];
  const top = -hd;
  // Sleeves dropped out to the sides and bent back down towards the hem, the left one flung a bit wider.
  parts.push(...sleeve(new THREE.Vector3(-hw * 0.82, 0.004, top + 0.07), -1.85, 1.05, 0));
  parts.push(...sleeve(new THREE.Vector3(hw * 0.82, 0.004, top + 0.07), 1.45, -0.7, 0));
  // Collar (stand-up collar lying folded) or hood.
  if (variant === 'parka') {
    const hood = new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    hood.scale(1, 0.38, 0.85);
    hood.translate(0, 0, top - 0.06);
    parts.push(finish(hood, SHELL));
    const rim = new THREE.TorusGeometry(0.12, 0.018, 8, 24, Math.PI);
    rim.rotateX(-Math.PI / 2);
    rim.scale(1, 1, 0.75);
    rim.translate(0, 0.045, top - 0.02);
    parts.push(finish(rim, TRIM, false));
  } else {
    const collar = new THREE.TorusGeometry(0.095, 0.03, 8, 26, Math.PI * 1.25);
    collar.rotateZ(-Math.PI * 0.125);
    collar.rotateX(-Math.PI / 2);
    collar.scale(1, 0.45, 0.8);
    collar.translate(0, 0.05, top + 0.075);
    parts.push(finish(collar, TRIM));
  }
  // Zip down the front, with its pull near the collar, and two flap pockets low on the front.
  const zipLen = hd * 2 - 0.12;
  parts.push(rounded(zipLen, 0.008, 0.014, 0, thick + 0.004, top + 0.08 + zipLen / 2, ZIP, Math.PI / 2));
  parts.push(rounded(0.03, 0.01, 0.016, 0.012, thick + 0.012, top + 0.13, ZIP * 1.8, Math.PI / 2));
  for (const s of [-1, 1]) {
    const pz = hd - 0.2;
    parts.push(rounded(0.15, 0.012, 0.055, s * 0.125, thick + 0.002 + crease(s * 0.125, pz), pz, TRIM, s * 0.06));
  }
  // Drawstring hem on the parka.
  if (variant === 'parka') parts.push(rounded(hw * 1.9, 0.016, 0.03, 0, 0.022, hd - 0.012, TRIM));
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

const cache = new Map<Variant, THREE.BufferGeometry>();
/** Shared geometry per variant (the caller owns nothing: don't dispose). */
export function droppedJacket(variant: Variant): THREE.BufferGeometry {
  let g = cache.get(variant);
  if (!g) cache.set(variant, (g = build(variant)));
  return g;
}

export const JACKET_VARIANTS: Variant[] = ['field', 'parka'];

/** Drab shell colours real jackets come in: olive, khaki, navy, black, brown, grey, faded red. */
export const JACKET_COLORS = [0x4a5236, 0x6b6248, 0x262d3d, 0x1e1f21, 0x4e3a2a, 0x55585a, 0x6a2d26, 0x3b4a3f];

/** Shader edit for the jacket material: a fine twill weave and a little wear, in object space. */
export function jacketFabric(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vJk;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvJk = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vJk;
      float jh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float jn(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(jh(i), jh(i + vec3(1,0,0)), f.x), mix(jh(i + vec3(0,1,0)), jh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(jh(i + vec3(0,0,1)), jh(i + vec3(1,0,1)), f.x), mix(jh(i + vec3(0,1,1)), jh(i + vec3(1,1,1)), f.x), f.y), f.z);
      }`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float twill = 0.9 + 0.08 * abs(sin((vJk.x + vJk.z) * 700.0));
        float wear = 0.9 + 0.14 * jn(vJk * 18.0) + 0.06 * jn(vJk * 90.0);
        diffuseColor.rgb *= twill * wear;
      }`,
    );
}
