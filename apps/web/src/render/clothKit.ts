/**
 * Which real garment each clothing item is: a piece of a licensed rigged model in models/bodies (credited in
 * models/CREDITS.txt), fitted to our own body at load (fitToRest in rebind.ts). `part` matches
 * "<glTF mesh name> <material name>" of the pieces to take.
 *
 * `short`: the sleeves stop above the elbow, so the forearms stay drawn. `keepHair`: worn with the hair showing
 * (a cap with a headset over short hair still hides it). `underHelmet`: stays on under a helmet (a balaclava);
 * other headwear comes off when one goes on. `open`: leaves skin bare in its own region (a crop top's midriff and
 * shoulders, shorts' thighs), so the body stays drawn under it instead of being cut away.
 */
export interface KitPiece {
  body: string;
  part: string;
  short?: boolean;
  underHelmet?: boolean;
  open?: boolean;
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
  c_ukr_jacket: { body: 'ukr_a', part: '^Tops_' },
  c_desert_top: { body: 'ukr_b', part: '^Tops_' },
  c_mil_suit: { body: 'pmc_a', part: '^Mil_Suit_R5(\\.001)?_Mil_Suit_R5_0|Pads_Leg' },
  c_swat_uniform: { body: 'swat', part: ' uniform$' },
  c_fsb_uniform: { body: 'fsb', part: ' uniform$' },
  c_fw_top: { body: 'pmc_a', part: '^Mil_Suit_R5_Mil_Suit_R5_0|Pads_Hands' },
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
  c_ukr_pants: { body: 'ukr_a', part: '^Bottoms_' },
  c_fw_pants: { body: 'pmc_a', part: '^Mil_Suit_R5\\.001_Mil_Suit_R5_0|Pads_Leg' },
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
  c_ukr_boots: { body: 'ukr_a', part: '^Shoes_' },
  c_swat_boots: { body: 'swat', part: ' boots$' },
  c_fw_boots: { body: 'pmc_a', part: '^Mil_Suit_R5\\.002_Mil_Suit_R5_0' },
  c_strap_boots: { body: 'fem_leather', part: '^Punk_Strap_Boots' },
  // Adventurer set (women's cut)
  c_crop_top: { open: true, body: 'cl_orion_f', part: ' Top\\.002$', short: true },
  c_sports_top: { open: true, body: 'cl_maryjane', part: '^Tops_', short: true },
  c_tank_gloves: { open: true, body: 'cl_nancy', part: '^(Tops|Gloves)_', short: true },
  c_denim_shorts: { open: true, body: 'cl_orion_f', part: ' Bottom\\.002$' },
  c_khaki_trousers: { body: 'cl_kelly', part: '^Bottoms_' },
  c_hiking_boots: { body: 'cl_orion_f', part: ' Shoes\\.002$' },
  c_lace_boots: { body: 'cl_kelly', part: '^Shoes_' },
  // Plainclothes set (men's cut)
  c_baseball_cap: { body: 'cl_jamal', part: '^Hats_' },
  c_leather_jacket: { body: 'cl_daren', part: '^Tops_' },
  c_brown_shirt: { body: 'cl_david', part: '^Tops_' },
  c_white_shirt: { body: 'cl_andrew', part: '^Tops_' },
  c_dark_jeans: { body: 'cl_daren', part: '^Bottoms_' },
  c_trail_shoes: { body: 'cl_david', part: '^Shoes_' },
  c_white_sneakers: { body: 'cl_andrew', part: '^Shoes_' },
};

/**
 * Outfits for people whose clothes don't come from items (NPCs, bosses, the infected): picked by a seed, among those
 * whose pieces aren't cut for the other sex (ItemDef clothing.sex).
 */
export const DEFAULT_OUTFITS: string[][] = [
  ['c_knit', 'c_trousers', 'c_shoes'],
  ['c_bomber', 'c_work_pants', 'c_sneakers'],
  ['c_survivor_top', 'c_kneepad_pants', 'c_survivor_boots'],
  ['c_knit', 'c_ripped_jeans', 'c_tall_boots'],
  ['c_smock', 'c_flora_pants', 'c_kirza'],
  ['c_police_shirt', 'c_police_pants', 'c_police_shoes'],
  ['c_bomber', 'c_trousers', 'c_shoes'],
  ['c_survivor_top', 'c_work_pants', 'c_kirza'],
  ['c_crop_top', 'c_denim_shorts', 'c_hiking_boots'],
  ['c_tank_gloves', 'c_khaki_trousers', 'c_lace_boots'],
  ['c_sports_top', 'c_khaki_trousers', 'c_hiking_boots'],
  ['c_leather_jacket', 'c_dark_jeans', 'c_lace_boots', 'c_baseball_cap'],
  ['c_brown_shirt', 'c_dark_jeans', 'c_trail_shoes'],
  ['c_white_shirt', 'c_dark_jeans', 'c_white_sneakers'],
];
