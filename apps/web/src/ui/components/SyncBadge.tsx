import { useProfile } from '../../state/profileStore';

const LABEL = { offline: 'Offline', syncing: 'Syncing…', synced: 'Cloud saved', error: 'Sync error', local: 'Local save' } as const;

export function SyncBadge() {
  const sync = useProfile((s) => s.sync);
  return (
    <span className={`sync-badge ${sync}`} title="Progress is stored on this Mac and synced to the server">
      <i />
      {LABEL[sync]}
    </span>
  );
}
