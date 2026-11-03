import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { useApp } from './state/appStore';
import { useProfile } from './state/profileStore';
import { audio } from './audio/AudioEngine';
import './styles/global.css';
import './ui/screens/hideout.css';
import './ui/components/dialogue.css';

// No <StrictMode>: its double-mount would start (and pay for) a raid twice in dev.
const CharLab = lazy(() => import('./dev/CharLab').then((m) => ({ default: m.CharLab })));
const ExtractLab = lazy(() => import('./dev/ExtractLab').then((m) => ({ default: m.ExtractLab })));
const lab = location.hash.startsWith('#charlab');
createRoot(document.getElementById('root')!).render(
  lab ? (
    <Suspense fallback={null}>
      <CharLab />
    </Suspense>
  ) : location.hash.startsWith('#extractlab') ? (
    <Suspense fallback={null}>
      <ExtractLab />
    </Suspense>
  ) : (
    <App />
  ),
);

// Button clicks get a soft UI tick; first gesture also unlocks WebAudio.
document.addEventListener(
  'click',
  (e) => {
    audio.unlock();
    if ((e.target as HTMLElement).closest('button')) audio.ui('click');
  },
  true,
);

// Precached build + offline play. Skip in dev so HMR isn't fighting a service worker.
// A new build is switched to (which reloads the tab) only outside a raid and its summary, after the profile is
// saved: mid-raid the reload ended the raid, and the gear you took in went with it.
if (import.meta.env.PROD) {
  let waiting = false;
  const apply = () => {
    const screen = useApp.getState().screen;
    if (!waiting || screen === 'raid' || screen === 'raidEnd') return;
    waiting = false;
    void useProfile
      .getState()
      .flush()
      .finally(() => updateSW(true));
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true;
      apply();
    },
  });
  useApp.subscribe(apply);
}
