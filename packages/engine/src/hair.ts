/**
 * Hairstyles, facial hair and hair colours a survivor (or an NPC) can have. Ids are what a saved look stores;
 * how each one is drawn lives in the renderer (apps/web/src/render/hairStyles.ts). Every style renders on either
 * body; `sex` is only which creator list it is offered in ('u': both).
 */
import type { Sex } from './shape';

export interface HairStyleDef {
  id: string;
  label: string;
  group: 'Short' | 'Fades' | 'Medium' | 'Long' | 'Curly & coily' | 'Braids & locs' | 'Tied' | 'Statement' | 'Thinning';
  sex: Sex | 'u';
  /** How common it is among NPCs (relative; default by group). */
  w?: number;
  /** Mostly on older NPCs (receding, balding) or younger ones (statement cuts). */
  age?: 'old' | 'young';
  /** Modelled hair (MakeHuman CC0 hair cards, renderer assetHair.ts) on the MPFB bodies; elsewhere drawn as the
   * procedural style it is closest to. */
  asset?: boolean;
}

/**
 * The catalogue, after real cuts (barbers' and stylists' references: fades and tapers by height, crops, parts,
 * curl types 2A–4C, protective styles). The first ids are the original ones (saved looks hold them).
 */
export const HAIR_STYLES: readonly HairStyleDef[] = [
  // Short
  { id: 'bald', label: 'Bald', group: 'Short', sex: 'm', w: 2, age: 'old' },
  { id: 'shaved', label: 'Shaved', group: 'Short', sex: 'u' },
  { id: 'buzz', label: 'Buzz', group: 'Short', sex: 'u' },
  { id: 'crew', label: 'Crew cut', group: 'Short', sex: 'm' },
  { id: 'short', label: 'Side part', group: 'Short', sex: 'm' },
  { id: 'ivy', label: 'Ivy league', group: 'Short', sex: 'm' },
  { id: 'caesar', label: 'Caesar', group: 'Short', sex: 'm' },
  { id: 'frenchcrop', label: 'French crop', group: 'Short', sex: 'm' },
  { id: 'combover', label: 'Comb over', group: 'Short', sex: 'm' },
  { id: 'waves', label: '360 waves', group: 'Short', sex: 'm' },
  { id: 'pixie', label: 'Pixie', group: 'Short', sex: 'f' },
  { id: 'pixielong', label: 'Long pixie', group: 'Short', sex: 'f' },
  { id: 'crop', label: 'Cropped', group: 'Short', sex: 'f' },
  { id: 'curls', label: 'Short curls', group: 'Short', sex: 'u' },
  // Fades and tapers
  { id: 'lowfade', label: 'Low fade', group: 'Fades', sex: 'm', w: 4 },
  { id: 'midfade', label: 'Mid fade', group: 'Fades', sex: 'm', w: 4 },
  { id: 'fade', label: 'High fade', group: 'Fades', sex: 'm' },
  { id: 'skinfade', label: 'High skin fade', group: 'Fades', sex: 'm', w: 3, age: 'young' },
  { id: 'taper', label: 'Classic taper', group: 'Fades', sex: 'm', w: 4 },
  { id: 'buzzfade', label: 'Buzz & fade', group: 'Fades', sex: 'u', w: 3 },
  { id: 'hightight', label: 'High and tight', group: 'Fades', sex: 'm', w: 3 },
  { id: 'flattop', label: 'Flat-top', group: 'Fades', sex: 'm', w: 1 },
  { id: 'texcrop', label: 'Textured crop', group: 'Fades', sex: 'm', w: 3, age: 'young' },
  { id: 'hardpart', label: 'Hard part', group: 'Fades', sex: 'm', w: 2 },
  { id: 'slickfade', label: 'Slick back, fade', group: 'Fades', sex: 'm', w: 2 },
  { id: 'longtop', label: 'Long top, swept', group: 'Fades', sex: 'm', w: 2, age: 'young' },
  { id: 'curlfade', label: 'Curls & fade', group: 'Fades', sex: 'm', w: 2 },
  { id: 'afrofade', label: 'Afro taper', group: 'Fades', sex: 'm', w: 2 },
  { id: 'pixieundercut', label: 'Undercut pixie', group: 'Fades', sex: 'f', w: 1, age: 'young' },
  // Medium
  { id: 'undercut', label: 'Undercut', group: 'Medium', sex: 'm' },
  { id: 'slick', label: 'Slicked back', group: 'Medium', sex: 'm' },
  { id: 'pompadour', label: 'Pompadour', group: 'Medium', sex: 'm' },
  { id: 'quiff', label: 'Quiff', group: 'Medium', sex: 'm' },
  { id: 'messy', label: 'Messy', group: 'Medium', sex: 'u' },
  { id: 'surfer', label: 'Surfer', group: 'Medium', sex: 'm' },
  { id: 'curtains', label: 'Curtains', group: 'Medium', sex: 'm' },
  { id: 'shag', label: 'Shag', group: 'Medium', sex: 'u' },
  { id: 'wolf', label: 'Wolf cut', group: 'Medium', sex: 'f', age: 'young' },
  { id: 'bob', label: 'Bob', group: 'Medium', sex: 'f' },
  { id: 'fringebob', label: 'Bob, fringe', group: 'Medium', sex: 'f' },
  { id: 'abob', label: 'A-line bob', group: 'Medium', sex: 'f' },
  { id: 'bobwavy', label: 'Wavy bob', group: 'Medium', sex: 'f' },
  { id: 'lob', label: 'Long bob', group: 'Medium', sex: 'f' },
  { id: 'lobwavy', label: 'Wavy lob', group: 'Medium', sex: 'f' },
  // Long
  { id: 'long', label: 'Long', group: 'Long', sex: 'u' },
  { id: 'shoulder', label: 'Shoulder length', group: 'Long', sex: 'u' },
  { id: 'straight', label: 'Long straight', group: 'Long', sex: 'f' },
  { id: 'layers', label: 'Long layers', group: 'Long', sex: 'f' },
  { id: 'wavy', label: 'Long wavy', group: 'Long', sex: 'u' },
  { id: 'sideswept', label: 'Side-swept', group: 'Long', sex: 'f' },
  { id: 'bangs', label: 'Long, bangs', group: 'Long', sex: 'f' },
  { id: 'curtainbangs', label: 'Curtain bangs', group: 'Long', sex: 'f' },
  // Curly and coily (by curl type)
  { id: 'wave2a', label: 'Waves (2A)', group: 'Curly & coily', sex: 'f' },
  { id: 'wave2c', label: 'Deep waves (2C)', group: 'Curly & coily', sex: 'u' },
  { id: 'curl3a', label: 'Loose curls (3A)', group: 'Curly & coily', sex: 'f' },
  { id: 'curlylong', label: 'Long curly (3B)', group: 'Curly & coily', sex: 'u' },
  { id: 'curl3c', label: 'Tight curls (3C)', group: 'Curly & coily', sex: 'u' },
  { id: 'coil4a', label: 'Coils (4A)', group: 'Curly & coily', sex: 'u' },
  { id: 'coil4c', label: 'Coils (4C)', group: 'Curly & coily', sex: 'f' },
  { id: 'curlytop', label: 'Curly top', group: 'Curly & coily', sex: 'm' },
  { id: 'twa', label: 'Short afro', group: 'Curly & coily', sex: 'u' },
  { id: 'afro', label: 'Afro', group: 'Curly & coily', sex: 'u' },
  { id: 'twists', label: 'Sponge twists', group: 'Curly & coily', sex: 'm' },
  { id: 'puff', label: 'Afro puff', group: 'Curly & coily', sex: 'f' },
  { id: 'puffs', label: 'Two puffs', group: 'Curly & coily', sex: 'f', age: 'young' },
  // Braids and locs
  { id: 'cornrows', label: 'Cornrows', group: 'Braids & locs', sex: 'u' },
  { id: 'cornrowsbraids', label: 'Cornrows, long', group: 'Braids & locs', sex: 'f' },
  { id: 'boxbraids', label: 'Box braids', group: 'Braids & locs', sex: 'u' },
  { id: 'boxbob', label: 'Box braids, bob', group: 'Braids & locs', sex: 'f' },
  { id: 'braidspony', label: 'Braids, ponytail', group: 'Braids & locs', sex: 'f' },
  { id: 'twistslong', label: 'Long twists', group: 'Braids & locs', sex: 'f' },
  { id: 'locsshort', label: 'Short locs', group: 'Braids & locs', sex: 'm' },
  { id: 'locs', label: 'Locs', group: 'Braids & locs', sex: 'u' },
  { id: 'locstied', label: 'Locs, tied', group: 'Braids & locs', sex: 'u' },
  // Tied
  { id: 'ponytail', label: 'Ponytail', group: 'Tied', sex: 'f', w: 4 },
  { id: 'ponybangs', label: 'Ponytail, bangs', group: 'Tied', sex: 'f' },
  { id: 'sidepony', label: 'Side ponytail', group: 'Tied', sex: 'f' },
  { id: 'bubblepony', label: 'Bubble ponytail', group: 'Tied', sex: 'f', age: 'young' },
  { id: 'lowtail', label: 'Tied back', group: 'Tied', sex: 'u', w: 4 },
  { id: 'manbun', label: 'Man bun', group: 'Tied', sex: 'm' },
  { id: 'bunundercut', label: 'Bun & undercut', group: 'Tied', sex: 'm', age: 'young' },
  { id: 'halfup', label: 'Half up', group: 'Tied', sex: 'u' },
  { id: 'bun', label: 'Space buns', group: 'Tied', sex: 'f', w: 1, age: 'young' },
  { id: 'topknot', label: 'Top bun', group: 'Tied', sex: 'u' },
  { id: 'ballerina', label: 'Ballerina bun', group: 'Tied', sex: 'f' },
  { id: 'messybun', label: 'Messy bun', group: 'Tied', sex: 'f', w: 4 },
  { id: 'lowbun', label: 'Low bun', group: 'Tied', sex: 'f', w: 4 },
  { id: 'braid', label: 'Braid', group: 'Tied', sex: 'f', w: 4 },
  { id: 'braids', label: 'Two braids', group: 'Tied', sex: 'f' },
  { id: 'frenchbraid', label: 'French braid', group: 'Tied', sex: 'f', w: 4 },
  { id: 'dutchbraids', label: 'Dutch braids', group: 'Tied', sex: 'f', w: 4 },
  { id: 'sidebraid', label: 'Side braid', group: 'Tied', sex: 'f' },
  { id: 'crownbraid', label: 'Crown braid', group: 'Tied', sex: 'f' },
  // Thinning (receding and balding patterns)
  { id: 'receding', label: 'Receding', group: 'Thinning', sex: 'm', w: 3, age: 'old' },
  { id: 'thinning', label: 'Thinning crown', group: 'Thinning', sex: 'm', w: 3, age: 'old' },
  { id: 'horseshoe', label: 'Balding', group: 'Thinning', sex: 'm', w: 3, age: 'old' },
  // Statement
  { id: 'mohawk', label: 'Mohawk', group: 'Statement', sex: 'u' },
  { id: 'fauxhawk', label: 'Faux hawk', group: 'Statement', sex: 'm', age: 'young' },
  { id: 'spiky', label: 'Spiky', group: 'Statement', sex: 'm' },
  { id: 'mullet', label: 'Mullet', group: 'Statement', sex: 'u' },
  { id: 'sideshave', label: 'Side shave', group: 'Statement', sex: 'f' },
  // Modelled (MakeHuman CC0 hair meshes, alpha-textured cards)
  { id: 'mh_bob01', label: 'Bob (modelled)', group: 'Medium', sex: 'f', w: 2, asset: true },
  { id: 'mh_bob02', label: 'Short bob (modelled)', group: 'Medium', sex: 'f', w: 2, asset: true },
  { id: 'mh_long01', label: 'Long (modelled)', group: 'Long', sex: 'f', w: 2, asset: true },
  { id: 'mh_ponytail01', label: 'Ponytail (modelled)', group: 'Tied', sex: 'f', w: 3, asset: true },
  { id: 'mh_short01', label: 'Short (modelled)', group: 'Short', sex: 'm', w: 2, asset: true },
  { id: 'mh_short02', label: 'Side part (modelled)', group: 'Short', sex: 'm', w: 2, asset: true },
  { id: 'mh_short03', label: 'Crop (modelled)', group: 'Short', sex: 'u', w: 1, asset: true },
  { id: 'mh_short04', label: 'Buzz (modelled)', group: 'Short', sex: 'm', w: 1, asset: true },
  { id: 'mh_afro01', label: 'Afro (modelled)', group: 'Curly & coily', sex: 'u', w: 1, asset: true },
  { id: 'mh_bluntbob', label: 'Blunt bob (modelled)', group: 'Medium', sex: 'f', w: 2, asset: true },
  { id: 'mh_curledbob', label: 'Curled bob, bangs (modelled)', group: 'Medium', sex: 'f', w: 2, asset: true },
  { id: 'mh_wavybob', label: 'Wavy bob (modelled)', group: 'Medium', sex: 'f', w: 1, asset: true },
  { id: 'mh_katherine', label: 'Angled bob (modelled)', group: 'Medium', sex: 'f', w: 2, asset: true },
  { id: 'mh_hazel', label: 'Long wavy (modelled)', group: 'Long', sex: 'f', w: 2, asset: true },
  { id: 'mh_updo', label: 'Updo (modelled)', group: 'Tied', sex: 'f', w: 1, asset: true },
  // Cut out of the `ai_f2` identity's image-to-3D head (tools/assets/mpfb-pilot/ai3d_hair.py): her own short afro.
  // Pilot: offered in the creator, never on NPCs (w 0).
  { id: 'mh_ai_afro', label: 'Short afro, sculpted (modelled)', group: 'Curly & coily', sex: 'f', w: 0, asset: true },
];

export const HAIR_BY_ID: Readonly<Record<string, HairStyleDef>> = Object.fromEntries(HAIR_STYLES.map((h) => [h.id, h]));

/** The styles the creator offers one sex, in display order. */
export function hairStylesFor(sex: Sex): HairStyleDef[] {
  return HAIR_STYLES.filter((h) => h.sex === sex || h.sex === 'u');
}

export interface BeardStyleDef {
  id: string;
  label: string;
  group: 'None' | 'Beard' | 'Moustache' | 'Trim';
}

export const BEARD_STYLES: readonly BeardStyleDef[] = [
  { id: 'none', label: 'Clean shaven', group: 'None' },
  { id: 'stubble', label: 'Stubble', group: 'Trim' },
  { id: 'scruff', label: 'Heavy stubble', group: 'Trim' },
  { id: 'chinstrap', label: 'Chin strap', group: 'Trim' },
  { id: 'soulpatch', label: 'Soul patch', group: 'Trim' },
  { id: 'goatee', label: 'Goatee', group: 'Trim' },
  { id: 'vandyke', label: 'Van Dyke', group: 'Trim' },
  { id: 'moustache', label: 'Moustache', group: 'Moustache' },
  { id: 'walrus', label: 'Walrus', group: 'Moustache' },
  { id: 'pencil', label: 'Pencil', group: 'Moustache' },
  { id: 'horseshoe', label: 'Horseshoe', group: 'Moustache' },
  { id: 'chops', label: 'Mutton chops', group: 'Moustache' },
  { id: 'boxed', label: 'Short boxed', group: 'Beard' },
  { id: 'full', label: 'Full beard', group: 'Beard' },
  { id: 'long', label: 'Long beard', group: 'Beard' },
  { id: 'viking', label: 'Forked', group: 'Beard' },
];
export const BEARD_BY_ID: Readonly<Record<string, BeardStyleDef>> = Object.fromEntries(BEARD_STYLES.map((b) => [b.id, b]));

export interface HairColorDef {
  hex: number;
  label: string;
  dyed?: boolean;
  /** Colour towards the ends (sun-lightened, balayage); unset: the same. */
  tips?: number;
  /** Colour at the roots (grown-out dye); unset: the same. */
  roots?: number;
  /** Fraction of grey or white strands through it (0..1). */
  grey?: number;
}

/** Natural shades first (NPCs only get these), then a few dyes. */
export const HAIR_PALETTE: readonly HairColorDef[] = [
  { hex: 0x0f0f12, label: 'Jet black' },
  { hex: 0x1c1612, label: 'Black' },
  { hex: 0x2c2018, label: 'Soft black' },
  { hex: 0x3a281b, label: 'Dark brown' },
  { hex: 0x5b3d25, label: 'Brown' },
  { hex: 0x6a3a20, label: 'Chestnut' },
  { hex: 0x5c3e26, label: 'Sun-kissed brown', tips: 0x9a7048 },
  { hex: 0x7a5434, label: 'Light brown' },
  { hex: 0x7c3b21, label: 'Auburn' },
  { hex: 0xa0502a, label: 'Ginger' },
  { hex: 0xb87a50, label: 'Strawberry blond' },
  { hex: 0x9a7a4a, label: 'Dark blond' },
  { hex: 0xb0a080, label: 'Ash blond' },
  { hex: 0xc4a46a, label: 'Blond' },
  { hex: 0xe0cfa0, label: 'Platinum' },
  { hex: 0x2a2018, label: 'Greying black', grey: 0.22 },
  { hex: 0x4a3524, label: 'Greying brown', grey: 0.3 },
  { hex: 0x6e6a66, label: 'Salt & pepper', grey: 0.5 },
  { hex: 0x9c9a96, label: 'Grey', grey: 0.85 },
  { hex: 0xd8d4cc, label: 'White' },
  { hex: 0x3b2a1c, label: 'Balayage', tips: 0xb08a5a, dyed: true },
  { hex: 0xc6a66c, label: 'Blond, dark roots', roots: 0x3a2a1c, dyed: true },
  { hex: 0x8e1f24, label: 'Red dye', dyed: true },
  { hex: 0xc4447a, label: 'Pink dye', dyed: true },
  { hex: 0x5a3a8a, label: 'Violet dye', dyed: true },
  { hex: 0x2c5aa0, label: 'Blue dye', dyed: true },
  { hex: 0x2e7a5a, label: 'Green dye', dyed: true },
];
export const HAIR_COLOR_BY_HEX: ReadonlyMap<number, HairColorDef> = new Map(HAIR_PALETTE.map((c) => [c.hex, c]));
/** Natural, not grey: what a young NPC's hair is. */
export const NATURAL_HAIR: readonly number[] = HAIR_PALETTE.filter((c) => !c.dyed && !c.grey && c.hex !== 0xd8d4cc).map((c) => c.hex);
/** Greying and grey shades (older NPCs). */
export const GREY_HAIR: readonly number[] = HAIR_PALETTE.filter((c) => !c.dyed && (c.grey || c.hex === 0xd8d4cc)).map((c) => c.hex);

/** The default style per sex (a fresh look, or a saved id that no longer exists). */
export const DEFAULT_HAIR: Record<Sex, string> = { m: 'short', f: 'ponytail' };

/** A saved look's beard: older saves stored true/false (true was the one full beard). */
export function beardId(beard: unknown): string {
  if (beard === true) return 'full';
  if (typeof beard === 'string' && BEARD_BY_ID[beard]) return beard;
  return 'none';
}

const mix = (seed: number, salt: number) => ((Math.imul((seed | 0) ^ salt, 2246822519) ^ 0x5bd1e995) >>> 0) / 4294967296;
const pickBy = <T>(list: readonly T[], r: number) => list[Math.floor(r * list.length) % list.length]!;

/**
 * NPC hair, deterministic per seed: everyday cuts are likelier than statement ones; `age` (0 young, 1 middle-aged,
 * 2 older) shifts men towards receding and balding patterns and away from the young cuts.
 */
export function npcHair(sex: Sex, seed: number, age = 1): string {
  const pool = hairStylesFor(sex).filter((h) => h.id !== 'shaved' || sex === 'm');
  const weighted: string[] = [];
  for (const h of pool) {
    let w = h.w ?? (h.group === 'Statement' ? 1 : h.group === 'Short' || h.group === 'Fades' ? 3 : 2);
    if (h.age === 'old') w = age >= 2 ? w * 3 : age === 1 ? w : 0;
    if (h.age === 'young') w = age === 0 ? w * 1.5 : age === 1 ? w * 0.5 : 0;
    for (let i = 0; i < Math.round(w * 2); i++) weighted.push(h.id);
  }
  return pickBy(weighted, mix(seed, 0x68a1));
}

/** NPC hair colour: natural shades; greying with age (a third of the middle-aged, most of the older). */
export function npcHairColor(seed: number, age = 1): number {
  const r = mix(seed, 0x3c6f);
  if ((age >= 2 && r < 0.75) || (age === 1 && r < 0.3)) return pickBy(GREY_HAIR, mix(seed, 0x7a11));
  return pickBy(NATURAL_HAIR, mix(seed, 0x1b2d));
}

/** NPC facial hair (men only), deterministic per seed: about half are clean or stubbled. */
export function npcBeard(sex: Sex, seed: number): string {
  if (sex !== 'm') return 'none';
  const r = mix(seed, 0x9e37);
  if (r < 0.28) return 'none';
  if (r < 0.5) return r < 0.4 ? 'stubble' : 'scruff';
  return pickBy(BEARD_STYLES.slice(3).map((b) => b.id), mix(seed, 0x51ed));
}
