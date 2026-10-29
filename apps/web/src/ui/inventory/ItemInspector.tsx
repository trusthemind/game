import { footprint, getDef, itemNeeds, RARITY_COLORS } from '@ashfall/engine';
import { useProfile } from '../../state/profileStore';
import { itemLines, useInspect } from './components';
import { ItemArt } from './ItemArt';

const RARITY_NAME = ['', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** Side panel: the last item you pointed at, bigger, with every stat and what it's still needed for. */
export function ItemInspector() {
  const item = useInspect((s) => s.item);
  const profile = useProfile((s) => s.profile);
  if (!item || !profile) {
    return (
      <section className="panel col inspector">
        <div className="panel-title">
          <span>Inspect</span>
        </div>
        <p className="pad dim inspector-empty">Point at an item to see its stats and what it is needed for.</p>
      </section>
    );
  }
  const d = getDef(item.def);
  const fp = footprint(item);
  const scale = Math.min(260 / (fp.w * 52), 150 / (fp.h * 52), 2.4);
  const needs = itemNeeds(profile, item.def);
  return (
    <section className="panel col inspector">
      <div className="panel-title">
        <span>Inspect</span>
        <span style={{ color: RARITY_COLORS[d.rarity] }}>{RARITY_NAME[d.rarity]}</span>
      </div>
      <div className="inspector-art" style={{ borderColor: RARITY_COLORS[d.rarity] }}>
        <ItemArt item={item} w={fp.w * 52 * scale} h={fp.h * 52 * scale} />
      </div>
      <div className="pad stack">
        <div>
          <div className="inspector-name">
            {d.name}
            {item.fir && <span className="fir">FIR</span>}
          </div>
          <div className="dim inspector-cat">
            {d.category} · {fp.w}×{fp.h}
          </div>
        </div>
        <div className="inspector-rows">
          {itemLines(item).map(([k, v]) => (
            <div key={k} className="tooltip-row">
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        {needs.length > 0 && (
          <div className="inspector-needs">
            <div className="inspector-sub">Needed for</div>
            {needs.map((n) => (
              <div key={n.label} className="tooltip-row">
                <span>
                  {n.label}
                  {n.fir && <span className="fir">FIR</span>}
                </span>
                <b>×{n.count}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
