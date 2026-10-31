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
  /** Right mouse / aim-down: face the aim point and shoot accurately. Bots always aim. */
  aim: boolean;
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
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, crouch: false, aim: false,
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
  /** Item definition being used (for the animation), null when idle. */
  useDef: string | null;
  usePart: BodyPart | null;
  crouching: boolean;
  sprinting: boolean;
  /** Ran out of stamina: no sprinting until it recovers. */
  winded: boolean;
  /** Climbing through a window: seconds left and the path. */
  vaultT: number;
  vaultFrom: Vec2 | null;
  vaultTo: Vec2 | null;
  /** Currently aiming (player holds aim, or recently fired). */
  aiming: boolean;
  flashlight: boolean;
  lastHitAt: number;
  lastAttacker: number | null;
  /** Raid time of the last shot fired or hit taken (auto-heal waits for a lull). */
  combatAt: number;
  /** Riding in a vehicle (see sim/vehicle.ts): position follows the seat, no walking or shooting. */
  vehicle?: { id: number; seat: number } | null;
  kills: number;
  stepT: number;
  intent: ActorIntent;
  brain: Brain | null;
  /** Dialogue NPC id (for npc faction and companions). */
  npcId?: string;
  /** Named boss id (BOSSES). */
  bossId?: string;
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
  id: number;
}

export type RaidEvent =
  | { t: 'shot'; actor: number; fx: number; fy: number; tx: number; ty: number; weapon: string; hit: boolean; suppressed?: boolean; pellet?: boolean }
  | { t: 'swing'; actor: number; x: number; y: number; facing: number; weapon: string }
  | { t: 'hit'; target: number; attacker: number; x: number; y: number; zone: HitZone; damage: number; penetrated: boolean; melee: boolean }
  | { t: 'impact'; x: number; y: number; material: 'wood' | 'metal' | 'ground' | 'glass' }
  | { t: 'death'; actor: number; killer: number | null; name: string; faction: Faction }
  | { t: 'reload'; actor: number }
  | { t: 'step'; actor: number; x: number; y: number; tile: number; indoor: boolean; loud: number }
  | { t: 'used'; actor: number; item: string }
  | { t: 'msg'; text: string; tone?: 'info' | 'good' | 'bad' }
  | { t: 'extracted' }
  | { t: 'died' }
  | { t: 'vault'; actor: number }
  | { t: 'glass'; x: number; y: number; idx: number }
  | { t: 'vehicle'; id: number; actor: number; what: 'enter' | 'exit' | 'crash' | 'runover'; x: number; y: number; power: number };

export function hostile(a: Faction, b: Faction): boolean {
  if (a === b) return false;
  if (a === 'infected' || b === 'infected') return true;
  if (a === 'npc' || b === 'npc') return false;
  return true;
}
