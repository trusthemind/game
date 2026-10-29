import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rng, getDef, type Actor, type Corpse, type Equipment } from '@ashfall/engine';
import type { AssetLibrary } from './assets';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import { faceTexture, type FaceSpec } from './facePainter';

// ─────────────────────────────────────────────────────────────────────────────
// Appearance
// ─────────────────────────────────────────────────────────────────────────────

export type HairStyle = 'bald' | 'buzz' | 'short' | 'messy' | 'long' | 'ponytail' | 'bob' | 'bun';
export type TopStyle = 'tee' | 'jacket' | 'hoodie' | 'coat';

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
}

export const SKIN_TONES = [0xf1c8a8, 0xe3b08e, 0xc99069, 0x9a6544, 0x6b4430];
export const HAIR_COLORS = [0x1c1612, 0x3a281b, 0x5b3d25, 0x7c3b21, 0xb08a52, 0x8c8a86, 0xd8cfb8];
const HAIR_M: HairStyle[] = ['bald', 'buzz', 'short', 'short', 'messy', 'messy'];
const HAIR_F: HairStyle[] = ['long', 'ponytail', 'bob', 'bun', 'long', 'ponytail'];

const DRAB_TOPS = [0x4f553a, 0x5a4632, 0x55595b, 0x2b3346, 0x6b5b45, 0x3d4a3a, 0x7a6a50, 0x4a3b3b];
const DRAB_PANTS = [0x3a4558, 0x2e3324, 0x45403a, 0x2b2b2e, 0x524634];

/** Deterministic look per actor so the same bot looks the same every frame / reload. */
export function lookFor(seed: number, archetype: string, npcId?: string): Appearance {
  if (npcId && NPC_LOOKS[npcId]) return NPC_LOOKS[npcId]!;
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
  switch (archetype) {
    case 'raider':
    case 'guard':
      return { ...base, top: rng.pick([0x2a2d2f, 0x3a3a2c, 0x23272b, 0x4a4936]), pants: rng.pick([0x2a2d2f, 0x3d3c30]), topStyle: 'jacket', gloves: 0x1a1a1a, boots: 0x1a1816 };
    case 'boss':
      return { ...base, top: 0x3b2622, topStyle: 'coat', pants: 0x1f1f22, beard: true, hair: 'buzz', gloves: 0x1a1a1a };
    case 'infected':
      return { ...base, zombie: true, skin: rng.pick([0x8c9a7a, 0x7d8b6c, 0x9aa088, 0x6f7a62]), top: rng.pick(DRAB_TOPS) & 0x7f7f7f, pants: rng.pick(DRAB_PANTS) & 0x7f7f7f };
    default:
      return base;
  }
}

/** The player's own survivor: persisted body/hair choices + a practical scavenger outfit. */
export function playerAppearance(look: { sex: 'm' | 'f'; skin: number; hair: string; hairColor: number; beard: boolean }): Appearance {
  return { ...look, hair: look.hair as HairStyle, top: 0x4b5138, topStyle: 'jacket', pants: 0x3a3a30, boots: 0x2a2420, gloves: 0x2b2722, eyes: 0x4a3020, age: 1 };
}

const NPC_LOOKS: Record<string, Appearance> = {
  lena: { sex: 'f', skin: 0xf1c8a8, hair: 'ponytail', hairColor: 0x7c3b21, beard: false, top: 0xd8dcd4, topStyle: 'coat', pants: 0x2f4f5a, boots: 0x2a2420, gloves: null, eyes: 0x4f6a3a, age: 0 },
  mykola: { sex: 'm', skin: 0xe3b08e, hair: 'short', hairColor: 0x8c8a86, beard: true, top: 0xb5622e, topStyle: 'jacket', pants: 0x3a4558, boots: 0x3b2f24, gloves: 0x5a4632, eyes: 0x3a5a7a, age: 2 },
  vera: { sex: 'f', skin: 0xe3b08e, hair: 'bob', hairColor: 0x1c1612, beard: false, top: 0x4a2f55, topStyle: 'coat', pants: 0x1f1f22, boots: 0x1e1e1e, gloves: null, eyes: 0x2a1d14, age: 1 },
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

function analyseRig(meshes: THREE.SkinnedMesh[]): RigInfo {
  const boxes = { head: new THREE.Box3(), chest: new THREE.Box3(), hips: new THREE.Box3(), handR: new THREE.Box3(), handL: new THREE.Box3() };
  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const mesh of meshes) {
    analyseMesh(mesh, boxes);
    geometries.set(mesh.name, mesh.geometry);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Hair & gear geometry (authored in bind space, parented to bones)
// ─────────────────────────────────────────────────────────────────────────────

function capGeometry(box: THREE.Box3, coverage: number, inflate: number): THREE.BufferGeometry {
  const s = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const g = new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI * coverage);
  g.rotateX(-0.2);
  g.scale(s.x * inflate, s.y * inflate * 1.02, s.z * inflate);
  g.translate(c.x, c.y + s.y * 0.06, c.z - s.z * 0.04);
  return g;
}

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
  dead = false;
  private hidden = false;

  constructor(
    private lib: AssetLibrary,
    readonly look: Appearance,
    private u: WorldUniforms,
    shadows: boolean,
  ) {
    const src = look.sex === 'f' && lib.characterF ? lib.characterF.scene : lib.character.scene;
    this.model = SkeletonUtils.clone(src);
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(o as THREE.SkinnedMesh);
    });
    if (!skinnedMeshes.length) throw new Error('character.glb has no skinned mesh');
    // The body is the mesh with the most vertices (the other is the joint rings).
    skinnedMeshes.sort((a, b) => b.geometry.attributes.position!.count - a.geometry.attributes.position!.count);
    this.skinned = skinnedMeshes[0]!;
    if (!rigInfos.has(src)) rigInfos.set(src, analyseRig(skinnedMeshes));
    this.rig = rigInfos.get(src)!;
    this.bodyMeshes = skinnedMeshes;
    for (const m of skinnedMeshes) {
      m.material = bodyMaterial(look, u);
      m.castShadow = shadows;
      m.frustumCulled = false;
    }
    this.model.scale.setScalar(CHAR_SCALE);
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
    const hairMat = flatMat(a.hairColor, { rough: 0.9, side: true }, this.u);
    for (const g of hairGeometry(a.hair, rig.boxes.head)) {
      const m = new THREE.Mesh(g, hairMat);
      m.castShadow = shadows;
      attachToBone(this.skinned, head, m);
    }
    for (const m of earParts(rig.boxes.head, a, this.u)) attachToBone(this.skinned, head, m);
    if (a.topStyle === 'hoodie' || a.topStyle === 'coat') {
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
    const key = `${s.helmet?.def}|${s.armor?.def}|${s.backpack?.def}|${s.rig?.def}|${held?.def}`;
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
    const classColor = (cls: number) => [0x555555, 0x5a5a48, 0x4f5640, 0x3d4436, 0x2f3a2c, 0x262b2d, 0x1d2022][cls] ?? 0x333333;

    if (s.helmet) {
      const cls = getDef(s.helmet.def).armor!.armorClass;
      const g = capGeometry(rig.boxes.head, cls >= 5 ? 0.62 : 0.5, 1.22);
      const m = new THREE.Mesh(g, flatMat(classColor(cls), { rough: 0.5, metal: 0.3 }, this.u));
      m.castShadow = true;
      add(/^head$/i, m);
      if (cls >= 5) {
        // Visor.
        const c = rig.boxes.head.getCenter(new THREE.Vector3());
        const sz = rig.boxes.head.getSize(new THREE.Vector3());
        const v = new THREE.BoxGeometry(sz.x * 0.95, sz.y * 0.32, sz.z * 0.12);
        v.translate(c.x, c.y + sz.y * 0.05, c.z + sz.z * 0.55);
        add(/^head$/i, new THREE.Mesh(v, flatMat(0x1a2024, { rough: 0.2, metal: 0.6 }, this.u)));
      }
    }
    if (s.armor) {
      const cls = getDef(s.armor.def).armor!.armorClass;
      const c = rig.boxes.chest.getCenter(new THREE.Vector3());
      const sz = rig.boxes.chest.getSize(new THREE.Vector3());
      const vest = new THREE.BoxGeometry(sz.x * 0.86, sz.y * 0.95, sz.z * 1.18, 1, 1, 1);
      vest.translate(c.x, c.y - sz.y * 0.05, c.z);
      const m = new THREE.Mesh(vest, flatMat(classColor(cls), { rough: 0.85 }, this.u));
      m.castShadow = true;
      add(/^spine_03$/, m);
    }
    if (s.rig) {
      const c = rig.boxes.chest.getCenter(new THREE.Vector3());
      const sz = rig.boxes.chest.getSize(new THREE.Vector3());
      for (let i = -1; i <= 1; i++) {
        const p = new THREE.BoxGeometry(sz.x * 0.2, sz.y * 0.26, sz.z * 0.22);
        p.translate(c.x + i * sz.x * 0.24, c.y - sz.y * 0.28, c.z + sz.z * 0.66);
        add(/^spine_03$/, new THREE.Mesh(p, flatMat(0x3d3a2c, { rough: 0.9 }, this.u)));
      }
    }
    if (s.backpack) {
      const src = this.lib.props.get('backpack');
      if (src) {
        const d = getDef(s.backpack.def);
        const bp = src.clone();
        const c = rig.boxes.chest.getCenter(new THREE.Vector3());
        const sz = rig.boxes.chest.getSize(new THREE.Vector3());
        const k = (0.65 + d.w * 0.1) * (sz.y / 0.5);
        bp.scale.setScalar(k);
        bp.rotation.y = Math.PI;
        bp.position.set(c.x, c.y - sz.y * 0.1, c.z - sz.z * 0.5 - 0.12 * k);
        add(/^spine_03$/, bp);
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
        this.held = src.clone();
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
    if (!this.hidden) this.mixer.update(dt);
    this.placeHeld(a);
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

  toCorpse(c: Corpse): void {
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
    this.oneShotT = Infinity;
    for (const m of this.bodyMeshes) m.material = bodyMaterial(this.look, this.u, true);
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

export function disposeCharacterCaches(): void {
  for (const m of bodyMatCache.values()) m.dispose();
  for (const m of flatMatCache.values()) m.dispose();
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
