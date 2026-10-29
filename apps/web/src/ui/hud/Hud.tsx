import { useRaidUi, type HudState } from '../../game/hudStore';
import { BodyFigure } from '../components/BodyFigure';
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
            <div key={e.name} className={`exit ${e.kind === 'grave' ? 'grave' : ''}`}>
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
        <div className="health-row">
          <BodyFigure parts={hud.parts} height={112} />
          <div className="health-side">
            <div className="hp-row">
              <span className="h">Health</span>
              <span className="mono">
                {Math.ceil(hud.hp)}
                <span className="dim small"> / {hud.maxHp}</span>
              </span>
            </div>
            <div className="hp-bar">
              <i style={{ width: `${hpPct}%`, background: hpPct > 50 ? 'var(--good)' : hpPct > 25 ? 'var(--accent)' : 'var(--bad)' }} />
            </div>
            <div className="conditions">
              {conditions(hud).map((c) => (
                <span key={c.text} className={`tag ${c.bad ? 'bad' : ''}`}>
                  {c.text}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mini-bars">
          <Mini label={hud.winded ? "WINDED" : "STA"} v={hud.stamina} color={hud.winded ? "#c8553d" : "#d9d3a0"} />
          <Mini label="ENG" v={hud.energy} color="#d69a4a" />
          <Mini label="H2O" v={hud.hydration} color="#6aa7d6" />
        </div>
        <div className="status">
          {hud.crouch && <span className="tag">Crouched</span>}
          {hud.flashlight && <span className="tag">Light</span>}
          <span className={`tag ${hud.weight > 40 ? 'bad' : ''}`}>{hud.weight.toFixed(1)} kg</span>
        </div>
      </div>

      <div className="hud-br panel-lite">
        <div className="weapon-name h">{hud.weapon}</div>
        {hud.ammo !== null ? (
          <div className="ammo-block">
            <div className="ammo">
              <span className={`mono big ${hud.ammo === 0 ? 'bad' : hud.ammo <= hud.mag * 0.25 ? 'warn' : ''}`}>{hud.ammo}</span>
              <span className="mono dim">/ {hud.mag}</span>
              <span className="dim small">in mag</span>
            </div>
            <div className="mag-pips" title={`${hud.ammo} of ${hud.mag} rounds loaded`}>
              {Array.from({ length: Math.min(hud.mag, 30) }, (_, i) => (
                <i key={i} className={i < Math.ceil(((hud.ammo ?? 0) / hud.mag) * Math.min(hud.mag, 30)) ? 'on' : ''} />
              ))}
            </div>
            <div className="reserve-line">
              <span className={`mono ${hud.reserve === 0 ? 'bad' : ''}`}>{hud.reserve}</span>
              <span className="dim small">
                spare rounds · ≈{Math.floor(hud.reserve / Math.max(1, hud.mag))} reload{Math.floor(hud.reserve / Math.max(1, hud.mag)) === 1 ? '' : 's'}
              </span>
              {hud.ammoType && <span className="tag">{hud.ammoType}</span>}
            </div>
            {hud.ammo === 0 && hud.reserve > 0 && <div className="hint">Press R to reload</div>}
            {hud.ammo === 0 && hud.reserve === 0 && <div className="hint bad">Out of ammo — switch weapon (1/2/3)</div>}
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

function conditions(h: HudState): { text: string; bad: boolean }[] {
  const out: { text: string; bad: boolean }[] = [];
  const heavy = h.parts.filter((p) => p.heavy);
  const light = h.parts.filter((p) => p.light && !p.heavy);
  const frac = h.parts.filter((p) => p.fracture);
  const black = h.parts.filter((p) => p.hp <= 0);
  if (heavy.length) out.push({ text: `Heavy bleed ×${heavy.length}`, bad: true });
  if (light.length) out.push({ text: `Bleeding ×${light.length}`, bad: true });
  if (frac.length) out.push({ text: `Fracture: ${frac.map((p) => PART_SHORT[p.part]).join(', ')}`, bad: true });
  if (black.length) out.push({ text: `Destroyed: ${black.map((p) => PART_SHORT[p.part]).join(', ')}`, bad: true });
  if (h.pain) out.push({ text: 'Pain', bad: true });
  if (h.painkiller > 0) out.push({ text: `Painkiller ${Math.ceil(h.painkiller)}s`, bad: false });
  if (out.some((o) => o.bad)) out.push({ text: 'Q — treat', bad: false });
  return out;
}

const PART_SHORT: Record<string, string> = { head: 'head', thorax: 'thorax', stomach: 'stomach', leftArm: 'L arm', rightArm: 'R arm', leftLeg: 'L leg', rightLeg: 'R leg' };

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
