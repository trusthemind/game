import { useEffect, useState } from 'react';
import { getDef, type ItemInstance } from '@ashfall/engine';
import { getThumb, onThumbsChanged, thumbKey } from '../../render/thumbnails';
import { ICON_BODY, ICON_FOR } from './gameIcons';

/** Tint per category so the grid reads at a glance (meds red, food green, valuables gold…). */
const CAT_TINT: Record<string, string> = {
  ammo: '#d9b45a',
  med: '#e06a5a',
  food: '#9ccf72',
  drink: '#7fb8e0',
  valuable: '#f0c24a',
  money: '#9ad08a',
  junk: '#b9b3a6',
  armor: '#c9cfc4',
  helmet: '#c9cfc4',
  rig: '#c9c09a',
  backpack: '#c9b48a',
  secure: '#e0c070',
  mod: '#b7c7d6',
  weapon: '#d7dad2',
  melee: '#d7dad2',
};

/** Picture for an item: 3D-rendered thumbnail for guns/melee, a game-icons glyph for everything else. */
export function ItemArt({ item, w, h }: { item: ItemInstance; w: number; h: number }) {
  const d = getDef(item.def);
  const key = thumbKey(item);
  const [url, setUrl] = useState<string | null>(() => (key ? getThumb(item) : null));
  useEffect(() => {
    if (!key) return;
    setUrl(getThumb(item));
    return onThumbsChanged(() => setUrl(getThumb(item)));
  }, [key, item]);
  if (url) return <img className="item-img" src={url} alt="" draggable={false} style={{ width: w - 6, height: h - 6 }} />;
  const name = ICON_FOR[item.def] ?? ICON_FOR[`cat:${d.category}`] ?? 'cog';
  const body = ICON_BODY[name];
  const s = Math.min(w, h) * 0.66;
  return (
    <svg className="item-svg" width={s} height={s} viewBox="0 0 512 512" aria-hidden="true" style={{ color: CAT_TINT[d.category] ?? '#ccc' }} dangerouslySetInnerHTML={{ __html: body ?? '' }} />
  );
}
