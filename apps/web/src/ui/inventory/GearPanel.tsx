import { useContext } from 'react';
import { equipmentValue, equipmentWeight } from '@ashfall/engine';
import { EquipSlot, InvContext, ItemGrid } from './components';

/** Tarkov-style character panel: equipment slots on the left, carried containers on the right. */
export function GearPanel({ owner, cell = 48, title, compact = false }: { owner: string; cell?: number; title?: string; compact?: boolean }) {
  const ctx = useContext(InvContext)!;
  const eq = ctx.host.resolver.equipment(owner);
  if (!eq) return null;
  return (
    <div className="gear-panel">
      {title && (
        <div className="gear-head">
          <span className="h">{title}</span>
          <span className="mono dim">
            {equipmentWeight(eq).toFixed(1)} kg · {equipmentValue(eq).toLocaleString('en-US')} ₵
          </span>
        </div>
      )}
      <div className={`gear-cols ${compact ? 'compact' : ''}`}>
        <div className="gear-slots">
          <div className="row">
            <EquipSlot owner={owner} slot="helmet" w={2} h={2} cell={cell} />
            <EquipSlot owner={owner} slot="armor" w={3} h={3} cell={cell} />
          </div>
          <EquipSlot owner={owner} slot="primary" w={5} h={2} cell={cell} />
          <div className="row">
            <EquipSlot owner={owner} slot="secondary" w={3} h={1.5} cell={cell} />
            <EquipSlot owner={owner} slot="melee" w={2} h={1.5} cell={cell} />
          </div>
          <div className="row">
            <EquipSlot owner={owner} slot="rig" w={2} h={2} cell={cell} />
            <EquipSlot owner={owner} slot="backpack" w={2} h={2} cell={cell} />
          </div>
        </div>
        <div className="gear-grids">
          <ItemGrid gridId={`${owner}:pockets`} cell={cell} label="Pockets" />
          {eq.slots.rig && <ItemGrid gridId={`${owner}:rig`} cell={cell} label={`Rig`} />}
          {eq.slots.backpack && <ItemGrid gridId={`${owner}:backpack`} cell={cell} label="Backpack" />}
        </div>
      </div>
    </div>
  );
}
