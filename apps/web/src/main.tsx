import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './styles/global.css';
import './ui/screens/hideout.css';
import './ui/components/dialogue.css';

// No <StrictMode>: its double-mount would start (and pay for) a raid twice in dev.
createRoot(document.getElementById('root')!).render(<App />);

// Precached build + offline play. Skip in dev so HMR isn't fighting a service worker.
if (import.meta.env.PROD) registerSW({ immediate: true });
