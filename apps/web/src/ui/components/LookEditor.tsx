import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  BEARD_STYLES,
  FACE_GROUPS,
  FACE_PARTS,
  FACE_PRESETS,
  facePartOf,
  NEUTRAL_FACE,
  HAIR_PALETTE,
  hairStylesFor,
  HUMAN_LIMIT,
  humanFace,
  humanShape,
  resolveFace,
  resolveShape,
  SHAPE_KEYS,
  SHAPE_PRESETS,
  type BodyShape,
  type FaceShape,
  type PlayerLook,
  type Sex,
} from '@ashfall/engine';
import { SKIN_TONES } from '../../render/character';
import { getLookThumb, onLookThumbs, trimLookThumbs, type LookThumbKind } from '../../render/lookThumbs';

/** The styles offered per sex (engine hair.ts), grouped in display order. */
export const HAIR: Record<Sex, string[]> = { m: hairStylesFor('m').map((h) => h.id), f: hairStylesFor('f').map((h) => h.id) };
const groupsOf = <T extends { group: string }>(list: readonly T[]) => {
  const out = new Map<string, T[]>();
  for (const it of list) out.set(it.group, [...(out.get(it.group) ?? []), it]);
  return [...out.entries()];
};
const SKIN_NAMES = ['Fair', 'Light', 'Tan', 'Brown', 'Dark'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const cap = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');

/** Slider captions: label, the -1 end, the +1 end, and where on the little figure the icon marks (x, y). */
const BODY_META: Record<keyof BodyShape, [string, string, string, number, number]> = {
  height: ['Height', 'Short', 'Tall', 7, 1],
  shoulders: ['Shoulders', 'Narrow', 'Broad', 7, 6],
  chest: ['Chest', 'Narrow', 'Deep', 7, 8],
  bust: ['Bust', 'Small', 'Full', 8.5, 8.5],
  waist: ['Waist', 'Narrow', 'Wide', 7, 11],
  belly: ['Belly', 'Flat', 'Round', 8, 11.5],
  hips: ['Hips', 'Narrow', 'Wide', 7, 13],
  glutes: ['Glutes', 'Flat', 'Full', 6, 13.5],
  thighs: ['Thighs', 'Thin', 'Thick', 5.5, 15.5],
  calves: ['Calves', 'Thin', 'Thick', 5.5, 19],
  arms: ['Arms', 'Thin', 'Thick', 2.5, 10],
};
/** The bust slider reads as pecs on the male body. */
const bodyMeta = (sex: Sex): typeof BODY_META => (sex === 'm' ? { ...BODY_META, bust: ['Pecs', 'Flat', 'Full', 8.5, 8.5] } : BODY_META);
const FACE_META: Record<keyof FaceShape, [string, string, string, number, number]> = {
  headWidth: ['Head width', 'Narrow', 'Wide', 2, 8],
  headLength: ['Head length', 'Short', 'Long', 7, 2],
  forehead: ['Forehead', 'Sloped', 'Upright', 7, 4],
  brow: ['Brow ridge', 'Smooth', 'Heavy', 7, 6],
  browHeight: ['Brow height', 'Low', 'High', 9.5, 5.5],
  eyeSize: ['Eye size', 'Small', 'Large', 9.5, 8],
  eyeSpacing: ['Eye spacing', 'Close', 'Wide', 4.5, 8],
  eyeTilt: ['Eye tilt', 'Down', 'Up', 10.5, 7.5],
  nose: ['Nose size', 'Small', 'Large', 7, 10.5],
  noseWidth: ['Nose width', 'Narrow', 'Wide', 8.5, 11.5],
  noseBridge: ['Nose bridge', 'Scooped', 'Humped', 7, 9],
  noseTip: ['Nose tip', 'Hooked', 'Upturned', 7, 12],
  lips: ['Lips', 'Thin', 'Full', 7, 14],
  mouthWidth: ['Mouth width', 'Narrow', 'Wide', 9, 14],
  jaw: ['Jaw', 'Narrow', 'Wide', 10.5, 14],
  chin: ['Chin', 'Soft', 'Strong', 7, 17.5],
  chinLength: ['Chin length', 'Short', 'Long', 7, 18],
  chinShape: ['Chin shape', 'Square', 'Pointed', 8.5, 17],
  cleft: ['Chin cleft', 'None', 'Deep', 7, 17],
  cheeks: ['Cheekbones', 'Flat', 'High', 10, 10],
  cheekFull: ['Cheeks', 'Hollow', 'Full', 10, 12.5],
  ears: ['Ears', 'Small', 'Large', 12.5, 9.5],
};
const PART_LABEL: Record<keyof typeof FACE_PARTS, string> = { nose: 'Nose', eyes: 'Eyes', mouth: 'Mouth', jaw: 'Jaw & chin' };

export type Tab = 'body' | 'face' | 'hair' | 'skin' | 'beard';
const ALL_TABS: { id: Tab; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'skin', label: 'Skin' },
  { id: 'beard', label: 'Beard' },
];

// The looks the tile pictures show: only the sex, skin and the option itself vary (hair colour too for hair and
// beards), so each picture is drawn once per sex and skin and reused.
const BASE_HAIR_COLOR = 0x3a281b;
const faceThumb = (sex: Sex, skin: number, face: string | FaceShape): PlayerLook => ({
  sex, skin, face, hair: sex === 'm' ? 'bald' : 'topknot', hairColor: BASE_HAIR_COLOR, beard: 'none', shape: 'average',
});
const hairThumb = (sex: Sex, skin: number, hair: string, hairColor: number): PlayerLook => ({
  sex, skin, hair, hairColor, beard: 'none', face: 'classic', shape: 'average',
});
const beardThumb = (skin: number, hair: string, hairColor: number, beard: string, beardColor?: number): PlayerLook => ({
  sex: 'm', skin, hair, hairColor, beard, ...(beardColor !== undefined ? { beardColor } : {}), face: 'classic', shape: 'average',
});
const bodyThumb = (sex: Sex, skin: number, shape: string): PlayerLook => ({
  sex, skin, shape, hair: sex === 'm' ? 'short' : 'ponytail', hairColor: BASE_HAIR_COLOR, beard: 'none', face: 'classic',
});

function useLookThumb(look: PlayerLook, kind: LookThumbKind): string | null {
  const [, bump] = useState(0);
  useEffect(() => onLookThumbs(() => bump((n) => n + 1)), []);
  return getLookThumb(look, kind);
}

/** One option: a picture (or a colour chip), its name, highlighted when chosen. Hover/focus previews it. */
function Tile({
  label,
  selected,
  onPick,
  onPreview,
  thumb,
  chip,
  wide,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
  onPreview: (on: boolean) => void;
  thumb?: { look: PlayerLook; kind: LookThumbKind };
  chip?: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`look-tile${selected ? ' on' : ''}${chip ? ' chip' : ''}${wide ? ' tall' : ''}`}
      onClick={onPick}
      onPointerEnter={() => onPreview(true)}
      onPointerLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
    >
      <span className="look-tile-art">
        {thumb ? <Thumb look={thumb.look} kind={thumb.kind} /> : <i className="look-chip" style={{ background: chip }} />}
      </span>
      <span className="look-tile-name">{label}</span>
    </button>
  );
}

function Thumb({ look, kind }: { look: PlayerLook; kind: LookThumbKind }) {
  const url = useLookThumb(look, kind);
  return url ? <img src={url} alt="" draggable={false} /> : <i className="look-thumb-wait" />;
}

/** Arrow keys move between the options of a group (radio-group behaviour); Tab leaves it. */
function arrowNav(e: ReactKeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const n = items.length;
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + n) % n;
  items[j]!.focus();
}

function Group({ label, children, chips }: { label: string; children: ReactNode; chips?: boolean }) {
  const id = useId();
  return (
    <section className="look-group">
      <h4 id={id}>{label}</h4>
      <div className={`look-tiles${chips ? ' chips' : ''}`} role="radiogroup" aria-labelledby={id} onKeyDown={arrowNav}>
        {children}
      </div>
    </section>
  );
}

/** A small figure (or face) with the part a slider moves marked. */
function RegionIcon({ face, x, y }: { face: boolean; x: number; y: number }) {
  return (
    <svg className="tune-icon" viewBox="0 0 14 21" aria-hidden="true">
      {face ? (
        <path d="M7 2c3.2 0 5 2.6 5 6.2 0 4.6-2.6 10.3-5 10.3S2 12.8 2 8.2C2 4.6 3.8 2 7 2z" />
      ) : (
        <path d="M7 1.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM4 6h6l1.6 6-1.1.3L9.4 9v4.4l.6 6.6H8.4L7.6 14H6.4l-.8 6H4l.6-6.6V9l-1.1 3.3-1.1-.3z" />
      )}
      <circle cx={x} cy={y} r="1.7" />
    </svg>
  );
}

/** The optional sliders under a category: icon, name, -1/+1 captions, value, double-click (or Delete) zeroes one. */
function FineTune<K extends string>({
  title,
  keys,
  meta,
  values,
  face,
  onChange,
  onReset,
  resetLabel,
  modified,
  groups,
}: {
  title: string;
  groups?: readonly { id: string; label: string; keys: readonly K[] }[];
  keys: readonly K[];
  meta: Record<K, [string, string, string, number, number]>;
  values: Record<K, number>;
  face: boolean;
  onChange: (k: K, v: number) => void;
  onReset: () => void;
  resetLabel: string;
  modified: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className={`fine-tune${open ? ' open' : ''}`}>
      <div className="fine-tune-head">
        <button type="button" className="fine-tune-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className="caret" aria-hidden="true">▸</span>
          {title}
          {modified && <span className="tune-badge">custom</span>}
        </button>
        {open && (
          <button type="button" className="btn ghost small" onClick={onReset} disabled={!modified}>
            {resetLabel}
          </button>
        )}
      </div>
      {open && (
        <div className="fine-tune-body" id={bodyId}>
          {(groups ?? [{ id: '', label: '', keys }]).map((g) => (
            <div className="tune-group" key={g.id} role={g.label ? 'group' : undefined} aria-label={g.label || undefined}>
              {g.label && <h5 className="tune-group-title">{g.label}</h5>}
          {g.keys.map((k) => {
            const [label, lo, hi, x, y] = meta[k];
            const v = values[k];
            const pct = Math.round((v / HUMAN_LIMIT) * 100);
            return (
              <div className="tune-row" key={k}>
                <RegionIcon face={face} x={x} y={y} />
                <label className="tune-label" htmlFor={`${bodyId}-${k}`}>
                  {label}
                </label>
                <output className={`tune-val${pct ? '' : ' zero'}`}>{pct > 0 ? `+${pct}` : pct}</output>
                <span className="tune-end">{lo}</span>
                <input
                  id={`${bodyId}-${k}`}
                  type="range"
                  min={-HUMAN_LIMIT}
                  max={HUMAN_LIMIT}
                  step={0.05}
                  value={v}
                                    aria-valuetext={`${label} ${pct > 0 ? '+' : ''}${pct} (${v < 0 ? lo : v > 0 ? hi : 'neutral'})`}
                  onChange={(e) => onChange(k, Number(e.target.value))}
                  onDoubleClick={() => onChange(k, 0)}
                  onKeyDown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && onChange(k, 0)}
                />
                <span className="tune-end hi">{hi}</span>
              </div>
            );
          })}
            </div>
          ))}
          <p className="tune-hint dim">Double-click a slider (or press Delete) to centre it.</p>
        </div>
      )}
    </section>
  );
}

export interface LookEditorProps {
  draft: PlayerLook;
  tab: Tab;
  setTab: (t: Tab) => void;
  /** Apply a change to the draft. */
  apply: (patch: Partial<PlayerLook>) => void;
  /** Show a change on the model without applying it (null: back to the draft). */
  preview: (patch: Partial<PlayerLook> | null) => void;
  setSex: (sex: Sex) => void;
  /** The preset the fine-tune sliders started from (their reset target). */
  bodyBase: string;
  faceBase: string;
  setBodyBase: (id: string) => void;
  setFaceBase: (id: string) => void;
}

/**
 * The right side of the character creator: category tabs, each a grid of picture tiles (hover = try on, click =
 * choose), with the raw sliders tucked into a "Fine tune" fold-out under Body and Face.
 */
export function LookEditor({ draft, tab, setTab, apply, preview, setSex, bodyBase, faceBase, setBodyBase, setFaceBase }: LookEditorProps) {
  const sex = draft.sex;
  // No facial hair on the female body: its tab isn't offered.
  const TABS = ALL_TABS.filter((t) => t.id !== 'beard' || sex === 'm');
  const shape = resolveShape(sex, draft.shape);
  const face = resolveFace(draft.face);
  const shapeId = typeof draft.shape === 'string' ? draft.shape : null;
  const faceId = typeof draft.face === 'string' ? draft.face : null;
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabIds = useId();
  const pv = (patch: Partial<PlayerLook>) => (on: boolean) => preview(on ? patch : null);

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    // Pictures queued for the tab being left aren't needed now (they're drawn again if it's reopened).
    trimLookThumbs(() => false);
    preview(null);
    setTab(t);
  };
  const tabKeys = (e: ReactKeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    switchTab(TABS[j]!.id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[j]?.focus();
  };

  const bodyMod = !shapeId || shapeId !== bodyBase;
  const faceMod = !faceId || faceId !== faceBase;

  let content: ReactNode;
  if (tab === 'body')
    content = (
      <>
        <section className="look-group">
          <h4>Sex</h4>
          <div className="look-seg" role="radiogroup" aria-label="Sex" onKeyDown={arrowNav}>
            {(['m', 'f'] as const).map((sx) => (
              <button key={sx} type="button" role="radio" aria-checked={sex === sx} className={`look-seg-btn${sex === sx ? ' on' : ''}`} onClick={() => setSex(sx)}>
                {sx === 'm' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </section>
        <Group label="Build">
          {Object.keys(SHAPE_PRESETS[sex]).map((id) => (
            <Tile
              key={id}
              wide
              label={cap(id)}
              selected={shapeId === id}
              thumb={{ look: bodyThumb(sex, draft.skin, id), kind: 'body' }}
              onPreview={pv({ shape: id })}
              onPick={() => (setBodyBase(id), apply({ shape: id }))}
            />
          ))}
        </Group>
        <FineTune
          title="Fine tune build"
          keys={SHAPE_KEYS}
          meta={bodyMeta(sex)}
          values={shape}
          face={false}
          modified={bodyMod}
          resetLabel={`Reset to ${cap(bodyBase)}`}
          onReset={() => apply({ shape: bodyBase })}
          onChange={(k, v) => apply({ shape: humanShape({ ...shape, [k]: v }) })}
        />
      </>
    );
  else if (tab === 'face')
    content = (
      <>
        <Group label="Overall">
          {Object.keys(FACE_PRESETS).map((id) => (
            <Tile
              key={id}
              label={cap(id)}
              selected={faceId === id}
              thumb={{ look: faceThumb(sex, draft.skin, id), kind: 'mug' }}
              onPreview={pv({ face: id })}
              onPick={() => (setFaceBase(id), apply({ face: id }))}
            />
          ))}
        </Group>
        {(Object.keys(FACE_PARTS) as (keyof typeof FACE_PARTS)[]).map((part) => {
          const on = facePartOf(face, part);
          return (
            <Group key={part} label={PART_LABEL[part]}>
              {Object.entries(FACE_PARTS[part]).map(([id, p]) => (
                <Tile
                  key={id}
                  label={cap(id)}
                  selected={on === id}
                  thumb={{ look: faceThumb(sex, draft.skin, { ...NEUTRAL_FACE, ...p }), kind: 'mug' }}
                  onPreview={pv({ face: humanFace({ ...face, ...p }) })}
                  onPick={() => apply({ face: humanFace({ ...face, ...p }) })}
                />
              ))}
            </Group>
          );
        })}
        <FineTune
          title="Fine tune face"
          keys={FACE_GROUPS.flatMap((g) => g.keys)}
          groups={FACE_GROUPS}
          meta={FACE_META}
          values={face}
          face
          modified={faceMod}
          resetLabel={`Reset to ${cap(faceBase)}`}
          onReset={() => apply({ face: faceBase })}
          onChange={(k, v) => apply({ face: humanFace({ ...face, [k]: v }) })}
        />
      </>
    );
  else if (tab === 'hair')
    content = (
      <>
        {groupsOf(hairStylesFor(sex)).map(([group, list]) => (
          <Group key={group} label={group}>
            {list.map((h) => (
              <Tile
                key={h.id}
                label={h.label}
                selected={draft.hair === h.id}
                thumb={{ look: hairThumb(sex, draft.skin, h.id, draft.hairColor), kind: 'hair' }}
                onPreview={pv({ hair: h.id })}
                onPick={() => apply({ hair: h.id })}
              />
            ))}
          </Group>
        ))}
        {groupsOf(HAIR_PALETTE.map((c) => ({ ...c, group: c.dyed ? 'Dyed' : 'Colour' }))).map(([group, list]) => (
          <Group key={group} label={group} chips>
            {list.map((c) => (
              <Tile key={c.hex} label={c.label} chip={hex(c.hex)} selected={draft.hairColor === c.hex} onPreview={pv({ hairColor: c.hex })} onPick={() => apply({ hairColor: c.hex })} />
            ))}
          </Group>
        ))}
      </>
    );
  else if (tab === 'skin' || (tab === 'beard' && sex === 'f'))
    content = (
      <Group label="Skin tone" chips>
        {SKIN_TONES.map((c, i) => (
          <Tile key={c} label={SKIN_NAMES[i]!} chip={hex(c)} selected={draft.skin === c} onPreview={pv({ skin: c })} onPick={() => apply({ skin: c })} />
        ))}
      </Group>
    );
  else
    content =
      sex === 'm' ? (
        <>
          {groupsOf(BEARD_STYLES).map(([group, list]) => (
            <Group key={group} label={group === 'None' ? 'Facial hair' : group}>
              {list.map((b) => (
                <Tile
                  key={b.id}
                  label={b.label}
                  selected={draft.beard === b.id}
                  thumb={{ look: beardThumb(draft.skin, draft.hair, draft.hairColor, b.id, draft.beardColor), kind: 'face' }}
                  onPreview={pv({ beard: b.id })}
                  onPick={() => apply({ beard: b.id })}
                />
              ))}
            </Group>
          ))}
          <Group label="Beard colour" chips>
            <Tile label="Match hair" chip={`linear-gradient(135deg, ${hex(draft.hairColor)} 50%, transparent 50%)`} selected={draft.beardColor === undefined} onPreview={pv({ beardColor: undefined })} onPick={() => apply({ beardColor: undefined })} />
            {HAIR_PALETTE.filter((c) => !c.dyed || c.hex === draft.hairColor).map((c) => (
              <Tile key={c.hex} label={c.label} chip={hex(c.hex)} selected={draft.beardColor === c.hex} onPreview={pv({ beardColor: c.hex })} onPick={() => apply({ beardColor: c.hex })} />
            ))}
          </Group>
        </>
      ) : (
        <p className="look-empty dim">Facial hair is only available on the male body.</p>
      );

  return (
    <div className="look-editor">
      <div className="look-tabs" role="tablist" aria-label="Customisation" ref={tabsRef} onKeyDown={tabKeys}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${tabIds}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${tabIds}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab${tab === t.id ? ' on' : ''}`}
            onClick={() => switchTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="look-panel" role="tabpanel" id={`${tabIds}-panel`} aria-labelledby={`${tabIds}-${tab}`}>
        {content}
      </div>
    </div>
  );
}
