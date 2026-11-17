import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_LOOK, IDENTITIES, type Actor, type PlayerLook, type Sex } from '@ashfall/engine';
import type { WorldUniforms } from '../render/patches';
import { loadAssets, loadBodies } from '../render/assets';
import { loadAssetHair } from '../render/assetHair';
import { preloadIdentityTextures } from '../render/faceIdentity';
import { CharacterView, lookBodies, playerAppearance, SKIN_TONES } from '../render/character';
import { SCULPT } from '../render/lookStyle';

/**
 * Render-style comparison (lookStyle.ts pilot).
 * `#charlab?view=lookcompare&sex=m|f`: the same identities and hairstyles side by side, the current look (left)
 * and the sculpt look (right, `?look=sculpt`), each a `lookgrid` page in its own frame (the look is chosen per
 * page load). `#charlab?view=lookgrid&sex=m|f`: one look's grid: a row per identity, columns front / three-quarter
 * / profile at the creator's close-up, then the game camera's distance; `&ai=1` the AI-sheet pilot identities.
 */

interface Row {
  id: string;
  hair: string;
  beard?: string;
  color: number;
  skin: number;
  eyes: number;
}
const ROWS: Record<Sex, Row[]> = {
  m: [
    { id: 'jack', hair: 'short', beard: 'stubble', color: 0x4a3524, skin: 1, eyes: 0x3a5a7a },
    { id: 'kofi', hair: 'afro', color: 0x1c1612, skin: 4, eyes: 0x2a1d14 },
    { id: 'kenji', hair: 'frenchcrop', color: 0x15120f, skin: 1, eyes: 0x2a1d14 },
    { id: 'tariq', hair: 'slick', beard: 'boxed', color: 0x221a14, skin: 2, eyes: 0x4a3020 },
    { id: 'viktor', hair: 'buzz', beard: 'full', color: 0x6a4a2c, skin: 0, eyes: 0x5a6a4a },
    { id: 'elias', hair: 'mh_short02', color: 0xb08850, skin: 0, eyes: 0x2f6a8a },
    { id: 'mateo', hair: 'skinfade', beard: 'moustache', color: 0x1e1712, skin: 2, eyes: 0x4a3020 },
    { id: 'walter', hair: 'receding', beard: 'walrus', color: 0x9a948a, skin: 1, eyes: 0x6a6a6a },
  ],
  f: [
    { id: 'nora', hair: 'long', color: 0xc8a068, skin: 0, eyes: 0x3a5a7a },
    { id: 'amara', hair: 'puff', color: 0x15110e, skin: 4, eyes: 0x2a1d14 },
    { id: 'mei', hair: 'bob', color: 0x14110f, skin: 1, eyes: 0x2a1d14 },
    { id: 'lucia', hair: 'wavy', color: 0x3a2618, skin: 2, eyes: 0x5a3a22 },
    { id: 'olena', hair: 'ponytail', color: 0x7a5434, skin: 0, eyes: 0x5a6a4a },
    { id: 'priya', hair: 'braid', color: 0x1a1410, skin: 3, eyes: 0x2a1d14 },
    { id: 'kira', hair: 'pixie', color: 0xa0502a, skin: 0, eyes: 0x5a6a4a },
    { id: 'rosa', hair: 'mh_updo', color: 0x8a8378, skin: 1, eyes: 0x4a3020 },
  ],
};
const COLS = [
  { label: 'front', yaw: 0, d: 0.78 },
  { label: '3/4', yaw: 35, d: 0.78 },
  { label: 'profile', yaw: 90, d: 0.78 },
  { label: 'game distance', yaw: 20, d: 0 },
];

export function LookCompare() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sex = q.get('sex') === 'f' ? 'f' : 'm';
  const r = Date.now();
  const src = (sc: boolean) => `${location.pathname}?mute=1&r=${r}${sc ? '&look=sculpt' : ''}#charlab?view=lookgrid&sex=${sex}`;
  const head = { color: '#f2efe6', font: '600 15px ui-monospace, Menlo, monospace', padding: '4px 8px', background: '#111' } as const;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#111' }}>
      {[false, true].map((sc) => (
        <div key={String(sc)} style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: sc ? '2px solid #e8b04a' : undefined }}>
          <div style={head}>{sc ? 'SCULPT (?look=sculpt)' : 'CURRENT (default)'} | {sex === 'm' ? 'men' : 'women'}</div>
          <iframe title={sc ? 'sculpt' : 'current'} src={src(sc)} style={{ flex: 1, border: 0, width: '100%' }} />
        </div>
      ))}
    </div>
  );
}

export function LookGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rows, setRows] = useState<string[]>([]);
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const sex: Sex = q.get('sex') === 'f' ? 'f' : 'm';
    // `&ai=1`: the AI-sheet pilot identities, each with its designed look (identity.ts `suggest`).
    const rows: Row[] = q.get('ai')
      ? IDENTITIES[sex].filter((d) => d.pilot && d.suggest).map((d) => ({ id: d.id, hair: d.suggest!.hair, beard: d.suggest!.beard, color: d.suggest!.hairColor, skin: Math.max(0, SKIN_TONES.indexOf(d.suggest!.skin ?? SKIN_TONES[1]!)), eyes: d.suggest!.eyes ?? 0x4a3020 }))
      : ROWS[sex].slice(0, Number(q.get('n') ?? 8));
    setRows(rows.map((r) => `${r.id} | ${r.hair}${r.beard ? ' | ' + r.beard : ''}`));
    let disposed = false;
    let raf = 0;
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setScissorTest(true);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd8e0ea, 0x2a2420, 1.2));
    const key = new THREE.DirectionalLight(0xffe2c4, 2.4);
    key.position.set(1.5, 2.5, 2.5);
    const rim = new THREE.DirectionalLight(0x9ec4ff, 1.4);
    rim.position.set(-2, 2, -1.5);
    scene.add(key, rim);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
    const u: WorldUniforms = {
      uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
      uPlayer: { value: new THREE.Vector3(0, -100, 0) },
      uFowOn: { value: 0 },
    };
    (u.uFow.value as THREE.DataTexture).needsUpdate = true;
    const views: { view: CharacterView; actor: Actor; head: THREE.Bone | null }[] = [];
    const w = window as unknown as { __labReady?: boolean; __lookGrid?: unknown };
    const resize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
    resize();
    window.addEventListener('resize', resize);

    void (async () => {
      const lib = await loadAssets();
      await preloadIdentityTextures();
      if (rows.some((r) => r.hair.startsWith('mh_'))) await loadAssetHair();
      for (const [i, r] of rows.entries()) {
        const look: PlayerLook = { ...DEFAULT_LOOK, sex, skin: SKIN_TONES[r.skin]!, hair: r.hair, hairColor: r.color, beard: r.beard ?? 'none', shape: 'average', face: 'classic', faceId: r.id };
        const pd = IDENTITIES[sex].find((d) => d.id === r.id);
        const a = { ...playerAppearance(look), eyes: r.eyes, age: (pd?.pilot ? pd.age : r.id === 'walter' || r.id === 'rosa' ? 2 : 1) as 0 | 1 | 2 };
        await loadBodies(lib, lookBodies(a));
        if (disposed) return;
        const actor = { pos: { x: i * 3, y: 0 }, vel: { x: 0, y: 0 }, facing: Math.PI / 2, crouching: false, sprinting: false, eq: { slots: {}, pockets: { w: 0, h: 0, items: [] } }, active: 'melee', faction: 'npc' } as unknown as Actor;
        const view = new CharacterView(lib, a, u, false);
        scene.add(view.root);
        view.update(actor, 0.5, true, false);
        view.root.updateMatrixWorld(true);
        const head = (view as unknown as { skinned: THREE.SkinnedMesh }).skinned.skeleton.bones.find((b) => /^head$/i.test(b.name)) ?? null;
        views.push({ view, actor, head });
      }
      setTimeout(() => (w.__labReady = true), 2500);
      raf = requestAnimationFrame(tick);
    })();

    const hp = new THREE.Vector3();
    const size = new THREE.Vector2();
    const draw = () => {
      renderer.getSize(size);
      const cw = size.x / COLS.length;
      const ch = size.y / Math.max(1, rows.length);
      for (const [ri, v] of views.entries()) {
        for (const o of views) o.view.root.visible = o === v;
        if (v.head) v.head.getWorldPosition(hp);
        else hp.set(v.actor.pos.x, 1.6, v.actor.pos.y);
        for (const [ci, c] of COLS.entries()) {
          const x = ci * cw;
          const y = size.y - (ri + 1) * ch;
          renderer.setViewport(x, y, cw, ch);
          renderer.setScissor(x, y, cw, ch);
          renderer.setClearColor(ci === 3 ? 0x3a3f36 : 0x232826);
          renderer.clear();
          cam.aspect = cw / ch;
          const yaw = THREE.MathUtils.degToRad(c.yaw);
          if (c.d) {
            cam.fov = 26;
            cam.position.set(hp.x + Math.sin(yaw) * c.d, hp.y + 0.07, hp.z + Math.cos(yaw) * c.d);
            cam.lookAt(hp.x, hp.y + 0.05, hp.z);
          } else {
            // The raid camera: high and back, ~10 m off; the character a few dozen pixels tall.
            cam.fov = 30;
            cam.position.set(hp.x + Math.sin(yaw) * 4, 6.5, hp.z + Math.cos(yaw) * 4);
            cam.lookAt(hp.x, 1.0, hp.z);
          }
          cam.updateProjectionMatrix();
          renderer.render(scene, cam);
        }
      }
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      for (const v of views) v.view.update(v.actor, 0, true, false);
      draw();
    };
    w.__lookGrid = {
      sculpt: SCULPT,
      info: renderer.info,
      /** ms per full grid draw (GPU-synchronised), for the look's frame-time cost. */
      bench(n = 30): number {
        const gl = renderer.getContext();
        draw();
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) draw();
        gl.finish();
        return (performance.now() - t0) / n;
      },
    };
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      for (const v of views) (scene.remove(v.view.root), v.view.dispose());
      renderer.dispose();
    };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#232826' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        {rows.map((r) => (
          <div key={r} style={{ flex: 1, color: '#f2efe6', font: '12px ui-monospace, Menlo, monospace', padding: '3px 6px', textShadow: '0 1px 2px #000', borderTop: '1px solid #0006' }}>
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}
