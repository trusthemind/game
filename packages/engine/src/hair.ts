/**
 * Hairstyles, facial hair and hair colours a survivor (or an NPC) can have. Ids are what a saved look stores;
 * how each one is drawn lives in the renderer (apps/web/src/render/hairStyles.ts). Every style renders on either
 * body; `sex` is only which creator list it is offered in ('u': both).
 */
import type { Sex } from './shape';

export interface HairStyleDef {
  id: string;
  label: string;
  group: 'Short' | 'Medium' | 'Long' | 'Tied' | 'Statement';
  sex: Sex | 'u';
}

export const HAIR_STYLES: readonly HairStyleDef[] = [
  // Short
  { id: 'bald', label: 'Bald', group: 'Short', sex: 'm' },
  { id: 'shaved', label: 'Shaved', group: 'Short', sex: 'u' },
  { id: 'buzz', label: 'Buzz', group: 'Short', sex: 'u' },
  { id: 'crew', label: 'Crew cut', group: 'Short', sex: 'm' },
  { id: 'short', label: 'Side part', group: 'Short', sex: 'm' },
  { id: 'ivy', label: 'Ivy league', group: 'Short', sex: 'm' },
  { id: 'fade', label: 'High fade', group: 'Short', sex: 'm' },
  { id: 'caesar', label: 'Caesar', group: 'Short', sex: 'm' },
  { id: 'pixie', label: 'Pixie', group: 'Short', sex: 'f' },
  { id: 'crop', label: 'Cropped', group: 'Short', sex: 'f' },
  { id: 'curls', label: 'Short curls', group: 'Short', sex: 'u' },
  // Medium
  { id: 'undercut', label: 'Undercut', group: 'Medium', sex: 'm' },
  { id: 'slick', label: 'Slicked back', group: 'Medium', sex: 'm' },
  { id: 'pompadour', label: 'Pompadour', group: 'Medium', sex: 'm' },
  { id: 'quiff', label: 'Quiff', group: 'Medium', sex: 'm' },
  { id: 'messy', label: 'Messy', group: 'Medium', sex: 'u' },
  { id: 'curlytop', label: 'Curly top', group: 'Medium', sex: 'm' },
  { id: 'afro', label: 'Afro', group: 'Medium', sex: 'u' },
  { id: 'shag', label: 'Shag', group: 'Medium', sex: 'u' },
  { id: 'bob', label: 'Bob', group: 'Medium', sex: 'f' },
  { id: 'fringebob', label: 'Bob, fringe', group: 'Medium', sex: 'f' },
  { id: 'lob', label: 'Long bob', group: 'Medium', sex: 'f' },
  // Long
  { id: 'long', label: 'Long', group: 'Long', sex: 'u' },
  { id: 'shoulder', label: 'Shoulder length', group: 'Long', sex: 'u' },
  { id: 'straight', label: 'Long straight', group: 'Long', sex: 'f' },
  { id: 'wavy', label: 'Long wavy', group: 'Long', sex: 'f' },
  { id: 'curlylong', label: 'Long curly', group: 'Long', sex: 'f' },
  { id: 'bangs', label: 'Long, bangs', group: 'Long', sex: 'f' },
  // Tied
  { id: 'ponytail', label: 'Ponytail', group: 'Tied', sex: 'f' },
  { id: 'lowtail', label: 'Tied back', group: 'Tied', sex: 'u' },
  { id: 'manbun', label: 'Man bun', group: 'Tied', sex: 'm' },
  { id: 'bun', label: 'Space buns', group: 'Tied', sex: 'f' },
  { id: 'topknot', label: 'Top bun', group: 'Tied', sex: 'f' },
  { id: 'lowbun', label: 'Low bun', group: 'Tied', sex: 'f' },
  { id: 'braid', label: 'Braid', group: 'Tied', sex: 'f' },
  { id: 'braids', label: 'Two braids', group: 'Tied', sex: 'f' },
  // Statement
  { id: 'mohawk', label: 'Mohawk', group: 'Statement', sex: 'u' },
  { id: 'spiky', label: 'Spiky', group: 'Statement', sex: 'm' },
  { id: 'sideshave', label: 'Side shave', group: 'Statement', sex: 'f' },
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
}

/** Natural shades first (NPCs only get these), then a few dyes. */
export const HAIR_PALETTE: readonly HairColorDef[] = [
  { hex: 0x1c1612, label: 'Black' },
  { hex: 0x2c2018, label: 'Soft black' },
  { hex: 0x3a281b, label: 'Dark brown' },
  { hex: 0x5b3d25, label: 'Brown' },
  { hex: 0x7a5434, label: 'Light brown' },
  { hex: 0x7c3b21, label: 'Auburn' },
  { hex: 0xa0502a, label: 'Ginger' },
  { hex: 0x9a7a4a, label: 'Dark blond' },
  { hex: 0xc4a46a, label: 'Blond' },
  { hex: 0xe0cfa0, label: 'Platinum' },
  { hex: 0x6e6a66, label: 'Salt & pepper' },
  { hex: 0x9c9a96, label: 'Grey' },
  { hex: 0xd8d4cc, label: 'White' },
  { hex: 0x8e1f24, label: 'Red dye', dyed: true },
  { hex: 0xc4447a, label: 'Pink dye', dyed: true },
  { hex: 0x5a3a8a, label: 'Violet dye', dyed: true },
  { hex: 0x2c5aa0, label: 'Blue dye', dyed: true },
  { hex: 0x2e7a5a, label: 'Green dye', dyed: true },
];
export const NATURAL_HAIR: readonly number[] = HAIR_PALETTE.filter((c) => !c.dyed && c.hex !== 0xd8d4cc).map((c) => c.hex);

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

/** NPC hair, deterministic per seed: everyday cuts are likelier than statement ones. */
export function npcHair(sex: Sex, seed: number): string {
  const pool = hairStylesFor(sex).filter((h) => h.id !== 'shaved' || sex === 'm');
  const weighted: string[] = [];
  for (const h of pool) {
    const w = h.group === 'Statement' ? 1 : h.id === 'bald' ? 2 : h.group === 'Short' ? 4 : 3;
    for (let i = 0; i < w; i++) weighted.push(h.id);
  }
  return pickBy(weighted, mix(seed, 0x68a1));
}

/** NPC facial hair (men only), deterministic per seed: about half are clean or stubbled. */
export function npcBeard(sex: Sex, seed: number): string {
  if (sex !== 'm') return 'none';
  const r = mix(seed, 0x9e37);
  if (r < 0.28) return 'none';
  if (r < 0.5) return r < 0.4 ? 'stubble' : 'scruff';
  return pickBy(BEARD_STYLES.slice(3).map((b) => b.id), mix(seed, 0x51ed));
}
