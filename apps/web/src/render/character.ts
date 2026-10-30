import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rng, getDef, type Actor, type Corpse, type Equipment } from '@ashfall/engine';
import type { AssetLibrary } from './assets';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import { faceTexture, type FaceSpec } from './facePainter';
import { buildGun, gunKey } from './gunsmith';
import { armorModel, BACKPACK_TINT, hatModel, helmetModel, rigModel, slingModel } from './gear3d';
import { ARMOR_SPECS, buildShell, details, RIG_SPECS, type ArmorSpec } from './armorShell';
import { attachSkinned, cloneHuman, type HumanParts } from './human';

// ─────────────────────────────────────────────────────────────────────────────
// Appearance
// ─────────────────────────────────────────────────────────────────────────────

export type HairStyle = 'bald' | 'buzz' | 'short' | 'messy' | 'long' | 'ponytail' | 'bob' | 'bun';
export type TopStyle = 'tee' | 'jacket' | 'hoodie' | 'coat';
/** Fabric print, drawn in the outfit shader from object-space position (no textures). */
export type Pattern = 'plain' | 'woodland' | 'flora' | 'digital' | 'stripes' | 'plaid' | 'tracksuit' | 'denim';
export const PATTERN_ID: Record<Pattern, number> = { plain: 0, woodland: 1, flora: 2, digital: 3, stripes: 4, plaid: 5, tracksuit: 6, denim: 7 };
export type Hat = 'beanie' | 'cap' | 'ushanka' | 'bandana';

export interface Appearance {
  sex: 'm' | 'f';
  skin: number;
  hair: HairStyle;
  hairColor: number;
  beard: boolean;
  top: number;
  topStyle: TopStyle;
  pants: number;
  boots: number;
  gloves: number | null;
  zombie?: boolean;
  eyes?: number;
  age?: 0 | 1 | 2;
  scars?: boolean;
  /** Clothing variety: print on the top / trousers, a second colour for it, which pack the trousers and
   * footwear come from (mix and match), and headwear. */
  topPattern?: Pattern;
  pantsPattern?: Pattern;
  accent?: number;
  legs?: 'ranger' | 'peasant';
  feet?: 'ranger' | 'peasant';
  hat?: Hat | null;
  hatColor?: number;
}

export const SKIN_TONES = [0xf1c8a8, 0xe3b08e, 0xc99069, 0x9a6544, 0x6b4430];
export const HAIR_COLORS = [0x1c1612, 0x3a281b, 0x5b3d25, 0x7c3b21, 0xb08a52, 0x8c8a86, 0xd8cfb8];
const HAIR_M: HairStyle[] = ['bald', 'buzz', 'short', 'short', 'messy', 'messy'];
const HAIR_F: HairStyle[] = ['long', 'ponytail', 'bob', 'bun', 'long', 'ponytail'];

const DRAB_TOPS = [0x4f553a, 0x5a4632, 0x55595b, 0x2b3346, 0x6b5b45, 0x3d4a3a, 0x7a6a50, 0x4a3b3b];
const DRAB_PANTS = [0x3a4558, 0x2e3324, 0x45403a, 0x2b2b2e, 0x524634];

/** Deterministic look per actor so the same bot looks the same every frame / reload. */
export function lookFor(seed: number, archetype: string, npcId?: string, bossId?: string): Appearance {
  if (npcId && NPC_LOOKS[npcId]) return NPC_LOOKS[npcId]!;
  if (bossId && BOSS_LOOKS[bossId]) return BOSS_LOOKS[bossId]!;
  const rng = new Rng(seed * 7919 + archetype.length);
  const sex: 'm' | 'f' = archetype === 'boss' ? 'm' : rng.chance(archetype === 'raider' || archetype === 'guard' ? 0.25 : 0.4) ? 'f' : 'm';
  const base: Appearance = {
    sex,
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(sex === 'm' ? HAIR_M : HAIR_F),
    hairColor: rng.pick(HAIR_COLORS.slice(0, 6)),
    beard: sex === 'm' && rng.chance(0.4),
    top: rng.pick(DRAB_TOPS),
    topStyle: rng.pick(['tee', 'jacket', 'hoodie', 'jacket'] as TopStyle[]),
    pants: rng.pick(DRAB_PANTS),
    boots: rng.pick([0x2a2420, 0x1e1e1e, 0x3b2f24]),
    gloves: null,
    eyes: rng.pick([0x4a3020, 0x5a3a22, 0x3a5a7a, 0x5a6a4a, 0x6a6a6a, 0x2a1d14]),
    age: rng.weighted([[0, 3], [1, 4], [2, 2]] as const),
    scars: rng.chance(archetype === 'raider' || archetype === 'guard' ? 0.35 : 0.1),
  };
  // Clothing: mix pack pieces and prints so a crowd doesn't look like clones.
  const civ = (): Partial<Appearance> => {
    const style = rng.weighted([['gopnik', 3], ['sailor', 2], ['flannel', 2], ['work', 3], ['hoodie', 2]] as const);
    switch (style) {
      case 'gopnik':
        return { topStyle: 'jacket', top: rng.pick([0x1c1f2a, 0x1f3a6a, 0x5a1c1c, 0x1e1e1e]), topPattern: 'tracksuit', pants: rng.pick([0x1c1f2a, 0x1e1e1e]), pantsPattern: 'tracksuit', accent: 0xe8e8e0, legs: 'ranger', feet: 'peasant', hat: rng.chance(0.5) ? 'cap' : null, hatColor: 0x1e1e1e };
      case 'sailor':
        return { topStyle: 'tee', top: 0x1d2c5a, topPattern: 'stripes', accent: 0xe8e8e0, pantsPattern: 'denim', pants: 0x2c3e5e, hat: rng.chance(0.4) ? 'beanie' : null, hatColor: rng.pick([0x1e1e1e, 0x2c3e5e]) };
      case 'flannel':
        return { topStyle: 'tee', top: rng.pick([0x8a2a22, 0x2a5a3a, 0x2a3a6a]), topPattern: 'plaid', accent: 0x1e1e1e, pantsPattern: rng.chance(0.6) ? 'denim' : 'plain', pants: rng.pick([0x2c3e5e, 0x3a3a30]), hat: rng.chance(0.3) ? 'ushanka' : null, hatColor: 0x5a4632 };
      case 'hoodie':
        return { topStyle: 'hoodie', topPattern: 'plain', pantsPattern: rng.chance(0.5) ? 'denim' : 'plain', pants: rng.pick([0x2c3e5e, 0x2e3324]) };
      default:
        return { topStyle: rng.pick(['jacket', 'coat'] as TopStyle[]), topPattern: 'plain', pantsPattern: rng.chance(0.4) ? 'denim' : 'plain', legs: rng.chance(0.5) ? 'peasant' : 'ranger', hat: rng.weighted([[null, 4], ['beanie', 3], ['ushanka', 1], ['bandana', 1]] as const), hatColor: rng.pick([0x2a2a2a, 0x4a3b2b, 0x3d4a3a, 0x6a2a22]) };
    }
  };
  const camo = (): Partial<Appearance> => {
    const p = rng.pick(['woodland', 'flora', 'digital'] as Pattern[]);
    const base = p === 'flora' ? 0x6a7a52 : p === 'digital' ? 0x5a6448 : 0x55603e;
    return { topStyle: rng.pick(['jacket', 'jacket', 'coat'] as TopStyle[]), top: base, topPattern: p, pants: base, pantsPattern: rng.chance(0.75) ? p : 'plain', accent: p === 'flora' ? 0x3a4a2a : 0x2e2a20, legs: 'ranger', feet: 'ranger', hat: rng.chance(0.35) ? 'beanie' : null, hatColor: 0x2a2d22 };
  };
  switch (archetype) {
    case 'raider':
    case 'guard':
      return { ...base, ...camo(), gloves: 0x1a1a1a, boots: 0x1a1816 };
    case 'boss':
      return { ...base, top: 0x3b2622, topStyle: 'coat', pants: 0x1f1f22, beard: true, hair: 'buzz', gloves: 0x1a1a1a };
    case 'infected': {
      const c = civ();
      return { ...base, ...c, zombie: true, hat: null, skin: rng.pick([0x8c9a7a, 0x7d8b6c, 0x9aa088, 0x6f7a62]), top: (c.top ?? base.top) & 0x7f7f7f, pants: (c.pants ?? base.pants) & 0x7f7f7f };
    }
    default:
      return { ...base, ...civ() };
  }
}

/** The player's own survivor: persisted body/hair choices + a practical scavenger outfit. */
export function playerAppearance(look: { sex: 'm' | 'f'; skin: number; hair: string; hairColor: number; beard: boolean }): Appearance {
  return { ...look, hair: look.hair as HairStyle, top: 0x4b5138, topStyle: 'jacket', pants: 0x3a3a30, boots: 0x2a2420, gloves: 0x2b2722, eyes: 0x4a3020, age: 1 };
}

const BOSS_LOOKS: Record<string, Appearance> = {
  kostia: { sex: 'm', skin: 0xe3b08e, hair: 'buzz', hairColor: 0x2a201a, beard: true, top: 0x3b2622, topStyle: 'coat', pants: 0x1f1f22, boots: 0x1a1816, gloves: 0x1a1a1a, eyes: 0x3a2a1a, age: 2, scars: true },
  bohdan: { sex: 'm', skin: 0xc99069, hair: 'short', hairColor: 0x8c8a86, beard: true, top: 0x3e4a2e, topStyle: 'jacket', pants: 0x3a3a2c, boots: 0x3b2f24, gloves: 0x4a3a28, eyes: 0x4a5a3a, age: 2 },
  rina: { sex: 'f', skin: 0xf1c8a8, hair: 'long', hairColor: 0x7c3b21, beard: false, top: 0x1c1c20, topStyle: 'jacket', pants: 0x26262c, boots: 0x161616, gloves: 0x1a1a1a, eyes: 0x3a5a4a, age: 1 },
};

const NPC_LOOKS: Record<string, Appearance> = {
  lena: { sex: 'f', skin: 0xf1c8a8, hair: 'ponytail', hairColor: 0x7c3b21, beard: false, top: 0xd8dcd4, topStyle: 'coat', pants: 0x2f4f5a, boots: 0x2a2420, gloves: null, eyes: 0x4f6a3a, age: 0 },
  mykola: { sex: 'm', skin: 0xe3b08e, hair: 'short', hairColor: 0x8c8a86, beard: true, top: 0xb5622e, topStyle: 'jacket', pants: 0x3a4558, boots: 0x3b2f24, gloves: 0x5a4632, eyes: 0x3a5a7a, age: 2 },
  vera: { sex: 'f', skin: 0xe3b08e, hair: 'bob', hairColor: 0x1c1612, beard: false, top: 0x4a2f55, topStyle: 'coat', pants: 0x1f1f22, boots: 0x1e1e1e, gloves: null, eyes: 0x2a1d14, age: 1 },
  taras: { sex: 'm', skin: 0xd9a582, hair: 'buzz', hairColor: 0x3a2a1c, beard: false, top: 0x55603e, topStyle: 'jacket', pants: 0x4a5236, boots: 0x2a2620, gloves: 0x3a3a2e, eyes: 0x5a6a7a, age: 1, scars: true },
  yaryna: { sex: 'f', skin: 0xf3d0b4, hair: 'bun', hairColor: 0x2a1a12, beard: false, top: 0x6a5a8a, topStyle: 'hoodie', pants: 0x2a3040, boots: 0x3a2a2a, gloves: null, eyes: 0x3a2a1a, age: 0 },
  ostap: { sex: 'm', skin: 0xc68a62, hair: 'short', hairColor: 0xb8b4ac, beard: true, top: 0x5a4632, topStyle: 'coat', pants: 0x3a3428, boots: 0x2e2418, gloves: 0x4a3828, eyes: 0x4a3a2a, age: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Rig analysis (done once): body regions per vertex + bind-space boxes for attachments
// ─────────────────────────────────────────────────────────────────────────────

const enum Region {
  Skin = 0,
  Hands = 1,
  Top = 2,
  Sleeve = 3,
  Pants = 4,
  Boots = 5,
  Belt = 6,
}

interface RigInfo {
  geometries: Map<string, THREE.BufferGeometry>;
  boxes: Record<'head' | 'chest' | 'hips' | 'handR' | 'handL', THREE.Box3>;
  forward: THREE.Vector3;
}

const rigInfos = new Map<THREE.Object3D, RigInfo>();

// Bone names follow the Unreal mannequin convention used by Quaternius' UAL1/UAL2 rigs.
const HAND_R = /^(hand|index|middle|pinky|ring|thumb)_.*r$|^hand_r$/i;
const HAND_L = /^(hand|index|middle|pinky|ring|thumb)_.*l$|^hand_l$/i;

function regionForBone(name: string): Region {
  const n = name.toLowerCase();
  if (/^head$|^neck/.test(n)) return Region.Skin;
  if (/^(hand|index|middle|pinky|ring|thumb)_/.test(n)) return Region.Hands;
  if (/^lowerarm/.test(n)) return Region.Sleeve;
  if (/^(spine|clavicle|upperarm)/.test(n)) return Region.Top;
  if (/^pelvis/.test(n)) return Region.Pants;
  if (/^(foot|ball)/.test(n)) return Region.Boots;
  return Region.Pants;
}

function analyseRig(meshes: THREE.SkinnedMesh[], paintedFace = true): RigInfo {
  const boxes = { head: new THREE.Box3(), chest: new THREE.Box3(), hips: new THREE.Box3(), handR: new THREE.Box3(), handL: new THREE.Box3() };
  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const mesh of meshes) {
    analyseMesh(mesh, boxes);
    geometries.set(mesh.name, mesh.geometry);
  }
  if (!paintedFace) return { geometries, boxes, forward: new THREE.Vector3(0, 0, 1) };
  // Second pass once the head box is known: planar face UVs for head vertices on the front half.
  const hb = boxes.head;
  const hs = hb.getSize(new THREE.Vector3());
  const hc = hb.getCenter(new THREE.Vector3());
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position!;
    const reg = mesh.geometry.attributes.aRegion!;
    const face = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const inHead = reg.getX(i) === 0 && y > hb.min.y - hs.y * 0.05;
      face[i * 3] = (x - hb.min.x) / hs.x;
      face[i * 3 + 1] = (y - hb.min.y) / hs.y;
      // Fade the projection out towards the sides of the head so features don't smear.
      face[i * 3 + 2] = inHead ? THREE.MathUtils.clamp(((z - hc.z) / (hs.z * 0.5)) * 2.2 - 0.3, 0, 1) : 0;
    }
    mesh.geometry.setAttribute('aFace', new THREE.BufferAttribute(face, 3));
  }
  // Face direction: the hands of an A/T-pose sit on ±X, so forward is ±Z; glTF characters face +Z.
  return { geometries, boxes, forward: new THREE.Vector3(0, 0, 1) };
}

function analyseMesh(mesh: THREE.SkinnedMesh, boxes: RigInfo['boxes']): void {
  const geo = mesh.geometry;
  const pos = geo.attributes.position!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const bones = mesh.skeleton.bones;
  const region = new Float32Array(pos.count);
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
    const name = bones[best]?.name ?? '';
    region[i] = regionForBone(name);
    v.fromBufferAttribute(pos, i);
    // Mesh-space positions are in the skinned mesh's bind space.
    if (/^head$/i.test(name)) boxes.head.expandByPoint(v);
    else if (/^spine_0[23]$/.test(name)) boxes.chest.expandByPoint(v);
    else if (/^pelvis$/.test(name)) boxes.hips.expandByPoint(v);
    else if (HAND_R.test(name)) boxes.handR.expandByPoint(v);
    else if (HAND_L.test(name)) boxes.handL.expandByPoint(v);
  }
  geo.setAttribute('aRegion', new THREE.BufferAttribute(region, 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────────────────────

const bodyMatCache = new Map<string, THREE.MeshStandardMaterial>();
const flatMatCache = new Map<string, THREE.MeshStandardMaterial>();

function palette(a: Appearance, dead: boolean): THREE.Color[] {
  const k = dead ? 0.6 : 1;
  const c = (hex: number) => new THREE.Color(hex).multiplyScalar(k);
  const sleeve = a.topStyle === 'tee' ? a.skin : a.top;
  return [c(a.skin), c(a.gloves ?? a.skin), c(a.top), c(sleeve), c(a.pants), c(a.boots), c(0x1c1a17)];
}

function bodyMaterial(a: Appearance, u: WorldUniforms, dead = false): THREE.MeshStandardMaterial {
  const key = JSON.stringify(a) + dead;
  let m = bodyMatCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const pal = palette(a, dead);
  const faceTex = faceTexture(faceSpecFor(a));
  patchWorldMaterial(m, u, {
    pre: (shader) => {
      shader.uniforms.uPal = { value: pal };
      shader.uniforms.uFaceTex = { value: faceTex };
      shader.uniforms.uDead = { value: dead ? 0.6 : 1 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRegion;\nattribute vec3 aFace;\nvarying float vRegion;\nvarying vec3 vObjPos;\nvarying vec3 vFace;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;\nvObjPos = position;\nvFace = aFace;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPal[7];\nuniform sampler2D uFaceTex;\nuniform float uDead;\nvarying float vRegion;\nvarying vec3 vObjPos;\nvarying vec3 vFace;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          int ri = int(vRegion + 0.5);
          vec3 pc = uPal[0];
          for (int i = 1; i < 7; i++) if (i == ri) pc = uPal[i];
          // Cheap fabric/grime variation so flat colours don't look like plastic.
          float n = fract(sin(dot(floor(vObjPos * 40.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (ri != 0) pc *= 0.9 + n * 0.14;
          if (vFace.z > 0.01) {
            vec4 ft = texture2D(uFaceTex, vFace.xy);
            pc = mix(pc, ft.rgb * uDead, ft.a * vFace.z);
          }
          diffuseColor.rgb = pc;`,
        );
    },
    key: 'char',
  });
  bodyMatCache.set(key, m);
  return m;
}

function flatMat(color: number, opts: { rough?: number; metal?: number; side?: boolean } = {}, u?: WorldUniforms): THREE.MeshStandardMaterial {
  const key = `${color}:${opts.rough}:${opts.metal}:${opts.side}`;
  let m = flatMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0, flatShading: true, side: opts.side ? THREE.DoubleSide : THREE.FrontSide });
    if (u) patchWorldMaterial(m, u);
    flatMatCache.set(key, m);
  }
  return m;
}

const gearSkinCache = new Map<string, THREE.MeshStandardMaterial>();
/** Smooth-shaded fabric for armour shells and sewn-on parts (works for skinned and plain meshes). */
function gearSkinMat(color: number, rough: number, u: WorldUniforms): THREE.MeshStandardMaterial {
  const key = `${color}:${rough}`;
  let m = gearSkinCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide });
    patchWorldMaterial(m, u);
    gearSkinCache.set(key, m);
  }
  return m;
}

// ── Modelled humans ─────────────────────────────────────────────────────────

/** Average skin colour of the pack's body textures (sRGB #a67350); skin tones are applied relative to it. */
const TEX_SKIN = new THREE.Color(0xa67350);

const HAIR_MODEL: Record<'m' | 'f', Record<HairStyle, string | null>> = {
  m: { bald: null, buzz: 'Hair_Buzzed', short: 'Hair_SimpleParted', messy: 'Hair_SimpleParted', long: 'Hair_Long', ponytail: 'Hair_Long', bob: 'Hair_BuzzedFemale', bun: 'Hair_Buns' },
  f: { bald: null, buzz: 'Hair_BuzzedFemale', short: 'Hair_BuzzedFemale', messy: 'Hair_BuzzedFemale', long: 'Hair_Long', ponytail: 'Hair_Long', bob: 'Hair_BuzzedFemale', bun: 'Hair_Buns' },
};

const heightCache = new Map<THREE.Object3D, number>();
/** Scale so the bind-pose model is `target` metres tall. */
function heightScale(src: THREE.Object3D, target: number): number {
  let h = heightCache.get(src);
  if (h === undefined) {
    h = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()).y || 1.8;
    heightCache.set(src, h);
  }
  return target / h;
}

const humanMatCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * PBR skin + painted clothes. Head/neck (and bare hands / tee sleeves) keep the photographic texture,
 * re-tinted to the actor's skin tone; everything else becomes fabric in the outfit colours, keeping a
 * little of the texture's shading so folds and muscles still read under the lights.
 */
function humanBodyMaterial(src: THREE.MeshStandardMaterial, a: Appearance, u: WorldUniforms, dead = false, clothed = false): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|${JSON.stringify(a)}|${dead}|${clothed}`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  m.userData.src = src;
  m.roughness = 0.75;
  const pal = palette(a, dead);
  const tint = new THREE.Color(a.skin);
  tint.r /= TEX_SKIN.r;
  tint.g /= TEX_SKIN.g;
  tint.b /= TEX_SKIN.b;
  if (dead) tint.multiplyScalar(0.7);
  const skinMask = [1, a.gloves === null ? 1 : 0, 0, a.topStyle === 'tee' ? 1 : 0, 0, 0, 0];
  // Under real clothes only the head and neck of the body are drawn; the outfit brings its own arms and hands.
  const hide = clothed ? [0, 1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0, 0];
  patchWorldMaterial(m, u, {
    pre: (shader) => {
      shader.uniforms.uHide = { value: hide };
      shader.uniforms.uPal = { value: pal };
      shader.uniforms.uSkinTint = { value: tint };
      shader.uniforms.uSkinMask = { value: skinMask };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRegion;\nvarying float vRegion;\nvarying vec3 vObjPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;\nvObjPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPal[7];\nuniform vec3 uSkinTint;\nuniform float uSkinMask[7];\nuniform float uHide[7];\nvarying float vRegion;\nvarying vec3 vObjPos;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          int ri = int(vRegion + 0.5);
          for (int i = 0; i < 7; i++) if (i == ri && uHide[i] > 0.5) discard;
          float skin = 0.0;
          vec3 cloth = uPal[0];
          for (int i = 0; i < 7; i++) if (i == ri) { skin = uSkinMask[i]; cloth = uPal[i]; }
          if (skin > 0.5) {
            diffuseColor.rgb = min(diffuseColor.rgb * uSkinTint, vec3(1.0));
          } else {
            float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            float n = fract(sin(dot(floor(vObjPos * 60.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            diffuseColor.rgb = cloth * (0.86 + 0.32 * l) * (0.94 + n * 0.08);
          }`,
        );
    },
    key: 'human',
  });
  humanMatCache.set(key, m);
  return m;
}

/**
 * Clothing from the outfit pack, re-dyed per character: the texture's shading and stitching stay, its hue
 * mostly gives way to the character's palette. Skin parts (bare forearms, hands) take the skin tone.
 */
function outfitMaterial(src: THREE.MeshStandardMaterial, color: number, skin: boolean, u: WorldUniforms, dead = false, pattern: Pattern = 'plain', accent = 0x202020): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|outfit|${color}|${skin}|${dead}|${pattern}|${accent}`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  m.roughness = skin ? 0.7 : pattern === 'tracksuit' ? 0.6 : 0.88;
  m.metalness = 0;
  const tint = new THREE.Color(color).multiplyScalar(dead ? 0.7 : 1);
  const acc = new THREE.Color(accent).multiplyScalar(dead ? 0.7 : 1);
  patchWorldMaterial(m, u, {
    pre: (shader) => {
      shader.uniforms.uDye = { value: tint };
      shader.uniforms.uDye2 = { value: acc };
      shader.uniforms.uDyeMix = { value: skin ? 1.0 : 0.82 };
      shader.uniforms.uPattern = { value: skin ? 0 : PATTERN_ID[pattern] };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vClothPos;\nvarying vec3 vClothNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothPos = position;\nvClothNrm = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uDye;
          uniform vec3 uDye2;
          uniform float uDyeMix;
          uniform int uPattern;
          varying vec3 vClothPos;
          varying vec3 vClothNrm;
          float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float vn(vec3 p) {
            vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          float fbm(vec3 p) { return vn(p) * 0.6 + vn(p * 2.1) * 0.3 + vn(p * 4.3) * 0.1; }
          // Returns the cloth colour for the active print; 'base' is the dyed texture shading.
          vec3 clothPrint(vec3 base, float shade) {
            vec3 p = vClothPos * 1.0;
            if (uPattern == 1) { // woodland camo: four blotch colours
              float a = fbm(p * 7.0); float b = fbm(p * 7.0 + 19.3);
              vec3 c = uDye;
              if (a > 0.55) c = uDye2;
              if (b > 0.62) c = vec3(0.17, 0.15, 0.11);
              if (a < 0.32) c = mix(uDye, vec3(0.55, 0.5, 0.36), 0.55);
              return c * shade;
            }
            if (uPattern == 2) { // flora: vertical green/brown brush strokes
              float s = fbm(vec3(p.x * 18.0, p.y * 2.5, p.z * 18.0));
              vec3 c = s > 0.6 ? uDye2 : s < 0.38 ? mix(uDye, vec3(0.45, 0.36, 0.22), 0.6) : uDye;
              return c * shade;
            }
            if (uPattern == 3) { // digital: pixelated blobs
              vec3 q = floor(p * 55.0) / 55.0;
              float a = fbm(q * 9.0);
              vec3 c = a > 0.58 ? uDye2 : a < 0.36 ? mix(uDye, vec3(0.6, 0.58, 0.48), 0.5) : uDye;
              return c * shade;
            }
            if (uPattern == 4) { // telnyashka: horizontal stripes
              float s = step(0.5, fract(p.y * 46.0));
              return mix(uDye2, uDye, s) * shade;
            }
            if (uPattern == 5) { // flannel plaid
              float x = step(0.72, fract(p.x * 14.0 + p.z * 14.0));
              float y = step(0.72, fract(p.y * 14.0));
              float t = step(0.93, fract(p.x * 42.0 + p.z * 42.0)) + step(0.93, fract(p.y * 42.0));
              vec3 c = mix(uDye, uDye2, max(x, y) * 0.65);
              return mix(c, vec3(0.85), min(t, 1.0) * 0.25) * shade;
            }
            if (uPattern == 6) { // tracksuit: two stripes down the outer sides
              float side = smoothstep(0.78, 0.92, abs(vClothNrm.x));
              float bands = step(0.5, fract(p.z * 60.0 + p.y * 2.0));
              return mix(uDye, uDye2, side * bands) * shade;
            }
            if (uPattern == 7) { // denim: twill noise
              float tw = vn(vec3((p.x + p.y) * 160.0, (p.x - p.y) * 18.0, p.z * 160.0));
              return uDye * (0.88 + tw * 0.22) * shade;
            }
            return base;
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 dyed = uDye * (0.45 + 1.5 * l);
          vec3 cloth = clothPrint(min(dyed, vec3(1.0)), 0.45 + 1.5 * l);
          diffuseColor.rgb = mix(diffuseColor.rgb, min(cloth, vec3(1.0)), uDyeMix);`,
        );
    },
    key: 'outfit',
  });
  humanMatCache.set(key, m);
  return m;
}

/** Which outfit pieces to wear and what colour each takes. Null = no outfit (painted body only). */
function outfitPieces(lib: AssetLibrary, a: Appearance): { src: THREE.SkinnedMesh; color: number; pattern: Pattern }[] | null {
  const kind = a.topStyle === 'tee' ? 'peasant' : 'ranger';
  const top = lib.outfits.get(`${a.sex}_${kind}`);
  if (!top?.length) return null;
  const legs = lib.outfits.get(`${a.sex}_${a.legs ?? kind}`) ?? top;
  const feet = lib.outfits.get(`${a.sex}_${a.feet ?? kind}`) ?? top;
  const out: { src: THREE.SkinnedMesh; color: number; pattern: Pattern }[] = [];
  const pick = (list: THREE.SkinnedMesh[], re: RegExp) => list.filter((m) => re.test(m.name));
  for (const src of [...pick(top, /Body|Arms|Hood/), ...pick(legs, /Legs|Belt/), ...pick(feet, /Feet/)]) {
    const n = src.name;
    // Fantasy extras that don't belong in a post-Soviet town.
    if (/Pauldron|Bracer/.test(n)) continue;
    if (/Hood/.test(n) && a.topStyle !== 'hoodie') continue;
    if (/Belt/.test(n)) {
      out.push({ src, color: 0x3a2c20, pattern: 'plain' });
      continue;
    }
    const isLegs = /Legs/.test(n);
    const color = isLegs ? a.pants : /Feet/.test(n) ? a.boots : /Hood/.test(n) ? shadeHex(a.top, 0.85) : a.top;
    const pattern = isLegs ? (a.pantsPattern ?? 'plain') : /Feet/.test(n) ? 'plain' : (a.topPattern ?? 'plain');
    out.push({ src, color, pattern });
  }
  return out;
}

function shadeHex(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}

function hairMaterial(src: THREE.MeshStandardMaterial, color: number, u: WorldUniforms): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|hair|${color}`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  // The hair textures are grey cards: tint them, cut the transparent strands, render both sides.
  m.color = new THREE.Color(color).multiplyScalar(1.6);
  m.alphaTest = 0.4;
  m.transparent = false;
  m.side = THREE.DoubleSide;
  m.roughness = 0.65;
  patchWorldMaterial(m, u, { key: 'hair' });
  humanMatCache.set(key, m);
  return m;
}

function hairMaterialFor(lib: AssetLibrary, color: number, u: WorldUniforms): THREE.MeshStandardMaterial | undefined {
  const any = lib.hair.values().next().value as THREE.SkinnedMesh | undefined;
  return any ? hairMaterial(any.material as THREE.MeshStandardMaterial, color, u) : undefined;
}

function worldMat(src: THREE.MeshStandardMaterial, u: WorldUniforms, tint: number | null): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|w|${tint}`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  if (tint !== null) m.color = new THREE.Color(tint);
  patchWorldMaterial(m, u, { key: 'eyes' });
  humanMatCache.set(key, m);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hair & gear geometry (authored in bind space, parented to bones)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hair = a top cap plus a "skirt" that wraps the sides and back but leaves the face open.
 * In three's sphere parameterisation the front (+Z) is at phi = π/2.
 */
function hairShell(box: THREE.Box3, top: number, bottom: number, faceOpen: number, inflate: number): THREE.BufferGeometry[] {
  const s = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const place = (g: THREE.BufferGeometry) => {
    g.rotateX(-0.16);
    g.scale(s.x * inflate, s.y * inflate, s.z * inflate);
    g.translate(c.x, c.y + s.y * 0.05, c.z - s.z * 0.05);
    return g;
  };
  const out = [place(new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI * top))];
  if (bottom > top) {
    const start = Math.PI / 2 + faceOpen;
    out.push(place(new THREE.SphereGeometry(0.5, 18, 8, start, Math.PI * 2 - faceOpen * 2, Math.PI * top, Math.PI * (bottom - top))));
  }
  return out;
}

/** Side-swept fringe across the forehead. */
function bangs(head: THREE.Box3): THREE.BufferGeometry {
  const s = head.getSize(new THREE.Vector3());
  const c = head.getCenter(new THREE.Vector3());
  const g = new THREE.SphereGeometry(0.5, 14, 6, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.22, Math.PI * 0.16);
  g.rotateZ(0.12);
  g.scale(s.x * 1.12, s.y * 1.08, s.z * 1.12);
  g.translate(c.x, c.y + s.y * 0.04, c.z);
  return g;
}

function hairGeometry(style: HairStyle, head: THREE.Box3): THREE.BufferGeometry[] {
  const s = head.getSize(new THREE.Vector3());
  const c = head.getCenter(new THREE.Vector3());
  switch (style) {
    case 'bald':
      return [];
    case 'buzz':
      return hairShell(head, 0.4, 0.5, 1.2, 1.03);
    case 'short':
      return hairShell(head, 0.36, 0.62, 1.12, 1.09);
    case 'messy': {
      const out = hairShell(head, 0.38, 0.58, 1.1, 1.11);
      const rng = new Rng(7);
      for (let i = 0; i < 9; i++) {
        const t = new THREE.IcosahedronGeometry(s.x * 0.15, 0);
        t.translate(c.x + rng.range(-0.35, 0.35) * s.x, c.y + s.y * rng.range(0.4, 0.55), c.z + rng.range(-0.45, 0.15) * s.z);
        out.push(t);
      }
      return out;
    }
    case 'long': {
      const out = [...hairShell(head, 0.34, 0.7, 1.0, 1.12), bangs(head)];
      const back = new THREE.CylinderGeometry(s.x * 0.5, s.x * 0.44, s.y * 1.15, 12, 1, true, Math.PI * 0.62, Math.PI * 0.76);
      back.translate(c.x, c.y - s.y * 0.42, c.z - s.z * 0.08);
      out.push(back);
      return out;
    }
    case 'bob':
      return [...hairShell(head, 0.34, 0.74, 0.95, 1.14), bangs(head)];
    case 'ponytail': {
      const out = [...hairShell(head, 0.36, 0.62, 1.1, 1.08), bangs(head)];
      const tail = new THREE.CylinderGeometry(s.x * 0.05, s.x * 0.14, s.y * 1.0, 8);
      tail.rotateX(0.35);
      tail.translate(c.x, c.y - s.y * 0.12, c.z - s.z * 0.62);
      const tie = new THREE.SphereGeometry(s.x * 0.14, 8, 6);
      tie.translate(c.x, c.y + s.y * 0.28, c.z - s.z * 0.5);
      out.push(tail, tie);
      return out;
    }
    case 'bun': {
      const out = hairShell(head, 0.36, 0.56, 1.15, 1.08);
      const bun = new THREE.SphereGeometry(s.x * 0.24, 10, 8);
      bun.translate(c.x, c.y + s.y * 0.42, c.z - s.z * 0.42);
      out.push(bun);
      return out;
    }
  }
}

/** Ears stay geometric (they stick out of the silhouette); everything else on the face is painted. */
function earParts(head: THREE.Box3, a: Appearance, u: WorldUniforms): THREE.Mesh[] {
  const s = head.getSize(new THREE.Vector3());
  const c = head.getCenter(new THREE.Vector3());
  const skin = flatMat(a.skin, { rough: 0.7 }, u);
  return [-1, 1].map((side) => {
    const ear = new THREE.SphereGeometry(s.x * 0.12, 8, 6);
    ear.scale(0.35, 1, 0.75);
    ear.translate(c.x + side * s.x * 0.49, c.y - s.y * 0.02, c.z - s.z * 0.02);
    return new THREE.Mesh(ear, skin);
  });
}

export function faceSpecFor(a: Appearance): FaceSpec {
  return {
    sex: a.sex,
    skin: a.skin,
    hairColor: a.hair === 'bald' ? 0x3a281b : a.hairColor,
    eyes: a.eyes ?? 0x4a3020,
    age: a.age ?? 1,
    beard: a.beard,
    scars: !!a.scars,
    zombie: !!a.zombie,
    seed: a.skin ^ a.hairColor ^ (a.top << 1),
  };
}

/** Wrap bind-space geometry so it rides on a bone exactly like the skinned surface underneath. */
function attachToBone(mesh: THREE.SkinnedMesh, boneName: string, obj: THREE.Object3D): void {
  const idx = mesh.skeleton.bones.findIndex((b) => b.name === boneName);
  if (idx < 0) return;
  const bone = mesh.skeleton.bones[idx]!;
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(mesh.skeleton.boneInverses[idx]!).multiply(mesh.bindMatrix);
  holder.add(obj);
  bone.add(holder);
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation layering
// ─────────────────────────────────────────────────────────────────────────────

const UPPER = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)/;
const LOWER = /^(root|pelvis|spine_01|thigh|calf|foot|ball)/;
const filtered = new Map<string, THREE.AnimationClip>();

function layerClip(lib: AssetLibrary, name: string, layer: 'upper' | 'lower' | 'full'): THREE.AnimationClip | null {
  const key = `${name}:${layer}`;
  const hit = filtered.get(key);
  if (hit) return hit;
  const src = lib.clips.get(name);
  if (!src) return null;
  if (layer === 'full') return src;
  const re = layer === 'upper' ? UPPER : LOWER;
  const clip = new THREE.AnimationClip(`${name}_${layer}`, src.duration, src.tracks.filter((t) => re.test(t.name)));
  filtered.set(key, clip);
  return clip;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character view
// ─────────────────────────────────────────────────────────────────────────────

const CHAR_SCALE = 0.92;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class CharacterView {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private skinned: THREE.SkinnedMesh;
  private bodyMeshes: THREE.SkinnedMesh[] = [];
  /** Clothing pieces bound to the body skeleton. */
  private outfitMeshes: THREE.SkinnedMesh[] = [];
  private hairMeshes: THREE.SkinnedMesh[] = [];
  private mixer: THREE.AnimationMixer;
  private lower: THREE.AnimationAction | null = null;
  private lowerName = '';
  private upper: THREE.AnimationAction | null = null;
  private upperName = '';
  private oneShot: THREE.AnimationAction | null = null;
  private oneShotT = 0;
  private oneShotLayer: 'upper' | 'full' = 'upper';
  private heavyMelee = false;
  private gearKey = '';
  private gear = new THREE.Group();
  private gearAttachments: THREE.Object3D[] = [];
  private held: THREE.Object3D | null = null;
  private heldKind: 'gun' | 'melee' | null = null;
  private heldLen = 0;
  private handR: THREE.Bone | null = null;
  private handL: THREE.Bone | null = null;
  private aimT = 0;
  private rig!: RigInfo;
  private human: HumanParts | null = null;
  dead = false;
  private hidden = false;

  constructor(
    private lib: AssetLibrary,
    readonly look: Appearance,
    private u: WorldUniforms,
    shadows: boolean,
  ) {
    // Modelled humans (faces, eyes, real hair) when the pack is present; the mannequin otherwise.
    const human = cloneHuman(lib, look.sex);
    this.human = human;
    const src = human ? (look.sex === 'f' ? lib.humanF! : lib.humanM!).scene : look.sex === 'f' && lib.characterF ? lib.characterF.scene : lib.character.scene;
    this.model = human ? human.model : SkeletonUtils.clone(src);
    let skinnedMeshes: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(o as THREE.SkinnedMesh);
    });
    if (!skinnedMeshes.length) throw new Error('character model has no skinned mesh');
    // The body is the mesh with the most vertices (the other is the joint rings / eyes / brows).
    skinnedMeshes.sort((a, b) => b.geometry.attributes.position!.count - a.geometry.attributes.position!.count);
    if (human) skinnedMeshes = [human.body];
    this.skinned = skinnedMeshes[0]!;
    if (!rigInfos.has(src)) rigInfos.set(src, analyseRig(skinnedMeshes, !human));
    this.rig = rigInfos.get(src)!;
    this.bodyMeshes = skinnedMeshes;
    const outfit = human ? outfitPieces(lib, look) : null;
    for (const m of skinnedMeshes) {
      m.material = human ? humanBodyMaterial(human.body.material as THREE.MeshStandardMaterial, look, u, false, !!outfit) : bodyMaterial(look, u);
      m.castShadow = shadows;
      m.frustumCulled = false;
    }
    if (human) {
      for (const m of [human.eyes, human.brows]) {
        if (!m) continue;
        m.material = m === human.brows ? hairMaterial(m.material as THREE.MeshStandardMaterial, look.zombie ? 0x2a2a24 : look.hairColor, u) : worldMat(m.material as THREE.MeshStandardMaterial, u, look.zombie ? 0xc8c0a0 : null);
        m.frustumCulled = false;
      }
      this.model.scale.setScalar(heightScale(src, look.sex === 'f' ? 1.66 : 1.8));
      for (const piece of outfit ?? []) {
        const mats = Array.isArray(piece.src.material) ? piece.src.material : [piece.src.material];
        const dressed = mats.map((mt) => {
          const skin = /Regular/.test(mt.name);
          return outfitMaterial(mt as THREE.MeshStandardMaterial, skin ? (look.gloves ?? look.skin) : piece.color, skin, u, false, piece.pattern, look.accent);
        });
        const worn = attachSkinned(piece.src, human.body, dressed.length === 1 ? dressed[0] : (dressed as unknown as THREE.Material));
        worn.castShadow = shadows;
        this.outfitMeshes.push(worn);
      }
    } else this.model.scale.setScalar(CHAR_SCALE);
    this.root.add(this.model);
    this.handR = this.skinned.skeleton.getBoneByName('hand_r') ?? null;
    this.handL = this.skinned.skeleton.getBoneByName('hand_l') ?? null;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.buildBody(shadows);
    this.root.add(this.gear);
    this.setLower('Idle_Loop', 1, 'full');
  }

  private bone(re: RegExp): string {
    return this.skinned.skeleton.bones.find((b) => re.test(b.name))?.name ?? '';
  }

  private buildBody(shadows: boolean): void {
    const rig = this.rig;
    const a = this.look;
    const head = this.bone(/^head$/i);
    if (this.human) {
      const clothed = this.outfitMeshes.length > 0;
      const hooded = clothed && a.topStyle === 'hoodie';
      const style = HAIR_MODEL[a.sex][a.hair];
      const hm = hairMaterialFor(this.lib, a.zombie ? 0x3a3530 : a.hairColor, this.u);
      if (style && !hooded && this.lib.hair.get(style)) {
        const h = attachSkinned(this.lib.hair.get(style)!, this.human.body, hm);
        h.castShadow = shadows;
        this.hairMeshes.push(h);
      }
      if (a.beard && a.sex === 'm' && this.lib.hair.get('Hair_Beard')) attachSkinned(this.lib.hair.get('Hair_Beard')!, this.human.body, hm);
      if (!clothed && (a.topStyle === 'hoodie' || a.topStyle === 'coat')) this.addCollar(rig, a);
      return;
    }
    const hairMat = flatMat(a.hairColor, { rough: 0.9, side: true }, this.u);
    for (const g of hairGeometry(a.hair, rig.boxes.head)) {
      const m = new THREE.Mesh(g, hairMat);
      m.castShadow = shadows;
      attachToBone(this.skinned, head, m);
    }
    for (const m of earParts(rig.boxes.head, a, this.u)) attachToBone(this.skinned, head, m);
    if (a.topStyle === 'hoodie' || a.topStyle === 'coat') this.addCollar(rig, a);
  }

  private addCollar(rig: RigInfo, a: Appearance): void {
    {
      // Collar / hood roll around the neck.
      const c = rig.boxes.chest.getCenter(new THREE.Vector3());
      const s = rig.boxes.chest.getSize(new THREE.Vector3());
      const collar = new THREE.TorusGeometry(s.x * 0.24, s.x * 0.07, 6, 14);
      collar.rotateX(Math.PI / 2);
      collar.translate(c.x, rig.boxes.chest.max.y - s.y * 0.04, c.z - s.z * 0.06);
      attachToBone(this.skinned, this.bone(/^spine_03$/), new THREE.Mesh(collar, flatMat(a.top, { rough: 0.95 }, this.u)));
    }
  }

  /** Rebuild gear meshes when equipment or held weapon changes. */
  syncGear(eq: Equipment, active: 'primary' | 'secondary' | 'melee'): void {
    const s = eq.slots;
    const held = active === 'melee' ? s.melee : s[active];
    const key = `${s.helmet?.def}|${s.armor?.def}|${s.backpack?.def}|${s.rig?.def}|${gunKey(held)}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    for (const g of this.gearAttachments) g.parent?.remove(g);
    this.gearAttachments = [];
    const rig = this.rig;
    const add = (bone: RegExp, obj: THREE.Object3D) => {
      const holder = new THREE.Group();
      holder.add(obj);
      attachToBone(this.skinned, this.bone(bone), holder);
      this.gearAttachments.push(holder.parent ?? holder);
    };
    /** Scale `obj` (built in metres) non-uniformly so its bounds match `target` (bind-space metres). */
    const fit = (obj: THREE.Object3D, target: THREE.Vector3, anchor: THREE.Vector3, align: 'bottom' | 'center' = 'bottom') => {
      obj.updateMatrixWorld(true);
      // Helmets fit by their shell, so a raised visor or faceplate doesn't squash the dome.
      const b = new THREE.Box3().setFromObject((obj.userData.shell as THREE.Object3D | undefined) ?? obj);
      const sz = b.getSize(new THREE.Vector3());
      const wrap = new THREE.Group();
      wrap.add(obj);
      obj.position.set(-(b.min.x + b.max.x) / 2, align === 'bottom' ? -b.min.y : -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
      wrap.scale.set(target.x / sz.x, target.y / sz.y, target.z / sz.z);
      wrap.position.copy(anchor);
      wrap.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      return wrap;
    };
    const head = rig.boxes.head;
    const hc = head.getCenter(new THREE.Vector3());
    const hs = head.getSize(new THREE.Vector3());
    const chest = rig.boxes.chest;
    const cc = chest.getCenter(new THREE.Vector3());
    const cs = chest.getSize(new THREE.Vector3());

    for (const m of this.outfitMeshes) if (/Hood/.test(m.name)) m.visible = !s.helmet;
    const hat = !s.helmet && this.look.hat && !this.look.zombie ? this.look.hat : null;
    // Hats and helmets sit over short hair; long hair stays (it hangs below the rim).
    for (const h of this.hairMeshes) h.visible = !(s.helmet || (hat && hat !== 'bandana')) || /Long/.test(h.name);
    if (hat) {
      const brow = hc.y + hs.y * (hat === 'cap' ? 0.1 : 0.06);
      const top = head.max.y + hs.y * (hat === 'bandana' ? -0.05 : 0.07);
      add(/^head$/i, fit(hatModel(hat, this.look.hatColor ?? 0x2a2a2a), new THREE.Vector3(hs.x * 1.22, top - brow, hs.z * 1.2), new THREE.Vector3(hc.x, brow, hc.z - hs.z * 0.03)));
    }
    if (s.helmet) {
      const id = s.helmet.def;
      // Rim just above the brow, dome over the crown; the Altyn's faceplate hangs lower.
      const brow = hc.y + hs.y * (id === 'altyn' ? -0.06 : 0.04);
      const top = head.max.y + hs.y * 0.06;
      add(/^head$/i, fit(helmetModel(id), new THREE.Vector3(hs.x * 1.32, top - brow, hs.z * 1.3), new THREE.Vector3(hc.x, brow, hc.z - hs.z * 0.03)));
    }
    // Armour and rigs: shells cut from this body's own torso, skinned to its skeleton (see armorShell.ts).
    const wear = (id: string, spec: ArmorSpec | undefined): boolean => {
      const body = this.human?.body;
      if (!spec || !body) return false;
      const shell = buildShell(body, id, spec.cut);
      for (const [geo, color, rough] of [
        [shell.geometry, spec.color, 0.9],
        [shell.rim, spec.rim, 0.85],
      ] as const) {
        const m = new THREE.SkinnedMesh(geo, gearSkinMat(color, rough, this.u));
        m.bind(body.skeleton, body.bindMatrix);
        m.castShadow = true;
        m.frustumCulled = false;
        body.parent!.add(m);
        this.gearAttachments.push(m);
      }
      for (const d of details(shell, spec, (c) => gearSkinMat(c, 0.9, this.u))) add(/^spine_03$/, d);
      return true;
    };
    if (s.armor && !wear(s.armor.def, ARMOR_SPECS[s.armor.def])) {
      const bottom = chest.min.y - cs.y * 0.62;
      add(/^spine_03$/, fit(armorModel(s.armor.def), new THREE.Vector3(cs.x * 1.12, chest.max.y + cs.y * 0.06 - bottom, cs.z * 1.32), new THREE.Vector3(cc.x, bottom, cc.z)));
    }
    if (s.rig && !wear(s.rig.def, RIG_SPECS[s.rig.def])) {
      const bottom = chest.min.y - cs.y * 0.55;
      add(/^spine_03$/, fit(rigModel(s.rig.def), new THREE.Vector3(cs.x * (s.armor ? 1.18 : 1.1), chest.max.y + cs.y * 0.04 - bottom, cs.z * (s.armor ? 1.55 : 1.35)), new THREE.Vector3(cc.x, bottom, cc.z + cs.z * 0.02)));
    }
    if (s.backpack) {
      const id = s.backpack.def;
      const d = getDef(id);
      let bp: THREE.Object3D | null = null;
      if (id === 'b_sling') bp = slingModel();
      else {
        const src = this.lib.props.get('backpack');
        if (src) {
          bp = src.clone(true);
          const tint = new THREE.Color(BACKPACK_TINT[id] ?? 0x666666);
          bp.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mat = (m.material as THREE.MeshStandardMaterial).clone();
            mat.color.copy(tint).multiplyScalar(0.7 + mat.color.getHSL({ h: 0, s: 0, l: 0 }).l);
            m.material = mat;
          });
          bp.rotation.y = Math.PI;
        }
      }
      if (bp) {
        // Bigger packs ride higher and stick out further.
        const k = 0.75 + (d.w * d.h) / 40;
        const h = cs.y * 1.35 * k;
        const depth = cs.z * (id === 'b_sling' ? 0.5 : 0.75) * k;
        const back = chest.min.z - depth / 2 - (s.armor ? cs.z * 0.1 : 0);
        add(/^spine_03$/, fit(bp, new THREE.Vector3(cs.x * 0.9 * Math.min(1.15, k), h, depth), new THREE.Vector3(cc.x, chest.max.y - h * 0.95, back)));
      }
    }

    // Weapon in hands.
    if (this.held) this.gear.remove(this.held);
    this.held = null;
    this.heldKind = null;
    if (held) {
      const d = getDef(held.def);
      const src = d.melee ? this.lib.melee.get(held.def) : this.lib.weapons.get(held.def);
      if (src) {
        this.held = d.melee ? src.clone() : buildGun(this.lib, held)!;
        this.heldKind = d.melee ? 'melee' : 'gun';
        this.heavyMelee = /^(axe|sledge|bat|crowbar)$/.test(held.def);
        this.heldLen = new THREE.Box3().setFromObject(src).getSize(tmpV).z;
        this.gear.add(this.held);
      }
    }
  }

  // ── Animation ──────────────────────────────────────────────────────────────

  /**
   * Base locomotion layer. Plays on the whole body unless an upper-body pose (weapon stance or a one-shot
   * like reload/punch) is active — then only legs/hips, so the two never average into a half-pose.
   */
  private setLower(name: string, timeScale: number, layer: 'lower' | 'full'): void {
    const key = `${name}:${layer}`;
    if (this.lowerName === key) {
      if (this.lower) this.lower.timeScale = timeScale;
      return;
    }
    const clip = layerClip(this.lib, name, layer);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    const sameClip = this.lowerName.split(':')[0] === name;
    next.reset().setEffectiveWeight(1).play();
    // Switching between the full/legs-only variant of the same cycle keeps the step phase.
    if (sameClip && this.lower) next.time = this.lower.time;
    next.timeScale = timeScale;
    if (this.lower) this.lower.crossFadeTo(next, sameClip ? 0.08 : 0.22, false);
    this.lower = next;
    this.lowerName = key;
  }

  private setUpper(name: string | null): void {
    if (this.upperName === (name ?? '')) return;
    const prev = this.upper;
    this.upper = null;
    this.upperName = name ?? '';
    if (name) {
      const clip = layerClip(this.lib, name, 'upper');
      if (clip) {
        const next = this.mixer.clipAction(clip);
        next.reset().play();
        if (prev) prev.crossFadeTo(next, 0.15, false);
        else next.fadeIn(0.15);
        this.upper = next;
      }
    } else prev?.fadeOut(0.15);
  }

  private playOneShot(name: string, layer: 'upper' | 'full', speed = 1): void {
    const clip = layerClip(this.lib, name, layer);
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = layer === 'full';
    a.timeScale = speed;
    a.setEffectiveWeight(1).fadeIn(0.06).play();
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.06);
    // A one-shot replaces the stance for its duration.
    this.upper?.fadeOut(0.06);
    this.upper = null;
    this.upperName = '';
    this.oneShot = a;
    this.oneShotLayer = layer;
    this.oneShotT = clip.duration / speed;
  }

  private swingN = 0;

  fired(): void {
    this.aimT = 2.5;
    this.playOneShot('Pistol_Shoot', 'upper', 2.2);
  }

  swung(): void {
    this.swingN++;
    if (this.look.zombie) return this.playOneShot('Zombie_Scratch', 'upper', 1.5);
    if (this.heldKind !== 'melee') return this.playOneShot(this.swingN % 2 ? 'Punch_Jab' : 'Punch_Cross', 'upper', 1.8);
    if (this.heavyMelee) return this.playOneShot('Melee_Hook', 'upper', 1.4);
    this.playOneShot(['Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C'][this.swingN % 3]!, 'upper', 1.5);
  }

  reloading(): void {
    this.playOneShot('Pistol_Reload', 'upper', 1.4);
  }

  /** Eating, drinking, bandaging. */
  consuming(): void {
    this.playOneShot('Consume', 'upper', 1.2);
  }

  /** Climbing through a window. */
  vaulting(): void {
    this.playOneShot('ClimbUp_1m_RM', 'full', 1.25);
  }

  /** Rummaging through a container or body. */
  searching(): void {
    this.playOneShot('PickUp_Table', 'upper', 1.1);
  }

  hit(): void {
    if (!this.oneShot || this.oneShotT <= 0) this.playOneShot(Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head', 'upper', 1.6);
  }

  update(a: Actor, dt: number, visible: boolean, alerted: boolean, talking = false): void {
    this.root.position.set(a.pos.x, 0, a.pos.y);
    this.root.rotation.y = Math.PI / 2 - a.facing;
    this.root.visible = visible;
    this.hidden = !visible;
    this.syncGear(a.eq, a.active);

    const speed = Math.hypot(a.vel.x, a.vel.y);
    const zombie = !!this.look.zombie;
    // Moving against the facing direction (aiming while backing off) plays the cycle in reverse.
    const along = speed > 0.01 ? (a.vel.x * Math.cos(a.facing) + a.vel.y * Math.sin(a.facing)) / speed : 1;
    const dir = along < -0.35 ? -1 : 1;
    const sprint = !zombie && !a.crouching && (a.sprinting || speed > 4.2);
    const moving = speed > 0.25;

    // Upper-body stance first: it decides whether the base layer plays on the whole body.
    this.aimT = Math.max(0, this.aimT - dt);
    this.oneShotT -= dt;
    if (this.oneShot && this.oneShotT <= 0) {
      this.oneShot.fadeOut(0.12);
      this.oneShot = null;
    }
    // Treating wounds / eating: keep the consume gesture going while the use timer runs.
    if (a.useT > 0 && !this.oneShot) this.consuming();
    const gun = this.heldKind === 'gun';
    let stance: string | null = null;
    if (zombie || talking || (sprint && moving)) stance = null;
    else if (gun && (alerted || this.aimT > 0 || (a.faction === 'player' && a.aiming))) stance = 'Pistol_Aim_Neutral';
    else if (gun) stance = 'Pistol_Idle_Loop';
    else if (this.heldKind === 'melee' && (alerted || a.faction === 'player')) stance = 'Sword_Idle';
    if (!this.oneShot) this.setUpper(stance);
    const upperBusy = !!this.upper || (!!this.oneShot && this.oneShotLayer === 'upper');
    const layer: 'lower' | 'full' = upperBusy ? 'lower' : 'full';

    if (zombie) {
      if (moving) this.setLower('Zombie_Walk_Fwd_Loop', speed / 1.2, layer);
      else this.setLower('Zombie_Idle_Loop', 1, layer);
    } else if (moving) {
      if (a.crouching) this.setLower('Crouch_Fwd_Loop', (dir * speed) / 1.4, layer);
      else if (sprint) this.setLower('Sprint_Loop', speed / 5.6, layer);
      else if (speed > 2.4) this.setLower('Jog_Fwd_Loop', (dir * speed) / 3.6, layer);
      else this.setLower('Walk_Loop', (dir * speed) / 1.5, layer);
    } else if (a.crouching) this.setLower('Crouch_Idle_Loop', 1, layer);
    else if (talking) this.setLower('Idle_Talking_Loop', 1, 'full');
    else if (a.faction === 'npc' && !alerted) this.setLower(this.look.sex === 'f' ? 'Idle_Loop' : 'Idle_FoldArms_Loop', 1, layer);
    else this.setLower('Idle_Loop', 1, layer);

    // Skip skinning work for actors the player can't see (big win with 40 bots).
    if (!this.hidden) {
      // Undo last frame's leg twist first (the mixer only rewrites bones its clips animate).
      for (const [b, q] of this.yawSaved) b.quaternion.copy(q);
      this.yawSaved.length = 0;
      this.mixer.update(dt);
      this.twistLegs(a, dt, moving && !zombie && !sprint && !a.crouching ? along : null);
    }
    this.placeHeld(a);
  }

  private legYaw = 0;
  private yawSaved: [THREE.Bone, THREE.Quaternion][] = [];
  private yawBones: { pelvis: THREE.Bone | null; s1: THREE.Bone | null; s2: THREE.Bone | null } | null = null;

  /**
   * There are no strafe clips, so when you walk sideways while aiming, turn the hips and legs towards the
   * direction of travel and twist the spine back so the chest and gun keep pointing at the cursor.
   * Walking backwards plays the clip in reverse with the legs aligned to the backward direction.
   */
  private twistLegs(a: Actor, dt: number, along: number | null): void {
    let target = 0;
    if (along !== null) {
      let ang = Math.atan2(a.vel.y, a.vel.x) - a.facing;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      if (along < -0.35) ang = Math.atan2(Math.sin(ang + Math.PI), Math.cos(ang + Math.PI));
      target = Math.max(-1.25, Math.min(1.25, -ang));
    }
    this.legYaw += (target - this.legYaw) * (1 - Math.exp(-dt * 10));
    if (Math.abs(this.legYaw) < 0.01) return;
    const sk = this.skinned.skeleton;
    this.yawBones ??= { pelvis: sk.getBoneByName('pelvis') ?? null, s1: sk.getBoneByName('spine_01') ?? null, s2: sk.getBoneByName('spine_02') ?? null };
    const { pelvis, s1, s2 } = this.yawBones;
    if (!pelvis || !s1 || !s2) return;
    this.root.updateMatrixWorld(true);
    for (const b of [pelvis, s1, s2]) this.yawSaved.push([b, b.quaternion.clone()]);
    yawBone(pelvis, this.legYaw);
    yawBone(s1, -this.legYaw * 0.5);
    yawBone(s2, -this.legYaw * 0.5);
  }

  /** Guns are placed in actor space between the hands and always point along the aim; melee rides the hand bone. */
  private placeHeld(a: Actor): void {
    const h = this.held;
    if (!h || !this.handR) return;
    this.handR.getWorldPosition(tmpV);
    if (this.heldKind === 'gun') {
      if (this.handL) {
        this.handL.getWorldPosition(tmpV2);
        tmpV.lerp(tmpV2, 0.35);
      }
      this.gear.worldToLocal(tmpV);
      h.position.copy(tmpV);
      // Pistols sit in front of the grip, long guns extend forward with the stock at the shoulder.
      h.position.z += this.heldLen < 0.4 ? this.heldLen * 0.45 : this.heldLen * 0.22;
      h.position.y += 0.04;
      h.rotation.set(0, 0, 0);
    } else {
      this.gear.worldToLocal(tmpV);
      h.position.copy(tmpV);
      // Blade up and slightly forward; swing animation moves the hand.
      h.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
      h.position.addScaledVector(new THREE.Vector3(0, 1, 0.5).normalize(), this.heldLen * 0.38);
    }
    void a;
  }

  get muzzle(): THREE.Vector3 {
    if (!this.held) return this.root.position.clone().setY(1.2);
    return this.held.localToWorld(new THREE.Vector3(0, 0, this.heldLen / 2));
  }

  /** `settled`: skip the fall (bodies that were already lying there when the raid started). */
  toCorpse(c: Corpse, settled = false): void {
    if (this.dead) return;
    this.dead = true;
    this.root.position.set(c.pos.x, 0, c.pos.y);
    this.root.rotation.y = Math.PI / 2 - c.facing;
    this.setUpper(null);
    this.oneShot = null;
    this.mixer.stopAllAction();
    this.lower = null;
    this.lowerName = '';
    this.playOneShot('Death01', 'full', 1.1);
    const fall = this.oneShot as THREE.AnimationAction | null;
    if (settled && fall) {
      fall.time = fall.getClip().duration;
      this.mixer.update(0.2);
    }
    this.oneShotT = Infinity;
    for (const m of this.bodyMeshes)
      m.material = this.human ? humanBodyMaterial(this.human.srcMaterial, this.look, this.u, true, this.outfitMeshes.length > 0) : bodyMaterial(this.look, this.u, true);
    if (this.held && this.heldKind === 'gun') {
      // Drop the gun next to the body.
      this.held.position.set(0.5, 0.05, 0.4);
      this.held.rotation.set(0, 0.7, Math.PI / 2);
      this.held = null;
    }
  }

  /** Corpses keep animating until the death clip finishes, then freeze. */
  updateCorpse(dt: number, visible: boolean): void {
    this.root.visible = visible;
    if (visible) this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/** Rotate a bone about the world up axis (keeps the rest of its pose), then refresh its subtree. */
function yawBone(bone: THREE.Bone, angle: number): void {
  const parent = bone.parent!;
  parent.getWorldQuaternion(_pq);
  _rq.setFromAxisAngle(_up, angle);
  // local' = P⁻¹ · R · P · local
  bone.quaternion.premultiply(_pq).premultiply(_rq).premultiply(_pq.invert());
  bone.updateMatrixWorld(true);
}

export function disposeCharacterCaches(): void {
  for (const m of bodyMatCache.values()) m.dispose();
  for (const m of flatMatCache.values()) m.dispose();
  for (const m of humanMatCache.values()) m.dispose();
  humanMatCache.clear();
  bodyMatCache.clear();
  flatMatCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Portraits for dialogue / survivor cards
// ─────────────────────────────────────────────────────────────────────────────

let portraitRenderer: THREE.WebGLRenderer | null = null;
const portraitCache = new Map<string, string>();

export function renderPortrait(lib: AssetLibrary, look: Appearance, size = 256): string {
  const key = JSON.stringify(look) + size;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  portraitRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const r = portraitRenderer;
  r.setSize(size, size, false);
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const u: WorldUniforms = {
    uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uPlayer: { value: new THREE.Vector3(0, -100, 0) },
    uFowOn: { value: 0 },
  };
  (u.uFow.value as THREE.DataTexture).needsUpdate = true;
  const view = new CharacterView(lib, look, u, false);
  const fake = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: Math.PI / 2 - 0.3, crouching: false, sprinting: false, eq: { slots: {}, pockets: { w: 0, h: 0, items: [] } }, active: 'melee', faction: 'npc' } as unknown as Actor;
  view.update(fake, 0.5, true, false, true);
  scene.add(view.root);
  scene.add(new THREE.HemisphereLight(0xd8e0ea, 0x2a2420, 1.2));
  const key1 = new THREE.DirectionalLight(0xffe2c4, 2.4);
  key1.position.set(1.5, 2.5, 2.5);
  const rim = new THREE.DirectionalLight(0x9ec4ff, 1.4);
  rim.position.set(-2, 2, -1.5);
  scene.add(key1, rim);
  view.root.updateMatrixWorld(true);
  view.root.traverse((o) => o.updateMatrixWorld(true));
  const headBone = (view as unknown as { skinned: THREE.SkinnedMesh }).skinned.skeleton.bones.find((b) => /^head$/i.test(b.name));
  const hp = headBone ? headBone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.6, 0);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 10);
  cam.position.set(hp.x + 0.12, hp.y + 0.1, hp.z + 0.95);
  cam.lookAt(hp.x, hp.y + 0.02, hp.z);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  portraitCache.set(key, url);
  view.dispose();
  return url;
}
