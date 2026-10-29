import type { Choice, Condition, DialogueNode, Effect, NpcDef, Relationship } from './types';
import { stageOf } from './types';

/** Side effects a dialogue can have on the world, supplied by whoever hosts the conversation (hideout or raid). */
export interface DialogueHost {
  inRaid: boolean;
  isCompanion: boolean;
  countItem(def: string): number;
  takeItem(def: string, n: number): boolean;
  giveItem(def: string, n: number): void;
  addMoney(delta: number): void;
  money(): number;
  recruit(): void;
  dismiss(): void;
  joinNow?(): void;
  healNpc?(): void;
  openTrade?(): void;
}

export function checkCondition(c: Condition | undefined, rel: Relationship, host: DialogueHost): boolean {
  if (!c) return true;
  if (c.minAffinity !== undefined && rel.affinity < c.minAffinity) return false;
  if (c.maxAffinity !== undefined && rel.affinity > c.maxAffinity) return false;
  if (c.flag && !rel.flags.includes(c.flag)) return false;
  if (c.notFlag && [c.notFlag].flat().some((f) => rel.flags.includes(f))) return false;
  if (c.hasItem && host.countItem(c.hasItem.def) < (c.hasItem.n ?? 1)) return false;
  if (c.inRaid !== undefined && c.inRaid !== host.inRaid) return false;
  if (c.companion !== undefined && c.companion !== host.isCompanion) return false;
  if (c.stage && !c.stage.includes(stageOf(rel))) return false;
  if (c.minTalks !== undefined && rel.talks < c.minTalks) return false;
  if (c.minMoney !== undefined && host.money() < c.minMoney) return false;
  return true;
}

export function applyEffects(effects: Effect[] | undefined, rel: Relationship, host: DialogueHost): void {
  for (const e of effects ?? []) {
    if (e.affinity) rel.affinity = Math.max(-100, Math.min(100, rel.affinity + e.affinity));
    if (e.flag && !rel.flags.includes(e.flag)) rel.flags.push(e.flag);
    if (e.unflag) rel.flags = rel.flags.filter((f) => f !== e.unflag);
    if (e.take) host.takeItem(e.take.def, e.take.n ?? 1);
    if (e.give) host.giveItem(e.give.def, e.give.n ?? 1);
    if (e.money) host.addMoney(e.money);
    if (e.recruit) host.recruit();
    if (e.dismiss) host.dismiss();
    if (e.joinNow) host.joinNow?.();
    if (e.healNpc) host.healNpc?.();
    if (e.openTrade) host.openTrade?.();
  }
}

/**
 * Walks an NPC's dialogue graph. Pure logic: the UI renders `node` + `choices` and calls `choose(i)`.
 */
export class DialogueRunner {
  node: DialogueNode | null = null;

  constructor(
    readonly npc: NpcDef,
    readonly rel: Relationship,
    private host: DialogueHost,
  ) {}

  start(): DialogueNode | null {
    const entry = this.npc.entries.find((e) => checkCondition(e.cond, this.rel, this.host));
    this.rel.met = true;
    this.rel.talks++;
    return this.goto(entry?.node ?? null);
  }

  get choices(): Choice[] {
    if (!this.node) return [];
    return this.node.choices.filter((c) => checkCondition(c.cond, this.rel, this.host) && !(c.once && this.rel.flags.includes(onceFlag(this.node!.id, c))));
  }

  /** Pick a visible choice by index. Returns the next node, or null when the conversation ends. */
  choose(index: number): DialogueNode | null {
    const c = this.choices[index];
    if (!c || !this.node) return this.node;
    if (c.once) this.rel.flags.push(onceFlag(this.node.id, c));
    applyEffects(c.effects, this.rel, this.host);
    return this.goto(c.next);
  }

  get ended(): boolean {
    return this.node === null;
  }

  private goto(id: string | null): DialogueNode | null {
    if (id === null) return (this.node = null);
    const n = this.npc.nodes[id];
    if (!n) throw new Error(`Dialogue ${this.npc.id}: missing node "${id}"`);
    this.node = n;
    applyEffects(n.effects, this.rel, this.host);
    return n;
  }
}

function onceFlag(nodeId: string, c: Choice): string {
  return `once:${nodeId}:${c.text.slice(0, 24)}`;
}

/** Every `next` must point to an existing node — used by tests to validate authored content. */
export function validateNpc(npc: NpcDef): string[] {
  const errors: string[] = [];
  for (const e of npc.entries) if (!npc.nodes[e.node]) errors.push(`entry → missing ${e.node}`);
  for (const n of Object.values(npc.nodes)) {
    if (n.choices.length === 0) errors.push(`${n.id}: dead end without choices`);
    for (const c of n.choices) if (c.next !== null && !npc.nodes[c.next]) errors.push(`${n.id} → missing ${c.next}`);
  }
  return errors;
}
