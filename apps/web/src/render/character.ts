import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rng, getDef, type Actor, type Corpse, type Equipment, type ItemInstance } from '@ashfall/engine';
import type { AssetLibrary } from './assets';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import { faceTexture, type FaceSpec } from './facePainter';
import { buildGun, gunKey } from './gunsmith';
import { armorModel, BACKPACK_TINT, hatModel, helmetModel, rigModel, slingModel } from './gear3d';
import { HEAVY_MELEE, meleeModel, REVERSE_GRIP } from './melee3d';
import { ARMOR_SPECS, details, RIG_SPECS, shellParts, shellShader, type ArmorSpec } from './armorShell';
import { itemModel } from './thumbnails';
import { attachSkinned, cloneHuman, type HumanParts } from './human';
import { ease, newPalm, palmFrame, reachPalm, type Arm } from './armIK';

// ─────────────────────────────────────────────────────────────────────────────
// Appearance
// ─────────────────────────────────────────────────────────────────────────────

export type HairStyle = 'bald' | 'buzz' | 'short' | 'messy' | 'long' | 'ponytail' | 'bob' | 'bun';
export type TopStyle = 'tee' | 'jacket' | 'hoodie' | 'coat';
/** Fabric print, drawn in the outfit shader from object-space position (no textures). */
export type Pattern = 'plain' | 'woodland' | 'flora' | 'digital' | 'stripes' | 'plaid' | 'tracksuit' | 'denim';
export const PATTERN_ID: Record<Pattern, number> = {
  plain: 0,
  woodland: 1,
  flora: 2,
  digital: 3,
  stripes: 4,
  plaid: 5,
  tracksuit: 6,
  denim: 7,
};
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
  const sex: 'm' | 'f' =
    archetype === 'boss' ? 'm' : rng.chance(archetype === 'raider' || archetype === 'guard' ? 0.25 : 0.4) ? 'f' : 'm';
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
    age: rng.weighted([
      [0, 3],
      [1, 4],
      [2, 2],
    ] as const),
    scars: rng.chance(archetype === 'raider' || archetype === 'guard' ? 0.35 : 0.1),
  };
  // Clothing: mix pack pieces and prints so a crowd doesn't look like clones.
  const civ = (): Partial<Appearance> => {
    const style = rng.weighted([
      ['gopnik', 3],
      ['sailor', 2],
      ['flannel', 2],
      ['work', 3],
      ['hoodie', 2],
    ] as const);
    switch (style) {
      case 'gopnik':
        return {
          topStyle: 'jacket',
          top: rng.pick([0x1c1f2a, 0x1f3a6a, 0x5a1c1c, 0x1e1e1e]),
          topPattern: 'tracksuit',
          pants: rng.pick([0x1c1f2a, 0x1e1e1e]),
          pantsPattern: 'tracksuit',
          accent: 0xe8e8e0,
          legs: 'ranger',
          feet: 'peasant',
          hat: rng.chance(0.5) ? 'cap' : null,
          hatColor: 0x1e1e1e,
        };
      case 'sailor':
        return {
          topStyle: 'tee',
          top: 0x1d2c5a,
          topPattern: 'stripes',
          accent: 0xe8e8e0,
          pantsPattern: 'denim',
          pants: 0x2c3e5e,
          hat: rng.chance(0.4) ? 'beanie' : null,
          hatColor: rng.pick([0x1e1e1e, 0x2c3e5e]),
        };
      case 'flannel':
        return {
          topStyle: 'tee',
          top: rng.pick([0x8a2a22, 0x2a5a3a, 0x2a3a6a]),
          topPattern: 'plaid',
          accent: 0x1e1e1e,
          pantsPattern: rng.chance(0.6) ? 'denim' : 'plain',
          pants: rng.pick([0x2c3e5e, 0x3a3a30]),
          hat: rng.chance(0.3) ? 'ushanka' : null,
          hatColor: 0x5a4632,
        };
      case 'hoodie':
        return {
          topStyle: 'hoodie',
          topPattern: 'plain',
          pantsPattern: rng.chance(0.5) ? 'denim' : 'plain',
          pants: rng.pick([0x2c3e5e, 0x2e3324]),
        };
      default:
        return {
          topStyle: rng.pick(['jacket', 'coat'] as TopStyle[]),
          topPattern: 'plain',
          pantsPattern: rng.chance(0.4) ? 'denim' : 'plain',
          legs: rng.chance(0.5) ? 'peasant' : 'ranger',
          hat: rng.weighted([
            [null, 4],
            ['beanie', 3],
            ['ushanka', 1],
            ['bandana', 1],
          ] as const),
          hatColor: rng.pick([0x2a2a2a, 0x4a3b2b, 0x3d4a3a, 0x6a2a22]),
        };
    }
  };
  const camo = (): Partial<Appearance> => {
    const p = rng.pick(['woodland', 'flora', 'digital'] as Pattern[]);
    const base = p === 'flora' ? 0x6a7a52 : p === 'digital' ? 0x5a6448 : 0x55603e;
    return {
      topStyle: rng.pick(['jacket', 'jacket', 'coat'] as TopStyle[]),
      top: base,
      topPattern: p,
      pants: base,
      pantsPattern: rng.chance(0.75) ? p : 'plain',
      accent: p === 'flora' ? 0x3a4a2a : 0x2e2a20,
      legs: 'ranger',
      feet: 'ranger',
      hat: rng.chance(0.35) ? 'beanie' : null,
      hatColor: 0x2a2d22,
    };
  };
  switch (archetype) {
    case 'raider':
    case 'guard':
      return { ...base, ...camo(), gloves: 0x1a1a1a, boots: 0x1a1816 };
    case 'boss':
      return { ...base, top: 0x3b2622, topStyle: 'coat', pants: 0x1f1f22, beard: true, hair: 'buzz', gloves: 0x1a1a1a };
    case 'infected': {
      const c = civ();
      return {
        ...base,
        ...c,
        zombie: true,
        hat: null,
        skin: rng.pick([0x8c9a7a, 0x7d8b6c, 0x9aa088, 0x6f7a62]),
        top: (c.top ?? base.top) & 0x7f7f7f,
        pants: (c.pants ?? base.pants) & 0x7f7f7f,
      };
    }
    default:
      return { ...base, ...civ() };
  }
}

/** The player's own survivor: persisted body/hair choices + a practical scavenger outfit. */
export function playerAppearance(look: {
  sex: 'm' | 'f';
  skin: number;
  hair: string;
  hairColor: number;
  beard: boolean;
}): Appearance {
  return {
    ...look,
    hair: look.hair as HairStyle,
    top: 0x4b5138,
    topStyle: 'jacket',
    pants: 0x3a3a30,
    boots: 0x2a2420,
    gloves: 0x2b2722,
    eyes: 0x4a3020,
    age: 1,
  };
}

const BOSS_LOOKS: Record<string, Appearance> = {
  kostia: {
    sex: 'm',
    skin: 0xe3b08e,
    hair: 'buzz',
    hairColor: 0x2a201a,
    beard: true,
    top: 0x3b2622,
    topStyle: 'coat',
    pants: 0x1f1f22,
    boots: 0x1a1816,
    gloves: 0x1a1a1a,
    eyes: 0x3a2a1a,
    age: 2,
    scars: true,
  },
  bohdan: {
    sex: 'm',
    skin: 0xc99069,
    hair: 'short',
    hairColor: 0x8c8a86,
    beard: true,
    top: 0x3e4a2e,
    topStyle: 'jacket',
    pants: 0x3a3a2c,
    boots: 0x3b2f24,
    gloves: 0x4a3a28,
    eyes: 0x4a5a3a,
    age: 2,
  },
  rina: {
    sex: 'f',
    skin: 0xf1c8a8,
    hair: 'long',
    hairColor: 0x7c3b21,
    beard: false,
    top: 0x1c1c20,
    topStyle: 'jacket',
    pants: 0x26262c,
    boots: 0x161616,
    gloves: 0x1a1a1a,
    eyes: 0x3a5a4a,
    age: 1,
  },
};

const NPC_LOOKS: Record<string, Appearance> = {
  lena: {
    sex: 'f',
    skin: 0xf1c8a8,
    hair: 'ponytail',
    hairColor: 0x7c3b21,
    beard: false,
    top: 0xd8dcd4,
    topStyle: 'coat',
    pants: 0x2f4f5a,
    boots: 0x2a2420,
    gloves: null,
    eyes: 0x4f6a3a,
    age: 0,
  },
  mykola: {
    sex: 'm',
    skin: 0xe3b08e,
    hair: 'short',
    hairColor: 0x8c8a86,
    beard: true,
    top: 0xb5622e,
    topStyle: 'jacket',
    pants: 0x3a4558,
    boots: 0x3b2f24,
    gloves: 0x5a4632,
    eyes: 0x3a5a7a,
    age: 2,
  },
  vera: {
    sex: 'f',
    skin: 0xe3b08e,
    hair: 'bob',
    hairColor: 0x1c1612,
    beard: false,
    top: 0x4a2f55,
    topStyle: 'coat',
    pants: 0x1f1f22,
    boots: 0x1e1e1e,
    gloves: null,
    eyes: 0x2a1d14,
    age: 1,
  },
  taras: {
    sex: 'm',
    skin: 0xd9a582,
    hair: 'buzz',
    hairColor: 0x3a2a1c,
    beard: false,
    top: 0x55603e,
    topStyle: 'jacket',
    pants: 0x4a5236,
    boots: 0x2a2620,
    gloves: 0x3a3a2e,
    eyes: 0x5a6a7a,
    age: 1,
    scars: true,
  },
  yaryna: {
    sex: 'f',
    skin: 0xf3d0b4,
    hair: 'bun',
    hairColor: 0x2a1a12,
    beard: false,
    top: 0x6a5a8a,
    topStyle: 'hoodie',
    pants: 0x2a3040,
    boots: 0x3a2a2a,
    gloves: null,
    eyes: 0x3a2a1a,
    age: 0,
  },
  ostap: {
    sex: 'm',
    skin: 0xc68a62,
    hair: 'short',
    hairColor: 0xb8b4ac,
    beard: true,
    top: 0x5a4632,
    topStyle: 'coat',
    pants: 0x3a3428,
    boots: 0x2e2418,
    gloves: 0x4a3828,
    eyes: 0x4a3a2a,
    age: 2,
  },
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
  const boxes = {
    head: new THREE.Box3(),
    chest: new THREE.Box3(),
    hips: new THREE.Box3(),
    handR: new THREE.Box3(),
    handL: new THREE.Box3(),
  };
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
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aRegion;\nattribute vec3 aFace;\nvarying float vRegion;\nvarying vec3 vObjPos;\nvarying vec3 vFace;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvRegion = aRegion;\nvObjPos = position;\nvFace = aFace;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uPal[7];\nuniform sampler2D uFaceTex;\nuniform float uDead;\nvarying float vRegion;\nvarying vec3 vObjPos;\nvarying vec3 vFace;',
        )
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

function flatMat(
  color: number,
  opts: { rough?: number; metal?: number; side?: boolean } = {},
  u?: WorldUniforms,
): THREE.MeshStandardMaterial {
  const key = `${color}:${opts.rough}:${opts.metal}:${opts.side}`;
  let m = flatMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      flatShading: true,
      side: opts.side ? THREE.DoubleSide : THREE.FrontSide,
    });
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

const shellMatCache = new Map<string, THREE.MeshStandardMaterial>();
/** Armour fabric: the shell shader (print, weave, binding, stitching) on top of the world patch. */
function shellMat(spec: ArmorSpec, color: number, k: number, u: WorldUniforms): THREE.MeshStandardMaterial {
  const key = `${color}:${spec.rim}:${spec.print ?? ''}:${spec.quilt ?? 0}:${k.toFixed(3)}`;
  let m = shellMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    patchWorldMaterial(m, u, { pre: (sh) => shellShader(sh, spec, k, color) });
    shellMatCache.set(key, m);
  }
  return m;
}

// ── Modelled humans ─────────────────────────────────────────────────────────

/** Average skin colour of the pack's body textures (sRGB #a67350); skin tones are applied relative to it. */
const TEX_SKIN = new THREE.Color(0xa67350);

const HAIR_MODEL: Record<'m' | 'f', Record<HairStyle, string | null>> = {
  m: {
    bald: null,
    buzz: 'Hair_Buzzed',
    short: 'Hair_SimpleParted',
    messy: 'Hair_SimpleParted',
    long: 'Hair_Long',
    ponytail: 'Hair_Long',
    bob: 'Hair_BuzzedFemale',
    bun: 'Hair_Buns',
  },
  f: {
    bald: null,
    buzz: 'Hair_BuzzedFemale',
    short: 'Hair_BuzzedFemale',
    messy: 'Hair_BuzzedFemale',
    long: 'Hair_Long',
    ponytail: 'Hair_Long',
    bob: 'Hair_BuzzedFemale',
    bun: 'Hair_Buns',
  },
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
function humanBodyMaterial(
  src: THREE.MeshStandardMaterial,
  a: Appearance,
  u: WorldUniforms,
  dead = false,
  clothed = false,
): THREE.MeshStandardMaterial {
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
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aRegion;\nvarying float vRegion;\nvarying vec3 vObjPos;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;\nvObjPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uPal[7];\nuniform vec3 uSkinTint;\nuniform float uSkinMask[7];\nuniform float uHide[7];\nvarying float vRegion;\nvarying vec3 vObjPos;',
        )
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
function outfitMaterial(
  src: THREE.MeshStandardMaterial,
  color: number,
  skin: boolean,
  u: WorldUniforms,
  dead = false,
  pattern: Pattern = 'plain',
  accent = 0x202020,
  /** Bind-space units → metres (the model's height scale), so prints have a real-world size. */
  k = 1,
): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|outfit|${color}|${skin}|${dead}|${pattern}|${accent}|${k.toFixed(4)}`;
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
      shader.uniforms.uBindK = { value: k };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uBindK;\nattribute vec3 aBind;\nattribute vec3 aBindN;\nvarying vec3 vClothPos;\nvarying vec3 vClothNrm;',
        )
        // Prints live in the skeleton's bind space (metres), shared by every outfit piece: the raw
        // attribute is quantized per mesh, so using it directly stretched each piece differently (see bindSpace).
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_SKINNING
            vClothPos = aBind * uBindK;
            vClothNrm = normalize(aBindN);
          #else
            vClothPos = aBind * uBindK;
            vClothNrm = normalize(aBindN);
          #endif`,
        );
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
          // Box-filtered square wave (duty d): stripes fade to their average instead of shimmering into moiré.
          float sqI(float t, float d) { return floor(t) * d + max(fract(t) - (1.0 - d), 0.0); }
          float stripe(float x, float d) {
            float w = max(fwidth(x), 1e-4);
            return (sqI(x + 0.5 * w, d) - sqI(x - 0.5 * w, d)) / w;
          }
          // Returns the cloth colour for the active print; 'base' is the dyed texture shading.
          vec3 clothPrint(vec3 base, float shade) {
            vec3 p = vClothPos * 1.0;
            // Hands (gloves) stay plain: arms lie along X in the bind pose.
            if (abs(p.x) > 0.6) return base;
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
              // Around the body on the torso, around the arm on the sleeves (arms lie along X in the bind pose).
              float coord = abs(p.x) > 0.21 ? abs(p.x) : p.y;
              float s = stripe(coord * 36.0, 0.42);
              if (p.y < 0.92) s = 1.0;
              return mix(uDye2, uDye, s) * shade;
            }
            if (uPattern == 5) { // flannel plaid
              float x = stripe(p.x * 14.0 + p.z * 14.0, 0.28);
              float y = stripe(p.y * 14.0, 0.28);
              float t = stripe(p.x * 42.0 + p.z * 42.0, 0.07) + stripe(p.y * 42.0, 0.07);
              vec3 c = mix(uDye, uDye2, max(x, y) * 0.65);
              return mix(c, vec3(0.85), min(t, 1.0) * 0.12) * shade;
            }
            if (uPattern == 6) { // tracksuit: two stripes down the outer sides
              float side = smoothstep(0.78, 0.92, abs(vClothNrm.x));
              float bands = stripe(p.z * 60.0 + p.y * 2.0, 0.5);
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
function outfitPieces(
  lib: AssetLibrary,
  a: Appearance,
): { src: THREE.SkinnedMesh; color: number; pattern: Pattern }[] | null {
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

const bindDone = new WeakSet<THREE.BufferGeometry>();
/**
 * Adds aBind/aBindN: each vertex in the skeleton's rest-pose space. The packs' meshes are quantized and the
 * de-quantization lives in the inverse bind matrices, so rest bone world × bone inverse recovers it.
 */
function bindSpace(src: THREE.SkinnedMesh): void {
  const geo = src.geometry;
  if (bindDone.has(geo)) return;
  bindDone.add(geo);
  const bone = src.skeleton.bones[0]!;
  bone.updateWorldMatrix(true, false);
  const d = new THREE.Matrix4()
    .multiplyMatrices(bone.matrixWorld, src.skeleton.boneInverses[0]!)
    .multiply(src.bindMatrix);
  const nm = new THREE.Matrix3().getNormalMatrix(d);
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal;
  const b = new Float32Array(pos.count * 3);
  const bn = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
      .applyMatrix4(d)
      .toArray(b, i * 3);
    if (nor)
      v.fromBufferAttribute(nor, i)
        .applyMatrix3(nm)
        .normalize()
        .toArray(bn, i * 3);
  }
  geo.setAttribute('aBind', new THREE.BufferAttribute(b, 3));
  geo.setAttribute('aBindN', new THREE.BufferAttribute(bn, 3));
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
function hairShell(
  box: THREE.Box3,
  top: number,
  bottom: number,
  faceOpen: number,
  inflate: number,
): THREE.BufferGeometry[] {
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
    out.push(
      place(
        new THREE.SphereGeometry(
          0.5,
          18,
          8,
          start,
          Math.PI * 2 - faceOpen * 2,
          Math.PI * top,
          Math.PI * (bottom - top),
        ),
      ),
    );
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
        t.translate(
          c.x + rng.range(-0.35, 0.35) * s.x,
          c.y + s.y * rng.range(0.4, 0.55),
          c.z + rng.range(-0.45, 0.15) * s.z,
        );
        out.push(t);
      }
      return out;
    }
    case 'long': {
      const out = [...hairShell(head, 0.34, 0.7, 1.0, 1.12), bangs(head)];
      const back = new THREE.CylinderGeometry(
        s.x * 0.5,
        s.x * 0.44,
        s.y * 1.15,
        12,
        1,
        true,
        Math.PI * 0.62,
        Math.PI * 0.76,
      );
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
  const clip = new THREE.AnimationClip(
    `${name}_${layer}`,
    src.duration,
    src.tracks.filter((t) => re.test(t.name)),
  );
  filtered.set(key, clip);
  return clip;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character view
// ─────────────────────────────────────────────────────────────────────────────

const CHAR_SCALE = 0.92;
const tmpV = new THREE.Vector3();
const _ikF = new THREE.Vector3();
const _ikU = new THREE.Vector3();
const _ikL = new THREE.Vector3();
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikP = new THREE.Vector3();
const _ikS = new THREE.Vector3();
const _ikT = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const _palmC0 = new THREE.Vector3();
const _palmC1 = new THREE.Vector3();
const _palmC2 = new THREE.Vector3();
const _palmM = new THREE.Matrix4();
const _palmQ = new THREE.Quaternion();
const _palmQ2 = new THREE.Quaternion();
const [_rlX, _rlY, _rlZ, _rlD, _rlB, _rlR, _rlT, _rlF, _rlN] = Array.from({ length: 9 }, () => new THREE.Vector3());
/** Clip seconds of Fixing_Kneeling spent down on one knee. */
const KNEEL_HOLD = [1.0, 4.0] as const;

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
  private heldBox = new THREE.Box3();
  private heldDef = '';
  private reverseGrip = false;
  /** index_01, middle_01, pinky_01, thumb_01 of the right hand: they define the fist the weapon sits in. */
  private fingers: (THREE.Bone | null)[] = [];
  private handR: THREE.Bone | null = null;
  private handL: THREE.Bone | null = null;
  private aimT = 0;
  private rig!: RigInfo;
  private human: HumanParts | null = null;
  /** Calling in an extraction on the radio (standing still in the zone while its timer runs). */
  extracting = false;
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
    const src = human
      ? (look.sex === 'f' ? lib.humanF! : lib.humanM!).scene
      : look.sex === 'f' && lib.characterF
        ? lib.characterF.scene
        : lib.character.scene;
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
      m.material = human
        ? humanBodyMaterial(human.body.material as THREE.MeshStandardMaterial, look, u, false, !!outfit)
        : bodyMaterial(look, u);
      m.castShadow = shadows;
      m.frustumCulled = false;
    }
    if (human) {
      for (const m of [human.eyes, human.brows]) {
        if (!m) continue;
        m.material =
          m === human.brows
            ? hairMaterial(m.material as THREE.MeshStandardMaterial, look.zombie ? 0x2a2a24 : look.hairColor, u)
            : worldMat(m.material as THREE.MeshStandardMaterial, u, look.zombie ? 0xc8c0a0 : null);
        m.frustumCulled = false;
      }
      const bindK = heightScale(src, look.sex === 'f' ? 1.66 : 1.8);
      this.model.scale.setScalar(bindK);
      for (const piece of outfit ?? []) {
        bindSpace(piece.src);
        const mats = Array.isArray(piece.src.material) ? piece.src.material : [piece.src.material];
        const dressed = mats.map((mt) => {
          const skin = /Regular/.test(mt.name);
          return outfitMaterial(
            mt as THREE.MeshStandardMaterial,
            skin ? (look.gloves ?? look.skin) : piece.color,
            skin,
            u,
            false,
            piece.pattern,
            look.accent,
            bindK,
          );
        });
        const worn = attachSkinned(
          piece.src,
          human.body,
          dressed.length === 1 ? dressed[0] : (dressed as unknown as THREE.Material),
        );
        worn.castShadow = shadows;
        this.outfitMeshes.push(worn);
      }
    } else this.model.scale.setScalar(CHAR_SCALE);
    this.root.add(this.model);
    this.handR = this.skinned.skeleton.getBoneByName('hand_r') ?? null;
    this.handL = this.skinned.skeleton.getBoneByName('hand_l') ?? null;
    this.fingers = ['index_01_r', 'middle_01_r', 'pinky_01_r', 'thumb_01_r'].map(
      (n) => this.skinned.skeleton.getBoneByName(n) ?? null,
    );
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
      if (a.beard && a.sex === 'm' && this.lib.hair.get('Hair_Beard'))
        attachSkinned(this.lib.hair.get('Hair_Beard')!, this.human.body, hm);
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
      attachToBone(
        this.skinned,
        this.bone(/^spine_03$/),
        new THREE.Mesh(collar, flatMat(a.top, { rough: 0.95 }, this.u)),
      );
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
    const fit = (
      obj: THREE.Object3D,
      target: THREE.Vector3,
      anchor: THREE.Vector3,
      align: 'bottom' | 'center' = 'bottom',
    ) => {
      obj.updateMatrixWorld(true);
      // Helmets fit by their shell, so a raised visor or faceplate doesn't squash the dome.
      const b = new THREE.Box3().setFromObject((obj.userData.shell as THREE.Object3D | undefined) ?? obj);
      const sz = b.getSize(new THREE.Vector3());
      const wrap = new THREE.Group();
      wrap.add(obj);
      obj.position.set(
        -(b.min.x + b.max.x) / 2,
        align === 'bottom' ? -b.min.y : -(b.min.y + b.max.y) / 2,
        -(b.min.z + b.max.z) / 2,
      );
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
    // No hat over a raised hood.
    const hat =
      !s.helmet && this.look.hat && !this.look.zombie && this.look.topStyle !== 'hoodie' ? this.look.hat : null;
    // Hats and helmets sit over short hair; long hair stays (it hangs below the rim).
    for (const h of this.hairMeshes) h.visible = !(s.helmet || (hat && hat !== 'bandana')) || /Long/.test(h.name);
    if (hat) {
      // A bandana is a band round the forehead; the rest cover the crown.
      const brow = hc.y + hs.y * (hat === 'cap' ? 0.1 : hat === 'bandana' ? 0.2 : 0.06);
      const top = hat === 'bandana' ? brow + hs.y * 0.24 : head.max.y + hs.y * 0.07;
      add(
        /^head$/i,
        fit(
          hatModel(hat, this.look.hatColor ?? 0x2a2a2a),
          new THREE.Vector3(hs.x * 1.16, top - brow, hs.z * 1.15),
          new THREE.Vector3(hc.x, brow, hc.z - hs.z * 0.03),
        ),
      );
    }
    if (s.helmet) {
      const id = s.helmet.def;
      // Rim just above the brow, dome over the crown; the Altyn's faceplate hangs lower.
      const brow = hc.y + hs.y * (id === 'altyn' ? -0.06 : 0.04);
      const top = head.max.y + hs.y * 0.06;
      add(
        /^head$/i,
        fit(
          helmetModel(id),
          new THREE.Vector3(hs.x * 1.32, top - brow, hs.z * 1.3),
          new THREE.Vector3(hc.x, brow, hc.z - hs.z * 0.03),
        ),
      );
    }
    // Armour and rigs: shells cut from this body's own torso, skinned to its skeleton (see armorShell.ts).
    const wear = (id: string, spec: ArmorSpec | undefined): boolean => {
      const body = this.human?.body;
      if (!spec || !body) return false;
      const parts = shellParts(body, id, spec);
      for (const { shell, color } of parts)
        for (const geo of [shell.geometry, shell.rim]) {
          const m = new THREE.SkinnedMesh(geo, shellMat(spec, color, shell.frame.k, this.u));
          m.bind(body.skeleton, body.bindMatrix);
          m.castShadow = true;
          m.frustumCulled = false;
          body.parent!.add(m);
          this.gearAttachments.push(m);
        }
      const shell = parts[0]!.shell;
      for (const d of details(shell, spec, (c) => gearSkinMat(c, 0.9, this.u))) add(/^spine_03$/, d);
      return true;
    };
    if (s.armor && !wear(s.armor.def, ARMOR_SPECS[s.armor.def])) {
      const bottom = chest.min.y - cs.y * 0.62;
      add(
        /^spine_03$/,
        fit(
          armorModel(s.armor.def),
          new THREE.Vector3(cs.x * 1.12, chest.max.y + cs.y * 0.06 - bottom, cs.z * 1.32),
          new THREE.Vector3(cc.x, bottom, cc.z),
        ),
      );
    }
    if (s.rig && !wear(s.rig.def, RIG_SPECS[s.rig.def])) {
      const bottom = chest.min.y - cs.y * 0.55;
      add(
        /^spine_03$/,
        fit(
          rigModel(s.rig.def),
          new THREE.Vector3(
            cs.x * (s.armor ? 1.18 : 1.1),
            chest.max.y + cs.y * 0.04 - bottom,
            cs.z * (s.armor ? 1.55 : 1.35),
          ),
          new THREE.Vector3(cc.x, bottom, cc.z + cs.z * 0.02),
        ),
      );
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
        add(
          /^spine_03$/,
          fit(
            bp,
            new THREE.Vector3(cs.x * 0.9 * Math.min(1.15, k), h, depth),
            new THREE.Vector3(cc.x, chest.max.y - h * 0.95, back),
          ),
        );
      }
    }

    // Weapon in hands.
    if (this.held) this.gear.remove(this.held);
    this.held = null;
    this.heldKind = null;
    if (held) {
      const d = getDef(held.def);
      const src = d.melee ? meleeModel(held.def) : this.lib.weapons.get(held.def);
      if (src) {
        this.held = d.melee ? src : buildGun(this.lib, held)!;
        this.heldKind = d.melee ? 'melee' : 'gun';
        this.heavyMelee = HEAVY_MELEE.has(held.def);
        this.reverseGrip = REVERSE_GRIP.has(held.def);
        const b = new THREE.Box3().setFromObject(src);
        this.heldLen = d.melee ? b.max.z : b.getSize(tmpV).z;
        this.heldBox.copy(b);
        this.heldDef = held.def;
        if (d.melee) this.held.matrixAutoUpdate = false;
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
    // Guns reload with hand IK (see reloadGesture); the clip is only a fallback for a rig without arm bones.
    if (!(this.heldKind === 'gun' && this.arms())) this.playOneShot('Pistol_Reload', 'upper', 1.4);
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
    if (!this.oneShot || this.oneShotT <= 0)
      this.playOneShot(Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head', 'upper', 1.6);
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
    // Treating wounds / eating: a looping gesture for the whole use timer, weapon put away, item in hand.
    const treat = this.updateTreat(a, moving);
    const gun = this.heldKind === 'gun';
    let stance: string | null = null;
    const radio = this.extracting && !moving && !treat;
    if (this.held) this.held.visible = !radio && !this.treatDef;
    if (treat === 'kneel' || radio) stance = null;
    else if (treat) stance = treat;
    else if (zombie || talking || (sprint && moving)) stance = null;
    else if (gun && (alerted || this.aimT > 0 || (a.faction === 'player' && a.aiming))) stance = 'Pistol_Aim_Neutral';
    else if (gun) stance = 'Pistol_Idle_Loop';
    else if (this.heldKind === 'melee' && (alerted || a.faction === 'player')) stance = 'Sword_Idle';
    if (!this.oneShot) this.setUpper(stance);
    const upperBusy = !!this.upper || (!!this.oneShot && this.oneShotLayer === 'upper');
    const layer: 'lower' | 'full' = upperBusy ? 'lower' : 'full';

    if (treat === 'kneel') this.setLower('Fixing_Kneeling', 1, 'full');
    else if (radio) this.setLower('Idle_TalkingPhone_Loop', 1, 'full');
    else if (zombie) {
      if (moving) this.setLower('Zombie_Walk_Fwd_Loop', speed / 1.2, layer);
      else this.setLower('Zombie_Idle_Loop', 1, layer);
    } else if (moving) {
      if (a.crouching) this.setLower('Crouch_Fwd_Loop', (dir * speed) / 1.4, layer);
      else if (sprint) this.setLower('Sprint_Loop', speed / 5.6, layer);
      else if (speed > 2.4) this.setLower('Jog_Fwd_Loop', (dir * speed) / 3.6, layer);
      else this.setLower('Walk_Loop', (dir * speed) / 1.5, layer);
    } else if (a.crouching) this.setLower('Crouch_Idle_Loop', 1, layer);
    else if (talking) this.setLower('Idle_Talking_Loop', 1, 'full');
    else if (a.faction === 'npc' && !alerted)
      this.setLower(this.look.sex === 'f' ? 'Idle_Loop' : 'Idle_FoldArms_Loop', 1, layer);
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
    if (!this.hidden) this.proceduralArms(a, dt);
    this.placeTreatProp();
  }

  // ── Procedural hands: reloads and treatment, IK on top of the animated pose ───────────────────────────

  private armBones: Record<string, THREE.Bone> | null | undefined;
  private reloadTotal = 0;
  private reloadPrev = 0;
  private useTotal = 0;
  private usePrev = 0;
  private handProp: THREE.Mesh | null = null;
  private gestureT = 0;

  private arms(): Record<string, THREE.Bone> | null {
    if (this.armBones !== undefined) return this.armBones;
    const sk = this.skinned.skeleton;
    const names = ['upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'spine_01', 'spine_03', 'Head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
    const fingers = ['middle_01', 'index_01', 'pinky_01'].flatMap((f) => [`${f}_l`, `${f}_r`]);
    const out: Record<string, THREE.Bone> = {};
    for (const n of [...names, ...fingers]) {
      const b = sk.getBoneByName(n);
      if (!b) return (this.armBones = null);
      out[n] = b;
    }
    const arm = (side: 'l' | 'r'): Arm => ({
      side,
      upper: out[`upperarm_${side}`]!,
      lower: out[`lowerarm_${side}`]!,
      hand: out[`hand_${side}`]!,
      middle: out[`middle_01_${side}`]!,
      index: out[`index_01_${side}`]!,
      pinky: out[`pinky_01_${side}`]!,
    });
    this.armRig = { l: arm('l'), r: arm('r') };
    return (this.armBones = out);
  }

  /** Arm chains for the hand IK (set up with the bones; separate from `rig`, the mesh's RigInfo). */
  private armRig: Record<'l' | 'r', Arm> | null = null;
  private palm = newPalm();

  /**
   * Seat `obj` (geometry centred on its origin, `size` its extent) in the palm of a hand: its longest side across
   * the palm like a gripped handle, the next along the fingers, resting on the palm.
   */
  private inPalm(obj: THREE.Object3D, side: 'l' | 'r', size: THREE.Vector3): void {
    if (!this.armRig) return;
    const P = palmFrame(this.armRig[side], this.palm);
    const dims = [size.x, size.y, size.z];
    const ord = [0, 1, 2].sort((i, j) => dims[j]! - dims[i]!);
    const cols = [_palmC0, _palmC1, _palmC2];
    cols[ord[0]!]!.copy(P.x);
    cols[ord[1]!]!.copy(P.f);
    cols[ord[2]!]!.copy(P.n);
    _palmM.makeBasis(cols[0]!, cols[1]!, cols[2]!);
    if (_palmM.determinant() < 0) _palmM.makeBasis(cols[0]!.negate(), cols[1]!, cols[2]!);
    _palmQ.setFromRotationMatrix(_palmM);
    obj.quaternion.copy(this.gear.getWorldQuaternion(_palmQ2).invert().multiply(_palmQ));
    tmpV.copy(P.c).addScaledVector(P.n, dims[ord[2]!]! / 2);
    obj.position.copy(this.gear.worldToLocal(tmpV));
  }

  /** A small prop (magazine, shell) carried in a hand, gripped in its palm each frame. */
  private propInHand(kind: 'mag' | 'pmag' | 'shell' | null, side: 'l' | 'r' = 'l'): void {
    if (!kind) {
      if (this.handProp) this.handProp.visible = false;
      return;
    }
    const dims = kind === 'mag' ? [0.035, 0.17, 0.08] : kind === 'pmag' ? [0.024, 0.1, 0.035] : [0.022, 0.022, 0.07];
    const key = dims.join('x');
    if (!this.handProp || this.handProp.userData.key !== key) {
      if (this.handProp) this.gear.remove(this.handProp);
      this.handProp = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), flatMat(kind === 'shell' ? 0x8a2a22 : 0x1e1f1c, { rough: 0.6 }, this.u));
      this.handProp.userData.key = key;
      this.handProp.castShadow = true;
      this.gear.add(this.handProp);
    }
    this.handProp.visible = true;
    this.inPalm(this.handProp, side, tmpV2.set(dims[0]!, dims[1]!, dims[2]!));
  }

  private proceduralArms(a: Actor, dt: number): void {
    const B = this.arms();
    if (!B || this.dead) return;
    this.gestureT += dt;
    this.root.updateMatrixWorld(true);
    // Body frame in world: forward, up, the character's left.
    const fwd = _ikF.set(0, 0, 1).transformDirection(this.root.matrixWorld);
    const up = _ikU.set(0, 1, 0);
    const left = _ikL.subVectors(B.upperarm_l!.getWorldPosition(_ikA), B.upperarm_r!.getWorldPosition(_ikB)).normalize();
    const pole = (side: 'l' | 'r') =>
      _ikP.copy(B[`upperarm_${side}`]!.getWorldPosition(_ikA)).addScaledVector(up, -0.6).addScaledVector(left, side === 'l' ? 0.35 : -0.35).addScaledVector(fwd, -0.15);

    let reloading = false;
    if (a.reloadT > 0 && this.held && this.heldKind === 'gun') {
      if (this.reloadTotal <= 0 || a.reloadT > this.reloadPrev + 1e-3) this.reloadTotal = a.reloadT;
      this.reloadPrev = a.reloadT;
      reloading = true;
      this.reloadGesture(1 - a.reloadT / this.reloadTotal, B, fwd, up, left, pole('l'));
    } else this.reloadTotal = this.reloadPrev = 0;

    let treating = false;
    this.treatHand = 'l';
    if (!reloading && a.useT > 0 && a.useDef) {
      if (this.useTotal <= 0 || a.useT > this.usePrev + 1e-3) this.useTotal = a.useT;
      this.usePrev = a.useT;
      treating = this.treatGesture(a, 1 - a.useT / this.useTotal, B, fwd, up, left);
    } else this.useTotal = this.usePrev = 0;
    if (!reloading && !treating) this.propInHand(null);
    if (!treating) this.showWrap(null);
  }

  /**
   * Reload by hand: the gun rolls to show its side, the support hand strips the magazine and drops it, reaches
   * to the chest rig for a fresh one, seats it and works the charging handle (slide on a pistol). A pump gun is
   * fed shell by shell from the belt into the loading port, then racked.
   */
  private reloadGesture(u: number, B: Record<string, THREE.Bone>, fwd: THREE.Vector3, up: THREE.Vector3, left: THREE.Vector3, pole: THREE.Vector3): void {
    const h = this.held!;
    const box = this.heldBox;
    const sz = box.getSize(_ikS);
    const pistol = this.heldLen < 0.4;
    const pump = /mp133|toz/.test(this.heldDef);
    // Roll the gun to bring the magazine well / port into view, back level for the charging handle; the key
    // points below are read off the rolled gun.
    h.rotation.z += (pistol ? 0.25 : 0.45) * ease(0.02, 0.12, u) * (1 - ease(0.8, 0.9, u));
    h.updateMatrixWorld(true);
    const at = (x: number, y: number, z: number) => h.localToWorld(_ikT.set(box.min.x + sz.x * x, box.min.y + sz.y * y, box.min.z + sz.z * z)).clone();
    const well = pistol ? at(0.5, 0.05, 0.3) : at(0.5, 0.35, 0.52);
    const below = well.clone().addScaledVector(up, -0.24);
    const handle = pistol ? at(0.5, 1, 0.08) : at(0.0, 0.7, 0.58);
    const back = handle.clone().addScaledVector(fwd, -0.09);
    const pouch = B.spine_03!.getWorldPosition(_ikA).addScaledVector(fwd, 0.17).addScaledVector(left, 0.1).addScaledVector(up, -0.24).clone();
    const port = at(0.5, 0.3, 0.55);
    const foreEnd = at(0.5, 0.35, 0.78);
    const foreBack = foreEnd.clone().addScaledVector(fwd, -0.1);

    // How the support hand meets each point, in the gun's own axes (gz towards the muzzle, gy up, gx towards the
    // side away from the charging handle): under the gun palm up, into the pouch fingers down, hooking the handle
    // from its side, over the top of a pistol slide.
    const gx = _rlX.setFromMatrixColumn(h.matrixWorld, 0).normalize();
    const gy = _rlY.setFromMatrixColumn(h.matrixWorld, 1).normalize();
    const gz = _rlZ.setFromMatrixColumn(h.matrixWorld, 2).normalize();
    type Grip = 'under' | 'pouch' | 'side' | 'top';
    const grip = (g: Grip): [THREE.Vector3, THREE.Vector3] =>
      g === 'under' ? [gz, gy] : g === 'pouch' ? [_rlD.copy(up).negate(), _rlB.copy(fwd).negate()] : g === 'side' ? [gy, gx] : [_rlR.copy(gx).negate(), _rlT.copy(gy).negate()];
    type Key = [number, THREE.Vector3, Grip];
    let keys: Key[];
    let prop: 'mag' | 'pmag' | 'shell' | null = null;
    if (pump) {
      keys = [];
      for (let i = 0; i < 4; i++) {
        const t0 = 0.04 + i * 0.2;
        keys.push([t0, pouch, 'pouch'], [t0 + 0.1, port, 'under'], [t0 + 0.16, port, 'under']);
        const k = (u - t0) / 0.2;
        if (k >= 0 && k < 0.5) prop = 'shell';
      }
      keys.push([0.86, foreEnd, 'under'], [0.91, foreBack, 'under'], [0.97, foreEnd, 'under']);
    } else {
      const hg: Grip = pistol ? 'top' : 'side';
      keys = [[0, well, 'under'], [0.14, well, 'under'], [0.3, below, 'under'], [0.47, pouch, 'pouch'], [0.55, pouch, 'pouch'], [0.72, below, 'under'], [0.8, well, 'under'], [0.86, handle, hg], [0.92, back, hg], [1, handle, hg]];
      if ((u > 0.14 && u < 0.3) || (u > 0.55 && u < 0.8)) prop = pistol ? 'pmag' : 'mag';
    }
    const target = _ikT;
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1]![0]) i++;
    const [t0, p0, g0] = keys[i]!;
    const [t1, p1, g1] = keys[i + 1]!;
    const k = u <= t0 ? 0 : u >= t1 ? 1 : ease(t0, t1, u);
    target.lerpVectors(p0, p1, k);
    const [f0, n0] = grip(g0);
    const fd = _rlF.copy(f0);
    const nd = _rlN.copy(n0);
    const [f1, n1] = grip(g1);
    fd.lerp(f1, k).normalize();
    nd.lerp(n1, k).normalize();
    const w = ease(0, 0.08, u) * (1 - ease(0.95, 1, u));
    reachPalm(this.armRig!.l, target, fd, nd, pole, w);
    this.propInHand(prop, 'l');
  }

  /**
   * Treatment by hand, on the body part being treated: a dressing or tourniquet is wound round the limb, a
   * splint or surgery kit worked with both hands on it, an injector jabbed into the thigh. Food, drink and pills
   * keep the eating clip. Returns false when the item has no hand gesture.
   */
  private treatGesture(
    a: Actor,
    u: number,
    B: Record<string, THREE.Bone>,
    fwd: THREE.Vector3,
    up: THREE.Vector3,
    left: THREE.Vector3,
  ): boolean {
    const m = getDef(a.useDef!).med;
    const R = this.armRig;
    if (!m || !R) return false;
    const w = ease(0, 0.12, u) * (1 - ease(0.92, 1, u));
    const part = a.usePart ?? 'thorax';
    const sgn = (s: 'l' | 'r') => (s === 'l' ? 1 : -1);
    const opp = (s: 'l' | 'r') => (s === 'l' ? 'r' : 'l');
    const at = (bone: string) => B[bone]!.getWorldPosition(new THREE.Vector3());
    // Elbows out to their own side and down, so a hand reaching across the body doesn't fold the arm inwards.
    const elbow = (side: 'l' | 'r') =>
      _ikP.copy(B[`upperarm_${side}`]!.getWorldPosition(_ikA)).addScaledVector(up, -0.5).addScaledVector(left, sgn(side) * 0.45).addScaledVector(fwd, -0.1);
    /** Palm flat on a surface whose outward normal is `out`, fingers carrying on the line of reach from the shoulder. */
    const flat = (side: 'l' | 'r', target: THREE.Vector3, out: THREE.Vector3, weight = w) => {
      const fd = target.clone().sub(at(`upperarm_${side}`));
      fd.addScaledVector(out, -fd.dot(out));
      if (fd.lengthSq() < 1e-6) fd.copy(fwd);
      reachPalm(R[side], target, fd.normalize(), out.clone().negate(), elbow(side), weight);
    };

    // An injured arm comes up in front of the belly, forearm across the body and palm up, for the other hand to work on.
    const hurt = part === 'leftArm' ? 'l' : part === 'rightArm' ? 'r' : null;
    if (hurt) {
      const hold = at('spine_03').addScaledVector(fwd, 0.3).addScaledVector(up, -0.14).addScaledVector(left, sgn(hurt) * 0.02);
      const fd = fwd.clone().multiplyScalar(0.7).addScaledVector(left, -sgn(hurt) * 0.7).normalize();
      reachPalm(R[hurt], hold, fd, up, elbow(hurt), w, 0.5);
    }

    const injector = /morphine|stim|adren|propital|zagustin|etg|sj/.test(a.useDef!);
    if (injector) {
      // Fist round the injector, raised, then jabbed down and in at the outside of the left thigh (high enough to
      // reach standing) and held for the dose.
      const into = left.clone().multiplyScalar(-0.6).addScaledVector(up, -0.8).normalize();
      const skin = at('thigh_l').lerp(at('calf_l'), 0.2).addScaledVector(left, 0.08).addScaledVector(fwd, 0.04);
      const jab = skin.clone().addScaledVector(into, -0.075);
      const raised = jab.clone().addScaledVector(left, 0.1).addScaledVector(up, 0.14).addScaledVector(fwd, 0.08);
      const target = raised.lerp(jab, ease(0.25, 0.35, u) * (1 - ease(0.8, 0.95, u)));
      // Across the palm (and so the injector) points into the thigh; fingers forward.
      const fd = fwd.clone().addScaledVector(into, -into.dot(fwd)).normalize();
      const nd = new THREE.Vector3().crossVectors(fd, into).negate();
      reachPalm(R.l, target, fd, nd, elbow('l'), w);
      this.treatHand = 'l';
      this.showWrap(null);
      return true;
    }

    // Torso and head: pressing on the wound rather than going round it.
    if (part === 'thorax' || part === 'stomach' || part === 'head') {
      const head = part === 'head';
      const spot = head
        ? at('Head').addScaledVector(up, 0.04).addScaledVector(left, 0.09)
        : at(part === 'thorax' ? 'spine_03' : 'spine_01').addScaledVector(fwd, 0.15);
      const out = head ? left.clone() : fwd.clone();
      const side = head ? 'l' : 'r';
      const ang = this.gestureT * 5;
      const work = spot.clone().addScaledVector(up, Math.sin(ang) * 0.03).addScaledVector(left, Math.cos(ang) * 0.03);
      flat(side, work, out);
      if (!head) flat(opp(side), spot.clone().addScaledVector(up, 0.06).addScaledVector(left, 0.07), out, w * 0.9);
      this.treatHand = side;
      this.showWrap(null);
      return true;
    }

    // Limbs: arms dressed mid-forearm; legs on the thigh, low on a raised one, high on the one knelt on. A
    // tourniquet goes high and tight on a leg.
    const band = !!m.stopsHeavy && !m.stopsLight;
    const leg = part === 'leftLeg' ? 'l' : part === 'rightLeg' ? 'r' : null;
    const s = (hurt ?? leg ?? 'l') as 'l' | 'r';
    const p0 = at(hurt ? `lowerarm_${s}` : `thigh_${s}`);
    const p1 = at(hurt ? `hand_${s}` : `calf_${s}`);
    const kneltOn = !hurt && p1.y < p0.y - 0.2;
    const mid = p0.clone().lerp(p1, hurt ? 0.5 : band ? 0.2 : kneltOn ? 0.3 : 0.55);
    const limbR = hurt ? 0.058 : 0.11;
    const axis = p1.clone().sub(p0).normalize();
    // Round the limb: e1 on top (the front of an upright thigh), e2 the side away from the body.
    const e1 = (Math.abs(axis.dot(up)) > 0.8 ? fwd : up).clone();
    e1.addScaledVector(axis, -e1.dot(axis)).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1);
    if (e2.dot(hurt ? fwd : left.clone().multiplyScalar(sgn(s))) < 0) e2.negate();

    if (m.surgery || m.fixesFracture) {
      // Palms either side of the limb, pressing and binding along it; on an arm the free hand works over the top.
      const k = Math.sin(this.gestureT * 3.2) * 0.04;
      if (hurt) flat(opp(s), mid.clone().addScaledVector(e1, limbR + 0.02).addScaledVector(axis, k), e1);
      else {
        flat(s, mid.clone().addScaledVector(e2, limbR + 0.025).addScaledVector(axis, k), e2);
        flat(opp(s), mid.clone().addScaledVector(e2, -limbR - 0.025).addScaledVector(axis, -k), e2.clone().negate());
      }
      this.treatHand = hurt ? opp(s) : s;
      // The splint's binding builds up on the limb.
      if (m.fixesFracture) this.showWrap(mid, axis, limbR + 0.006, 0.03 + 0.09 * ease(0.15, 0.85, u), 0xcfc6a4);
      else this.showWrap(null);
      return true;
    }

    if (m.stopsLight || m.stopsHeavy || m.resource > 0) {
      // Wind the dressing: the roll goes over the top, round the far side and underneath, and back, the palm on it
      // and the fingers along the line of reach. On a leg the other hand holds the end down on top.
      const work = hurt ? opp(s) : s;
      const th = 1.6 + 1.5 * Math.sin(this.gestureT * 4);
      const radial = e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
      flat(work, mid.clone().addScaledVector(radial, limbR + 0.065), radial);
      // The other hand pins the end just above the turns (towards the hip), where it is within reach when kneeling.
      if (!hurt) flat(opp(s), mid.clone().addScaledVector(axis, -0.07).addScaledVector(e1, limbR + 0.02), e1, w * 0.9);
      this.treatHand = work;
      // The dressing builds up on the limb as it is wound.
      this.showWrap(mid, axis, limbR + 0.004, (band ? 0.04 : 0.025) + (band ? 0.02 : 0.08) * ease(0.15, 0.85, u), band ? 0xa0452c : 0xe6e1d6);
      return true;
    }
    return false;
  }

  private wrap: THREE.Mesh | null = null;

  /** The dressing on the limb: an open sleeve round `axis` at `at`, `len` long; null hides it. */
  private showWrap(at: THREE.Vector3 | null, axis?: THREE.Vector3, r = 0.05, len = 0.05, color = 0xe6e1d6): void {
    if (!at) {
      if (this.wrap) this.wrap.visible = false;
      return;
    }
    if (!this.wrap) {
      this.wrap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), flatMat(color, { rough: 0.9, side: true }, this.u));
      this.wrap.castShadow = true;
      this.gear.add(this.wrap);
    }
    // Materials are shared from a cache: swap rather than recolour.
    this.wrap.material = flatMat(color, { rough: 0.9, side: true }, this.u);
    this.wrap.visible = true;
    this.wrap.scale.set(r, len, r);
    _palmQ.setFromUnitVectors(_palmC0.set(0, 1, 0), axis!);
    this.wrap.quaternion.copy(this.gear.getWorldQuaternion(_palmQ2).invert().multiply(_palmQ));
    this.wrap.position.copy(this.gear.worldToLocal(tmpV.copy(at)));
  }

  /** The hand holding the treatment item this frame; the item sits in its palm. */
  private treatHand: 'l' | 'r' = 'l';

  private treatDef: string | null = null;
  private treatProp: THREE.Object3D | null = null;

  /**
   * Which gesture fits the item: surgery kits and splints are done kneeling (when standing still),
   * dressings and tourniquets are wrapped at the waist, injectors are a jab, everything else goes to the mouth.
   * Returns the upper-body clip, 'kneel' for the full-body kneel, or null when not using anything.
   */
  private updateTreat(a: Actor, moving: boolean): string | null {
    const def = a.useT > 0 ? a.useDef : null;
    if (def !== this.treatDef) {
      this.treatDef = def;
      if (this.treatProp) {
        this.gear.remove(this.treatProp);
        this.treatProp = null;
      }
      if (this.held) this.held.visible = !def;
      if (def) {
        const item = { uid: '', def, stack: 1 } as unknown as ItemInstance;
        const m = itemModel(this.lib, item);
        if (m) {
          // Hand-sized: the longest side ~14 cm whatever the model's own size.
          const size = new THREE.Box3().setFromObject(m.obj).getSize(tmpV);
          // An autoinjector is ~13 cm in the fist, however small its model.
          const injector = /morphine|stim|adren|propital|zagustin|etg|sj/.test(def);
          const fit = 0.14 / Math.max(size.x, size.y, size.z, 1e-3);
          m.obj.scale.multiplyScalar(injector ? fit * 0.93 : Math.min(1, fit));
          // Centred on the group's origin so it can be seated in the palm.
          m.obj.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(m.obj);
          m.obj.position.sub(box.getCenter(tmpV2));
          this.treatProp = new THREE.Group().add(m.obj);
          this.treatProp.userData.size = box.getSize(new THREE.Vector3());
          this.gear.add(this.treatProp);
        }
        if (this.oneShot) {
          this.oneShot.fadeOut(0.1);
          this.oneShot = null;
        }
      }
    }
    if (!def) return null;
    // Fixing_Kneeling kneels down over its first second and stands back up after 4.1 s: while treating, loop
    // the kneeling stretch so a long treatment doesn't stand up and kneel again halfway through.
    for (const act of [this.lower, this.upper])
      if (act && act.getClip().name.startsWith('Fixing_Kneeling') && act.time > KNEEL_HOLD[1]) act.time -= KNEEL_HOLD[1] - KNEEL_HOLD[0];
    const d = getDef(def);
    const m = d.med;
    if (m && (m.surgery || m.fixesFracture)) return moving ? 'Fixing_Kneeling' : 'kneel';
    if (m && (m.stopsLight || m.stopsHeavy || m.resource > 0)) return moving ? 'Fixing_Kneeling' : 'kneel';
    if (m && /morphine|stim|adren|propital|zagustin|etg|sj/.test(def)) return 'Interact';
    return 'Consume';
  }

  /** Keep the treatment item gripped in the palm of the hand using it. */
  private placeTreatProp(): void {
    const p = this.treatProp;
    if (!p) return;
    if (this.armRig) return this.inPalm(p, this.treatHand, p.userData.size as THREE.Vector3);
    const hand = this.treatHand === 'r' ? this.handR : this.handL;
    if (!hand) return;
    p.position.copy(this.gear.worldToLocal(hand.getWorldPosition(tmpV)));
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
    this.yawBones ??= {
      pelvis: sk.getBoneByName('pelvis') ?? null,
      s1: sk.getBoneByName('spine_01') ?? null,
      s2: sk.getBoneByName('spine_02') ?? null,
    };
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
    } else this.placeInFist(h);
    void a;
  }

  /**
   * Melee weapons sit in the closed fist: the grip runs across the palm from the little finger to the
   * index knuckle, the edge faces where the knuckles point. Built from the hand and finger bones every
   * frame, so the weapon follows wrist and finger animation instead of floating by the forearm.
   */
  private placeInFist(h: THREE.Object3D): void {
    const [index, middle, pinky, thumb] = this.fingers;
    if (!index || !middle || !pinky || !thumb) return;
    const w = this.handR!.getWorldPosition(_fw);
    const m = middle.getWorldPosition(_fm);
    const across = index.getWorldPosition(_fa).sub(pinky.getWorldPosition(_fp));
    const fwd = _ff.subVectors(m, w);
    const palmLen = fwd.length();
    fwd.normalize();
    across.addScaledVector(fwd, -across.dot(fwd)).normalize();
    // Palm normal: the side the thumb folds over.
    const palm = _fn.crossVectors(fwd, across);
    if (palm.dot(thumb.getWorldPosition(_ft).sub(w)) < 0) palm.negate();
    // The haft crosses the palm diagonally, leaning towards the fingers.
    const z = _fz
      .copy(across)
      .multiplyScalar(this.reverseGrip ? -1 : 1)
      .addScaledVector(fwd, 0.35)
      .normalize();
    const y = _fy.copy(fwd).addScaledVector(z, -fwd.dot(z)).normalize();
    const x = _fx.crossVectors(y, z);
    const grip = _fg
      .copy(w)
      .addScaledVector(fwd, palmLen * 0.95)
      .addScaledVector(palm, palmLen * 0.32);
    _fq.setFromRotationMatrix(_fmat.makeBasis(x, y, z));
    // Into gear space (gear is a child of the unscaled root).
    this.gear.updateWorldMatrix(true, false);
    _fmat.compose(grip, _fq, _one);
    h.matrix.copy(this.gear.matrixWorld).invert().multiply(_fmat);
    h.matrixWorldNeedsUpdate = true;
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
      m.material = this.human
        ? humanBodyMaterial(this.human.srcMaterial, this.look, this.u, true, this.outfitMeshes.length > 0)
        : bodyMaterial(this.look, this.u, true);
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

const _fw = new THREE.Vector3();
const _fm = new THREE.Vector3();
const _fa = new THREE.Vector3();
const _fp = new THREE.Vector3();
const _ft = new THREE.Vector3();
const _ff = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _fg = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _fmat = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
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
  if (!portraitRenderer || portraitRenderer.getContext().isContextLost())
    portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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
  const fake = {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: Math.PI / 2 - 0.3,
    crouching: false,
    sprinting: false,
    eq: { slots: {}, pockets: { w: 0, h: 0, items: [] } },
    active: 'melee',
    faction: 'npc',
  } as unknown as Actor;
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
  const headBone = (view as unknown as { skinned: THREE.SkinnedMesh }).skinned.skeleton.bones.find((b) =>
    /^head$/i.test(b.name),
  );
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
