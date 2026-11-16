import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as THREE from 'three';
import {
  BEARD_STYLES,
  DEFAULT_LOOK,
  FACE_PRESETS,
  GREY_HAIR,
  HAIR_COLOR_BY_HEX,
  HAIR_PALETTE,
  IDENTITIES,
  NATURAL_HAIR,
  randomIdentity,
  hairStylesFor,
  randomHumanFace,
  Rng,
  type Actor,
  type PlayerLook,
  type Sex,
} from '@ashfall/engine';
import type { WorldUniforms } from '../render/patches';
import { loadAssets, loadBodies } from '../render/assets';
import { loadAssetHair } from '../render/assetHair';
import { CharacterView, disposeCharacterCaches, lookBodies, playerAppearance, SKIN_TONES } from '../render/character';

/**
 * Dev view (/#charlab?view=carousel): one character's head and shoulders close up (the creator's face framing),
 * live in 3D, switching to the next look every `&t=5` seconds: the next face preset (all of them, with a Randomize
 * variant every third), the next hairstyle of that sex, a new skin tone, hair colour (greying, dyes, roots), age
 * and eyes; men get a beard about every third look. `&sex=m|f|both` (default both: three looks of each in turn),
 * `&yaw=` a fixed camera angle in degrees (default: a slow +-25 degree sway), `&d=` the camera distance (m).
 * Face identities (MPFB bodies, `?body=mpfb`): each look is the next identity of its sex (a random blend every
 * third), on the plain sliders; `&ids=0` the old way (slider presets, no identity), `&id=<id>` one identity only,
 * `&hair=<id>` one hairstyle only, `&skin=<index>` one tone.
 * Keys: Space pause, Left/Right previous/next, m cycles the sex mode.
 */

type SexMode = 'm' | 'f' | 'both';
interface Entry {
  n: number;
  look: PlayerLook;
  eyes: number;
  age: 0 | 1 | 2;
  faceName: string;
  idName: string;
  hairLabel: string;
  colorLabel: string;
  beardLabel: string;
  skinIdx: number;
}

const EYES = [0x4a3020, 0x5a3a22, 0x3a5a7a, 0x5a6a4a, 0x6a6a6a, 0x2a1d14, 0x2f6a8a, 0x7a5a2a];
const FACE_NAMES = Object.keys(FACE_PRESETS);
const BEARDS = BEARD_STYLES.filter((b) => b.id !== 'none');
const SEX_RUN = 3;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const AGE_NAMES = ['young', 'middle-aged', 'older'];
const DYED = HAIR_PALETTE.filter((c) => c.dyed).map((c) => c.hex);

/** Frees what a view drew on the GPU: geometries, skeleton bone textures, materials and their textures (shared caches re-upload what they reuse). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (o as THREE.SkinnedMesh).skeleton?.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

export function Carousel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ e: Entry; mode: SexMode; paused: boolean; total: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const period = Math.max(0.5, Number(q.get('t') ?? 5));
    const fixedYaw = q.get('yaw') !== null && q.get('yaw') !== '' ? Number(q.get('yaw')) : null;
    const dist = Number(q.get('d') ?? 1.0);
    let mode: SexMode = q.get('sex') === 'm' || q.get('sex') === 'f' ? (q.get('sex') as Sex) : 'both';
    let paused = false;
    let disposed = false;
    let raf = 0;
    const rng = new Rng(Number(q.get('seed') ?? 11));
    const rnd = () => rng.next();

    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x232826);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 10);
    scene.add(new THREE.HemisphereLight(0xd8e0ea, 0x2a2420, 1.2));
    const key = new THREE.DirectionalLight(0xffe2c4, 2.4);
    key.position.set(1.5, 2.5, 2.5);
    const rim = new THREE.DirectionalLight(0x9ec4ff, 1.4);
    rim.position.set(-2, 2, -1.5);
    scene.add(key, rim);
    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const u: WorldUniforms = {
      uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
      uPlayer: { value: new THREE.Vector3(0, -100, 0) },
      uFowOn: { value: 0 },
    };
    (u.uFow.value as THREE.DataTexture).needsUpdate = true;
    const actor = {
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      facing: Math.PI / 2,
      crouching: false,
      sprinting: false,
      eq: { slots: {}, pockets: { w: 0, h: 0, items: [] } },
      active: 'melee',
      faction: 'npc',
    } as unknown as Actor;

    // ---- the sequence: generated on demand, kept so Left goes back to exactly what was shown ----
    const history: Entry[] = [];
    const cursor = { m: { face: 0, hair: 0, beard: 0, count: 0, ident: 0 }, f: { face: 0, hair: 0, beard: 0, count: 0, ident: 0 } };
    const useIds = q.get('ids') !== '0';
    const pinId = q.get('id');
    const pinHair = q.get('hair');
    const pinSkin = q.get('skin');
    let idx = -1;
    const nextEntry = (): Entry => {
      const n = history.length;
      const sex: Sex = mode === 'both' ? (Math.floor(n / SEX_RUN) % 2 === 0 ? 'm' : 'f') : mode;
      const c = cursor[sex];
      // Faces: every preset in turn, a Randomize variant (a random preset mixed with random parts) every third look.
      let face: PlayerLook['face'];
      let faceName: string;
      let faceId: PlayerLook['faceId'];
      let idName = '-';
      if (useIds) {
        // Identities: each in turn on the plain sliders, a random blend every third look.
        face = 'classic';
        faceName = 'classic (identity)';
        const list = IDENTITIES[sex];
        if (pinId) faceId = pinId;
        else if (c.count % 3 === 2) faceId = randomIdentity(sex, rnd);
        else faceId = list[c.ident++ % list.length]!.id;
        const mix = typeof faceId === 'string' ? [{ id: faceId, w: 1 }] : faceId;
        idName = mix.map((e) => `${list.find((d) => d.id === e.id)?.label ?? e.id} ${Math.round(e.w * 100)}%`).join(' + ') + (mix.length === 1 ? ` (${list.find((d) => d.id === mix[0]!.id)?.desc ?? ''})` : '');
      } else if (c.count % 3 === 2) {
        face = randomHumanFace(rnd);
        faceName = 'randomize (random preset + mixed parts)';
      } else {
        faceName = FACE_NAMES[c.face++ % FACE_NAMES.length]!;
        face = faceName;
      }
      const styles = hairStylesFor(sex);
      const hair = (pinHair && styles.find((h) => h.id === pinHair)) || styles[(c.hair++ + (sex === 'f' ? 5 : 4)) % styles.length]!;
      const age = rng.pick([0, 1, 1, 2] as const);
      const r = rnd();
      // Colour: older heads grey (greying, grey, white), the middle-aged often; the rest natural, now and then a dye
      // (the palette's dyes include balayage tips and grown-out dark roots).
      const hairColor = age === 2 && r < 0.85 ? rng.pick(GREY_HAIR) : age === 1 && r < 0.3 ? rng.pick(GREY_HAIR) : r > 0.86 ? rng.pick(DYED) : rng.pick(NATURAL_HAIR);
      let beard = 'none';
      if (sex === 'm' && c.count % 3 === 1) beard = BEARDS[c.beard++ % BEARDS.length]!.id;
      c.count++;
      const skinIdx = pinSkin !== null ? Number(pinSkin) % SKIN_TONES.length : n % SKIN_TONES.length;
      const look: PlayerLook = { ...DEFAULT_LOOK, sex, skin: SKIN_TONES[skinIdx]!, hair: hair.id, hairColor, beard, shape: 'average', face, ...(faceId ? { faceId } : {}) };
      const col = HAIR_COLOR_BY_HEX.get(hairColor);
      return {
        n,
        look,
        eyes: rng.pick(EYES),
        age,
        faceName,
        idName,
        hairLabel: `${hair.id} (${hair.label}, ${hair.group})`,
        colorLabel: `${col?.label ?? hex(hairColor)} ${hex(hairColor)}${col?.roots ? ' roots ' + hex(col.roots) : ''}${col?.tips ? ' tips ' + hex(col.tips) : ''}`,
        beardLabel: beard === 'none' ? (sex === 'f' ? 'none (f)' : 'clean shaven') : `${beard} (${BEARDS.find((b) => b.id === beard)!.label})`,
        skinIdx,
      };
    };

    // ---- showing one ----
    let view: CharacterView | null = null;
    let headBone: THREE.Bone | null = null;
    const headPos = new THREE.Vector3(0, 1.6, 0);
    let elapsed = 0;
    let busy = false;
    let pending: number | null = null;
    let swayT = 0;
    let lib: Awaited<ReturnType<typeof loadAssets>> | null = null;
    let switches = 0;

    const show = async (e: Entry) => {
      if (!lib) return;
      busy = true;
      const a = { ...playerAppearance(e.look), eyes: e.eyes, age: e.age };
      await loadBodies(lib, lookBodies(a));
      if (e.look.hair.startsWith('mh_')) await loadAssetHair();
      if (disposed) return;
      if (view) {
        scene.remove(view.root);
        view.dispose();
        disposeTree(view.root);
        // The previous look's cached materials, hair, underlay and face textures go with it.
        disposeCharacterCaches();
      }
      view = new CharacterView(lib, a, u, false);
      scene.add(view.root);
      view.update(actor, 0.5, true, false);
      view.root.updateMatrixWorld(true);
      headBone = (view as unknown as { skinned: THREE.SkinnedMesh }).skinned.skeleton.bones.find((b) => /^head$/i.test(b.name)) ?? null;
      elapsed = 0;
      switches++;
      flushSync(() => setInfo({ e, mode, paused, total: `${FACE_NAMES.length} faces, ${hairStylesFor(e.look.sex).length} ${e.look.sex} hairstyles` }));
      busy = false;
      if (pending !== null) {
        const d = pending;
        pending = null;
        go(d);
      }
    };
    const go = (delta: number) => {
      if (busy) {
        pending = (pending ?? 0) + delta;
        return;
      }
      if (delta > 0) {
        idx++;
        if (idx >= history.length) history.push(nextEntry());
      } else idx = Math.max(0, idx - 1);
      void show(history[idx]!);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') {
        ev.preventDefault();
        paused = !paused;
        setInfo((s) => (s ? { ...s, paused } : s));
      } else if (ev.key === 'ArrowRight') go(1);
      else if (ev.key === 'ArrowLeft') go(-1);
      else if (ev.key === 'm' || ev.key === 'M') {
        mode = mode === 'both' ? 'm' : mode === 'm' ? 'f' : 'both';
        // The next look comes from the new mode: drop what was queued after this one.
        history.length = idx + 1;
        go(1);
      }
    };
    window.addEventListener('keydown', onKey);

    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!view) return;
      if (!paused && !busy) {
        elapsed += dt;
        swayT += dt;
      }
      if (barRef.current) barRef.current.style.width = `${Math.min(100, (elapsed / period) * 100)}%`;
      if (!paused && !busy && elapsed >= period) go(1);
      view.update(actor, paused ? 0 : dt, true, false);
      if (headBone) headBone.getWorldPosition(headPos);
      // Frame the head (wherever it is: a tall man, a short woman) from a camera swaying round it.
      const yaw = THREE.MathUtils.degToRad(fixedYaw ?? 25 * Math.sin((swayT / 14) * Math.PI * 2));
      cam.position.set(headPos.x + Math.sin(yaw) * dist, headPos.y + 0.09, headPos.z + Math.cos(yaw) * dist);
      cam.lookAt(headPos.x, headPos.y + 0.06, headPos.z);
      renderer.render(scene, cam);
    };

    void loadAssets().then((l) => {
      if (disposed) return;
      lib = l;
      go(1);
      raf = requestAnimationFrame(tick);
    });

    const w = window as unknown as { __carousel?: unknown };
    w.__carousel = {
      next: () => go(1),
      prev: () => go(-1),
      get switches() {
        return switches;
      },
      get index() {
        return idx;
      },
      history,
      info: renderer.info,
      get tris() {
        return renderer.info.render.triangles;
      },
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
      if (view) {
        scene.remove(view.root);
        view.dispose();
        disposeTree(view.root);
        disposeCharacterCaches();
      }
      (u.uFow.value as THREE.DataTexture).dispose();
      renderer.dispose();
      delete w.__carousel;
    };
  }, []);

  const e = info?.e;
  const row = (k: string, v: string) => (
    <div>
      <span style={{ opacity: 0.6, display: 'inline-block', width: 64 }}>{k}</span>
      {v}
    </div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#232826' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'fixed', top: 12, left: 12, padding: '10px 14px', background: 'rgba(0,0,0,0.62)', color: '#f2efe6', font: '15px/1.45 ui-monospace, Menlo, monospace', borderRadius: 6, minWidth: 340, textShadow: '0 1px 2px #000' }}>
        {e ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              #{e.n + 1} {e.look.sex === 'm' ? 'male' : 'female'} <span style={{ opacity: 0.6, fontSize: 13 }}>mode {info!.mode}{info!.paused ? ' / PAUSED' : ''}</span>
            </div>
            {row('identity', e.idName)}
            {row('face', e.faceName)}
            {row('hair', e.hairLabel)}
            {row('colour', e.colorLabel)}
            {row('beard', e.beardLabel)}
            {row('skin', `${hex(e.look.skin)} (tone ${e.skinIdx + 1}/${SKIN_TONES.length})`)}
            {row('eyes', hex(e.eyes))}
            {row('age', AGE_NAMES[e.age]!)}
            <div style={{ opacity: 0.55, fontSize: 12, marginTop: 4 }}>{info!.total} | Space pause | Left/Right prev/next | m sex mode</div>
          </>
        ) : (
          <div>loading...</div>
        )}
        <div style={{ height: 6, marginTop: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 3, overflow: 'hidden' }}>
          <div ref={barRef} style={{ height: '100%', width: '0%', background: '#e8b04a' }} />
        </div>
      </div>
    </div>
  );
}
