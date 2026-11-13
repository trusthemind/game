import type { BrainState } from '../ai/brain';
import type { Actor } from '../sim/types';
import { getDef } from './defs';
import type { ItemInstance } from './inventory';

/** Does this item have a faceplate or visor that can be lowered and raised (ArmorStats `visor`)? */
export const hasVisor = (item: ItemInstance | null | undefined): boolean => !!item && !!getDef(item.def).armor?.visor;

/** Is its visor down? Only an item that has one; unset means raised. */
export const isVisorDown = (item: ItemInstance | null | undefined): boolean => hasVisor(item) && !!item!.visorDown;

/** Lower a raised visor or raise a lowered one. False (and nothing changes) for an item without one. Raised is
 * stored as no field at all, so items saved before visors keep comparing equal. */
export function toggleVisor(item: ItemInstance | null | undefined): boolean {
  if (!item || !hasVisor(item)) return false;
  if (item.visorDown) delete item.visorDown;
  else item.visorDown = true;
  return true;
}

/** The states in which a bot is fighting or on the alert. */
const COMBAT: ReadonlySet<BrainState> = new Set<BrainState>(['engage', 'cover', 'search', 'investigate', 'chase', 'flee']);

/**
 * Whether an actor wears its helmet's visor down right now. Someone with a brain (bots, guards, companions) lowers
 * it while fighting or alerted and raises it when calm again: a rule of its state, nothing stored, nothing to tick.
 * Everyone else (the player) wears it as the item says.
 */
export function actorVisorDown(a: Pick<Actor, 'eq' | 'brain'>): boolean {
  const h = a.eq.slots.helmet;
  if (!hasVisor(h)) return false;
  if (a.brain) return a.brain.alerted || COMBAT.has(a.brain.state);
  return !!h!.visorDown;
}
