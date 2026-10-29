import type { Rng } from '../core/rng';

/**
 * Tarkov-style per-limb health.
 *
 * - Seven body parts with their own HP. Head or thorax at 0 → death.
 * - A destroyed ("blacked") limb keeps working badly; further damage to it spills over to the other parts.
 * - Light bleeding (bandage) and heavy bleeding (tourniquet / kits) drain the bleeding part.
 * - Fractures (splint) cripple movement (legs) or aim (arms) and cause pain.
 * - Pain makes your hands shake; painkillers suppress pain and let you run on a broken leg.
 * - A surgical kit restores a blacked limb, but its maximum HP is permanently reduced for the raid.
 */
export type BodyPart = 'head' | 'thorax' | 'stomach' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export const BODY_PARTS: readonly BodyPart[] = ['head', 'thorax', 'stomach', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
export const PART_MAX: Record<BodyPart, number> = { head: 35, thorax: 85, stomach: 70, leftArm: 60, rightArm: 60, leftLeg: 65, rightLeg: 65 };
export const PART_LABEL: Record<BodyPart, string> = {
  head: 'Head',
  thorax: 'Thorax',
  stomach: 'Stomach',
  leftArm: 'Left arm',
  rightArm: 'Right arm',
  leftLeg: 'Left leg',
  rightLeg: 'Right leg',
};

export const LIGHT_BLEED_DPS = 0.75;
export const HEAVY_BLEED_DPS = 2.2;

export interface PartState {
  hp: number;
  max: number;
  light: boolean;
  heavy: boolean;
  fracture: boolean;
}

export interface Health {
  parts: Record<BodyPart, PartState>;
  /** Seconds of painkiller effect left. */
  painkiller: number;
  /** Regeneration from stimulants: hp/s and seconds left. */
  regen: number;
  regenT: number;
  /** No bleeding / fractures (infected). */
  immune: boolean;
}

export function createHealth(scale = 1, immune = false): Health {
  const parts = {} as Record<BodyPart, PartState>;
  for (const p of BODY_PARTS) {
    const max = Math.round(PART_MAX[p] * scale);
    parts[p] = { hp: max, max, light: false, heavy: false, fracture: false };
  }
  return { parts, painkiller: 0, regen: 0, regenT: 0, immune };
}

export const isLimb = (p: BodyPart) => p === 'leftArm' || p === 'rightArm' || p === 'leftLeg' || p === 'rightLeg';
export const isVital = (p: BodyPart) => p === 'head' || p === 'thorax';

export function totalHp(h: Health): number {
  let s = 0;
  for (const p of BODY_PARTS) s += h.parts[p].hp;
  return s;
}

export function totalMax(h: Health): number {
  let s = 0;
  for (const p of BODY_PARTS) s += h.parts[p].max;
  return s;
}

export function isDead(h: Health): boolean {
  return h.parts.head.hp <= 0 || h.parts.thorax.hp <= 0;
}

export function blacked(h: Health, p: BodyPart): boolean {
  return h.parts[p].hp <= 0;
}

export function bleeding(h: Health): { light: boolean; heavy: boolean } {
  let light = false;
  let heavy = false;
  for (const p of BODY_PARTS) {
    light ||= h.parts[p].light;
    heavy ||= h.parts[p].heavy;
  }
  return { light, heavy };
}

/** In pain = fracture or blacked limb, not suppressed by painkillers. */
export function inPain(h: Health): boolean {
  if (h.painkiller > 0) return false;
  return BODY_PARTS.some((p) => h.parts[p].fracture || (isLimb(p) && h.parts[p].hp <= 0));
}

export interface DamageOpts {
  bleedChance?: number;
  heavyChance?: number;
  fractureChance?: number;
}

/**
 * Apply damage to a part. Damage to a blacked limb spreads ×0.7 across the remaining parts (stomach ×1.5 to it,
 * like Tarkov's punishing gut shots). Returns true if this killed the target.
 */
export function damagePart(h: Health, part: BodyPart, dmg: number, rng: Rng | null, o: DamageOpts = {}): boolean {
  if (dmg <= 0) return isDead(h);
  const s = h.parts[part];
  if (s.hp <= 0 && !isVital(part)) {
    spread(h, part, dmg * 0.7);
  } else {
    const before = s.hp;
    s.hp = Math.max(0, s.hp - dmg);
    // Overkill on a limb also spills.
    if (!isVital(part) && dmg > before) spread(h, part, (dmg - before) * 0.7);
  }
  if (rng && !h.immune) {
    if (o.bleedChance && rng.chance(o.bleedChance)) {
      if (rng.chance(o.heavyChance ?? 0.25)) s.heavy = true;
      else s.light = true;
    }
    if (o.fractureChance && isLimb(part) && rng.chance(o.fractureChance)) s.fracture = true;
  }
  return isDead(h);
}

function spread(h: Health, from: BodyPart, amount: number): void {
  const targets = BODY_PARTS.filter((p) => p !== from && h.parts[p].hp > 0);
  if (!targets.length) {
    h.parts.thorax.hp = 0;
    return;
  }
  const share = amount / targets.length;
  for (const p of targets) h.parts[p].hp = Math.max(0, h.parts[p].hp - share * (p === 'stomach' ? 1.5 : 1));
}

/** Bleeding, regeneration and effect timers. Returns damage dealt this tick (for hit feedback). */
export function tickHealth(h: Health, dt: number): number {
  let dealt = 0;
  for (const p of BODY_PARTS) {
    const s = h.parts[p];
    const dps = (s.heavy ? HEAVY_BLEED_DPS : 0) + (s.light ? LIGHT_BLEED_DPS : 0);
    if (dps > 0) {
      damagePart(h, p, dps * dt, null);
      dealt += dps * dt;
    }
  }
  if (h.regenT > 0) {
    h.regenT -= dt;
    healPool(h, h.regen * dt);
  }
  h.painkiller = Math.max(0, h.painkiller - dt);
  return dealt;
}

/** Distribute healing over damaged, non-destroyed parts (most damaged first). Returns HP actually healed. */
export function healPool(h: Health, amount: number, only?: BodyPart): number {
  let left = amount;
  const order = (only ? [only] : [...BODY_PARTS])
    .filter((p) => h.parts[p].hp > 0 && h.parts[p].hp < h.parts[p].max)
    .sort((a, b) => h.parts[a].hp / h.parts[a].max - h.parts[b].hp / h.parts[b].max);
  for (const p of order) {
    if (left <= 0) break;
    const s = h.parts[p];
    const n = Math.min(left, s.max - s.hp);
    s.hp += n;
    left -= n;
  }
  return amount - left;
}

// ── Gameplay modifiers ────────────────────────────────────────────────────────

/** Movement multiplier from leg injuries. */
export function moveMul(h: Health): number {
  let m = 1;
  for (const p of ['leftLeg', 'rightLeg'] as const) {
    const s = h.parts[p];
    if (s.hp <= 0) m *= 0.72;
    else if (s.fracture && h.painkiller <= 0) m *= 0.75;
  }
  return m;
}

/** Sprinting needs two working legs (or painkillers). */
export function canSprint(h: Health): boolean {
  if (h.painkiller > 0) return true;
  return !(['leftLeg', 'rightLeg'] as const).some((p) => h.parts[p].fracture || h.parts[p].hp <= 0);
}

/** Weapon spread multiplier from arm injuries and pain tremor. */
export function aimMul(h: Health): number {
  let m = 1;
  for (const p of ['leftArm', 'rightArm'] as const) {
    const s = h.parts[p];
    if (s.hp <= 0) m *= 1.55;
    else if (s.fracture) m *= 1.3;
  }
  if (inPain(h)) m *= 1.25;
  return m;
}

/** Destroyed stomach makes you burn through food & water. */
export function metabolismMul(h: Health): number {
  return h.parts.stomach.hp <= 0 ? 3 : 1;
}

// ── Treatment ────────────────────────────────────────────────────────────────

export interface MedEffect {
  /** HP pool the item holds in total (multi-use kits). 0 = no healing. */
  resource: number;
  stopsLight: boolean;
  stopsHeavy: boolean;
  fixesFracture: boolean;
  surgery: boolean;
  /** Seconds of painkiller. */
  painkiller: number;
  /** HP per second for `regenTime` seconds. */
  regen?: number;
  regenTime?: number;
  /** Resource cost to stop a light / heavy bleed, or to fix a fracture (kits). */
  costLight?: number;
  costHeavy?: number;
  costFracture?: number;
  /** Discrete uses for non-resource items (bandages, splints, painkillers…). */
  uses: number;
  useTime: number;
}

/** What a med would do right now; used for picking the best part and for the "Use" button state. */
export function treatmentTarget(h: Health, m: MedEffect, preferred?: BodyPart): BodyPart | null {
  const parts = preferred ? [preferred, ...BODY_PARTS.filter((p) => p !== preferred)] : [...BODY_PARTS];
  if (m.surgery) return parts.find((p) => isLimb(p) && h.parts[p].hp <= 0) ?? null;
  if (m.stopsHeavy) {
    const p = parts.find((x) => h.parts[x].heavy);
    if (p) return p;
  }
  if (m.stopsLight) {
    const p = parts.find((x) => h.parts[x].light);
    if (p) return p;
  }
  if (m.fixesFracture) {
    const p = parts.find((x) => h.parts[x].fracture);
    if (p) return p;
  }
  if (m.resource > 0) {
    const p = parts.find((x) => h.parts[x].hp > 0 && h.parts[x].hp < h.parts[x].max);
    if (p) return p;
  }
  if (m.painkiller > 0 || m.regen) return 'head';
  return null;
}

/**
 * Apply one use of a med to a part. `remaining` is the item's uses/resource left. Returns the new remaining value
 * (0 → item is consumed) or null when the item had nothing to do.
 */
export function applyMed(h: Health, m: MedEffect, part: BodyPart, remaining: number): number | null {
  const s = h.parts[part];
  let did = false;
  let rem = remaining;
  if (m.surgery) {
    if (!(isLimb(part) && s.hp <= 0)) return null;
    s.max = Math.max(1, Math.round(s.max * 0.6));
    s.hp = 1;
    s.light = s.heavy = false;
    return rem - 1;
  }
  if (m.resource > 0) {
    // Resource kits: pay for bleeds/fractures out of the pool, then heal.
    if (s.heavy && m.stopsHeavy && rem >= (m.costHeavy ?? 0)) {
      s.heavy = false;
      rem -= m.costHeavy ?? 0;
      did = true;
    }
    if (s.light && m.stopsLight && rem >= (m.costLight ?? 0)) {
      s.light = false;
      rem -= m.costLight ?? 0;
      did = true;
    }
    if (s.fracture && m.fixesFracture && rem >= (m.costFracture ?? 0)) {
      s.fracture = false;
      rem -= m.costFracture ?? 0;
      did = true;
    }
    const healed = healPool(h, Math.min(rem, 999), s.hp > 0 && s.hp < s.max ? part : undefined);
    rem -= healed;
    did ||= healed > 0;
    return did ? Math.max(0, rem) : null;
  }
  if (m.stopsHeavy && s.heavy) {
    s.heavy = false;
    did = true;
  } else if (m.stopsLight && s.light) {
    s.light = false;
    did = true;
  }
  if (m.fixesFracture && s.fracture) {
    s.fracture = false;
    did = true;
  }
  if (m.painkiller > 0) {
    h.painkiller = Math.max(h.painkiller, m.painkiller);
    did = true;
  }
  if (m.regen && m.regenTime) {
    h.regen = m.regen;
    h.regenT = Math.max(h.regenT, m.regenTime);
    did = true;
  }
  return did ? rem - 1 : null;
}
