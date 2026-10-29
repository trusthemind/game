import { describe, expect, it } from 'vitest';
import { DialogueRunner, INITIAL_AFFINITY, NPCS, stageOf, validateNpc, type DialogueHost, type Relationship } from '../src/index';

const rel = (affinity = 0): Relationship => ({ affinity, flags: [], met: false, talks: 0, dead: false });

type FakeHost = DialogueHost & { cash: number; items: Record<string, number> };

function host(over: Partial<DialogueHost> = {}): FakeHost {
  const h: FakeHost = {
    cash: 1000,
    items: {} as Record<string, number>,
    inRaid: false,
    isCompanion: false,
    countItem: (d: string) => h.items[d] ?? 0,
    takeItem: (d: string, n: number) => ((h.items[d] ?? 0) >= n ? ((h.items[d]! -= n), true) : false),
    giveItem: (d: string, n: number) => void (h.items[d] = (h.items[d] ?? 0) + n),
    addMoney: (n: number) => void (h.cash += n),
    money: () => h.cash,
    recruit: () => {},
    dismiss: () => {},
    ...over,
  };
  return h;
}

describe('authored NPCs', () => {
  for (const npc of Object.values(NPCS)) {
    it(`${npc.id} has no dangling dialogue links`, () => {
      expect(validateNpc(npc)).toEqual([]);
    });

    it(`${npc.id} conversation can always be walked to an end`, () => {
      for (const inRaid of [false, true]) {
        const r = new DialogueRunner(npc, rel(INITIAL_AFFINITY[npc.id] ?? 0), host({ inRaid }));
        let node = r.start();
        let steps = 0;
        while (node && steps++ < 200) {
          const choices = r.choices;
          if (!choices.length) break;
          node = r.choose(choices.length - 1);
        }
        expect(steps).toBeLessThan(200);
      }
    });
  }
});

describe('relationships', () => {
  it('stages follow affinity', () => {
    expect(stageOf(rel(-50))).toBe('hostile');
    expect(stageOf(rel(0))).toBe('stranger');
    expect(stageOf(rel(20))).toBe('acquaintance');
    expect(stageOf(rel(50))).toBe('friend');
    expect(stageOf(rel(80))).toBe('close');
    expect(stageOf({ ...rel(80), flags: ['romance'] })).toBe('partner');
  });

  it('talking marks the NPC as met', () => {
    const r = rel();
    new DialogueRunner(NPCS.lena!, r, host({ inRaid: true })).start();
    expect(r.met).toBe(true);
    expect(r.talks).toBe(1);
  });
});
