import { useEffect, useRef, useState } from 'react';
import {
  FACE_KEYS,
  FACE_PRESETS,
  facePresetOf,
  presetOf,
  resolveFace,
  resolveShape,
  SHAPE_KEYS,
  SHAPE_PRESETS,
  type BodyShape,
  type FaceShape,
  type PlayerLook,
} from '@ashfall/engine';
import { HAIR_COLORS, SKIN_TONES } from '../../render/character';
import { useProfile } from '../../state/profileStore';

const HAIR: Record<'m' | 'f', string[]> = {
  m: ['bald', 'buzz', 'short', 'messy'],
  f: ['long', 'ponytail', 'bob', 'bun'],
};
const SKIN_NAMES = ['Fair', 'Light', 'Tan', 'Brown', 'Dark'];
const HAIR_NAMES = ['Black', 'Dark brown', 'Brown', 'Auburn', 'Blond', 'Grey', 'White'];
const FACE_LABEL: Record<keyof FaceShape, string> = { brow: 'Brow', jaw: 'Jaw', chin: 'Chin', nose: 'Nose', cheeks: 'Cheekbones' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Slider drags are committed at most every ~120 ms, so the preview isn't rebuilt on every pixel. */
function useThrottled<T>(commit: (v: T) => void) {
  const [draft, setDraft] = useState<T | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<T | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const change = (v: T) => {
    setDraft(v);
    pending.current = v;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (pending.current) commit(pending.current);
    }, 120);
  };
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) commit(pending.current);
    pending.current = null;
    setDraft(null);
  };
  return { draft, change, end, clear: () => setDraft(null) };
}

/**
 * Your survivor's looks: sex, skin tone, face (a preset, then sliders), hair style and colour, beard, and body
 * shape (a preset, then sliders). Saved into the profile; the 3D preview beside it follows every change.
 */
export function LookEditor() {
  const look = useProfile((s) => s.profile?.look);
  const set = (patch: Partial<PlayerLook>) => useProfile.getState().mutate((d) => void Object.assign(d.look, patch));
  const sexOf = () => useProfile.getState().profile?.look.sex ?? 'm';
  const body = useThrottled<BodyShape>((s) => set({ shape: presetOf(sexOf(), s) ?? s }));
  const face = useThrottled<FaceShape>((f) => set({ face: facePresetOf(f) ?? f }));
  if (!look) return null;
  const shape = body.draft ?? resolveShape(look.sex, look.shape);
  const preset = typeof look.shape === 'string' && !body.draft ? look.shape : presetOf(look.sex, shape);
  const fc = face.draft ?? resolveFace(look.face);
  const facePreset = typeof look.face === 'string' && !face.draft ? look.face : facePresetOf(fc);
  const randomize = () => {
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
    const sex = look.sex;
    set({
      skin: pick(SKIN_TONES),
      hair: pick(HAIR[sex]),
      hairColor: pick(HAIR_COLORS.slice(0, 6)),
      beard: sex === 'm' && Math.random() < 0.5,
      face: pick(Object.keys(FACE_PRESETS)),
      shape: pick(Object.keys(SHAPE_PRESETS[sex])),
    });
  };
  const slider = (label: string, value: number, onChange: (v: number) => void, onEnd: () => void) => (
    <label key={label}>
      <span>{label}</span>
      <input type="range" min={-1} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onEnd} onKeyUp={onEnd} />
    </label>
  );
  return (
    <div className="look-editor">
      <section>
        <h4>Body</h4>
        <div className="look-row">
          {(['m', 'f'] as const).map((sx) => (
            <button
              key={sx}
              className={`btn${look.sex === sx ? ' active' : ''}`}
              onClick={() => sx !== look.sex && set({ sex: sx, shape: 'average', hair: HAIR[sx][sx === 'm' ? 2 : 1]!, beard: sx === 'm' && look.beard })}
            >
              {sx === 'm' ? 'Male' : 'Female'}
            </button>
          ))}
          <button className="btn ghost small" onClick={randomize} title="A random face, hair, skin and build">
            Randomize
          </button>
        </div>
      </section>
      <section>
        <h4>Skin tone</h4>
        <div className="look-row">
          {SKIN_TONES.map((c, i) => (
            <button key={c} title={SKIN_NAMES[i]} className={`swatch big${look.skin === c ? ' active' : ''}`} style={{ background: hex(c) }} onClick={() => set({ skin: c })} />
          ))}
        </div>
      </section>
      <section>
        <h4>Face</h4>
        <div className="look-row">
          {Object.keys(FACE_PRESETS).map((id) => (
            <button key={id} className={`btn small${facePreset === id ? ' active' : ''}`} onClick={() => (face.clear(), set({ face: id }))}>
              {cap(id)}
            </button>
          ))}
        </div>
        <div className="look-sliders">{FACE_KEYS.map((k) => slider(FACE_LABEL[k], fc[k], (v) => face.change({ ...fc, [k]: v }), face.end))}</div>
      </section>
      <section>
        <h4>Hair</h4>
        <div className="look-row">
          {HAIR[look.sex].map((h) => (
            <button key={h} className={`btn small${look.hair === h ? ' active' : ''}`} onClick={() => set({ hair: h })}>
              {cap(h)}
            </button>
          ))}
          {look.sex === 'm' && (
            <button className={`btn small${look.beard ? ' active' : ''}`} onClick={() => set({ beard: !look.beard })}>
              Beard
            </button>
          )}
        </div>
        <div className="look-row">
          {HAIR_COLORS.map((c, i) => (
            <button key={c} title={HAIR_NAMES[i]} className={`swatch${look.hairColor === c ? ' active' : ''}`} style={{ background: hex(c) }} onClick={() => set({ hairColor: c })} />
          ))}
        </div>
      </section>
      <section>
        <h4>Build</h4>
        <div className="look-row">
          {Object.keys(SHAPE_PRESETS[look.sex]).map((id) => (
            <button key={id} className={`btn small${preset === id ? ' active' : ''}`} onClick={() => (body.clear(), set({ shape: id }))}>
              {cap(id)}
            </button>
          ))}
        </div>
        <div className="look-sliders">{SHAPE_KEYS.map((k) => slider(cap(k), shape[k], (v) => body.change({ ...shape, [k]: v }), body.end))}</div>
      </section>
    </div>
  );
}
