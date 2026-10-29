import { useLayoutEffect, useRef } from 'react';
import { PART_LABEL, type BodyPart } from '@ashfall/engine';
import { useDrag, zones } from '../inventory/drag';
import './body.css';

export interface PartView {
  part: BodyPart;
  hp: number;
  max: number;
  light: boolean;
  heavy: boolean;
  fracture: boolean;
}

// Silhouette shapes in a 100×200 box (front view).
const SHAPES: Record<BodyPart, { d: string; label: [number, number] }> = {
  head: { d: 'M50 6 a15 17 0 1 0 0.01 0 Z', label: [50, 24] },
  thorax: { d: 'M30 44 h40 l4 40 h-48 Z', label: [50, 66] },
  stomach: { d: 'M26 86 h48 l-3 30 h-42 Z', label: [50, 102] },
  leftArm: { d: 'M28 44 l-10 4 l-8 62 l10 2 l12 -46 Z', label: [17, 80] },
  rightArm: { d: 'M72 44 l10 4 l8 62 l-10 2 l-12 -46 Z', label: [83, 80] },
  leftLeg: { d: 'M29 118 h20 l-2 76 h-14 Z', label: [39, 156] },
  rightLeg: { d: 'M51 118 h20 l-4 76 h-14 Z', label: [61, 156] },
};

function color(p: PartView): string {
  if (p.hp <= 0) return '#121212';
  const r = p.hp / p.max;
  if (r > 0.75) return '#4f7a43';
  if (r > 0.45) return '#8d8a3c';
  if (r > 0.2) return '#9a5a2e';
  return '#8a2a22';
}

function DropPart({ p, children }: { p: PartView; children: React.ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  const hover = useDrag((s) => s.hover?.kind === 'special' && s.hover.zone === `heal:${p.part}`);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `heal:${p.part}`;
    zones.set(key, { el: el as unknown as HTMLElement, kind: 'special', id: key });
    return () => void zones.delete(key);
  }, [p.part]);
  return (
    <g ref={ref} className={hover ? 'part-hover' : ''}>
      {children}
    </g>
  );
}

/** Tarkov-style body status: colour by HP, bleed drops and fracture marks, optional drop targets for meds. */
export function BodyFigure({ parts, height = 150, droppable = false, showNumbers = false }: { parts: PartView[]; height?: number; droppable?: boolean; showNumbers?: boolean }) {
  return (
    <svg className="body-figure" viewBox="0 0 100 200" style={{ height, width: height / 2 }}>
      {parts.map((p) => {
        const s = SHAPES[p.part];
        const body = (
          <g key={p.part}>
            <path d={s.d} fill={color(p)} stroke={p.heavy ? '#ff4a3a' : p.light ? '#d27a6a' : 'rgba(255,255,255,.25)'} strokeWidth={p.heavy ? 2.4 : 1.2}>
              <title>{`${PART_LABEL[p.part]}: ${Math.ceil(p.hp)}/${p.max}${p.heavy ? ' · heavy bleeding' : p.light ? ' · bleeding' : ''}${p.fracture ? ' · fracture' : ''}`}</title>
            </path>
            {p.fracture && (
              <path d={`M${s.label[0] - 5} ${s.label[1] - 5} l10 10 M${s.label[0] + 5} ${s.label[1] - 5} l-10 10`} stroke="#f0c46a" strokeWidth={2.2} />
            )}
            {(p.light || p.heavy) && <circle className="bleed-dot" cx={s.label[0] + 7} cy={s.label[1] - 9} r={p.heavy ? 3.6 : 2.6} fill="#e0402f" />}
            {showNumbers && (
              <text x={s.label[0]} y={s.label[1] + (p.fracture ? 14 : 4)} textAnchor="middle" className="part-num">
                {Math.ceil(p.hp)}
              </text>
            )}
          </g>
        );
        return droppable ? (
          <DropPart key={p.part} p={p}>
            {body}
          </DropPart>
        ) : (
          body
        );
      })}
    </svg>
  );
}
