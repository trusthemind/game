import type { PlayerLook } from '@ashfall/engine';
import { getAssets, loadAssets, loadBodies } from './assets';
import { lookBodies, playerAppearance, renderPortrait } from './character';

/**
 * Pictures for the character creator's tiles (a face, a hairstyle, a beard, a build), drawn on the shared
 * offscreen renderer (renderPortrait) one per idle slot, so opening the creator never stalls a frame for long.
 * Each picture is keyed by the whole look it shows; callers pass a canonical look (only the sex, skin and the
 * option itself vary), so the cache is effectively per sex and skin and survives reopening the creator.
 */
export type LookThumbKind = 'face' | 'body' | 'hair';

const SIZE = 160;
const cache = new Map<string, string>();
const queue: { key: string; look: PlayerLook; kind: LookThumbKind }[] = [];
const listeners = new Set<() => void>();
let running = false;

const keyOf = (look: PlayerLook, kind: LookThumbKind) => kind + JSON.stringify(look);

/** The picture if it's drawn; otherwise null, and it's queued (listeners hear when it lands). */
export function getLookThumb(look: PlayerLook, kind: LookThumbKind): string | null {
  const key = keyOf(look, kind);
  const hit = cache.get(key);
  if (hit !== undefined) return hit || null;
  if (!queue.some((q) => q.key === key)) queue.push({ key, look, kind });
  pump();
  return null;
}

/** Drop queued pictures nobody is looking at any more (a tab was switched, the skin changed). */
export function trimLookThumbs(keep: (look: PlayerLook, kind: LookThumbKind) => boolean): void {
  for (let i = queue.length - 1; i >= 0; i--) if (!keep(queue[i]!.look, queue[i]!.kind)) queue.splice(i, 1);
}

export function onLookThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const idle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 16);

function pump(): void {
  if (running) return;
  running = true;
  const step = async () => {
    const q = queue.shift();
    if (!q) {
      running = false;
      return;
    }
    try {
      const lib = getAssets() ?? (await loadAssets());
      const a = playerAppearance(q.look);
      await loadBodies(lib, lookBodies(a));
      cache.set(q.key, renderPortrait(lib, a, SIZE, q.kind));
    } catch {
      cache.set(q.key, '');
    }
    for (const fn of listeners) fn();
    idle(() => void step());
  };
  idle(() => void step());
}
