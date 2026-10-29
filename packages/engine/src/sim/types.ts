import type { Vec2 } from '../core/math';
import type { Equipment } from '../items/inventory';
import type { BotArchetype } from '../world/map';
import type { BotBrain as Brain } from '../ai/brain';
import type { BodyPart, Health } from './health';

export type Faction = 'player' | 'scav' | 'raider' | 'infected' | 'boss' | 'npc';
export type WeaponSlot = 'primary' | 'secondary' | 'melee';
export type HitZone = BodyPart;

/** What an actor wants to do this tick. Produced by player input or by a bot brain — the sim treats both the same. */
export interface ActorIntent {
  moveX: number;
  moveY: number;
  /** World-space point the actor is aiming at. */
  aimX: number;
  aimY: number;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  /** Edge-triggered fire (semi-auto & melee need a fresh press). */
  firePressed: boolean;
  reload: boolean;
  switchTo: WeaponSlot | null;
  /** Item uid to consume (meds / food). */
  use: string | null;
  /** Body part to treat with `use` (null = pick automatically). */
  useOn?: BodyPart | null;
}

export const emptyIntent = (): ActorIntent => ({
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, crouch: false,
  fire: false, firePressed: false, reload: false, switchTo: null, use: null,
});

export interface Actor {
  id: number;
  name: string;
  faction: Faction;
  archetype: BotArchetype | 'player' | 'npc';
  pos: Vec2;
  vel: Vec2;
  facing: number;
  radius: number;
  baseSpeed: number;
  /** Cached weight/armour movement multiplier (recomputed a few times per second). */
  speedMul: number;
  /** Total HP across body parts (derived from `health`, kept in sync for AI/UI). */
  hp: number;
  maxHp: number;
  /** HP per second currently lost to bleeding (derived). */
  bleed: number;
  health: Health;
  stamina: number;
  energy: number;
  hydration: number;
  alive: boolean;
  eq: Equipment;
  active: WeaponSlot;
  fireCd: number;
  reloadT: number;
  /** Extra spread from sustained fire, decays over time. */
  bloom: number;
  useT: number;
  useUid: string | null;
  usePart: BodyPart | null;
  crouching: boolean;
  sprinting: boolean;
  flashlight: boolean;
  lastHitAt: number;
  lastAttacker: number | null;
  kills: number;
  stepT: number;
  intent: ActorIntent;
  brain: Brain | null;
  /** Dialogue NPC id (for npc faction and companions). */
  npcId?: string;
  /** Companion following the player. */
  companion?: boolean;
  /** Natural attack for creatures without gear (infected claws). */
  natural?: { damage: number; cooldown: number; reach: number; bleedChance: number };
}

export interface Corpse {
  id: number;
  actorId: number;
  name: string;
  faction: Faction;
  pos: Vec2;
  facing: number;
  eq: Equipment;
}

export interface Noise {
  x: number;
  y: number;
  radius: number;
  source: number;
  t: number;
  /** Gunfire is far more alarming than footsteps. */
  kind: 'step' | 'shot' | 'melee' | 'impact';
}

export type RaidEvent =
  | { t: 'shot'; actor: number; fx: number; fy: number; tx: number; ty: number; weapon: string; hit: boolean }
  | { t: 'swing'; actor: number; x: number; y: number; facing: number; weapon: string }
  | { t: 'hit'; target: number; attacker: number; x: number; y: number; zone: HitZone; damage: number; penetrated: boolean; melee: boolean }
  | { t: 'impact'; x: number; y: number }
  | { t: 'death'; actor: number; killer: number | null; name: string; faction: Faction }
  | { t: 'reload'; actor: number }
  | { t: 'used'; actor: number; item: string }
  | { t: 'msg'; text: string; tone?: 'info' | 'good' | 'bad' }
  | { t: 'extracted' }
  | { t: 'died' };

export function hostile(a: Faction, b: Faction): boolean {
  if (a === b) return false;
  if (a === 'infected' || b === 'infected') return true;
  if (a === 'npc' || b === 'npc') return false;
  return true;
}
