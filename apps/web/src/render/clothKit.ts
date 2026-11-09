/**
 * Which real garment each clothing item is: a piece of a licensed rigged model in models/bodies (credited in
 * models/CREDITS.txt), fitted to our own body at load (fitToRest in rebind.ts). `part` matches
 * "<glTF mesh name> <material name>" of the pieces to take.
 *
 * `short`: the sleeves stop above the elbow, so the forearms stay drawn. `keepHair`: worn with the hair showing
 * (a cap with a headset over short hair still hides it). `underHelmet`: stays on under a helmet (a balaclava);
 * other headwear comes off when one goes on.
 */
export interface KitPiece {
  body: string;
  part: string;
  short?: boolean;
  underHelmet?: boolean;
}

export const CLOTH_KIT: Record<string, KitPiece> = {
  // Headwear
  c_green_cap: { body: 'pmc_a', part: '^Cap_' },
  c_patrol_cap: { body: 'cl_soldier', part: '^Hats_' },
  c_balaclava: { body: 'rus_a', part: '^Masks_', underHelmet: true },
  c_balaclava_tan: { body: 'ukr_a', part: '^Masks_', underHelmet: true },
  // Tops
  c_bomber: { body: 'cl_man', part: '^(jacket|shirt)_' },
  c_knit: { body: 'cl_civ', part: '_Top_' },
  c_survivor_top: { body: 'cl_alan', part: ' Wolf3D_Outfit_Top$' },
  c_police_shirt: { body: 'fem_police', part: '^Tops_' },
  c_smock: { body: 'rus_a', part: '^Tops_' },
  c_acu_shirt: { body: 'cl_soldier', part: '^Tops_', short: true },
  c_kitel: { body: 'pmc_heavy', part: 'Mark_Kitel' },
  // Trousers
  c_trousers: { body: 'cl_man', part: '^pants_' },
  c_work_pants: { body: 'cl_civ', part: '_Bottom_' },
  c_ripped_jeans: { body: 'cl_tim', part: '^Bottoms_' },
  c_police_pants: { body: 'fem_police', part: '^Bottoms_' },
  c_kneepad_pants: { body: 'cl_alan', part: ' Wolf3D_Outfit_Bottom$' },
  c_flora_pants: { body: 'rus_a', part: '^Bottoms_' },
  c_desert_pants: { body: 'ukr_b', part: '^Bottoms_' },
  c_acu_pants: { body: 'cl_soldier', part: '^Bottoms_' },
  c_officer_pants: { body: 'pmc_heavy', part: 'Mark_Pants' },
  // Footwear
  c_shoes: { body: 'cl_man', part: '^shoes_' },
  c_sneakers: { body: 'cl_tim', part: '^Shoes_' },
  c_tall_boots: { body: 'cl_civ', part: '_Shoes_' },
  c_police_shoes: { body: 'fem_police', part: '^Shoes_' },
  c_kirza: { body: 'rus_a', part: '^Shoes_' },
  c_combat_boots: { body: 'cl_soldier', part: '^Shoes_' },
  c_desert_boots: { body: 'ukr_b', part: '^Shoes_' },
  c_survivor_boots: { body: 'cl_alan', part: ' Wolf3D_Outfit_Footwear$' },
  c_officer_boots: { body: 'pmc_heavy', part: 'Mark_Boots' },
};

/** Outfits for people whose clothes don't come from items (NPCs, bosses, the infected): picked by a seed. */
export const DEFAULT_OUTFITS: string[][] = [
  ['c_knit', 'c_trousers', 'c_shoes'],
  ['c_bomber', 'c_work_pants', 'c_sneakers'],
  ['c_survivor_top', 'c_kneepad_pants', 'c_survivor_boots'],
  ['c_knit', 'c_ripped_jeans', 'c_tall_boots'],
  ['c_smock', 'c_flora_pants', 'c_kirza'],
  ['c_police_shirt', 'c_police_pants', 'c_police_shoes'],
  ['c_bomber', 'c_trousers', 'c_shoes'],
  ['c_survivor_top', 'c_work_pants', 'c_kirza'],
];
