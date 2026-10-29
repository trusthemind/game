import { createStore, get, set, del } from 'idb-keyval';
import { migrateProfile, type Profile } from '@ashfall/engine';

/**
 * Local-first persistence. IndexedDB holds the profile so the game works offline and boots instantly;
 * the server copy (see api.ts) is synced on top. Falls back to localStorage when IndexedDB is unavailable
 * (Safari private windows).
 */
const store = typeof indexedDB !== 'undefined' ? createStore('ashfall', 'kv') : null;
const KEY = 'profile';
const AUTH_KEY = 'auth';

export interface AuthState {
  playerId: string;
  token: string;
}

async function rawGet<T>(key: string): Promise<T | undefined> {
  try {
    if (store) return await get<T>(key, store);
  } catch {
    /* fall through */
  }
  try {
    const s = localStorage.getItem(`ashfall:${key}`);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function rawSet(key: string, value: unknown): Promise<void> {
  try {
    if (store) return await set(key, value, store);
  } catch {
    /* fall through */
  }
  try {
    localStorage.setItem(`ashfall:${key}`, JSON.stringify(value));
  } catch {
    /* storage full / blocked: the server copy is still there */
  }
}

export async function loadLocalProfile(): Promise<Profile | null> {
  const raw = await rawGet<unknown>(KEY);
  return raw ? migrateProfile(raw) : null;
}

export const saveLocalProfile = (p: Profile) => rawSet(KEY, p);
export const loadAuth = () => rawGet<AuthState>(AUTH_KEY);
export const saveAuth = (a: AuthState) => rawSet(AUTH_KEY, a);

export async function wipeLocal(): Promise<void> {
  try {
    if (store) {
      await del(KEY, store);
      await del(AUTH_KEY, store);
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(`ashfall:${KEY}`);
    localStorage.removeItem(`ashfall:${AUTH_KEY}`);
  } catch {
    /* ignore */
  }
}
