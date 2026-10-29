import type { Profile } from '@ashfall/engine';
import type { AuthState } from './persistence';

/** Thin client for the Go backend (server/). Every call is optional: the game runs fully offline. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers, signal: ctrl.signal });
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => req<{ ok: boolean; db: string }>('/health'),
  register: (name: string) => req<AuthState & { code: string }>('/players', { method: 'POST', body: JSON.stringify({ name }) }),
  getProfile: (auth: AuthState) => req<{ profile: Profile | null; rev: number }>('/profile', { token: auth.token }),
  putProfile: (auth: AuthState, profile: Profile, baseRev: number) =>
    req<{ rev: number }>('/profile', { method: 'PUT', token: auth.token, body: JSON.stringify({ profile, baseRev }) }),
  linkCode: (auth: AuthState) => req<{ code: string }>('/players/me/code', { token: auth.token }),
  claim: (code: string) => req<AuthState>('/players/claim', { method: 'POST', body: JSON.stringify({ code }) }),
  postRaid: (auth: AuthState, raid: { status: string; kills: number; xp: number; value: number; duration: number }) =>
    req<{ ok: boolean }>('/raids', { method: 'POST', token: auth.token, body: JSON.stringify(raid) }),
  leaderboard: () => req<{ entries: { name: string; level: number; xp: number; survived: number; kills: number }[] }>('/leaderboard'),
};
