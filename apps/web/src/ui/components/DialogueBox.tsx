import { useEffect, useMemo, useState } from 'react';
import { DialogueRunner, NPCS, stageOf, STAGE_LABEL, type DialogueHost, type Relationship } from '@ashfall/engine';
import './dialogue.css';

interface Props {
  npcId: string;
  rel: Relationship;
  host: DialogueHost;
  /** Called after every step with the updated relationship (so it can be persisted). */
  onRelChange(rel: Relationship): void;
  onClose(): void;
}

/**
 * Visual-novel style dialogue: portrait, typewriter text, numbered choices (keys 1–9 work too).
 * Relationship meter animates as choices change affinity.
 */
export function DialogueBox({ npcId, rel: initialRel, host, onRelChange, onClose }: Props) {
  const npc = NPCS[npcId]!;
  const [rel] = useState(() => structuredClone(initialRel));
  const runner = useMemo(() => new DialogueRunner(npc, rel, host), [npc, rel, host]);
  const [node, setNode] = useState(() => runner.start());
  const [shown, setShown] = useState(0);
  const [, force] = useState(0);

  useEffect(() => onRelChange(structuredClone(rel)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const text = node?.text ?? '';
  useEffect(() => {
    setShown(0);
    if (!text) return;
    const id = setInterval(() => setShown((s) => (s >= text.length ? (clearInterval(id), s) : s + 2)), 16);
    return () => clearInterval(id);
  }, [text]);

  const choose = (i: number) => {
    if (shown < text.length) return setShown(text.length);
    const next = runner.choose(i);
    onRelChange(structuredClone(rel));
    if (!next) return onClose();
    setNode(next);
    force((n) => n + 1);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        e.preventDefault();
        choose(n - 1);
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (shown < text.length) setShown(text.length);
        else if (runner.choices.length === 1) choose(0);
      } else if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (!node) return null;
  const stage = stageOf(rel);
  const affinityPct = (rel.affinity + 100) / 2;
  return (
    <div className="dialogue-backdrop fade-in">
      <div className="dialogue" style={{ ['--npc' as string]: npc.color }}>
        <div className="dialogue-portrait">
          <div className="portrait-ring">
            <span>{npc.name[0]}</span>
          </div>
          <div className="dialogue-who">
            <div className="h">{npc.name}</div>
            <div className="dim small">{npc.role}</div>
          </div>
          <div className="rel">
            <div className="rel-label">
              <span>{STAGE_LABEL[stage]}</span>
              <span className="mono">{rel.affinity > 0 ? '+' : ''}{rel.affinity}</span>
            </div>
            <div className="rel-bar">
              <i style={{ width: `${affinityPct}%` }} />
              <b />
            </div>
          </div>
        </div>
        <div className="dialogue-body">
          <p className={node.speaker === 'narrator' ? 'narrator' : ''}>
            {text.slice(0, shown)}
            {shown < text.length && <span className="caret">▍</span>}
          </p>
          <div className={`choices ${shown < text.length ? 'waiting' : ''}`}>
            {runner.choices.map((c, i) => (
              <button key={c.text} className="choice" onClick={() => choose(i)}>
                <span className="kbd">{i + 1}</span>
                <span>{c.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
