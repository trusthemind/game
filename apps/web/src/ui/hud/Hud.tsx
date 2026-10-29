import { useRaidUi } from '../../game/hudStore';
import type { GameSession } from '../../game/GameSession';
import { Minimap } from './Minimap';
import './hud.css';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TOD: Record<string, string> = { day: 'Day', dusk: 'Dusk', night: 'Night' };

export function Hud({ session }: { session: GameSession }) {
  const hud = useRaidUi((s) => s.hud);
  const messages = useRaidUi((s) => s.messages);
  if (!hud) return null;
  const hpPct = (hud.hp / hud.maxHp) * 100;
  return (
    <div className="hud">
      <div className="hud-tl panel-lite">
        <div className="timer mono">{mmss(hud.timeLeft)}</div>
        <div className="dim small">
          {TOD[hud.timeOfDay]}
          {hud.rain ? ' · Rain' : ''} · Kills {hud.kills}
        </div>
        <div className="exits">
          {hud.extractions.map((e) => (
            <div key={e.name} className="exit">
              <span className="arrow" style={{ transform: `rotate(${e.angle}rad)` }}>➜</span>
              <span>{e.name}</span>
              <span className="mono dim">{Math.round(e.dist)}m</span>
            </div>
          ))}
        </div>
      </div>

      <Compass facing={hud.facing} extractions={hud.extractions} />

      <div className="hud-tr">
        <Minimap raid={session.raid} />
        {hud.companion && (
          <div className="companion panel-lite">
            <span className="h">{hud.companion.name}</span>
            <div className="bar">
              <i style={{ width: `${hud.companion.alive ? hud.companion.hp * 100 : 0}%`, background: hud.companion.alive ? '#7fd1b9' : 'var(--bad)' }} />
            </div>
          </div>
        )}
      </div>

      <div className="hud-bl panel-lite">
        <div className="hp-row">
          <span className="h">Health</span>
          <span className="mono">{Math.ceil(hud.hp)}</span>
        </div>
        <div className="hp-bar">
          <i style={{ width: `${hpPct}%`, background: hpPct > 50 ? 'var(--good)' : hpPct > 25 ? 'var(--accent)' : 'var(--bad)' }} />
        </div>
        <div className="mini-bars">
          <Mini label="STA" v={hud.stamina} color="#d9d3a0" />
          <Mini label="ENG" v={hud.energy} color="#d69a4a" />
          <Mini label="H2O" v={hud.hydration} color="#6aa7d6" />
        </div>
        <div className="status">
          {hud.bleed && <span className="tag bad">Bleeding · Q</span>}
          {hud.crouch && <span className="tag">Crouched</span>}
          {hud.flashlight && <span className="tag">Light</span>}
          <span className={`tag ${hud.weight > 40 ? 'bad' : ''}`}>{hud.weight.toFixed(1)} kg</span>
        </div>
      </div>

      <div className="hud-br panel-lite">
        <div className="weapon-name h">{hud.weapon}</div>
        {hud.ammo !== null ? (
          <div className="ammo">
            <span className="mono big">{hud.ammo}</span>
            <span className="mono dim">/ {hud.mag}</span>
            <span className="mono reserve">{hud.reserve}</span>
            <span className="dim small">{hud.ammoType}</span>
          </div>
        ) : (
          <div className="ammo dim">Melee</div>
        )}
        {hud.reloading > 0 && (
          <div className="bar reload">
            <i style={{ width: `${hud.reloading * 100}%` }} />
          </div>
        )}
        <div className="slots">
          {(['primary', 'secondary', 'melee'] as const).map((s, i) => (
            <span key={s} className={`slot-key ${hud.weaponSlot === s ? 'on' : ''}`}>
              <span className="kbd">{i + 1}</span>
            </span>
          ))}
        </div>
      </div>

      {hud.interact && hud.status === 'active' && (
        <div className="prompt">
          <span className="kbd">E</span> {hud.interact.kind === 'container' ? (hud.interact.searched ? 'Open' : 'Search') : ''} {hud.interact.label}
        </div>
      )}
      {hud.extract > 0 && hud.status === 'active' && (
        <div className="extracting">
          <div className="h">Extracting · {hud.extractName}</div>
          <div className="bar">
            <i style={{ width: `${hud.extract * 100}%`, background: '#4dff9a' }} />
          </div>
        </div>
      )}

      <div className="feed">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.tone ?? ''} fade-in`}>
            {m.text}
          </div>
        ))}
      </div>

      {hud.status !== 'active' && (
        <div className={`end-banner ${hud.status}`}>
          <div className="h">{hud.status === 'extracted' ? 'Extracted' : hud.status === 'dead' ? 'Killed in action' : 'Missing in action'}</div>
        </div>
      )}
      <div className="damage-vignette" style={{ opacity: Math.max(0, 0.75 - hpPct / 100) }} />
    </div>
  );
}

function Mini({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="mini">
      <span>{label}</span>
      <div className="bar">
        <i style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

function Compass({ facing, extractions }: { facing: number; extractions: { name: string; angle: number }[] }) {
  // 0 rad = east on the map; north is -y.
  const deg = ((facing * 180) / Math.PI + 90 + 360) % 360;
  const marks = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const pxPerDeg = 3;
  return (
    <div className="compass">
      <div className="compass-strip" style={{ transform: `translateX(${-deg * pxPerDeg}px)` }}>
        {[-1, 0, 1].flatMap((rep) =>
          marks.map((m, i) => (
            <span key={`${rep}${m}`} className={m.length === 1 ? 'major' : ''} style={{ left: (rep * 360 + i * 45) * pxPerDeg }}>
              {m}
            </span>
          )),
        )}
        {[-1, 0, 1].flatMap((rep) =>
          extractions.map((e) => {
            const d = ((e.angle * 180) / Math.PI + 90 + 360) % 360;
            return <i key={`${rep}${e.name}`} className="ex-mark" style={{ left: (rep * 360 + d) * pxPerDeg }} />;
          }),
        )}
      </div>
      <div className="compass-needle" />
    </div>
  );
}
