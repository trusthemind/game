import { useState } from 'react';
import { CharacterPreview } from './CharacterPreview';
import { LookEditor } from './LookEditor';
import { useEscape } from './useEscape';

/**
 * Character customisation: a large live 3D preview (whole body or a face close-up, helmet and hat off) beside
 * every look control. Changes save as they're made; the raid uses them on the next deploy.
 */
export function CustomizeModal({ onClose }: { onClose: () => void }) {
  const [framing, setFraming] = useState<'body' | 'face'>('face');
  useEscape(onClose);
  return (
    <div className="modal-backdrop fade-in" onClick={onClose}>
      <div className="panel customize" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <span>Customize character</span>
          <span className="dim">changes save as you go</span>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="customize-body">
          <div className="customize-preview">
            <CharacterPreview framing={framing} bareHead className="big" />
            <div className="look-row center">
              <button className={`btn small${framing === 'face' ? ' active' : ''}`} onClick={() => setFraming('face')}>
                Face
              </button>
              <button className={`btn small${framing === 'body' ? ' active' : ''}`} onClick={() => setFraming('body')}>
                Full body
              </button>
              <span className="dim small">drag to turn</span>
            </div>
          </div>
          <div className="customize-controls">
            <LookEditor />
          </div>
        </div>
        <div className="customize-foot">
          <button className="btn primary" onClick={onClose}>
            Done
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
