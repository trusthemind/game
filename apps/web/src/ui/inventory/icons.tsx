import type { Category } from '@ashfall/engine';

/** Hand-drawn category glyphs (inline SVG, no image assets). */
const PATHS: Record<Category, string> = {
  weapon: 'M2 10h14l2-2h4v3h-3l-1 2h-3l-1 4h-3l1-4H8l-1 2H4l1-2H2z',
  melee: 'M4 20l3-3m0 0L18 6l2-2-1 4-11 11zm-3 0l2 2',
  ammo: 'M7 21V10l2-6 2 6v11zm6 0V10l2-6 2 6v11z',
  armor: 'M6 3l3 2h6l3-2 3 4-2 3v11H5V10L3 7z',
  helmet: 'M3 15a9 9 0 0118 0v2H3zm2 2v2h4v-2',
  rig: 'M5 4h14v16H5zM8 8h3v4H8zm5 0h3v4h-3zM8 14h8v3H8z',
  backpack: 'M8 4a4 4 0 018 0h1a3 3 0 013 3v13H4V7a3 3 0 013-3zm1 9h6v4H9z',
  med: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z',
  food: 'M6 6h12v3H6zm1 3h10l-1 11H8z',
  drink: 'M10 2h4v3l2 3v14H8V8l2-3z',
  valuable: 'M12 3l7 6-7 12L5 9zM5 9h14',
  junk: 'M12 8a4 4 0 100 8 4 4 0 000-8zm0-6l2 3h3l1 3 3 2-2 3 2 3-3 2-1 3h-3l-2 3-2-3H7l-1-3-3-2 2-3-2-3 3-2 1-3h3z',
  money: 'M3 7h18v10H3zm9 2a3 3 0 100 6 3 3 0 000-6z',
};

export function CategoryIcon({ category, size = 22, color = 'currentColor' }: { category: Category; size?: number; color?: string }) {
  const strokey = category === 'melee' || category === 'valuable';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[category]} fill={strokey ? 'none' : color} stroke={strokey ? color : 'none'} strokeWidth={strokey ? 2 : 0} strokeLinejoin="round" fillRule="evenodd" />
    </svg>
  );
}
