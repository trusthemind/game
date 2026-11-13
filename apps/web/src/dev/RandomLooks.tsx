import { useEffect, useState } from 'react';
import { BEARD_STYLES, DEFAULT_LOOK, faceFromSeed, hairStylesFor, NATURAL_HAIR, npcBeard, npcHair, npcShape, randomHumanFace, randomHumanShape, Rng, type PlayerLook, type Sex } from '@ashfall/engine';
import { loadAssets, loadBodies } from '../render/assets';
import { lookBodies, playerAppearance, renderPortrait, SKIN_TONES } from '../render/character';

const HAIR: Record<Sex, string[]> = { m: hairStylesFor('m').map((h) => h.id), f: hairStylesFor('f').map((h) => h.id) };

/**
 * Dev check (/#charlab?view=randoms&sex=f&src=npc): 24 random looks as the character creator's Randomize makes
 * them (src=npc: the NPC seed generators), full body and head, to make sure every one is a believable person.
 */
export function RandomLooks() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sex: Sex = q.get('sex') === 'f' ? 'f' : 'm';
  const npc = q.get('src') === 'npc';
  // `&preset=pear|average` or a JSON shape: those shapes in turn instead of random ones.
  const forced = (q.get('preset') ?? '').split('|').filter(Boolean).map((p) => (p.startsWith('{') ? JSON.parse(p) : p));
  const [urls, setUrls] = useState<[string, string][]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const lib = await loadAssets();
      const rng = new Rng(Number(q.get('seed') ?? 7));
      const rnd = () => rng.next();
      const out: [string, string][] = [];
      for (let i = 0; i < 24; i++) {
        const look: PlayerLook = {
          ...DEFAULT_LOOK,
          sex,
          skin: rng.pick(SKIN_TONES),
          hair: npc ? npcHair(sex, i * 37) : rng.pick(HAIR[sex]),
          hairColor: rng.pick(NATURAL_HAIR),
          beard: npc ? npcBeard(sex, i * 37) : sex === 'm' ? rng.pick(BEARD_STYLES).id : 'none',
          shape: forced.length ? forced[i % forced.length]! : npc ? npcShape(sex, i * 37) : randomHumanShape(sex, rnd),
          face: npc ? faceFromSeed(i * 37) : randomHumanFace(rnd),
        };
        const a = playerAppearance(look);
        await loadBodies(lib, lookBodies(a));
        if (!alive) return;
        out.push([renderPortrait(lib, a, 360, 'body'), renderPortrait(lib, a, 110, 'head')]);
        setUrls([...out]);
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => void (alive = false);
  }, []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${q.get('cols') ?? 6}, 1fr)`, alignContent: 'start', gap: 2, padding: 2, background: '#3a3f3b', height: '100vh', overflow: 'auto' }}>
      {urls.map(([b, h], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', background: '#2a2e2b' }}>
          <img src={b} style={{ width: '58%', aspectRatio: '1', display: 'block' }} />
          <img src={h} style={{ width: '42%', aspectRatio: '1', display: 'block' }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Dev check (/#charlab?view=hair&sex=f, or view=beards): every hairstyle (or beard) of one sex, each from the
 * front-side and from behind, labelled.
 */
export function StyleGrid() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const beards = q.get('view') === 'beards';
  const sex: Sex = beards ? 'm' : q.get('sex') === 'f' ? 'f' : 'm';
  const size = Number(q.get('size') ?? 150);
  const [cells, setCells] = useState<[string, string, string][]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const lib = await loadAssets();
      const out: [string, string, string][] = [];
      const list = beards ? BEARD_STYLES.map((b) => [b.id, b.label] as const) : hairStylesFor(sex).map((h) => [h.id, h.label] as const);
      const only = (q.get('only') ?? '').split(',').filter(Boolean);
      for (const [id, label] of list) {
        if (only.length && !only.includes(id)) continue;
        const look: PlayerLook = { ...DEFAULT_LOOK, sex, hair: beards ? 'short' : id, beard: beards ? id : 'none', hairColor: Number(q.get('color') ?? 0x5b3d25), face: 'classic', shape: 'average' };
        const a = playerAppearance(look);
        await loadBodies(lib, lookBodies(a));
        if (!alive) return;
        out.push([label, renderPortrait(lib, a, size, beards ? 'face' : 'hair'), renderPortrait(lib, a, size, beards ? 'head' : 'back')]);
        setCells([...out]);
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => void (alive = false);
  }, []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${q.get('cols') ?? 7}, 1fr)`, alignContent: 'start', gap: 2, padding: 2, background: '#3a3f3b', height: '100vh', overflow: 'auto', font: '11px sans-serif', color: '#ddd' }}>
      {cells.map(([label, a, b]) => (
        <div key={label} style={{ background: '#2a2e2b', textAlign: 'center' }}>
          <div style={{ display: 'flex' }}>
            <img src={a} style={{ width: '50%', display: 'block' }} />
            <img src={b} style={{ width: '50%', display: 'block' }} />
          </div>
          {label}
        </div>
      ))}
    </div>
  );
}
