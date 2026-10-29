import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  Rng,
  aimMul,
  applyMed,
  canSprint,
  createHealth,
  createItem,
  damagePart,
  inPain,
  isDead,
  moveMul,
  penetrationChance,
  resolveBulletHit,
  resolveMeleeHit,
  tickHealth,
  totalHp,
  totalMax,
  treatmentTarget,
} from '../src/index';

const med = (id: string) => ITEMS[id]!.med!;

describe('limb health', () => {
  it('starts at 440 HP split over seven parts', () => {
    const h = createHealth();
    expect(totalMax(h)).toBe(440);
    expect(totalHp(h)).toBe(440);
  });

  it('dies from head or thorax, not from limbs', () => {
    const h = createHealth();
    damagePart(h, 'leftLeg', 70, null);
    expect(h.parts.leftLeg.hp).toBe(0);
    expect(isDead(h)).toBe(false);
    const h2 = createHealth();
    expect(damagePart(h2, 'head', 40, null)).toBe(true);
  });

  it('spills damage from a blacked limb to the rest of the body', () => {
    const h = createHealth();
    damagePart(h, 'leftArm', 60, null);
    const before = h.parts.thorax.hp;
    damagePart(h, 'leftArm', 30, null);
    expect(h.parts.thorax.hp).toBeLessThan(before);
  });

  it('bleeds over time', () => {
    const h = createHealth();
    h.parts.stomach.heavy = true;
    const dealt = tickHealth(h, 10);
    expect(dealt).toBeGreaterThan(15);
    expect(h.parts.stomach.hp).toBeLessThan(70);
  });

  it('fractured legs slow you and block sprinting until painkillers', () => {
    const h = createHealth();
    h.parts.rightLeg.fracture = true;
    expect(moveMul(h)).toBeLessThan(1);
    expect(canSprint(h)).toBe(false);
    expect(inPain(h)).toBe(true);
    applyMed(h, med('analgin'), 'head', 4);
    expect(canSprint(h)).toBe(true);
    expect(inPain(h)).toBe(false);
  });

  it('broken arms hurt your aim', () => {
    const h = createHealth();
    h.parts.leftArm.fracture = true;
    expect(aimMul(h)).toBeGreaterThan(1.2);
  });
});

describe('treatment', () => {
  it('tourniquet stops heavy bleeds, bandage stops light ones', () => {
    const h = createHealth();
    h.parts.leftLeg.heavy = true;
    h.parts.rightArm.light = true;
    expect(treatmentTarget(h, med('esmarch'))).toBe('leftLeg');
    applyMed(h, med('esmarch'), 'leftLeg', 1);
    expect(h.parts.leftLeg.heavy).toBe(false);
    expect(applyMed(h, med('bandage'), 'rightArm', 1)).toBe(0);
    expect(h.parts.rightArm.light).toBe(false);
  });

  it('splint fixes fractures', () => {
    const h = createHealth();
    h.parts.leftLeg.fracture = true;
    applyMed(h, med('splint'), 'leftLeg', 1);
    expect(h.parts.leftLeg.fracture).toBe(false);
  });

  it('medkits spend their resource and cannot restore a blacked limb', () => {
    const h = createHealth();
    damagePart(h, 'thorax', 40, null);
    damagePart(h, 'leftArm', 60, null);
    const left = applyMed(h, med('ai2'), 'thorax', 100)!;
    expect(left).toBeLessThan(100);
    expect(h.parts.thorax.hp).toBeGreaterThan(45);
    expect(h.parts.leftArm.hp).toBe(0);
  });

  it('surgery revives a blacked limb at reduced max HP', () => {
    const h = createHealth();
    damagePart(h, 'leftArm', 60, null);
    expect(treatmentTarget(h, med('cms'))).toBe('leftArm');
    applyMed(h, med('cms'), 'leftArm', 5);
    expect(h.parts.leftArm.hp).toBe(1);
    expect(h.parts.leftArm.max).toBeLessThan(60);
  });

  it('a med with nothing to do is not consumed', () => {
    const h = createHealth();
    expect(applyMed(h, med('splint'), 'leftLeg', 1)).toBeNull();
  });
});

describe('ballistics', () => {
  it('higher penetration beats armour more often', () => {
    const armor = ITEMS['6b23']!.armor!;
    expect(penetrationChance(60, armor, armor.durability)).toBeGreaterThan(penetrationChance(15, armor, armor.durability));
    // Worn armour is easier to defeat.
    expect(penetrationChance(30, armor, armor.durability * 0.2)).toBeGreaterThan(penetrationChance(30, armor, armor.durability));
  });

  it('unarmoured hits always penetrate', () => {
    const r = resolveBulletHit(new Rng(1), 50, 'a_545ps', 'stomach', null);
    expect(r.penetrated).toBe(true);
    expect(r.damage).toBeGreaterThan(40);
  });

  it('blocked rounds do a fraction of the damage', () => {
    const plate = createItem('6b23');
    let blocked = 0;
    const rng = new Rng(2);
    for (let i = 0; i < 200; i++) {
      const r = resolveBulletHit(rng, 50, 'a_9x18', 'thorax', plate);
      if (!r.penetrated) {
        blocked++;
        expect(r.damage).toBeLessThan(15);
      }
    }
    expect(blocked).toBeGreaterThan(100);
  });

  it('blunt weapons carry through armour better than blades', () => {
    const plate = createItem('6b23');
    const sledge = resolveMeleeHit(ITEMS.sledge!.melee!, 'thorax', plate);
    const knife = resolveMeleeHit(ITEMS.knife!.melee!, 'thorax', plate);
    expect(sledge.damage / ITEMS.sledge!.melee!.damage).toBeGreaterThan(knife.damage / ITEMS.knife!.melee!.damage);
  });
});

describe('quick heal (Q)', () => {
  it('picks a medkit for plain HP loss on a limb', async () => {
    const { Raid, starterKit, createItem, addItem } = await import('../src/index');
    const r = new Raid({ seed: 1, playerEq: starterKit(), mapId: 'testsite', timeOfDay: 'day' });
    if (!addItem(r.player.eq.pockets, createItem('ai2'))) addItem(r.player.eq.slots.rig!.grid!, createItem('ai2'));
    damagePart(r.player.health, 'rightArm', 6, null);
    const m = r.bestMed(r.player);
    expect(m && ITEMS[m.def]!.med!.resource).toBeGreaterThan(0);
  });

  it('explains why nothing can be used', async () => {
    const { Raid, createEquipment } = await import('../src/index');
    const r = new Raid({ seed: 1, playerEq: createEquipment(), mapId: 'testsite', timeOfDay: 'day' });
    expect(r.bestMed(r.player)).toBeNull();
    expect(r.medHint(r.player)).toMatch(/No meds/);
  });

  it('infected drop after two pistol rounds anywhere, one to the head', () => {
    const legs = createHealth(0.7, true, 70 * 0.68);
    expect(damagePart(legs, 'leftLeg', 28, null)).toBe(false);
    expect(damagePart(legs, 'rightArm', 28, null)).toBe(true);
    const head = createHealth(0.7, true, 70 * 0.68);
    expect(damagePart(head, 'head', 28, null)).toBe(true);
    // People keep the per-limb model.
    const human = createHealth();
    damagePart(human, 'leftLeg', 28, null);
    expect(damagePart(human, 'rightArm', 28, null)).toBe(false);
  });
});
