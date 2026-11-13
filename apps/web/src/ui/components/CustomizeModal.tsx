import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BEARD_STYLES,
  DEFAULT_HAIR,
  DEFAULT_LOOK,
  NATURAL_HAIR,
  FACE_PRESETS,
  facePresetOf,
  humanFace,
  humanShape,
  presetOf,
  randomHumanFace,
  randomHumanShape,
  resolveFace,
  resolveShape,
  SHAPE_PRESETS,
  tidyLook,
  type FaceShape,
  type BodyShape,
  type PlayerLook,
  type Sex,
} from '@ashfall/engine';
import { HAIR_COLORS, SKIN_TONES } from '../../render/character';
import { useProfile } from '../../state/profileStore';
import { CharacterPreview, type PreviewFraming } from './CharacterPreview';
import { HAIR, LookEditor, type Tab } from './LookEditor';
import { useEscape } from './useEscape';

/** A shape/face that equals a preset is stored as that preset's id (so it reads as chosen in the tiles). */
function tidy(look: PlayerLook): PlayerLook {
  const out = { ...look };
  if (out.sex === 'f') {
    out.beard = 'none';
    delete out.beardColor;
  }
  if (out.shape && typeof out.shape === 'object') {
    const s = humanShape(resolveShape(out.sex, out.shape as BodyShape));
    out.shape = presetOf(out.sex, s) ?? s;
  }
  if (out.face && typeof out.face === 'object') {
    const f = humanFace(resolveFace(out.face as FaceShape));
    out.face = facePresetOf(f) ?? f;
  }
  return out;
}
const baseOf = (spec: unknown, presets: Record<string, unknown>, fallback: string) =>
  typeof spec === 'string' && presets[spec] ? spec : fallback;

/** The model follows changes at most every ~110 ms (rebuilding the figure costs a few frames), leading edge first. */
function useThrottled<T>(value: T, ms = 110): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - performance.now();
    if (wait <= 0) {
      last.current = performance.now();
      setShown(value);
      return;
    }
    const t = window.setTimeout(() => {
      last.current = performance.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
  return shown;
}

/**
 * The character creator: a large live 3D preview (face, full body or back; drag or arrow keys to turn) beside
 * category tabs of picture tiles. Pointing at a tile tries it on, clicking chooses it; sliders are an optional
 * fine-tune. Everything is a draft until Save; Cancel (or Escape) leaves the saved look as it was.
 */
export function CustomizeModal({ onClose }: { onClose: () => void }) {
  const saved = useProfile((s) => s.profile?.look) ?? DEFAULT_LOOK;
  const initial = useMemo(() => tidy(tidyLook(structuredClone(saved))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<PlayerLook>(initial);
  const [hover, setHover] = useState<Partial<PlayerLook> | null>(null);
  const [tab, setTab] = useState<Tab>('body');
  const [framing, setFraming] = useState<PreviewFraming>('body');
  const [bodyBase, setBodyBase] = useState(() => baseOf(initial.shape, SHAPE_PRESETS[initial.sex], 'average'));
  const [faceBase, setFaceBase] = useState(() => baseOf(initial.face, FACE_PRESETS, 'classic'));
  // What each sex last had (hair style, beard, build), so switching back and forth keeps your choices.
  const perSex = useRef<Partial<Record<Sex, Pick<PlayerLook, 'hair' | 'beard' | 'shape'> & { base: string }>>>({});
  const leave = useRef<number | null>(null);

  const shown = useThrottled(useMemo(() => (hover ? { ...draft, ...hover } : draft), [draft, hover]));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // Opening a tab moves the camera to suit it (a face close-up for face, hair and beard); the buttons override.
  const openTab = (t: Tab) => {
    setTab(t);
    setFraming(t === 'body' || t === 'skin' ? 'body' : 'face');
  };
  useEffect(() => () => void (leave.current && clearTimeout(leave.current)), []);

  const apply = (patch: Partial<PlayerLook>) => {
    setHover(null);
    setDraft((d) => tidy({ ...d, ...patch }));
  };
  // Leaving a tile waits a moment before going back to the draft, so sweeping across tiles doesn't flicker.
  const preview = (patch: Partial<PlayerLook> | null) => {
    if (leave.current) clearTimeout(leave.current);
    leave.current = null;
    if (patch) setHover(patch);
    else leave.current = window.setTimeout(() => setHover(null), 140);
  };
  const setSex = (sex: Sex) => {
    if (sex === draft.sex) return;
    perSex.current[draft.sex] = { hair: draft.hair, beard: draft.beard, shape: draft.shape, base: bodyBase };
    const mem = perSex.current[sex];
    // Skin, hair colour and face carry over; the build keeps its name where the other sex has it.
    const same = typeof draft.shape === 'string' && SHAPE_PRESETS[sex][draft.shape] ? draft.shape : 'average';
    const base = mem?.base ?? (SHAPE_PRESETS[sex][bodyBase] ? bodyBase : 'average');
    setBodyBase(base);
    // A woman never keeps a beard (or its colour): switching clears it; the Beard tab goes away with it.
    if (sex === 'f' && tab === 'beard') openTab('face');
    apply({
      sex,
      hair: mem?.hair ?? DEFAULT_HAIR[sex],
      beard: sex === 'm' ? (mem?.beard ?? 'none') : 'none',
      beardColor: sex === 'm' ? draft.beardColor : undefined,
      shape: mem?.shape ?? same,
    });
  };
  const randomize = () => {
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
    const sex = draft.sex;
    const body = pick(Object.keys(SHAPE_PRESETS[sex]));
    const faceId = pick(Object.keys(FACE_PRESETS));
    setBodyBase(body);
    setFaceBase(faceId);
    apply({
      skin: pick(SKIN_TONES),
      hair: pick(HAIR[sex]),
      hairColor: pick(Math.random() < 0.08 ? HAIR_COLORS : NATURAL_HAIR),
      beard: sex === 'm' ? pick(Math.random() < 0.3 ? ['none'] : BEARD_STYLES.map((b) => b.id)) : 'none',
      beardColor: undefined,
      shape: randomHumanShape(sex, Math.random, body),
      // A whole face with a random nose, eyes, mouth and jaw blended in (kept believable: shape.ts humanFace).
      face: randomHumanFace(Math.random, faceId, true),
    });
  };
  const reset = () => {
    const sex = draft.sex;
    setBodyBase('average');
    setFaceBase('classic');
    apply({ ...DEFAULT_LOOK, sex, hair: DEFAULT_HAIR[sex], beard: sex === 'm' ? DEFAULT_LOOK.beard : 'none', beardColor: undefined, shape: 'average', face: 'classic' });
  };
  const save = () => {
    const look = tidy(draft);
    // Sliders are stored resolved (clamped); presets by id.
    if (typeof look.shape === 'object') look.shape = resolveShape(look.sex, look.shape);
    if (typeof look.face === 'object') look.face = resolveFace(look.face);
    useProfile.getState().mutate((d) => void (d.look = look));
    onClose();
  };
  useEscape(onClose);

  const frames: { id: PreviewFraming; label: string }[] = [
    { id: 'face', label: 'Face' },
    { id: 'body', label: 'Full body' },
    { id: 'back', label: 'Back' },
  ];
  return (
    <div className="modal-backdrop fade-in">
      <div className="panel customize" role="dialog" aria-modal="true" aria-labelledby="customize-title">
        <div className="panel-title">
          <span id="customize-title">Character</span>
          <span className="dim customize-sub">{dirty ? 'unsaved changes' : 'point at an option to try it on'}</span>
          <button className="btn ghost small" onClick={onClose} aria-label="Cancel and close">
            ✕
          </button>
        </div>
        <div className="customize-body">
          <div className="customize-preview">
            <div className="customize-stage">
              <CharacterPreview framing={framing} bareHead className="big" look={shown} />
              {hover && <span className="customize-trying">Previewing</span>}
            </div>
            <div className="customize-frames" role="group" aria-label="Camera">
              {frames.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={framing === f.id}
                  className={`btn small${framing === f.id ? ' active' : ''}`}
                  onClick={() => setFraming(f.id)}
                >
                  {f.label}
                </button>
              ))}
              <span className="dim small customize-hint">drag to turn</span>
            </div>
          </div>
          <div className="customize-controls">
            <LookEditor
              draft={draft}
              tab={tab}
              setTab={openTab}
              apply={apply}
              preview={preview}
              setSex={setSex}
              bodyBase={bodyBase}
              faceBase={faceBase}
              setBodyBase={setBodyBase}
              setFaceBase={setFaceBase}
            />
          </div>
        </div>
        <div className="customize-foot">
          <button className="btn ghost small" onClick={randomize} title="A random, believable face, hair, skin and build">
            ⚄ Randomize
          </button>
          <button className="btn ghost small" onClick={reset} title="The default look for this body">
            ↺ Reset
          </button>
          <span className="customize-foot-gap" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const SEEN = 'ashfall.customizeSeen';
/** Whether to open customisation on its own (once, the first time someone reaches the hideout). */
export function firstCustomize(): boolean {
  try {
    if (localStorage.getItem(SEEN)) return false;
    localStorage.setItem(SEEN, '1');
    return true;
  } catch {
    return false;
  }
}
