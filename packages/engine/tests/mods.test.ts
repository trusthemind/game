import { describe, expect, it } from 'vitest';
import {
  addItem,
  ALL_ITEMS,
  createItem,
  createProfile,
  effectiveWeapon,
  getDef,
  installMod,
  installPart,
  itemValue,
  itemWeight,
  migrateProfile,
  PROFILE_VERSION,
  modFits,
  partsFitting,
  removeMod,
  removePart,
  generateLoadout,
  Rng,
  socketFor,
  socketsOf,
  socketTree,
  type ItemInstance,
} from '../src/index';

describe('weapon mods', () => {
  it('older guns fit attachments by caliber, class or explicit ids', () => {
    expect(modFits('red_dot', 'mp133')).toBe(true);
    expect(modFits('mag_saiga20', 'saiga12')).toBe(true);
    expect(modFits('scope_4x', 'mp133')).toBe(false);
    expect(modFits('fgrip', 'pm')).toBe(false);
    // Parts made only for guns built from parts stay off the older ones.
    expect(modFits('ak_hg_b10', 'saiga12')).toBe(false);
    expect(modFits('pso1', 'saiga12')).toBe(false);
  });

  it('guns built from parts fit them by mount', () => {
    expect(socketFor(createItem('ak74m'), 'sup_545')).toEqual(['muzzle']);
    expect(socketFor(createItem('m4a1'), 'sup_545')).toBeNull();
    expect(socketFor(createItem('m4a1'), 'sup_556')).toEqual(['barrel', 'muzzle']);
    expect(socketFor(createItem('akm'), 'mag_ak45')).toBeNull();
    // A factory AK has no rail for a red dot, only the dovetail for a PSO.
    expect(socketFor(createItem('ak74m'), 'red_dot')).toBeNull();
    expect(socketFor(createItem('ak74m'), 'pso1')).toEqual(['side']);
    expect(socketFor(createItem('mp5'), 'sup_9')).toEqual(['muzzle']);
    expect(socketFor(createItem('glock17'), 'red_dot')).toEqual(['slide', 'sight']);
  });

  it('every weapon has sockets and at least one compatible part', () => {
    for (const w of ALL_ITEMS.filter((d) => d.weapon)) {
      expect(socketsOf(w.id).length).toBeGreaterThan(0);
      expect(partsFitting(createItem(w.id)).length).toBeGreaterThan(0);
    }
  });

  it('change stats: suppressor quietens, grip tames recoil, scope tightens aimed spread, mag holds more', () => {
    const gun = createItem('ak74m');
    const base = effectiveWeapon(gun);
    installMod(gun, createItem('sup_545'));
    installMod(gun, createItem('ak_hg_b10'));
    installMod(gun, createItem('fgrip'));
    installMod(gun, createItem('ak_gt_b19'));
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

describe('guns built from parts', () => {
  const tree = (g: ItemInstance) => socketTree(g).map((r) => `${r.path.join('/')}=${r.part?.def ?? '-'}`);

  it('leave the factory complete: same stats, weight and value as the gun in the catalogue', () => {
    for (const id of ['ak74m', 'akm', 'aks74u', 'm4a1']) {
      const g = createItem(id);
      const def = getDef(id);
      const e = effectiveWeapon(g);
      expect(e.operable).toBe(true);
      for (const k of ['damage', 'rpm', 'magSize', 'spread', 'range', 'reloadTime', 'noise', 'recoil'] as const) expect(e[k]).toBeCloseTo(def.weapon![k]);
      expect(itemWeight(g)).toBeCloseTo(def.weight);
      expect(itemValue(g)).toBe(def.value);
    }
    expect(tree(createItem('m4a1'))).toContain('barrel/muzzle=ar_fh_a2');
  });

  it("don't fire with a required part missing", () => {
    const g = createItem('ak74m');
    removePart(g, ['gastube']);
    expect(effectiveWeapon(g).operable).toBe(false);
    installPart(g, ['gastube'], createItem('ak_gt_74'));
    expect(effectiveWeapon(g).operable).toBe(true);
    removePart(g, ['mag']);
    expect(effectiveWeapon(g).operable).toBe(false);
  });

  it('parts carry sockets: a railed handguard takes a foregrip, and comes off with it', () => {
    const g = createItem('ak74m');
    expect(socketFor(g, 'fgrip')).toBeNull();
    const r = installPart(g, ['handguard'], createItem('ak_hg_b10'));
    expect(r && r.replaced?.def).toBe('ak_hg_74');
    expect(socketFor(g, 'fgrip')).toEqual(['handguard', 'foregrip']);
    // A rail takes only its kind of part: no scope on the bottom rail.
    expect(installPart(g, ['handguard', 'foregrip'], createItem('red_dot'))).toBe(false);
    expect(installPart(g, ['handguard', 'foregrip'], createItem('fgrip'))).not.toBe(false);
    const off = removePart(g, ['handguard']);
    expect(off.part?.mods?.foregrip?.def).toBe('fgrip');
    expect(tree(g)).not.toContain('handguard/foregrip=fgrip');
    expect(effectiveWeapon(g).operable).toBe(false);
  });

  it('a new barrel comes bare: the old one keeps its flash hider', () => {
    const g = createItem('m4a1');
    const r = installPart(g, ['barrel'], createItem('ar_barrel_20'));
    expect(r && r.replaced?.mods?.muzzle?.def).toBe('ar_fh_a2');
    expect(g.mods?.barrel?.mods?.muzzle).toBeUndefined();
    expect(effectiveWeapon(g).range).toBeGreaterThan(getDef('m4a1').weapon!.range);
  });

  it('profile v5 rebuilds old guns from parts and keeps every attachment', () => {
    const p = createProfile();
    p.version = 4;
    const legacy = (id: string, mods: Record<string, string>): ItemInstance => ({
      ...createItem(id),
      mods: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, createItem(v)])),
    });
    expect(addItem(p.stash, legacy('ak74m', { scope: 'red_dot', grip: 'fgrip', muzzle: 'sup_545', mag: 'mag_ak45', light: 'tac_light' }))).toBe(true);
    expect(addItem(p.stash, legacy('aks74u', { scope: 'holo' }))).toBe(true);
    p.equipment.slots.primary = legacy('m4a1', { grip: 'fgrip', mag: 'mag_stanag60' });
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(m.version).toBe(PROFILE_VERSION);
    const ak = m.stash.items.find((x) => x.item.def === 'ak74m')!.item;
    expect(tree(ak)).toEqual(
      expect.arrayContaining(['gastube/sight=red_dot', 'handguard/foregrip=fgrip', 'handguard/tactical=tac_light', 'muzzle=sup_545', 'mag=mag_ak45']),
    );
    expect(effectiveWeapon(ak).operable).toBe(true);
    const m4 = m.equipment.slots.primary!;
    expect(tree(m4)).toEqual(expect.arrayContaining(['handguard=ar_hg_ris', 'handguard/foregrip=fgrip', 'mag=mag_stanag60', 'barrel/muzzle=ar_fh_a2']));
    // The AKS-74U has no rail for a holographic sight: it goes into the stash, not lost.
    expect(m.stash.items.some((x) => x.item.def === 'holo')).toBe(true);
    expect(effectiveWeapon(m.stash.items.find((x) => x.item.def === 'aks74u')!.item).operable).toBe(true);
  });

  it('profile v6 rebuilds pistols from parts and keeps their attachments', () => {
    const p = createProfile();
    p.version = 5;
    const legacy = (id: string, mods: Record<string, string>): ItemInstance => ({
      ...createItem(id),
      mods: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, createItem(v)])),
    });
    p.equipment.slots.secondary = legacy('glock17', { scope: 'red_dot', muzzle: 'sup_9', light: 'tac_light', mag: 'mag_9_33' });
    expect(addItem(p.stash, legacy('pm', { muzzle: 'sup_9' }))).toBe(true);
    expect(addItem(p.stash, legacy('rhino', {}))).toBe(true);
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    const glock = m.equipment.slots.secondary!;
    expect(tree(glock)).toEqual(expect.arrayContaining(['slide=glock_slide', 'slide/sight=red_dot', 'muzzle=sup_9', 'tactical=tac_light', 'mag=mag_9_33']));
    expect(effectiveWeapon(glock).operable).toBe(true);
    expect(effectiveWeapon(glock).magSize).toBe(33);
    // A PM has no thread for a suppressor: it goes into the stash.
    const pm = m.stash.items.find((x) => x.item.def === 'pm')!.item;
    expect(tree(pm)).toEqual(['slide=pm_slide', 'mag=pm_mag8']);
    expect(m.stash.items.some((x) => x.item.def === 'sup_9')).toBe(true);
    expect(tree(m.stash.items.find((x) => x.item.def === 'rhino')!.item)).toEqual(['cylinder=rhino_cyl']);
  });

  it('profile v7 rebuilds submachine guns from parts and keeps their attachments', () => {
    const p = createProfile();
    p.version = 6;
    const legacy = (id: string, mods: Record<string, string>): ItemInstance => ({
      ...createItem(id),
      mods: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, createItem(v)])),
    });
    p.equipment.slots.primary = legacy('vector', { scope: 'holo', grip: 'fgrip', light: 'tac_light', muzzle: 'sup_9', mag: 'mag_9_33', stock: 'stock_tac' });
    expect(addItem(p.stash, legacy('mp5', { grip: 'fgrip', scope: 'red_dot' }))).toBe(true);
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    const vector = m.equipment.slots.primary!;
    expect(tree(vector)).toEqual(
      expect.arrayContaining(['sight=holo', 'foregrip=fgrip', 'tactical=tac_light', 'muzzle=sup_9', 'mag=mag_9_33', 'stock=stock_tac']),
    );
    expect(effectiveWeapon(vector).operable).toBe(true);
    expect(effectiveWeapon(vector).magSize).toBe(33);
    const mp5 = m.stash.items.find((x) => x.item.def === 'mp5')!.item;
    expect(tree(mp5)).toEqual(expect.arrayContaining(['sight=red_dot', 'handguard=mp5_hg', 'stock=mp5_st', 'mag=mp5_mag30']));
    // No bottom rail on an MP5's handguard: the foregrip goes into the stash.
    expect(m.stash.items.some((x) => x.item.def === 'fgrip')).toBe(true);
    expect(tree(createItem('pp19'))).toEqual(['sight=-', 'handguard=pp19_hg', 'stock=pp19_st', 'muzzle=-', 'mag=pp19_mag30']);
  });

  it('profile v8 rebuilds rifles and machine guns from parts and keeps their attachments', () => {
    const p = createProfile();
    p.version = 7;
    const legacy = (id: string, mods: Record<string, string>): ItemInstance => ({
      ...createItem(id),
      mods: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, createItem(v)])),
    });
    p.equipment.slots.primary = legacy('svd', { scope: 'scope_8x', muzzle: 'sup_54r', stock: 'stock_tac' });
    expect(addItem(p.stash, legacy('rpk16', { mag: 'mag_rpk95', grip: 'fgrip', muzzle: 'brake' }))).toBe(true);
    expect(addItem(p.stash, legacy('sks', { mag: 'mag_sks20', light: 'tac_light' }))).toBe(true);
    const m = migrateProfile(JSON.parse(JSON.stringify(p)));
    const svd = m.equipment.slots.primary!;
    expect(tree(svd)).toEqual(expect.arrayContaining(['sight=scope_8x', 'muzzle=sup_54r', 'stock=stock_tac', 'handguard=svd_hg', 'mag=svd_mag10']));
    expect(effectiveWeapon(svd).operable).toBe(true);
    const find = (id: string) => m.stash.items.find((x) => x.item.def === id)!.item;
    // The RPK-16's foregrip goes on its handguard's bottom rail.
    expect(tree(find('rpk16'))).toEqual(expect.arrayContaining(['mag=mag_rpk95', 'handguard=rpk16_hg', 'handguard/foregrip=fgrip', 'muzzle=brake']));
    expect(effectiveWeapon(find('rpk16')).magSize).toBe(95);
    expect(tree(find('sks'))).toEqual(expect.arrayContaining(['mag=mag_sks20']));
    // No rail for a light on an SKS: into the stash.
    expect(m.stash.items.some((x) => x.item.def === 'tac_light')).toBe(true);
    // A stock gun shoots like before: factory parts are neutral (the RPK-16's 45-round mag included).
    expect(effectiveWeapon(createItem('rpk16')).magSize).toBe(45);
    expect(effectiveWeapon(createItem('rpk16')).reloadTime).toBeCloseTo(3.2, 1);
    expect(tree(createItem('mosin'))).toEqual(['sight=-', 'muzzle=-']);
  });
});
