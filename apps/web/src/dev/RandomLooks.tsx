import { useEffect, useState } from 'react';
import { createItem, IDENTITIES, resolveShape, FACE_PARTS, FACE_PRESETS, getDef, NEUTRAL_FACE, type FaceShape, BEARD_STYLES, DEFAULT_LOOK, faceFromSeed, hairStylesFor, NATURAL_HAIR, npcBeard, npcHair, npcShape, randomHumanFace, randomHumanShape, Rng, type PlayerLook, type Sex } from '@ashfall/engine';
import { loadAssets, loadBodies } from '../render/assets';
import { loadAssetHair } from '../render/assetHair';
import { kitSources, lookBodies, playerAppearance, renderPortrait, SKIN_TONES, wearClothes } from '../render/character';
import { beardStats, hairStats } from '../render/hairGen';

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
      await loadAssetHair();
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
      (window as unknown as { __labReady?: boolean }).__labReady = true;
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
  // view=facegrid: every whole face, then every nose, eyes, mouth and jaw (on the plain face), close up.
  const faces = q.get('view') === 'facegrid';
  // view=bustgrid: the bust slider from small to full, front, side and back, bare (the painted top) or `&eq=` kit.
  const busts = q.get('view') === 'bustgrid';
  const sex: Sex = q.get('sex') === 'f' ? 'f' : 'm';
  const size = Number(q.get('size') ?? 150);
  const [cells, setCells] = useState<[string, ...string[]][]>([]);
  // `&yaws=0,90,180,270`: each style turned through these angles (close round the scalp) instead of the two views;
  // `&shape=`/`&skin=`: the body preset and skin tone.
  const yaws = (q.get('yaws') ?? '').split(',').filter(Boolean).map(Number);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const lib = await loadAssets();
      await loadAssetHair();
      const out: [string, ...string[]][] = [];
      const faceList: [string, string, FaceShape][] = faces
        ? [
            ...Object.entries(FACE_PRESETS).map(([id, f]) => [id, id, f] as [string, string, FaceShape]),
            ...Object.entries(FACE_PARTS).flatMap(([part, ps]) => Object.entries(ps).map(([id, p]) => [`${part}:${id}`, `${part}: ${id}`, { ...NEUTRAL_FACE, ...p }] as [string, string, FaceShape])),
          ]
        : [];
      // view=identities: every face identity of the sex (and the base face first), front, three-quarter and profile
      // (`&yaws=` other angles), on the plain sliders; `&hair=` / `&skin=` / `&helmet=` as below.
      if (q.get('view') === 'identities') {
        const ys = yaws.length ? yaws : [0, 30, 90];
        const hw = q.get('helmet');
        const slots = (hw ? { [getDef(hw).category === 'helmet' ? 'helmet' : 'hat']: createItem(hw) } : {}) as never;
        // `&only=ai_f1,...` just those (`base` the base face).
        const onlyIds = (q.get('only') ?? '').split(',').filter(Boolean);
        for (const d of [null, ...IDENTITIES[sex]]) {
          if (onlyIds.length && !onlyIds.includes(d?.id ?? 'base')) continue;
          // An identity's designed look (`suggest`, the AI-sheet pilots) unless `&hair=` / `&color=` / `&skin=` pin one;
          // `&shape=` a body preset.
          const sg = d?.suggest;
          const look: PlayerLook = { ...DEFAULT_LOOK, sex, hair: q.get('hair') ?? sg?.hair ?? (sex === 'm' ? 'buzz' : 'topknot'), beard: q.get('hair') ? 'none' : sg?.beard ?? 'none', face: 'classic', shape: (q.get('shape') as never) ?? 'average', hairColor: Number(q.get('color') ?? sg?.hairColor ?? 0x4a3020), ...(q.get('skin') ? { skin: Number(q.get('skin')) } : sg?.skin !== undefined ? { skin: sg.skin } : {}), ...(d ? { faceId: d.id } : {}) };
          const a = { ...playerAppearance(look), ...(sg?.eyes !== undefined ? { eyes: sg.eyes } : {}), ...(d?.pilot ? { age: d.age } : {}) };
          await loadBodies(lib, lookBodies(hw ? wearClothes(a, { slots } as never) : a));
          if (!alive) return;
          out.push([d ? `${d.label} (${d.desc})` : 'base face (before)', ...ys.map((y) => renderPortrait(lib, a, size, 'face', slots, y))]);
          setCells([...out]);
          await new Promise((r) => setTimeout(r, 0));
        }
        (window as unknown as { __labReady?: boolean }).__labReady = true;
        return;
      }
      // view=skin: each skin tone close up (the face, the torso and arms) and whole (as small as the game shows it).
      if (q.get('view') === 'skin') {
        for (const skin of SKIN_TONES) {
          const look: PlayerLook = { ...DEFAULT_LOOK, sex, skin, hair: sex === 'm' ? 'buzz' : 'ballerina', beard: 'none', face: 'classic', shape: 'average' };
          const a = playerAppearance(look);
          await loadBodies(lib, lookBodies(a));
          out.push([`#${skin.toString(16)}`, renderPortrait(lib, a, size, 'mug'), renderPortrait(lib, a, size, 'torso'), renderPortrait(lib, a, Math.round(size / 3), 'body')]);
          setCells([...out]);
        }
        (window as unknown as { __labReady?: boolean }).__labReady = true;
        return;
      }
      if (busts) {
        const eqIds = (q.get('eq') ?? '').split(',').filter(Boolean);
        const slots = Object.fromEntries(eqIds.map((id) => [getDef(id).category === 'helmet' ? 'helmet' : getDef(id).category === 'armor' ? 'armor' : getDef(id).clothing?.slot ?? 'rig', createItem(id)])) as never;
        for (const v of [-0.9, 0, 0.9]) {
          const look: PlayerLook = { ...DEFAULT_LOOK, sex, hair: sex === 'f' ? 'ponytail' : 'short', beard: 'none', face: 'classic', shape: { ...resolveShape(sex, 'average'), bust: v } };
          const a = playerAppearance(look);
          await loadBodies(lib, [...lookBodies(wearClothes(a, { slots } as never)), ...eqIds.flatMap((id) => kitSources(id))]);
          out.push([`bust ${v}`, renderPortrait(lib, a, size, 'torso', slots), renderPortrait(lib, a, size, q.get('back') ? 'bodyback' : 'side', slots)]);
          setCells([...out]);
        }
        (window as unknown as { __labReady?: boolean }).__labReady = true;
        return;
      }
      const list = faces ? faceList.map(([id, label]) => [id, label] as const) : beards ? BEARD_STYLES.map((b) => [b.id, b.label] as const) : hairStylesFor(sex).map((h) => [h.id, h.label] as const);
      const only = (q.get('only') ?? '').split(',').filter(Boolean);
      for (const [id, label] of list) {
        if (only.length && !only.includes(id)) continue;
        // `&face=` a preset id, or JSON sliders (`{"cheeks":0.8}`) on the plain face.
        const fq = q.get('face');
        const face = faces ? faceList.find((f) => f[0] === id)![2] : fq?.startsWith('{') ? { ...NEUTRAL_FACE, ...JSON.parse(fq) } : ((fq as never) ?? 'classic');
        const hair = faces ? (sex === 'm' ? 'buzz' : 'topknot') : beards ? 'short' : id;
        const look: PlayerLook = { ...DEFAULT_LOOK, sex, hair, beard: beards ? id : 'none', hairColor: Number(q.get('color') ?? 0x5b3d25), face, shape: (q.get('shape') as never) ?? 'average', ...(q.get('skin') ? { skin: Number(q.get('skin')) } : {}) };
        const a = playerAppearance(look);
        await loadBodies(lib, lookBodies(a));
        if (!alive) return;
        // `&helmet=<item id>` (or a cap's): every style under it, to check what shows below the rim.
        const hw = q.get('helmet');
        const slots = (hw ? { [getDef(hw).category === 'helmet' ? 'helmet' : 'hat']: createItem(hw) } : {}) as never;
        if (hw) await loadBodies(lib, lookBodies(wearClothes(a, { slots } as never)));
        if (yaws.length) out.push([label, ...yaws.map((y) => renderPortrait(lib, a, size, 'hair', slots, y))]);
        else out.push([label, renderPortrait(lib, a, size, faces ? 'mug' : beards ? (q.get('b1') as 'mug' | null) ?? 'face' : 'hair', slots), renderPortrait(lib, a, size, faces ? 'head' : beards ? (q.get('b2') as 'profile' | null) ?? 'head' : 'back', slots)]);
        setCells([...out]);
        await new Promise((r) => setTimeout(r, 0));
      }
      // Triangles per style, for the dev checks.
      (window as unknown as { __styleTris?: unknown }).__styleTris = { hair: { ...hairStats }, beard: { ...beardStats } };
      (window as unknown as { __labReady?: boolean }).__labReady = true;
    })();
    return () => void (alive = false);
  }, []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${q.get('cols') ?? 7}, 1fr)`, alignContent: 'start', gap: 2, padding: 2, background: '#3a3f3b', height: '100vh', overflow: 'auto', font: '11px sans-serif', color: '#ddd' }}>
      {cells.map(([label, ...imgs]) => (
        <div key={label} style={{ background: '#2a2e2b', textAlign: 'center' }}>
          <div style={{ display: 'flex' }}>
            {imgs.map((u, i) => (
              <img key={i} src={u} style={{ width: `${100 / imgs.length}%`, display: 'block' }} />
            ))}
          </div>
          {label}
        </div>
      ))}
    </div>
  );
}
