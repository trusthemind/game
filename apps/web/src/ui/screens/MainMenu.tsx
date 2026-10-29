import { useEffect, useRef, useState } from 'react';
import { levelFromXp } from '@ashfall/engine';
import { useApp } from '../../state/appStore';
import { useProfile } from '../../state/profileStore';
import { SyncBadge } from '../components/SyncBadge';
import './menu.css';

export function MainMenu() {
  const profile = useProfile((s) => s.profile);
  const [naming, setNaming] = useState(false);
  const [linking, setLinking] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <div className="menu">
      <Ash />
      <div className="menu-inner fade-in">
        <div className="title">
          <div className="h logo">
            ASH<span>FALL</span>
          </div>
          <div className="subtitle h">Extraction · Survival · Loot</div>
        </div>
        <div className="menu-actions">
          {profile && !naming && (
            <button className="btn primary big-btn" onClick={() => useApp.getState().go('hideout')}>
              Continue — {profile.name} · LVL {levelFromXp(profile.xp).level}
            </button>
          )}
          {!naming && !linking && (
            <>
              <button className={`btn ${profile ? '' : 'primary'} big-btn`} onClick={() => setNaming(true)}>
                New survivor
              </button>
              <button className="btn ghost" onClick={() => setLinking(true)}>
                Continue from another device
              </button>
            </>
          )}
          {naming && (
            <form
              className="name-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await useProfile.getState().newProfile(name);
                useApp.getState().go('hideout');
              }}
            >
              <input autoFocus className="input" maxLength={20} placeholder="Call sign" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary">Start</button>
              <button type="button" className="btn ghost" onClick={() => setNaming(false)}>
                Cancel
              </button>
              {profile && <p className="bad small">This replaces your current survivor on this device.</p>}
            </form>
          )}
          {linking && (
            <form
              className="name-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await useProfile.getState().linkDevice(code);
                if (ok) useApp.getState().go('hideout');
                else useApp.getState().toast('Code not found or server offline', 'bad');
              }}
            >
              <input autoFocus className="input mono" placeholder="LINK CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button className="btn primary">Link</button>
              <button type="button" className="btn ghost" onClick={() => setLinking(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>
        <div className="menu-foot">
          <SyncBadge />
          <span className="faint">v0.1 · best with a mouse · press F3 in raid for perf stats</span>
        </div>
      </div>
    </div>
  );
}

/** Drifting ash particles on a 2D canvas (cheap, pauses when hidden). */
function Ash() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let raf = 0;
    const parts = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + 0.4, v: Math.random() * 0.02 + 0.006, d: Math.random() * 6 }));
    const resize = () => {
      c.width = window.innerWidth * devicePixelRatio;
      c.height = window.innerHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener('resize', resize);
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      g.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.y += p.v * dt;
        p.x += Math.sin(now / 1500 + p.d) * 0.0004;
        if (p.y > 1.02) {
          p.y = -0.02;
          p.x = Math.random();
        }
        g.globalAlpha = 0.25 + (p.r / 2.4) * 0.4;
        g.fillStyle = p.r > 1.9 ? '#d6a74a' : '#a8a89c';
        g.beginPath();
        g.arc(p.x * c.width, p.y * c.height, p.r * devicePixelRatio, 0, Math.PI * 2);
        g.fill();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="ash" />;
}
