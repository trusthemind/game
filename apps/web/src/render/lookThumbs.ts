import type { PlayerLook } from '@ashfall/engine';
import { getAssets, loadAssets, loadBodies } from './assets';
import { nudity } from './nudity';
import { lookBodies, playerAppearance, renderPortrait } from './character';
import { assetHairLoaded, loadAssetHair } from './assetHair';

/**
 * Pictures for the character creator's tiles (a face, a hairstyle, a beard, a build), drawn on the shared
 * offscreen renderer (renderPortrait) one at a time, time-sliced (a slice of ~8 ms per frame, so a picture or two a
 * frame; a cold hairstyle is one longer step), and only for tiles on screen (the caller asks when a tile scrolls in).
 * Each picture is keyed by the whole look it shows; callers pass a canonical look (only the sex, skin and the
 * option itself vary), so the cache is effectively per sex and skin and survives reopening the creator.
 * Head pictures (face, hair, mug) are drawn without clothes: none shows in those frames (checked pixel for pixel),
 * and dressing the body is most of a picture's cost.
 */
export type LookThumbKind = 'face' | 'body' | 'hair' | 'mug';

const SIZE = 160;
/** Most pictures kept (a data URL is ~20-40 KB): a few skins' worth of every grid. */
const MAX_CACHE = 600;
/** Per frame: keep drawing while under this many ms. */
const SLICE_MS = 8;
const cache = new Map<string, string>();
interface Job {
  key: string;
  look: PlayerLook;
  kind: LookThumbKind;
  /** Asked for again recently (on screen): drawn first. */
  at: number;
}
const queue = new Map<string, Job>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();
let running = false;
let pausedUntil = 0;

// Keyed by the nudity setting too: a body picture differs between the two.
export const lookThumbKey = (look: PlayerLook, kind: LookThumbKind) => kind + nudity() + JSON.stringify(look);

/** The picture if drawn, without touching its place in the cache (a React snapshot). */
export function lookThumbUrl(key: string): string | null {
  return cache.get(key) || null;
}

/** The picture if drawn (no queuing). */
export function peekLookThumb(key: string): string | null {
  const hit = cache.get(key);
  if (hit === undefined) return null;
  // LRU: touched pictures go to the back.
  cache.delete(key);
  cache.set(key, hit);
  return hit || null;
}

/** The picture if it's drawn; otherwise null, and it's queued (listeners of its key hear when it lands). */
export function getLookThumb(look: PlayerLook, kind: LookThumbKind, key = lookThumbKey(look, kind)): string | null {
  if (cache.has(key)) return peekLookThumb(key);
  const q = queue.get(key);
  if (q) q.at = performance.now();
  else queue.set(key, { key, look, kind, at: performance.now() });
  pump();
  return null;
}

/** A tile scrolled away (or unmounted): its picture isn't needed now. */
export function cancelLookThumb(key: string): void {
  queue.delete(key);
}

/** Drop queued pictures nobody is looking at any more (a tab was switched, the skin changed). */
export function trimLookThumbs(keep: (look: PlayerLook, kind: LookThumbKind) => boolean): void {
  for (const [k, q] of queue) if (!keep(q.look, q.kind)) queue.delete(k);
}

/** Hear when this key's picture lands. */
export function onLookThumb(key: string, fn: () => void): () => void {
  let s = listeners.get(key);
  if (!s) listeners.set(key, (s = new Set()));
  s.add(fn);
  return () => {
    s.delete(fn);
    if (!s.size) listeners.delete(key);
  };
}

/** Hear when any picture lands. */
export function onLookThumbs(fn: () => void): () => void {
  anyListeners.add(fn);
  return () => anyListeners.delete(fn);
}

/** Hold the drawing for a moment (the user is dragging a slider or sweeping the tiles: the live preview first). */
export function pauseLookThumbs(ms = 150): void {
  pausedUntil = Math.max(pausedUntil, performance.now() + ms);
}

/** Pictures queued or being drawn (dev measurements). */
export function lookThumbsPending(): number {
  return queue.size + (running ? 1 : 0);
}
/** Dev: [kind, key, ms] of the last pictures drawn. */
const drawLog: [string, string, number][] = [];
if (import.meta.env.DEV && typeof window !== 'undefined')
  Object.assign(window, { __lookThumbsPending: lookThumbsPending, __lookThumbsLog: drawLog });

/** Forget every picture (the creator closed for good, memory wanted back). */
export function clearLookThumbs(): void {
  cache.clear();
  latest.clear();
  queue.clear();
}

/** Start the one-off loads the pictures need while the user looks at the first tab (the modelled hair). */
export function prewarmLookThumbs(): void {
  void loadAssetHair();
}

/**
 * The latest picture of each option whatever its colours (skin, hair colour): shown while the picture in the new
 * colours is drawn, so a colour change or reopening a tab swaps pictures instead of blanking the grid.
 */
const latest = new Map<string, string>();
const colourless = (key: string) => key.replace(/"(skin|hairColor|beardColor)":\d+,?/g, '');
export function lookThumbStale(key: string): string | null {
  return latest.get(colourless(key)) ?? null;
}

function land(key: string, url: string): void {
  cache.set(key, url);
  if (url) {
    const c = colourless(key);
    latest.delete(c);
    latest.set(c, url);
    while (latest.size > MAX_CACHE) latest.delete(latest.keys().next().value!);
  }
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  for (const fn of listeners.get(key) ?? []) fn();
  for (const fn of anyListeners) fn();
}

function next(): Job | undefined {
  // The most recently asked for first (what's on screen now), so a fast scroll doesn't wait behind old tiles.
  let best: Job | undefined;
  for (const q of queue.values()) if (!best || q.at > best.at) best = q;
  if (best) queue.delete(best.key);
  return best;
}

/** A task of its own, after whatever else is waiting (not clamped or throttled like a chain of timeouts). */
const port = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const posted: (() => void)[] = [];
if (port) port.port1.onmessage = () => posted.shift()?.();
const task = (fn: () => void) => {
  if (!port) return void setTimeout(fn, 0);
  posted.push(fn);
  port.port2.postMessage(0);
};
/** After the next frame is drawn (a hidden page draws none: then just after the other tasks waiting). */
const frame = (fn: () => void) =>
  typeof requestAnimationFrame === 'function' && !document.hidden ? requestAnimationFrame(() => task(fn)) : task(fn);

function pump(): void {
  if (running) return;
  running = true;
  const slice = async () => {
    const t0 = performance.now();
    if (t0 < pausedUntil) {
      setTimeout(() => void slice(), Math.min(100, pausedUntil - t0 + 5));
      return;
    }
    let lib = getAssets();
    if (!lib) lib = await loadAssets();
    while (performance.now() - t0 < SLICE_MS) {
      const q = next();
      if (!q) {
        running = false;
        return;
      }
      if (cache.has(q.key)) continue;
      try {
        const look = playerAppearance(q.look);
        // Head pictures: no clothes (none shows; see above). Build pictures keep the outfit.
        const a = q.kind === 'body' ? look : { ...look, kit: [] };
        await loadBodies(lib, lookBodies(a));
        // The modelled hair is drawn only once loaded (a picture drawn before would keep the stand-in).
        if (!assetHairLoaded()) await loadAssetHair();
        const t1 = performance.now();
        const url = renderPortrait(lib, a, SIZE, q.kind, undefined, undefined, true);
        if (import.meta.env.DEV) drawLog.push([q.kind, q.key.length > 80 ? q.key.slice(0, 80) : q.key, Math.round(performance.now() - t1)]) > 400 && drawLog.shift();
        land(q.key, url);
      } catch {
        land(q.key, '');
      }
    }
    frame(() => void slice());
  };
  frame(() => void slice());
}
