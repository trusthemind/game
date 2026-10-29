export interface Relationship {
  /** -100 … 100 */
  affinity: number;
  flags: string[];
  met: boolean;
  talks: number;
  dead: boolean;
}

export type Stage = 'hostile' | 'stranger' | 'acquaintance' | 'friend' | 'close' | 'partner';

export interface Condition {
  minAffinity?: number;
  maxAffinity?: number;
  flag?: string;
  notFlag?: string | string[];
  /** Item (def id) the player must have, optionally a count. */
  hasItem?: { def: string; n?: number };
  inRaid?: boolean;
  companion?: boolean;
  stage?: Stage[];
  minTalks?: number;
  minMoney?: number;
}

export interface Effect {
  affinity?: number;
  flag?: string;
  unflag?: string;
  take?: { def: string; n?: number };
  give?: { def: string; n?: number };
  money?: number;
  recruit?: boolean;
  dismiss?: boolean;
  /** In-raid: the NPC starts following the player right now. */
  joinNow?: boolean;
  /** In-raid: patch the NPC up (stop bleeding, restore HP). */
  healNpc?: boolean;
  openTrade?: boolean;
}

export interface Choice {
  text: string;
  next: string | null;
  cond?: Condition;
  effects?: Effect[];
  /** Hidden after it's been picked once (tracked via an auto flag). */
  once?: boolean;
}

export interface DialogueNode {
  id: string;
  /** Who speaks the line; 'narrator' is rendered as italic stage direction. */
  speaker: 'npc' | 'narrator';
  text: string;
  effects?: Effect[];
  choices: Choice[];
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  bio: string;
  /** UI accent colour. */
  color: string;
  /** Can join the player in raids once affinity is high enough. */
  canRecruit: boolean;
  /** Romance is possible (gated behind high affinity + explicit choices). */
  romanceable: boolean;
  /** Where the NPC is met: 'raid' encounters spawn in buildings of `prefers`; 'hideout' NPCs live at the base. */
  home: 'raid' | 'hideout';
  prefers?: string[];
  /** Ordered entry points: the first whose condition matches starts the conversation. */
  entries: { cond?: Condition; node: string }[];
  nodes: Record<string, DialogueNode>;
}

export const newRelationship = (): Relationship => ({ affinity: 0, flags: [], met: false, talks: 0, dead: false });

export function stageOf(rel: Relationship): Stage {
  if (rel.flags.includes('romance') && rel.affinity >= 70) return 'partner';
  if (rel.affinity < -30) return 'hostile';
  if (rel.affinity < 10) return 'stranger';
  if (rel.affinity < 35) return 'acquaintance';
  if (rel.affinity < 65) return 'friend';
  return 'close';
}

export const STAGE_LABEL: Record<Stage, string> = {
  hostile: 'Hostile',
  stranger: 'Stranger',
  acquaintance: 'Acquaintance',
  friend: 'Friend',
  close: 'Close friend',
  partner: 'Partner',
};
