import { describe, expect, it } from 'vitest';
import {
  actorVisorDown,
  applyRaidResult,
  createEquipment,
  createItem,
  createProfile,
  hasVisor,
  isVisorDown,
  migrateProfile,
  starterKit,
  toggleVisor,
  type Actor,
  type BotBrain,
  type RaidResult,
} from '../src/index';

describe('helmet visors', () => {
  it('only helmets with a hinged faceplate have one', () => {
    expect(hasVisor(createItem('altyn'))).toBe(true);
    for (const id of ['ssh68', 'ssh36', 'h_kevlar', 'h_fast', 'h_fast_headset', 'zsh', 'paca']) expect(hasVisor(createItem(id))).toBe(false);
    expect(hasVisor(null)).toBe(false);
  });

  it('is raised by default and toggles down and up', () => {
    const h = createItem('altyn');
    expect(isVisorDown(h)).toBe(false);
    expect(toggleVisor(h)).toBe(true);
    expect(isVisorDown(h)).toBe(true);
    expect(toggleVisor(h)).toBe(true);
    expect(isVisorDown(h)).toBe(false);
    // Raised leaves no field behind.
    expect('visorDown' in h).toBe(false);
  });

  it('does nothing to an item without one', () => {
    const h = createItem('h_fast');
    expect(toggleVisor(h)).toBe(false);
    expect(h.visorDown).toBeUndefined();
    expect(isVisorDown({ ...h, visorDown: true })).toBe(false);
  });

  it('persists through a save, a load and a raid', () => {
    const p = createProfile('t');
    p.equipment.slots.helmet = createItem('altyn');
    toggleVisor(p.equipment.slots.helmet);
    const back = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(isVisorDown(back.equipment.slots.helmet)).toBe(true);
    // An old save (no field) comes back raised.
    delete p.equipment.slots.helmet!.visorDown;
    expect(isVisorDown(migrateProfile(JSON.parse(JSON.stringify(p))).equipment.slots.helmet)).toBe(false);
    // Lowered in the raid, the helmet comes home lowered.
    const eq = starterKit();
    eq.slots.helmet = createItem('altyn', { visorDown: true });
    const res: RaidResult = {
      status: 'extracted', duration: 600, kills: {}, playerEq: eq, valueIn: 0, valueOut: 0, xp: 0,
      companion: null, metNpcs: [], deadNpcs: [], secure: null, deathAt: null, graveVisited: false,
    } as RaidResult;
    const q = createProfile('t');
    applyRaidResult(q, res);
    expect(isVisorDown(q.equipment.slots.helmet)).toBe(true);
  });

  it('bots lower it in a fight and raise it when calm; the player wears it as the item says', () => {
    const eq = createEquipment();
    eq.slots.helmet = createItem('altyn');
    const brain = { state: 'patrol', alerted: false } as unknown as BotBrain;
    const bot = { eq, brain } as unknown as Actor;
    expect(actorVisorDown(bot)).toBe(false);
    brain.state = 'engage';
    expect(actorVisorDown(bot)).toBe(true);
    brain.state = 'patrol';
    brain.alerted = true;
    expect(actorVisorDown(bot)).toBe(true);
    brain.alerted = false;
    brain.state = 'idle';
    expect(actorVisorDown(bot)).toBe(false);
    // The bot's own item is left alone.
    expect(eq.slots.helmet!.visorDown).toBeUndefined();
    const player = { eq, brain: null } as unknown as Actor;
    expect(actorVisorDown(player)).toBe(false);
    toggleVisor(eq.slots.helmet);
    expect(actorVisorDown(player)).toBe(true);
    // No visor, never down.
    eq.slots.helmet = createItem('h_fast', { visorDown: true });
    expect(actorVisorDown(player)).toBe(false);
  });
});
