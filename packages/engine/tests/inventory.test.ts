import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  addItem,
  canPlace,
  countAmmo,
  createEquipment,
  createGrid,
  createItem,
  findSpot,
  footprint,
  generateLoadout,
  generateLoot,
  moveItem,
  quickMove,
  removeItem,
  Rng,
  slotAccepts,
  starterKit,
  takeAmmo,
  CONTAINERS,
  type ContainerKind,
} from '../src/index';

describe('grid inventory', () => {
  it('places items without overlap and respects bounds', () => {
    const g = createGrid(4, 4);
    const rifle = createItem('ak74m');
    const { w, h } = footprint(rifle);
    expect(addItem(g, rifle)).toBe(true);
    const other = createItem('ak74m');
    expect(canPlace(g, other, 0, 0, false)).toBe(false);
    expect(canPlace(g, other, 4 - w + 1, 0, false)).toBe(false);
    expect(h).toBeGreaterThan(0);
  });

  it('rotates to fit when needed', () => {
    const g = createGrid(2, 6);
    const rifle = createItem('ak74m');
    const spot = findSpot(g, rifle);
    expect(spot?.rot).toBe(true);
  });

  it('removes and re-adds items', () => {
    const g = createGrid(3, 3);
    const b = createItem('bandage');
    addItem(g, b);
    expect(removeItem(g, b.uid)?.item.uid).toBe(b.uid);
    expect(g.items.length).toBe(0);
  });

  it('stacks ammo when adding', () => {
    const g = createGrid(2, 2);
    addItem(g, createItem('a_545ps', { stack: 20 }));
    addItem(g, createItem('a_545ps', { stack: 20 }));
    const total = g.items.reduce((s, p) => s + (p.item.stack ?? 1), 0);
    expect(total).toBe(40);
  });
});

describe('equipment', () => {
  it('only accepts matching items per slot', () => {
    expect(slotAccepts('primary', ITEMS.ak74m!)).toBe(true);
    expect(slotAccepts('helmet', ITEMS.ak74m!)).toBe(false);
    expect(slotAccepts('melee', ITEMS.knife!)).toBe(true);
    expect(slotAccepts('armor', ITEMS['6b23']!)).toBe(true);
  });

  it('moves an item from a grid into a slot and back', () => {
    const eq = createEquipment();
    const g = createGrid(6, 6);
    const gun = createItem('ak74m');
    addItem(g, gun);
    expect(moveItem({ kind: 'grid', grid: g, uid: gun.uid }, { kind: 'slot', eq, slot: 'primary' })).toBe(true);
    expect(eq.slots.primary?.uid).toBe(gun.uid);
    expect(quickMove({ kind: 'slot', eq, slot: 'primary' }, [g])).toBe(true);
    expect(eq.slots.primary).toBeNull();
  });

  it('draws ammo from carried stacks', () => {
    const eq = starterKit();
    const cal = ITEMS[eq.slots.secondary!.def]!.weapon!.caliber;
    const before = countAmmo(eq, cal);
    expect(before).toBeGreaterThan(0);
    const { taken } = takeAmmo(eq, cal, 5);
    expect(taken).toBe(5);
    expect(countAmmo(eq, cal)).toBe(before - 5);
  });
});

describe('loot and loadouts', () => {
  it('generates loot for every container kind deterministically', () => {
    for (const kind of Object.keys(CONTAINERS) as ContainerKind[]) {
      const a = generateLoot(kind, new Rng(9), 1);
      const b = generateLoot(kind, new Rng(9), 1);
      expect(a.items.map((p) => p.item.def)).toEqual(b.items.map((p) => p.item.def));
    }
  });

  it('gives raiders better gear than scavs on average', () => {
    const rng = new Rng(3);
    let scav = 0;
    let raider = 0;
    for (let i = 0; i < 40; i++) {
      scav += generateLoadout('scav', rng).slots.armor ? 1 : 0;
      raider += generateLoadout('raider', rng).slots.armor ? 1 : 0;
    }
    expect(raider).toBeGreaterThan(scav);
  });

  it('arms every bot', () => {
    const rng = new Rng(11);
    for (const a of ['scav', 'raider', 'guard', 'boss'] as const) {
      const eq = generateLoadout(a, rng, 1);
      expect(eq.slots.primary || eq.slots.secondary || eq.slots.melee).toBeTruthy();
    }
  });
});
