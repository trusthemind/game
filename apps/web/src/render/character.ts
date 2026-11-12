import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CLOTHING_SLOTS, Rng, getDef, type Actor, type ClothingSlot, type Corpse, type Equipment, type ItemInstance } from '@ashfall/engine';
import { bodySettled, loadBodies, type AssetLibrary } from './assets';
import { patchWorldMaterial, type WorldUniforms } from './patches';
import { faceTexture, type FaceSpec } from './facePainter';
import { buildGun, gunKey } from './gunsmith';
import { armorModel, BACKPACK_TINT, hatModel, helmetModel, rigModel, slingModel } from './gear3d';
import { bakeRigid } from './bakeRigid';
import { CLOTH_KIT, DEFAULT_OUTFITS, type KitPiece } from './clothKit';
import { ARMOR_KIT, armorSources, holdToSpine, layerOver, type ArmorKit } from './armorKit';
import { HEAVY_MELEE, meleeModel, REVERSE_GRIP } from './melee3d';
import { ARMOR_SPECS, details, RIG_SPECS, shellParts, shellShader, type ArmorSpec } from './armorShell';
import { itemModel } from './thumbnails';
import { offscreenRenderer } from './offscreen';
import { GEAR_MODEL, wornGear } from './gearModels';
import {
  fitHelmet,
  fitPack,
  fitVest,
  helmetLiner,
  measureBody,
  withLayer,
  pressUnder,
  type BodyFit,
  type TorsoField,
} from './gearFit';
import { attachSkinned, cloneHuman, type HumanParts } from './human';
import { heightFactor, shapeKey, shapeMesh, ShapeField, withNeutral, type BodyShape } from './bodyShape';
import { fitToRest, gltfMeshNames, rebindToSkeleton } from './rebind';
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
  /** A rigged character model (models/bodies/<id>.glb) instead of the modelled body + outfit: it brings its
   * own face, clothes and kit, and is rebound onto our skeleton so every animation and attachment works. */
  body?: string;
  /** Dressed from their kit: the hat / top / trousers / boots items they wear (see wearClothes). */
  clothed?: boolean;
  /** Clothes: real garments from rigged models (see clothKit.ts), fitted to this body. Unset: an outfit picked
   * for the look (kitFor). */
  kit?: Worn[];
  /** Body shape (bodyShape.ts) on our modelled body: unset is the base mesh. */
  shape?: BodyShape;
}
export type Worn = KitPiece & { slot: ClothingSlot; id: string };

export const SKIN_TONES = [0xf1c8a8, 0xe3b08e, 0xc99069, 0x9a6544, 0x6b4430];
export const HAIR_COLORS = [0x1c1612, 0x3a281b, 0x5b3d25, 0x7c3b21, 0xb08a52, 0x8c8a86, 0xd8cfb8];
const HAIR_M: HairStyle[] = ['bald', 'buzz', 'short', 'short', 'messy', 'messy'];
const HAIR_F: HairStyle[] = ['long', 'ponytail', 'bob', 'bun', 'long', 'ponytail'];

const DRAB_TOPS = [0x4f553a, 0x5a4632, 0x55595b, 0x2b3346, 0x6b5b45, 0x3d4a3a, 0x7a6a50, 0x4a3b3b];
const DRAB_PANTS = [0x3a4558, 0x2e3324, 0x45403a, 0x2b2b2e, 0x524634];

/** Deterministic look per actor so the same bot looks the same every frame / reload. */
/** `armored`: whether they go in wearing body armour (see ARMORED_BODIES). */
export function lookFor(seed: number, archetype: string, npcId?: string, bossId?: string, armored = true): Appearance {
  const kit = (ids: string[]) => (armored ? ids : ids.filter((id) => !ARMORED_BODIES.has(id)));
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
      return {
        ...base,
        ...camo(),
        gloves: 0x1a1a1a,
        boots: 0x1a1816,
        // Guards (a boss's own men) wear the heavy kit; raiders anything military.
        body:
          archetype === 'guard'
            ? rng.pick(kit(sex === 'f' ? ['fem_ops', 'fem_police'] : ['swat', 'swat_mc', 'pmc_heavy', 'rus_a']))
            : rng.pick(
                kit(
                  sex === 'f'
                    ? ['fem_w2', 'fem_ops', 'fem_jacket']
                    : ['pmc_a', 'fsb', 'pmc_heavy', 'swat_mc', 'ukr_a', 'ukr_b', 'rus_a'],
                ),
              ),
      };
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
    default: {
      // Some scavengers wear a whole rigged model: women more often, there are more civilian ones of those.
      const c: Appearance = { ...base, ...civ() };
      if (archetype === 'scav' && rng.chance(sex === 'f' ? 0.6 : 0.3))
        c.body = rng.pick(kit(sex === 'f' ? ['fem_jacket', 'fem_leather', 'fem_police', 'fem_w2'] : ['ukr_b', 'rus_a', 'pmc_a']));
      return c;
    }
  }
}

/** Per rigged body: see CharacterView.torsoPad. */
const TORSO_PAD = new Map<string, number>();
/** Per body as dressed (sex, rigged body, clothes): its measured torso and head (gearFit.ts). */
const BODY_FIT = new Map<string, BodyFit | null>();
/** Helmet liners (padding under every helmet), per colour. */
const LINER_FIT = new Map<string, THREE.BufferGeometry>();
const LINER_MAT = new Map<number, THREE.MeshStandardMaterial>();
const STRAP_MAT = new Map<string, THREE.MeshStandardMaterial>();
let webbing: THREE.Texture | null = null;

/** Webbing, grey (the material's colour tints it): ribs along the strap, a darker selvedge, a stitch line inside
 * each edge. u runs across the strap, v along it (one tile per strap width). */
function webbingTex(): THREE.Texture {
  if (webbing) return webbing;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 32; x++) {
    const rib = x % 2 ? 214 : 236;
    const edge = x < 2 || x > 29 ? 0.72 : 1;
    g.fillStyle = `rgb(${rib * edge},${rib * edge},${rib * edge})`;
    g.fillRect(x, 0, 1, 32);
  }
  g.fillStyle = 'rgb(150,150,150)';
  for (let y = 0; y < 32; y += 8) {
    g.fillRect(4, y, 1, 5);
    g.fillRect(27, y, 1, 5);
  }
  webbing = new THREE.CanvasTexture(c);
  webbing.wrapS = webbing.wrapT = THREE.RepeatWrapping;
  webbing.colorSpace = THREE.SRGBColorSpace;
  webbing.anisotropy = 4;
  return webbing;
}

/** The colour a pack mostly shows: its materials' colours times their textures' average, by triangle count. */
function dominantColour(obj: THREE.Object3D): THREE.Color {
  const sum = new THREE.Color(0, 0, 0);
  let n = 0;
  const avg = new Map<unknown, THREE.Color>();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d', { willReadFrequently: true });
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const tris = (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      const c = std.color ? std.color.clone() : new THREE.Color(1, 1, 1);
      const img = std.map?.image as CanvasImageSource | undefined;
      if (img && g) {
        let a = avg.get(img);
        if (!a) {
          a = new THREE.Color(1, 1, 1);
          try {
            g.clearRect(0, 0, 16, 16);
            g.drawImage(img, 0, 0, 16, 16);
            const d = g.getImageData(0, 0, 16, 16).data;
            let r = 0;
            let gg = 0;
            let b = 0;
            for (let i = 0; i < d.length; i += 4) {
              r += d[i]!;
              gg += d[i + 1]!;
              b += d[i + 2]!;
            }
            const px = d.length / 4;
            a.setRGB(r / px / 255, gg / px / 255, b / px / 255, THREE.SRGBColorSpace);
          } catch {
            /* unreadable: the colour alone */
          }
          avg.set(img, a);
        }
        c.multiply(a);
      }
      sum.r += c.r * tris;
      sum.g += c.g * tris;
      sum.b += c.b * tris;
      n += tris;
    }
  });
  return n ? sum.multiplyScalar(1 / n) : new THREE.Color(0x57533f);
}

/** A pack's strap material: webbing in the pack's dominant colour (or its paint), a shade darker, matt. */
function strapMat(pack: THREE.Object3D, paint: number | undefined): THREE.MeshStandardMaterial {
  const col = paint !== undefined ? new THREE.Color(paint) : dominantColour(pack);
  col.multiplyScalar(0.72);
  const key = col.getHexString();
  let m = STRAP_MAT.get(key);
  if (!m)
    STRAP_MAT.set(
      key,
      (m = new THREE.MeshStandardMaterial({
        color: col,
        map: webbingTex(),
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
      })),
    );
  return m;
}
/** Vests and rigs already wrapped onto a body: per measured body, item and what is under it. */
const VEST_FIT = new Map<string, { geos: THREE.BufferGeometry[]; over: TorsoField }>();
/** Armour and rigs from the kit (armorKit.ts) laid over a body: per measured body, item and what is under it. */
const ARMOR_FIT = new Map<string, { geos: THREE.BufferGeometry[]; over: TorsoField }>();

/**
 * Kit a rigged body comes modelled with, matched on "<body> <glTF mesh> <material>". Armour, helmets, goggles and
 * pouches are items: they show only when worn, drawn by syncGear, so the model's own are always hidden (the
 * soldiers' "Hats" are helmets). A cap comes off under a helmet.
 */
const SF_KIT = /helmet|headgear|night_vis|plate|armors|pouch|puches|^(ukr_a|ukr_b|rus_a) hats_/i;
const SF_HAT = / (hats|cap)_/i;
/**
 * Bodies whose armour is part of the jacket (one mesh, one texture), so it can't come off: only someone actually
 * wearing a carrier gets one of these.
 */
export const ARMORED_BODIES = new Set(['ukr_a', 'ukr_b', 'rus_a', 'fem_ops', 'swat_mc']);
function kitVisibility(meshes: THREE.SkinnedMesh[], helmet: boolean): void {
  for (const m of meshes) {
    const part = String(m.userData.part ?? '');
    m.visible = !SF_KIT.test(part) && !(helmet && SF_HAT.test(part));
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
    clothed: true,
  };
}

/** Nothing in a slot: the body's own painted base layer in these colours (a vest, plain trousers, shoes). */
const BARE = { top: 0x5a5a52, pants: 0x3a3a38, boots: 0x2a2420 } as const;

const worn = (id: string): Worn | null => {
  const piece = CLOTH_KIT[id];
  const slot = getDef(id).clothing?.slot;
  return piece && slot ? { ...piece, slot, id } : null;
};

/** The look someone's clothes give them: the hat / top / trousers / boots items they wear (see clothKit.ts). */
export function wearClothes(look: Appearance, eq: Equipment | null): Appearance {
  const kit = CLOTHING_SLOTS.map((s) => eq?.slots[s]).flatMap((it) => (it ? (worn(it.def) ?? []) : []));
  const color = (slot: ClothingSlot, bare: number) => {
    const it = eq?.slots[slot];
    return it ? (getDef(it.def).clothing?.color ?? bare) : bare;
  };
  const top = kit.find((k) => k.slot === 'top');
  return {
    ...look,
    body: undefined,
    clothed: true,
    kit,
    top: color('top', BARE.top),
    // The painted body's forearms: skin under short sleeves (or none), cloth under long ones (hidden anyway).
    topStyle: !top || top.short ? 'tee' : 'jacket',
    topPattern: 'plain',
    pants: color('pants', BARE.pants),
    boots: color('boots', BARE.boots),
    hat: null,
  };
}

/** Unset kit (an outfit picked for the look) differs from an empty one (nothing worn). */
const clothesKey = (a: Appearance) => (a.kit ? a.kit.map((k) => k.id).join('|') : '*');

/** What a look wears: its kit, or for a look not dressed from items, an outfit picked by its colours. */
export function kitFor(look: Appearance): Worn[] {
  if (look.kit) return look.kit;
  const h = Math.abs((look.top * 31 + look.pants * 17 + look.skin) | 0);
  return DEFAULT_OUTFITS[h % DEFAULT_OUTFITS.length]!.flatMap((id) => worn(id) ?? []);
}

/** Fog-of-war uniforms that switch it off: clothing pictures are drawn outside the world. */
const NO_FOW: WorldUniforms = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return { uFow: { value: t }, uMapSize: { value: new THREE.Vector2(1, 1) }, uPlayer: { value: new THREE.Vector3(0, -100, 0) }, uFowOn: { value: 0 } };
})();

let iconBody: HumanParts | null = null;
/**
 * A clothing item on its own, for its picture: the real garment fitted to the male body, in the rest pose (arms
 * out). Null until the model it comes from has loaded (see clothingSource).
 */
export function clothingModel(lib: AssetLibrary, defId: string): THREE.Object3D | null {
  const w = worn(defId);
  const g = w && lib.bodies.get(w.body);
  if (!w || !g) return null;
  iconBody ??= cloneHuman(lib, 'm');
  if (!iconBody) return null;
  iconBody.model.updateMatrixWorld(true);
  const re = new RegExp(w.part, 'i');
  const out = new THREE.Group();
  for (const m of fitToRest(g.scene, gltfMeshNames(g as never), g.animations[0], iconBody.model, iconBody.body.skeleton.bones, (mt) => worldMat(mt as THREE.MeshStandardMaterial, NO_FOW, null), (n) => re.test(n), `${w.body}|${w.part}|icon`)) {
    m.parent?.remove(m);
    out.add(new THREE.Mesh(m.geometry, m.material));
  }
  return out;
}

/**
 * Body armour or a rig on its own, for its picture: the soldier's pieces (armorKit.ts) fitted to the male body at
 * rest. Null when the item has none, or until every model they come from has loaded (see kitSources).
 */
export function armorKitModel(lib: AssetLibrary, defId: string): THREE.Object3D | null {
  const kit = ARMOR_KIT[defId];
  if (!kit || kit.pieces.some((p) => !lib.bodies.get(p.body))) return null;
  iconBody ??= cloneHuman(lib, 'm');
  if (!iconBody) return null;
  iconBody.model.updateMatrixWorld(true);
  const out = new THREE.Group();
  for (const p of kit.pieces) {
    const g = lib.bodies.get(p.body)!;
    const re = new RegExp(p.part, 'i');
    for (const m of fitToRest(g.scene, gltfMeshNames(g as never), g.animations[0], iconBody.model, iconBody.body.skeleton.bones, (mt) => worldMat(mt as THREE.MeshStandardMaterial, NO_FOW, null), (n) => re.test(n), `${p.body}|${p.part}|icon`)) {
      m.parent?.remove(m);
      out.add(new THREE.Mesh(m.geometry, m.material));
    }
  }
  return out.children.length ? out : null;
}

/** The rigged model a clothing item's garment comes from. */
export const clothingSource = (defId: string): string | null => CLOTH_KIT[defId]?.body ?? null;
/** Every rigged model an item worn from the kit comes from: a garment's, or an armour's or rig's pieces'. */
export const kitSources = (defId: string): string[] => (CLOTH_KIT[defId] ? [CLOTH_KIT[defId]!.body] : armorSources(defId));

/** Every rigged model a look needs loaded: its whole body, or the ones its clothes come from. */
export function lookBodies(look: Appearance): string[] {
  if (look.body) return [look.body];
  return [...new Set(kitFor(look).map((k) => k.body))];
}

/** Someone wearing clothes from their kit is drawn in them (and in our own body, not a rigged model). */
export function actorLook(look: Appearance, eq: Equipment | null): Appearance {
  return look.clothed || CLOTHING_SLOTS.some((s) => eq?.slots[s]) ? wearClothes(look, eq) : look;
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
    body: 'fem_jacket',
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
    body: 'pmc_a',
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
    body: 'fem_leather',
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
    body: 'ukr_a',
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
    body: 'fem_ops',
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
    body: 'ukr_b',
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
  /** The crown and back of the head: skin, but under a balaclava (only humanBodyMaterial; 7 is unused). */
  Scalp = 8,
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
    markNape(mesh);
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

/**
 * How far the skin at the back of the neck sinks under a top's collar (aNape, 0..1: fully up to 60% of the neck,
 * none from four fifths of the way up, fading out to the sides): in some poses it would poke through the collar,
 * and cut away it would leave a hole wherever the collar stands off the neck. Also the head's own regions (Scalp).
 */
function markNape(mesh: THREE.SkinnedMesh): void {
  const bones = mesh.skeleton.bones;
  const ni = bones.findIndex((b) => /^neck_01$/i.test(b.name));
  const hi = bones.findIndex((b) => /^head$/i.test(b.name));
  const reg = mesh.geometry.attributes.aRegion;
  const pos = mesh.geometry.attributes.position!;
  const nape = new Float32Array(pos.count);
  mesh.geometry.setAttribute('aNape', new THREE.BufferAttribute(nape, 1));
  if (ni < 0 || hi < 0 || !reg) return;
  const at = (i: number) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i]!.clone().invert());
  const neck = at(ni);
  const head = at(hi);
  const len = head.y - neck.y;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (reg.getX(i) !== Region.Skin || y > neck.y + len * 0.8 || z > neck.z) continue;
    const up = THREE.MathUtils.smoothstep(neck.y + len * 0.8 - y, 0, len * 0.2);
    const back = THREE.MathUtils.smoothstep(neck.z - z, 0, len * 0.15);
    nape[i] = up * back;
  }
  // The scalp: head skin above the brows, or behind the ears. A balaclava's crown can sit lower than a tall head's.
  let crown = -Infinity;
  let back = Infinity;
  for (let i = 0; i < pos.count; i++)
    if (reg.getX(i) === Region.Skin && pos.getY(i) > head.y) (crown = Math.max(crown, pos.getY(i))), (back = Math.min(back, pos.getZ(i)));
  if (!(crown > head.y)) return;
  const brow = head.y + (crown - head.y) * 0.62;
  const behind = head.z - (head.z - back) * 0.3;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (reg.getX(i) !== Region.Skin || y < head.y - (head.y - neck.y) * 0.3) continue;
    if (y > brow || pos.getZ(i) < behind) reg.setX(i, Region.Scalp);
  }
  reg.needsUpdate = true;
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
          if (ri != 0 && ri < 7) pc *= 0.9 + n * 0.14;
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
  const key = `${src.uuid}|${JSON.stringify(a)}|${dead}|${clothed}|${clothed ? kitFor(a).map((k) => k.id).join('|') : ''}`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  m.userData.src = src;
  m.roughness = 0.75;
  const pal = palette(a, dead);
  pal.push(pal[0]!, pal[0]!);
  const tint = new THREE.Color(a.skin);
  tint.r /= TEX_SKIN.r;
  tint.g /= TEX_SKIN.g;
  tint.b /= TEX_SKIN.b;
  if (dead) tint.multiplyScalar(0.7);
  const skinMask = [1, a.gloves === null ? 1 : 0, 0, a.topStyle === 'tee' ? 1 : 0, 0, 0, 0, 1, 1];
  // Under real clothes (clothKit) the body isn't drawn: what it would show is inside them. Head, neck and hands
  // always show, forearms under short sleeves, and any part with no garment on it (the painted base layer).
  const on = (slot: ClothingSlot) => clothed && kitFor(a).some((k) => k.slot === slot);
  const top = kitFor(a).find((k) => k.slot === 'top');
  const hide = [0, 0, on('top') ? 1 : 0, on('top') && !top?.short ? 1 : 0, on('pants') ? 1 : 0, on('boots') ? 1 : 0, 0, 0, kitFor(a).some((k) => k.slot === 'hat' && k.underHelmet) && clothed ? 1 : 0];
  patchWorldMaterial(m, u, {
    pre: (shader) => {
      shader.uniforms.uHide = { value: hide };
      // The back of the neck sinks forward under a collar (along its normals it would open at the UV seam there).
      shader.uniforms.uNapeIn = { value: on('top') ? 0.025 : 0 };
      shader.uniforms.uPal = { value: pal };
      shader.uniforms.uSkinTint = { value: tint };
      shader.uniforms.uSkinMask = { value: skinMask };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aRegion;\nattribute float aNape;\nuniform float uNapeIn;\nvarying float vRegion;\nvarying vec3 vObjPos;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvRegion = aRegion;\nvObjPos = position;\ntransformed.z += uNapeIn * aNape;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uPal[9];\nuniform vec3 uSkinTint;\nuniform float uSkinMask[9];\nuniform float uHide[9];\nvarying float vRegion;\nvarying vec3 vObjPos;',
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          int ri = int(vRegion + 0.5);
          for (int i = 0; i < 9; i++) if (i == ri && uHide[i] > 0.5) discard;
          float skin = 0.0;
          vec3 cloth = uPal[0];
          for (int i = 0; i < 9; i++) if (i == ri) { skin = uSkinMask[i]; cloth = uPal[i]; }
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

/**
 * A worn garment's material: as its model has it, but matte. Some are glossy (a leather jacket's roughness map
 * reads about 0.5), and under the raid's sky light a glossy shoulder panel moulded on the source's own muscular
 * back read as bare skin.
 */
function clothMat(src: THREE.MeshStandardMaterial, u: WorldUniforms): THREE.MeshStandardMaterial {
  const key = `${src.uuid}|cloth`;
  let m = humanMatCache.get(key);
  if (m) return m;
  m = src.clone();
  if (m.roughnessMap) {
    m.roughnessMap = null;
    m.roughness = 0.85;
  } else m.roughness = Math.max(m.roughness, 0.85);
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
/** Rebound body (id|sex) → how far it's raised to stand on its soles (CharacterView.soleLift). */
const SOLE_LIFT = new Map<string, { lift: number; hip: number }>();

/** Bones whose position the clips may set on a rebound body (everything else keeps the body's own proportions). */
const MOVING = /^(root|pelvis)\.position$/;

/**
 * One layer of a clip. `ownProportions`: a rebound body (rigged model on our skeleton) has its own bone lengths,
 * so the clip's per-bone position keys (authored for our mannequin) are dropped and only rotations drive it.
 */
function layerClip(lib: AssetLibrary, name: string, layer: 'upper' | 'lower' | 'full', ownProportions = false): THREE.AnimationClip | null {
  const key = `${name}:${layer}:${ownProportions ? 1 : 0}`;
  const hit = filtered.get(key);
  if (hit) return hit;
  const src = lib.clips.get(name);
  if (!src) return null;
  if (layer === 'full' && !ownProportions) return src;
  const re = layer === 'upper' ? UPPER : layer === 'lower' ? LOWER : /./;
  const clip = new THREE.AnimationClip(
    `${name}_${layer}${ownProportions ? '_own' : ''}`,
    src.duration,
    src.tracks.filter((t) => re.test(t.name) && (!ownProportions || !t.name.endsWith('.position') || MOVING.test(t.name))),
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
const _curlQ = new THREE.Quaternion();
const _curlZ = new THREE.Vector3(0, 0, 1);
/**
 * How far each joint of a finger bends (radians, root to tip) round what the hand holds: a pistol grip or a
 * handguard; the trigger finger lies straighter along the guard. Finger bones point along their local Y and bend
 * towards the palm about their local +Z (on both hands).
 */
const GRIP_CURL = [1.0, 1.05, 0.7];
const TRIGGER_CURL = [0.35, 0.45, 0.3];
const WRAP_CURL = [0.75, 0.8, 0.5];
const CURLED = ['index', 'middle', 'ring', 'pinky'] as const;
const _ikT = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
/** The butt's place from the right shoulder joint, in the character's frame (forward +Z, left +X): in towards the
 * chest, a touch forward, and the bore up at the cheek. */
const SHOULDER_POCKET = new THREE.Vector3(0.0, 0.02, 0.06);
/** A pistol's grip held up, from the right shoulder joint: forward, in towards the middle, a touch low. */
const PISTOL_AIM = new THREE.Vector3(0.15, -0.06, 0.46);
/** A long gun carried at low ready: muzzle pitched down, turned in across the body (radians). */
const LOW_READY = new THREE.Euler(0.65, 0.3, 0);
const _hs = new THREE.Vector3();
const _hb = new THREE.Vector3();
const _hg = new THREE.Vector3();
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
  /** Wearing a rigged model's own clothes and face (no hair, hats or outfit pieces of ours). */
  private sfBody = false;
  /** That model's own meshes (see SF_KIT: its helmet, plates and pouches only show as items we draw). */
  private sfMeshes: THREE.SkinnedMesh[] = [];
  /** How much bulkier that model's torso is than the body armour shells are cut from (metres): see torsoPad. */
  private shellPad = 0;
  /** Our body's bones as they stand at rest (local transforms), to fit clothes and armour to whatever the pose. */
  private restPose: [THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  /** A rebound body's lift onto its soles (soleLift), scaled each frame by the pelvis height. */
  private stand: { lift: number; hip: number; pelvis: THREE.Bone } | null = null;
  /** Calling in an extraction on the radio (standing still in the zone while its timer runs). */
  extracting = false;
  dead = false;
  private hidden = false;
  /** The body shape's displacement field (bodyShape.ts), built at rest on first use. */
  private shapeField: ShapeField | null = null;

  constructor(
    private lib: AssetLibrary,
    public look: Appearance,
    private u: WorldUniforms,
    private shadows: boolean,
  ) {
    // Modelled humans (faces, eyes, real hair) when the pack is present; the mannequin otherwise.
    const human = cloneHuman(lib, look.sex);
    this.human = human;
    if (human) this.restPose = human.body.skeleton.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
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
    const sfBody = human && look.body ? (lib.bodies.get(look.body) ?? null) : null;
    let rebound: THREE.SkinnedMesh[] = [];
    this.sfBody = !!sfBody;
    // Our own bodies wear real clothes (clothKit); a rigged model wears its own.
    const outfit = human && !sfBody;
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
      this.model.scale.setScalar(bindK * (outfit ? heightFactor(look.shape) : 1));
      if (outfit) this.wearKit(kitFor(look));
      if (sfBody) {
        for (const m of [human.body, human.eyes, human.brows]) if (m) m.visible = false;
        ({ meshes: rebound } = rebindToSkeleton(sfBody.scene, sfBody.animations[0], this.model, human.body.skeleton.bones, (m) => worldMat(m as THREE.MeshStandardMaterial, u, null), `${look.body}|${look.sex}`));
        for (const m of rebound) m.castShadow = shadows;
        // Name each piece by its glTF mesh too: the nodes are just Object_N, and some exports share one material
        // between a hat, a mask and gloves.
        const meshName = new Map<string, string>();
        sfBody.scene.traverse((o) => {
          const i = sfBody.parser.associations.get(o)?.meshes;
          if (i !== undefined) meshName.set(o.name, String(sfBody.parser.json.meshes[i]?.name ?? ''));
        });
        for (const m of rebound) m.userData.part = `${look.body} ${meshName.get(m.name) ?? ''} ${m.userData.part ?? ''}`;
        this.sfMeshes = rebound;
        kitVisibility(rebound, false);
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
    this.applyShape();
    this.root.add(this.gear);
    this.setLower('Idle_Loop', 1, 'full');
    const pelvis = this.skinned.skeleton.getBoneByName('pelvis');
    if (rebound.length && pelvis) this.stand = { ...this.soleLift(`${look.body}|${look.sex}`, rebound, pelvis), pelvis };
    if (rebound.length && human) this.shellPad = this.torsoPad(`${look.body}|${look.sex}`, human.body, rebound);
  }

  /**
   * How far to raise a rebound body so its soles rest on the ground standing idle (the clips keep the mannequin's
   * pelvis height, and these bodies have longer legs, so they would stand ankle-deep), and the pelvis's height in
   * that pose. Measured once per body.
   */
  private soleLift(key: string, meshes: THREE.SkinnedMesh[], pelvis: THREE.Bone): { lift: number; hip: number } {
    let s = SOLE_LIFT.get(key);
    if (s) return s;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    let low = Infinity;
    const v = new THREE.Vector3();
    for (const m of meshes)
      for (let i = 0, n = m.geometry.attributes.position!.count; i < n; i++) low = Math.min(low, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y);
    s = { lift: Number.isFinite(low) ? -low : 0, hip: pelvis.position.length() };
    SOLE_LIFT.set(key, s);
    return s;
  }

  /**
   * A rigged model's jacket and webbing stand out further than the bare body that armour shells are cut from, so
   * a carrier cut to the body would sit inside them. Compare the two torsos (waist to chest, all round, only
   * vertices that follow the spine, so arms held in front don't count) and return the difference. Once per body.
   */
  private torsoPad(key: string, body: THREE.SkinnedMesh, worn: THREE.SkinnedMesh[]): number {
    const hit = TORSO_PAD.get(key);
    if (hit !== undefined) return hit;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const sk = body.skeleton;
    const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(sk.getBoneByName(n)?.matrixWorld ?? new THREE.Matrix4());
    const s2 = at('spine_02');
    const s3 = at('spine_03');
    const neck = at('neck_01');
    // Waist to chest: everything a carrier covers.
    const y0 = at('spine_01').y;
    const y1 = s3.y + (neck.y - s3.y) * 0.3;
    const torso = new Set(sk.bones.map((b, i) => (/^spine_0[123]$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    // Furthest reach from the spine in 16 directions round the chest.
    const reach = (meshes: THREE.SkinnedMesh[]) => {
      const r = new Float32Array(16);
      const v = new THREE.Vector3();
      for (const m of meshes) {
        if (!m.visible && m !== body) continue;
        const si = m.geometry.attributes.skinIndex!;
        const sw = m.geometry.attributes.skinWeight!;
        for (let i = 0, n = m.geometry.attributes.position!.count; i < n; i++) {
          let best = 0;
          for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, best)) best = c;
          if (!torso.has(si.getComponent(i, best))) continue;
          m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
          if (v.y < y0 || v.y > y1) continue;
          const dx = v.x - s2.x;
          const dz = v.z - s2.z;
          const a = Math.floor(((Math.atan2(dz, dx) / (2 * Math.PI) + 1) % 1) * 16);
          r[a] = Math.max(r[a]!, Math.hypot(dx, dz));
        }
      }
      return r;
    };
    const bare = reach([body]);
    const dressed = reach(worn);
    // Ignore the two or three furthest directions: an open collar or a pocket flap shouldn't decide it.
    const diff = Array.from(dressed, (d, i) => d - bare[i]!).sort((a, b) => a - b);
    const k = this.model.scale.y;
    const pad = Math.min(0.14, Math.max(0, diff[14]!) / k);
    TORSO_PAD.set(key, pad);
    return pad;
  }

  /** What this body is and wears, as far as fitting gear to it goes. */
  private fitKey(): string {
    return `${this.look.sex}|${this.look.body ?? ''}|${clothesKey(this.look)}|${this.outfitMeshes.length}`;
  }

  /** This body measured as it is dressed (gearFit.ts), once per body and set of clothes; null for the mannequin. */
  private bodyFit(): BodyFit | null {
    const human = this.human;
    if (!human) return null;
    const key = this.fitKey();
    let fit = BODY_FIT.get(key);
    if (fit === undefined) {
      const slot = (m: THREE.SkinnedMesh) => (m.userData.worn as Worn | undefined)?.slot;
      // A rigged body stands in for ours whole, less the kit it's modelled with (that comes off, see SF_KIT).
      const own = this.sfMeshes.filter((m) => !SF_KIT.test(String(m.userData.part ?? '')) && !SF_HAT.test(String(m.userData.part ?? '')));
      fit = withNeutral([human.body, ...this.outfitMeshes], () => measureBody(
        human.body,
        this.sfBody ? own : this.outfitMeshes.filter((m) => slot(m) !== 'hat'),
        this.sfBody ? [] : this.outfitMeshes.filter((m) => slot(m) === 'hat' && (m.userData.worn as Worn).underHelmet),
        human.eyes,
        !this.sfBody,
      ));
      BODY_FIT.set(key, fit);
    }
    return fit;
  }

  private bone(re: RegExp): string {
    return this.skinned.skeleton.bones.find((b) => re.test(b.name))?.name ?? '';
  }

  private buildBody(shadows: boolean): void {
    const rig = this.rig;
    const a = this.look;
    const head = this.bone(/^head$/i);
    if (this.sfBody) return;
    if (this.human) {
      const clothed = this.outfitMeshes.length > 0;
      this.buildHair();
      const hm = hairMaterialFor(this.lib, a.zombie ? 0x3a3530 : a.hairColor, this.u);
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

  /** Real clothes from rigged models (see fitToRest), on our own body: it shows only its head and hands. */
  private wearKit(kit: Worn[]): void {
    const human = this.human!;
    for (const w of kit) {
      const { body, part } = w;
      const g = this.lib.bodies.get(body);
      if (!g) continue;
      const re = new RegExp(part, 'i');
      const meshes = fitToRest(
        g.scene,
        gltfMeshNames(g as never),
        g.animations[0],
        this.model,
        human.body.skeleton.bones,
        (m) => clothMat(m as THREE.MeshStandardMaterial, this.u),
        (n) => re.test(n),
        `${body}|${part}|${this.look.sex}`,
      );
      for (const m of meshes) {
        m.castShadow = this.shadows;
        m.userData.worn = w;
        this.outfitMeshes.push(m);
      }
    }
  }

  /**
   * Run `fn` with our skeleton in its rest pose (fitToRest carries pieces onto the bones as they stand, and the
   * clips may have moved them since), then put the pose back.
   */
  private atRest(fn: () => void): void {
    const bones = this.human?.body.skeleton.bones;
    if (!bones || !this.restPose.length) return fn();
    const now = bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    bones.forEach((b, i) => {
      const [p, q, sc] = this.restPose[i]!;
      b.position.copy(p);
      b.quaternion.copy(q);
      b.scale.copy(sc);
    });
    this.model.updateMatrixWorld(true);
    try {
      fn();
    } finally {
      bones.forEach((b, i) => {
        const [p, q, sc] = now[i]!;
        b.position.copy(p);
        b.quaternion.copy(q);
        b.scale.copy(sc);
      });
      this.model.updateMatrixWorld(true);
    }
  }

  /**
   * Real body armour or a chest rig (armorKit.ts): the soldier's own vest, plates or pouches carried onto our body
   * like the clothes, held to the spine, and laid over what is under it (`under`, the dressed torso or that with
   * armour on) a little clear of it. Returns the surface with it on (for what goes over it: a rig, a pack), or
   * null when a model it comes from failed to load.
   */
  private wearArmor(id: string, kit: ArmorKit, measured: BodyFit, under: TorsoField, layer: string): TorsoField | null {
    const human = this.human!;
    const body = human.body;
    const bones = body.skeleton.bones;
    const meshes: THREE.SkinnedMesh[] = [];
    for (const p of kit.pieces) {
      const g = this.lib.bodies.get(p.body);
      if (!g) return null;
      const re = new RegExp(p.part, 'i');
      this.atRest(() =>
        meshes.push(
          ...fitToRest(g.scene, gltfMeshNames(g as never), g.animations[0], this.model, bones, (m) => clothMat(m as THREE.MeshStandardMaterial, this.u), (n) => re.test(n), `${p.body}|${p.part}|${this.look.sex}`),
        ),
      );
    }
    if (!meshes.length) return null;
    const key = `${this.fitKey()}|${id}|${layer}`;
    let hit = ARMOR_FIT.get(key);
    if (!hit) {
      // The pieces' rest space → the body's bind space (the same joint, bound twice: see gearFit.ts bindVerts).
      const j = Math.max(0, bones.findIndex((b) => b.name === 'spine_02'));
      const sk = meshes[0]!.skeleton;
      const toBind = new THREE.Matrix4()
        .copy(body.bindMatrix)
        .invert()
        .multiply(new THREE.Matrix4().copy(body.skeleton.boneInverses[j]!).invert())
        .multiply(sk.boneInverses[j]!)
        .multiply(meshes[0]!.bindMatrix);
      const k = measured.k;
      const geos = meshes.map((m) => layerOver(holdToSpine(m.geometry, bones, kit.caps), toBind, under, (layer ? 0.012 : 0.008) * k, bones, 0.12 * k));
      const inBind = geos.map((g) => g.clone().applyMatrix4(toBind));
      ARMOR_FIT.set(key, (hit = { geos, over: withLayer(under, inBind, 0.03 * k) }));
    }
    meshes.forEach((m, i) => {
      m.geometry = hit.geos[i]!;
      m.userData.rigidShape = true;
      m.castShadow = true;
      this.gearAttachments.push(m);
    });
    return hit.over;
  }

  /** Hair, unless a raised hood covers it. */
  private buildHair(): void {
    const a = this.look;
    const human = this.human!;
    const style = HAIR_MODEL[a.sex][a.hair];
    if (!style || !this.lib.hair.get(style)) return;
    const hm = hairMaterialFor(this.lib, a.zombie ? 0x3a3530 : a.hairColor, this.u);
    const h = attachSkinned(this.lib.hair.get(style)!, human.body, hm);
    h.castShadow = this.shadows;
    this.hairMeshes.push(h);
  }

  /**
   * Change clothes: someone dressed from their kit (look.clothed) put on or took off a piece. The garments, the
   * hair and the body's mask are rebuilt; a garment whose model hasn't loaded yet goes on once it has.
   */
  private redress(eq: Equipment): void {
    if (!this.look.clothed || !this.human || this.sfBody) return;
    const next = wearClothes(this.look, eq);
    if (clothesKey(next) === clothesKey(this.look)) return;
    const missing = lookBodies(next).filter((b) => !bodySettled(this.lib, b));
    if (missing.length) {
      void loadBodies(this.lib, missing).then(() => (this.gearKey = ''));
      return;
    }
    this.look = next;
    for (const m of [...this.outfitMeshes, ...this.hairMeshes]) m.parent?.remove(m);
    this.outfitMeshes = [];
    this.hairMeshes = [];
    this.atRest(() => withNeutral([this.human!.body], () => this.wearKit(kitFor(next))));
    this.buildHair();
    for (const m of this.bodyMeshes) m.material = humanBodyMaterial(this.human.srcMaterial, next, this.u, this.dead, true);
    this.applyShape();
  }

  /**
   * Shape the body and everything skinned to it (clothes, armour, hair) by the look's body shape (bodyShape.ts):
   * all were fitted to the neutral body and take the same displacement, so they keep fitting. Cached per mesh
   * geometry and shape; anything already shaped is left as it is.
   */
  private applyShape(): void {
    const key = shapeKey(this.look.shape);
    if (!this.human || this.sfBody || !key) return;
    this.atRest(() => {
      this.shapeField ??= ShapeField.fromBones(this.human!.body.skeleton.bones, this.model, this.look.shape!, this.look.sex);
      const all: THREE.SkinnedMesh[] = [];
      this.model.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && all.push(o as THREE.SkinnedMesh));
      for (const m of all) shapeMesh(m, this.model, this.shapeField, `${this.look.sex}|${key}`);
    });
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
    const key = `${s.helmet?.def}|${s.armor?.def}|${s.backpack?.def}|${s.rig?.def}|${s.hat?.def}|${s.top?.def}|${s.pants?.def}|${s.boots?.def}|${gunKey(held)}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    this.redress(eq);
    for (const g of this.gearAttachments) g.parent?.remove(g);
    this.gearAttachments = [];
    const rig = this.rig;
    const add = (bone: RegExp, obj: THREE.Object3D) => {
      bakeRigid(obj);
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

    kitVisibility(this.sfMeshes, !!s.helmet);
    // Headwear from the kit: caps come off under a helmet, a balaclava stays on.
    let capOn = false;
    let maskOn = false;
    for (const m of this.outfitMeshes) {
      const w = m.userData.worn as Worn | undefined;
      if (w?.slot !== 'hat') continue;
      m.visible = !s.helmet || !!w.underHelmet;
      if (w.underHelmet) maskOn = true;
      else if (m.visible) capOn = true;
    }
    const hat = !s.helmet && !this.sfBody && !this.human && this.look.hat && !this.look.zombie ? this.look.hat : null;
    // Hats and helmets sit over short hair; long hair stays (it hangs below the rim). A balaclava covers it all.
    for (const h of this.hairMeshes) h.visible = !maskOn && (!(s.helmet || capOn || (hat && hat !== 'bandana')) || /Long/.test(h.name));
    // Brows and a beard are under it too (they'd poke through the knit). Not on a rigged body: our head (and its
    // brows) stays hidden under it, and showing them again left our brows floating in and out of its face.
    if (this.human && !this.sfBody)
      this.model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && /eyebrow|beard/i.test(o.name)) o.visible = !maskOn;
      });
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
    // A real model (gearModels.ts), in the world's fog-of-war materials.
    const real = (id: string) => {
      const o = wornGear(this.lib, id);
      o?.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) m.material = worldMat(m.material as THREE.MeshStandardMaterial, this.u, null);
      });
      return o;
    };
    /** Scale a real model evenly to `width` (its depth to `depth`, within reason) and hang its top at `top`. */
    const hang = (obj: THREE.Object3D, width: number, depth: number, top: THREE.Vector3, tall = 1) => {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const sz = b.getSize(new THREE.Vector3());
      const k = width / sz.x;
      const kz = THREE.MathUtils.clamp(depth / sz.z, k * 0.75, k * 1.7);
      const wrap = new THREE.Group();
      wrap.add(obj);
      obj.position.set(-(b.min.x + b.max.x) / 2, -b.max.y, -(b.min.z + b.max.z) / 2);
      wrap.scale.set(k, k * tall, kz);
      wrap.position.copy(top);
      return wrap;
    };
    const measured = this.bodyFit();
    const realHelmet = s.helmet ? real(s.helmet.def) : null;
    if (s.helmet && measured?.head) {
      // Every helmet has a liner over the scalp (gearFit.ts helmetLiner), so no model's openings show the head.
      const key = this.fitKey();
      let lg = LINER_FIT.get(key);
      if (!lg) LINER_FIT.set(key, (lg = helmetLiner(measured.head, measured.k)));
      const lc = GEAR_MODEL[s.helmet.def]?.liner ?? 0x1e1f1b;
      let lm = LINER_MAT.get(lc);
      if (!lm) LINER_MAT.set(lc, (lm = new THREE.MeshStandardMaterial({ color: lc, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })));
      const liner = new THREE.Mesh(lg, worldMat(lm, this.u, null));
      add(/^head$/i, liner);
    }
    if (s.helmet && realHelmet && measured?.head) {
      // Seated on the head as measured: shell round the skull, rim on the brow (gearFit.ts).
      const spec = GEAR_MODEL[s.helmet.def]!;
      add(/^head$/i, fitHelmet(realHelmet, measured.head, measured.k, spec));
    } else if (s.helmet && realHelmet) {
      // No measured head (the mannequin): sized by the shell, sitting on the crown.
      const frac = (realHelmet.userData.shellFrac as number | undefined) ?? 1;
      const b = new THREE.Box3().setFromObject(realHelmet);
      const depth = hs.z * 1.34;
      const w = (hs.x * 1.36 * (b.max.x - b.min.x)) / Math.max(1e-6, Math.min(b.max.x - b.min.x, (b.max.z - b.min.z) * (hs.x / hs.z)));
      add(/^head$/i, hang(realHelmet, w, depth, new THREE.Vector3(hc.x, head.max.y + hs.y * (0.1 + (1 - frac) * 0.55), hc.z - hs.z * 0.02)));
    } else if (s.helmet && measured?.head) {
      // A built helmet (gear3d.ts) seated the same way, by its shell: rim on the brow, a visor or faceplate below.
      const built = fitHelmet(helmetModel(s.helmet.def), measured.head, measured.k);
      built.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : undefined));
      add(/^head$/i, built);
    } else if (s.helmet) {
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
      const parts = shellParts(body, id, spec, this.shellPad);
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
      // Pouches, straps and plates: one piece, so they merge into a few meshes.
      const all = new THREE.Group();
      for (const d of details(shell, spec, (c) => gearSkinMat(c, 0.9, this.u))) all.add(d);
      add(/^spine_03$/, all);
      return true;
    };
    // Bulk of the clothes under it (see torsoPad), as a share of the chest's width: a rigged body's own, or the
    // top worn from the kit.
    if ((s.armor || s.rig) && this.human && !this.sfBody) {
      const tops = this.outfitMeshes.filter((m) => (m.userData.worn as Worn | undefined)?.slot === 'top');
      this.shellPad = tops.length ? this.torsoPad(`kit|${(tops[0]!.userData.worn as Worn).id}|${this.look.sex}`, this.human.body, tops) : 0;
    }
    const bulk = 1 + this.shellPad * 2.2;
    // Armour and rigs on our own bodies are the soldiers' own (armorKit.ts, wearArmor), once the models they come
    // from have loaded (nothing until then); the models below (gear.glb, gearFit.ts) only when one failed to load.
    const kitOf = (it: ItemInstance | null | undefined) => (it && this.human && !this.sfBody && measured ? ARMOR_KIT[it.def] : undefined);
    const kitArmor = kitOf(s.armor);
    const kitRig = kitOf(s.rig);
    const waiting = [s.armor, s.rig].flatMap((it) => (it && kitOf(it) ? armorSources(it.def) : [])).filter((b) => !bodySettled(this.lib, b));
    if (waiting.length) void loadBodies(this.lib, waiting).then(() => (this.gearKey = ''));
    const kitFailed = (it: ItemInstance | null | undefined) => {
      const bad = !!it && !!kitOf(it) && !waiting.length && armorSources(it.def).some((b) => !this.lib.bodies.has(b));
      if (bad) console.warn(`armour kit for ${it!.def} failed to load: falling back to its gear model`);
      return bad;
    };
    const armorFallback = kitFailed(s.armor);
    const rigFallback = kitFailed(s.rig);
    const realArmor = s.armor && (!kitArmor || armorFallback) ? real(s.armor.def) : null;
    const realRig = s.rig && (!kitRig || rigFallback) ? real(s.rig.def) : null;
    // A vest is wrapped onto the body as measured with its clothes on, hangs by its straps and bends with the
    // spine (gearFit.ts); a rig goes over the armour the same way. Returns the surface with this piece on it.
    const vest = (id: string, obj: THREE.Object3D, under: TorsoField | null, layer: string, press = false): TorsoField | null => {
      const body = this.human?.body;
      const spec = GEAR_MODEL[id]!;
      if (!body || !measured || !under) {
        // The mannequin: by the chest's box, on one bone.
        const f = spec.fit ?? {};
        const over = layer ? 1.08 : 1;
        add(/^spine_03$/, hang(obj, cs.x * 1.24 * bulk * over * (f.w ?? 1), cs.z * 1.46 * bulk * over * (f.d ?? 1), new THREE.Vector3(cc.x, chest.max.y + cs.y * (0.1 + (f.y ?? 0)), cc.z), f.h ?? 1));
        return null;
      }
      const key = `${this.fitKey()}|${id}|${layer}${press ? '|pressed' : ''}`;
      let hit = VEST_FIT.get(key);
      const mats: (THREE.Material | THREE.Material[])[] = [];
      obj.traverse((o) => (o as THREE.Mesh).isMesh && mats.push((o as THREE.Mesh).material));
      if (!hit) {
        let { geos } = fitVest(obj, measured, under, { fit: spec.fit, anchor: spec.anchor, hem: spec.hem, arm: spec.arm });
        // Under a rig: its pouches pressed in by it (they'd come out through it).
        if (press) geos = pressUnder(geos, under, 0.03 * measured.k);
        VEST_FIT.set(key, (hit = { geos, over: withLayer(under, geos, 0.03 * measured.k) }));
      }
      hit.geos.forEach((g, i) => {
        const m = new THREE.SkinnedMesh(g, mats[i]!);
        m.bind(body.skeleton, body.bindMatrix);
        m.userData.rigidShape = true;
        m.frustumCulled = false;
        m.castShadow = true;
        body.parent!.add(m);
        this.gearAttachments.push(m);
      });
      return hit.over;
    };
    let surface = measured?.dressed ?? null;
    if (realArmor) surface = vest(s.armor!.def, realArmor, surface, '', !!realRig);
    else if (kitArmor && !waiting.length && measured && surface) surface = this.wearArmor(s.armor!.def, kitArmor, measured, surface, '') ?? surface;
    if (realRig) surface = vest(s.rig!.def, realRig, surface, realArmor ? s.armor!.def : '') ?? surface;
    else if (kitRig && !waiting.length && measured && surface) surface = this.wearArmor(s.rig!.def, kitRig, measured, surface, s.armor?.def ?? '') ?? surface;
    if (s.armor && !realArmor && !kitArmor && !wear(s.armor.def, ARMOR_SPECS[s.armor.def])) {
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
    if (s.rig && !realRig && !kitRig && !wear(s.rig.def, RIG_SPECS[s.rig.def])) {
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
    const realPack = s.backpack ? real(s.backpack.def) : null;
    if (s.backpack && realPack) {
      // A real pack (gearModels.ts): rigid on the back, sized by the item, clear of whatever is worn under it.
      const id = s.backpack.def;
      const d = getDef(id);
      const spec = GEAR_MODEL[id]!;
      const k = 0.75 + (d.w * d.h) / 40;
      const maxWidth = cs.x * 0.95 * Math.min(1.15, k);
      const body = this.human?.body;
      if (measured && surface && body) {
        const pack = fitPack(realPack, measured, surface, {
          tall: 0.35 + 0.4 * k,
          maxWidth,
          fit: spec.fit,
          dropLoose: spec.dropLoose,
          sling: id === 'b_sling',
          sternum: id === 'b_pilgrim' || id === 'b_attack',
        });
        const strap = pack.userData.strap as THREE.BufferGeometry | undefined;
        if (strap) {
          // Its straps, skinned as the clothes under them: webbing in the pack's own colour, a shade darker.
          const sm = strapMat(realPack, spec.paint ?? spec.mono);
          const m = new THREE.SkinnedMesh(strap, worldMat(sm, this.u, null));
          m.bind(body.skeleton, body.bindMatrix);
          m.frustumCulled = false;
          m.castShadow = true;
          body.parent!.add(m);
          this.gearAttachments.push(m);
        }
        // On spine_02, mid-way down the pack: on spine_03 its bottom swings out as the chest moves.
        add(/^spine_02$/, pack);
      } else {
        // The mannequin: by the chest's box.
        const t = new THREE.Group();
        t.rotation.y = Math.PI;
        t.add(realPack);
        const f = spec.fit ?? {};
        const pack = hang(
          t,
          maxWidth * 0.8 * (f.w ?? 1) * (f.size ?? 1),
          cs.z * 0.75 * k,
          new THREE.Vector3(cc.x, chest.max.y + cs.y * (0.05 + (f.y ?? 0)), 0),
        );
        pack.updateMatrixWorld(true);
        const pb = new THREE.Box3().setFromObject(pack);
        pack.position.z = chest.min.z - (s.armor ? cs.z * 0.1 : 0) - pb.max.z;
        // On spine_02, mid-way down the pack: on spine_03 its bottom swings out as the chest moves.
        add(/^spine_02$/, pack);
      }
    } else if (s.backpack) {
      const id = s.backpack.def;
      const d = getDef(id);
      let bp: THREE.Object3D | null = null;
      if (id === 'b_sling') bp = slingModel();
      else {
        const src = this.lib.props.get('backpack');
        if (src) {
          bp = src.clone(true);
          const tint = new THREE.Color(BACKPACK_TINT[id] ?? 0x666666);
          // One tinted copy per source material, so the pack's meshes merge (bakeRigid).
          const tinted = new Map<THREE.Material, THREE.MeshStandardMaterial>();
          bp.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const src = m.material as THREE.MeshStandardMaterial;
            let mat = tinted.get(src);
            if (!mat) {
              mat = src.clone();
              mat.color.copy(tint).multiplyScalar(0.7 + mat.color.getHSL({ h: 0, s: 0, l: 0 }).l);
              tinted.set(src, mat);
            }
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
        // A gun is one rigid thing but for the magazine (it comes out during a reload).
        if (!d.melee) {
          const mag = this.held.userData.mag as THREE.Object3D | null | undefined;
          bakeRigid(this.held, new Set(mag ? [mag] : []));
        }
        this.heavyMelee = HEAVY_MELEE.has(held.def);
        this.reverseGrip = REVERSE_GRIP.has(held.def);
        // A gun built from parts measures as built (a suppressor makes it longer).
        const b = new THREE.Box3().setFromObject(d.melee ? src : this.held);
        this.heldLen = d.melee ? b.max.z : b.getSize(tmpV).z;
        this.heldBox.copy(b);
        this.heldDef = held.def;
        if (d.melee) this.held.matrixAutoUpdate = false;
        this.gear.add(this.held);
      }
    }
    this.applyShape();
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
    const clip = layerClip(this.lib, name, layer, this.sfBody);
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

  /** `from`: a one-shot that just ended, handed over to the stance with a crossfade (weights always add up to 1). */
  private setUpper(name: string | null, from: THREE.AnimationAction | null = null): void {
    if (this.upperName === (name ?? '')) {
      from?.fadeOut(0.15);
      return;
    }
    if (from && this.upper) from.fadeOut(0.15);
    const prev = this.upper ?? from;
    this.upper = null;
    this.upperName = name ?? '';
    if (name) {
      const clip = layerClip(this.lib, name, 'upper', this.sfBody);
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
    const clip = layerClip(this.lib, name, layer, this.sfBody);
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    // Already on (the next shot of a burst, or a one-shot still fading out): restart at full weight. Fading it
    // in again from 0 would leave the upper body unheld for a few frames, and it sags into the bind pose.
    const live = a.isScheduled() && a.getEffectiveWeight() > 0;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    // Hold the last frame until update() fades it out: a finished LoopOnce action drops to weight 0 at once,
    // and while the stance is still fading in the arms would sag towards the bind pose (spread out wide).
    a.clampWhenFinished = true;
    a.timeScale = speed;
    a.setEffectiveWeight(1).play();
    if (!live) a.fadeIn(0.06);
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
    let ended: THREE.AnimationAction | null = null;
    if (this.oneShot && this.oneShotT <= 0) {
      ended = this.oneShot;
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
    if (!this.oneShot) this.setUpper(stance, ended);
    this.gunUp = stance === 'Pistol_Aim_Neutral' || stance === 'Pistol_Idle_Loop';
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
      // The longer legs hold the body up by less as the clip folds them (crouching): lift with the pelvis.
      if (this.stand && !this.dead) this.model.position.y = (this.stand.lift * this.stand.pelvis.position.length()) / this.stand.hip;
    }
    this.placeHeld(a, dt);
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
  /** Holding a gun at the ready or aiming (the stance clips), when a long gun's left hand goes on the handguard. */
  private gunUp = false;
  /** How far a long gun is in the shoulder-and-both-hands hold (eased with the stance). */
  private holdW = 0;
  /** 1 when a long gun is carried at low ready rather than up in the shoulder. */
  private lowW = 0;
  private supportW = 0;
  private gunMag: THREE.Object3D | null = null;

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
  /** The heel of the stock in the held gun's frame (a whole-gun model: the rear of its box, a quarter down). */
  private heldButt(): THREE.Vector3 {
    const own = this.held?.userData.butt as THREE.Vector3 | undefined;
    if (own) return own;
    const b = this.heldBox;
    return _hb.set((b.min.x + b.max.x) / 2, b.max.y - (b.max.y - b.min.y) * 0.25, b.min.z);
  }

  /** The top of the pistol grip in the held gun's frame (a whole-gun model: under the box, 30% from the back). */
  private heldGrip(): THREE.Vector3 {
    const own = this.held?.userData.grip as THREE.Vector3 | null | undefined;
    if (own) return own;
    const b = this.heldBox;
    return _hg.set((b.min.x + b.max.x) / 2, b.min.y + (b.max.y - b.min.y) * 0.4, b.min.z + (b.max.z - b.min.z) * 0.3);
  }

  /** Where the left hand holds a whole-gun model (no parts to go by): under it, a third of the way back from the muzzle. */
  private heldSupport(): THREE.Vector3 {
    const b = this.heldBox;
    return _hs.set((b.min.x + b.max.x) / 2, b.min.y + (b.max.y - b.min.y) * 0.3, b.max.z - (b.max.z - b.min.z) * 0.32);
  }

  private propInHand(kind: 'mag' | 'pmag' | 'shell' | null, side: 'l' | 'r' = 'l'): void {
    // A gun built from parts hands over its own magazine (a copy, centred on the palm) instead of a box.
    const own = kind === 'mag' ? (this.held?.userData.mag as THREE.Object3D | null | undefined) : null;
    if (own) {
      if (!this.gunMag || this.gunMag.userData.src !== own) {
        if (this.gunMag) this.gear.remove(this.gunMag);
        const copy = own.clone();
        copy.visible = true;
        const box = new THREE.Box3().setFromObject(copy);
        copy.position.sub(box.getCenter(tmpV2));
        this.gunMag = new THREE.Group().add(copy);
        this.gunMag.userData.src = own;
        this.gunMag.userData.size = box.getSize(new THREE.Vector3());
        this.gear.add(this.gunMag);
      }
      if (this.handProp) this.handProp.visible = false;
      this.gunMag.visible = true;
      this.inPalm(this.gunMag, side, tmpV2.copy(this.gunMag.userData.size as THREE.Vector3));
      return;
    }
    if (this.gunMag) this.gunMag.visible = false;
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
    const gunMag = this.held?.userData.mag as THREE.Object3D | null | undefined;
    if (!reloading && gunMag) gunMag.visible = true;

    // A long gun held up: the right hand on the pistol grip (through reloads too), the left under the handguard.
    // A pistol from parts: the right hand round its grip, the left wrapped over it from the other side.
    const longGun = this.heldKind === 'gun' && this.held && this.heldLen >= 0.4;
    const pistolUp = this.heldKind === 'gun' && !!this.held && this.heldLen < 0.4 && !!this.held.userData.grip;
    if ((longGun || pistolUp) && this.holdW > 0.01 && !treating) {
      const h = this.held!;
      h.updateMatrixWorld(true);
      const gx = _rlX.setFromMatrixColumn(h.matrixWorld, 0).normalize();
      const gz = _rlZ.setFromMatrixColumn(h.matrixWorld, 2).normalize();
      // Palm against the grip's right side, the hand forward along it, the fingers closing round its front.
      reachPalm(this.armRig!.r, h.localToWorld(_ikT.copy(this.heldGrip())), gz, gx, pole('r'), this.holdW);
    }
    this.supportW += ((!reloading && !treating && (longGun || (pistolUp && this.gunUp)) ? 1 : 0) - this.supportW) * Math.min(1, dt * 10);
    if (this.supportW > 0.01 && pistolUp) {
      const h = this.held!;
      h.updateMatrixWorld(true);
      const gx = _rlX.setFromMatrixColumn(h.matrixWorld, 0).normalize();
      const gy = _rlY.setFromMatrixColumn(h.matrixWorld, 1).normalize();
      const gz = _rlZ.setFromMatrixColumn(h.matrixWorld, 2).normalize();
      // Over the right hand's fingers from the left: palm to the grip, fingers forward and down round it.
      const target = h.localToWorld(_ikT.copy(h.userData.grip as THREE.Vector3)).addScaledVector(gx, 0.035).addScaledVector(gy, -0.015);
      const fd = _ikS.copy(gz).multiplyScalar(0.55).addScaledVector(gy, -0.83).normalize();
      // The wrist bends a long way round the grip here: let it, or the fingers swing back up along the forearm.
      reachPalm(this.armRig!.l, target, fd, gx.clone().negate(), pole('l'), this.supportW, 1.6);
      this.curlFingers('l', this.supportW, WRAP_CURL);
    } else if (this.supportW > 0.01 && longGun) {
      const h = this.held!;
      h.updateMatrixWorld(true);
      const local = (h.userData.support as THREE.Vector3 | undefined) ?? this.heldSupport();
      const target = h.localToWorld(_ikT.copy(local));
      const gx = _rlX.setFromMatrixColumn(h.matrixWorld, 0).normalize();
      const gy = _rlY.setFromMatrixColumn(h.matrixWorld, 1).normalize();
      const gz = _rlZ.setFromMatrixColumn(h.matrixWorld, 2).normalize();
      // Palm up under the handguard, the fingers across it and forward, to close up round its far side.
      const fd = _ikS.copy(gx).multiplyScalar(-0.75).addScaledVector(gz, 0.65).normalize();
      reachPalm(this.armRig!.l, target, fd, gy, pole('l'), this.supportW);
      this.curlFingers('l', this.supportW, WRAP_CURL);
    }
    // The right hand closes round the grip, the index finger along the trigger guard.
    if ((longGun || pistolUp) && this.holdW > 0.01 && !treating) this.curlFingers('r', this.holdW, GRIP_CURL, TRIGGER_CURL);
    if (!treating) this.showWrap(null);
  }

  private fingerBones = new Map<string, THREE.Bone | null>();

  /** Bend a hand's fingers by `w` of `curl` (the index finger by `index`), undone before the next animation step. */
  private curlFingers(side: 'l' | 'r', w: number, curl: number[], index = curl): void {
    for (const f of CURLED)
      for (let j = 0; j < 3; j++) {
        const name = `${f}_0${j + 1}_${side}`;
        let b = this.fingerBones.get(name);
        if (b === undefined) this.fingerBones.set(name, (b = this.skinned.skeleton.getBoneByName(name) ?? null));
        if (!b) continue;
        this.yawSaved.push([b, b.quaternion.clone()]);
        b.quaternion.multiply(_curlQ.setFromAxisAngle(_curlZ, (f === 'index' ? index : curl)[j]! * w));
      }
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
      // A gun built from parts: its magazine is out of the well from the strip until the new one is seated.
      const mag = h.userData.mag as THREE.Object3D | null | undefined;
      if (mag) mag.visible = !(u > 0.14 && u < 0.8);
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
  private placeHeld(a: Actor, dt: number): void {
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
      // Pistols sit in front of the grip; a long gun lowered hangs forward of the hands.
      h.position.z += this.heldLen < 0.4 ? this.heldLen * 0.45 : this.heldLen * 0.22;
      h.position.y += 0.04;
      h.rotation.set(0, 0, 0);
      // A long gun: the butt in the right shoulder and both hands on it (proceduralArms); up at cheek height in a
      // stance, otherwise carried at low ready, muzzle down and in across the body. Left to swing with the hand it
      // went through the chest when running.
      const shoulder = this.arms()?.upperarm_r;
      if (this.heldLen >= 0.4 && shoulder) {
        this.holdW += (1 - this.holdW) * Math.min(1, dt * 10);
        this.lowW += ((this.gunUp ? 0 : 1) - this.lowW) * Math.min(1, dt * 8);
        h.rotation.set(LOW_READY.x * this.lowW, LOW_READY.y * this.lowW, 0);
        const butt = tmpV3.copy(this.heldButt()).applyEuler(h.rotation);
        this.gear.worldToLocal(shoulder.getWorldPosition(tmpV2)).add(SHOULDER_POCKET).sub(butt);
        h.position.lerp(tmpV2, this.holdW);
      } else if (shoulder && h.userData.grip) {
        // A pistol held up in both hands: the grip out in front of the right shoulder and in towards the middle,
        // where an isosceles stance puts it (the hands go to it, proceduralArms).
        this.holdW += ((this.gunUp ? 1 : 0) - this.holdW) * Math.min(1, dt * 10);
        if (this.holdW > 0.001) {
          this.gear.worldToLocal(shoulder.getWorldPosition(tmpV2)).add(PISTOL_AIM).sub(h.userData.grip as THREE.Vector3);
          h.position.lerp(tmpV2, this.holdW);
        }
      } else this.holdW = 0;
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
    // Lying down, the legs' length no longer holds the body up.
    this.model.position.y = 0;
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

  /**
   * Corpses keep animating until the death clip finishes, then freeze. The fall plays out whether anyone sees it
   * or not: a body you come across later is already lying there.
   */
  updateCorpse(dt: number, visible: boolean): void {
    this.root.visible = visible;
    if (this.frozen) return;
    this.mixer.update(dt);
    const fall = this.oneShot as THREE.AnimationAction | null;
    if (!fall || fall.time >= fall.getClip().duration) this.freeze();
  }

  private frozen = false;
  /**
   * A body that has stopped moving costs what a statue does: no more animation or matrix updates, bounds where it
   * lies (so it's skipped off screen; living characters draw regardless, their bind-pose bounds don't follow
   * them), its bone texture uploaded once, and no shadow (lying flat it would be a smudge under it anyway).
   */
  private freeze(): void {
    this.frozen = true;
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.frustumCulled = true;
      const sm = m as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.computeBoundingBox();
      sm.computeBoundingSphere();
      sm.skeleton.update();
      sm.skeleton.update = () => {};
    });
    this.root.matrixWorldAutoUpdate = false;
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
  for (const v of VEST_FIT.values()) for (const g of v.geos) g.dispose();
  VEST_FIT.clear();
  for (const g of LINER_FIT.values()) g.dispose();
  LINER_FIT.clear();
  BODY_FIT.clear();
  bodyMatCache.clear();
  flatMatCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Portraits for dialogue / survivor cards
// ─────────────────────────────────────────────────────────────────────────────

const portraitCache = new Map<string, string>();

export function renderPortrait(lib: AssetLibrary, look: Appearance, size = 256): string {
  const key = JSON.stringify(look) + size;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  // Shared with the item pictures (offscreen.ts), so everything they change is set here too.
  const r = offscreenRenderer();
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1;
  r.setClearColor(0x000000, 0);
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
