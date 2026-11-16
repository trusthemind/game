import { tidyNudity, type Nudity } from '@ashfall/engine';

/**
 * The client's nudity setting (Profile → Settings, also in Customize), read by every human the renderer draws.
 * 'nevernude' (default, also before any profile is loaded): underwear where no clothing covers the body. 'nude':
 * the bare body there (characters are adults). Clothing always covers. `?nude=1` forces 'nude' (dev, CharLab).
 */
const forced: Nudity | null = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nude') === '1' ? 'nude' : null;
let current: Nudity = forced ?? 'nevernude';
let version = 0;

export function nudity(): Nudity {
  return current;
}

/** Bumped on every change: a character view re-applies its underwear/anatomy when it differs from its own. */
export function nudityVersion(): number {
  return version;
}

export function setNudity(v: unknown): void {
  const next = forced ?? tidyNudity(v);
  if (next === current) return;
  current = next;
  version++;
}
