import { create } from 'zustand';
import { createProfile, migrateProfile, type Profile } from '@ashfall/engine';
import { api, ApiError } from './api';
import { loadAuth, loadLocalProfile, saveAuth, saveLocalProfile, wipeLocal, type AuthState } from './persistence';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error' | 'local';

interface ProfileState {
  profile: Profile | null;
  auth: AuthState | null;
  sync: SyncStatus;
  /** Server revision the local copy is based on. */
  serverRev: number;
  ready: boolean;
  boot(): Promise<void>;
  newProfile(name: string): Promise<void>;
  /** Mutate a draft copy of the profile; the store swaps it in atomically and schedules a save. */
  mutate(fn: (draft: Profile) => void): void;
  /** Like mutate, but only commits when `fn` returns true. */
  tryMutate(fn: (draft: Profile) => boolean): boolean;
  replace(p: Profile): void;
  flush(): Promise<void>;
  linkDevice(code: string): Promise<boolean>;
  reset(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pushing: Promise<void> | null = null;

export const useProfile = create<ProfileState>((set, getState) => {
  const schedule = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void getState().flush(), 1200);
  };

  async function push(): Promise<void> {
    const { profile, auth, serverRev } = getState();
    if (!profile || !auth) return;
    set({ sync: 'syncing' });
    try {
      const { rev } = await api.putProfile(auth, profile, serverRev);
      set({ serverRev: rev, sync: 'synced' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Another device saved first: newer server copy wins.
        const remote = await api.getProfile(auth);
        if (remote.profile) {
          const p = migrateProfile(remote.profile);
          set({ profile: p, serverRev: remote.rev, sync: 'synced' });
          await saveLocalProfile(p);
        }
        return;
      }
      set({ sync: e instanceof ApiError ? 'error' : 'offline' });
    }
  }

  async function connect(profile: Profile): Promise<void> {
    let auth = (await loadAuth()) ?? null;
    try {
      if (!auth) {
        const r = await api.register(profile.name);
        auth = { playerId: r.playerId, token: r.token };
        await saveAuth(auth);
      }
      set({ auth, sync: 'syncing' });
      const remote = await api.getProfile(auth);
      if (remote.profile && remote.rev > 0 && (remote.profile.updatedAt ?? 0) > profile.updatedAt) {
        const p = migrateProfile(remote.profile);
        set({ profile: p, serverRev: remote.rev, sync: 'synced' });
        await saveLocalProfile(p);
      } else {
        set({ serverRev: remote.rev });
        await push();
      }
    } catch {
      set({ auth, sync: auth ? 'offline' : 'local' });
    }
  }

  return {
    profile: null,
    auth: null,
    sync: 'local',
    serverRev: 0,
    ready: false,

    async boot() {
      const local = await loadLocalProfile();
      set({ profile: local, ready: true });
      if (local) void connect(local);
    },

    async newProfile(name) {
      const p = createProfile(name.trim() || 'Survivor');
      await wipeLocal();
      set({ profile: p, auth: null, serverRev: 0 });
      await saveLocalProfile(p);
      void connect(p);
    },

    mutate(fn) {
      const cur = getState().profile;
      if (!cur) return;
      const draft = structuredClone(cur);
      fn(draft);
      draft.updatedAt = Date.now();
      draft.rev = (cur.rev ?? 0) + 1;
      set({ profile: draft });
      schedule();
    },

    tryMutate(fn) {
      const cur = getState().profile;
      if (!cur) return false;
      const draft = structuredClone(cur);
      if (!fn(draft)) return false;
      draft.updatedAt = Date.now();
      draft.rev = (cur.rev ?? 0) + 1;
      set({ profile: draft });
      schedule();
      return true;
    },

    replace(p) {
      p.updatedAt = Date.now();
      set({ profile: p });
      schedule();
    },

    async flush() {
      const { profile } = getState();
      if (!profile) return;
      await saveLocalProfile(profile);
      if (pushing) await pushing;
      pushing = push().finally(() => (pushing = null));
      await pushing;
    },

    async linkDevice(code) {
      try {
        const auth = await api.claim(code.trim().toUpperCase());
        await saveAuth(auth);
        const remote = await api.getProfile(auth);
        if (!remote.profile) return false;
        const p = migrateProfile(remote.profile);
        await saveLocalProfile(p);
        set({ auth, profile: p, serverRev: remote.rev, sync: 'synced' });
        return true;
      } catch {
        return false;
      }
    },

    async reset() {
      await wipeLocal();
      set({ profile: null, auth: null, serverRev: 0, sync: 'local' });
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const p = useProfile.getState().profile;
    if (p) void saveLocalProfile(p);
  });
}
