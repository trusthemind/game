import { describe, expect, it } from 'vitest';
import { ALL_ITEMS, createItem, effectiveWeapon, installMod, modFits, modSlotsFor, removeMod, generateLoadout, Rng, itemValue } from '../src/index';

describe('weapon mods', () => {
  it('fit by caliber, class or explicit ids', () => {
    expect(modFits('sup_545', 'ak74m')).toBe(true);
    expect(modFits('sup_545', 'm4a1')).toBe(false);
    expect(modFits('sup_9', 'mp5')).toBe(true);
    expect(modFits('scope_8x', 'svd')).toBe(true);
    expect(modFits('scope_8x', 'ak74m')).toBe(false);
    expect(modFits('mag_stanag60', 'hk416')).toBe(true);
    expect(modFits('fgrip', 'pm')).toBe(false);
  });

  it('every weapon has slots and at least one compatible mod', () => {
    for (const w of ALL_ITEMS.filter((d) => d.weapon)) {
      expect(modSlotsFor(w.id).length).toBeGreaterThan(0);
      expect(ALL_ITEMS.some((d) => d.mod && modFits(d.id, w.id))).toBe(true);
    }
  });

  it('change stats: suppressor quietens, grip tames recoil, scope tightens aimed spread, mag holds more', () => {
    const gun = createItem('ak74m');
    const base = effectiveWeapon(gun);
    installMod(gun, createItem('sup_545'));
    installMod(gun, createItem('fgrip'));
    installMod(gun, createItem('scope_4x'));
    installMod(gun, createItem('mag_ak45'));
    const m = effectiveWeapon(gun);
    expect(m.suppressed).toBe(true);
    expect(m.noise).toBeLessThan(base.noise * 0.5);
    expect(m.recoil).toBeLessThan(base.recoil);
    expect(m.aimSpreadMul).toBeLessThan(0.7);
    expect(m.zoom).toBeGreaterThan(1.2);
    expect(m.magSize).toBe(45);
    expect(itemValue(gun)).toBeGreaterThan(itemValue(createItem('ak74m')));
  });

  it('swapping replaces, and a smaller mag unloads the extra rounds', () => {
    const gun = createItem('ak74m');
    installMod(gun, createItem('mag_ak45'));
    gun.ammo = 45;
    const r = installMod(gun, createItem('mag_rpk95'));
    expect(r && r.replaced?.def).toBe('mag_ak45');
    const off = removeMod(gun, 'mag');
    expect(off.mod?.def).toBe('mag_rpk95');
    expect(off.unloaded).toBe(15);
    expect(gun.ammo).toBe(30);
  });

  it('rejects mods that do not fit', () => {
    expect(installMod(createItem('pm'), createItem('scope_8x'))).toBe(false);
  });

  it('raiders often carry modded guns', () => {
    const rng = new Rng(8);
    let modded = 0;
    for (let i = 0; i < 30; i++) if (Object.keys(generateLoadout('raider', rng).slots.primary?.mods ?? {}).length) modded++;
    expect(modded).toBeGreaterThan(8);
  });
});
