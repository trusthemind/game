import { useEffect, useState } from 'react';
import { loadAssets } from '../../render/assets';
import { lookFor, renderPortrait, type Appearance } from '../../render/character';

/** 3D-rendered head shot of an NPC (or any appearance), cached as a data URL. */
export function usePortrait(npcId: string | null, look?: Appearance): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadAssets()
      .then((lib) => {
        if (!alive) return;
        const a = look ?? (npcId ? lookFor(0, 'npc', npcId) : null);
        if (a) setUrl(renderPortrait(lib, a));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [npcId, look]);
  return url;
}
