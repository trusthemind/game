import { useEffect } from 'react';
import { useApp } from '../state/appStore';
import { useProfile } from '../state/profileStore';
import { MainMenu } from './screens/MainMenu';
import { Hideout } from './screens/Hideout';
import { RaidScreen } from './screens/RaidScreen';
import { RaidEnd } from './screens/RaidEnd';

export function App() {
  const screen = useApp((s) => s.screen);
  const ready = useProfile((s) => s.ready);
  const profile = useProfile((s) => s.profile);
  const toasts = useApp((s) => s.toasts);

  useEffect(() => {
    void useProfile.getState().boot();
  }, []);

  if (!ready) return <div className="boot h">Loading…</div>;
  const needProfile = screen !== 'menu' && !profile;
  return (
    <>
      {(screen === 'menu' || needProfile) && <MainMenu />}
      {screen === 'hideout' && profile && <Hideout />}
      {screen === 'raid' && profile && <RaidScreen />}
      {screen === 'raidEnd' && profile && <RaidEnd />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''} fade-in`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
