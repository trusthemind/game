import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getDef, type Actor, type Equipment, type PlayerLook } from '@ashfall/engine';
import { bodySettled, loadAssets, loadBodies } from '../../render/assets';
import { actorLook, CharacterView, lookBodies, playerAppearance } from '../../render/character';
import type { WorldUniforms } from '../../render/patches';
import { useProfile } from '../../state/profileStore';
import { useHoverItem } from '../inventory/components';

/**
 * Your survivor in 3D, wearing exactly what's in the loadout slots. Turns slowly on its own; drag to spin.
 * One small WebGL canvas, paused while the tab is hidden.
 */
export type PreviewFraming = 'body' | 'face' | 'back';

/** `look`: show this look instead of the saved one (the character creator's draft or a hovered option). */
export function CharacterPreview({
  framing = 'body',
  bareHead = false,
  className,
  look,
}: { framing?: PreviewFraming; bareHead?: boolean; className?: string; look?: PlayerLook } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(framing);
  frame.current = framing;
  const lookRef = useRef(look);
  const resync = useRef<() => void>(() => {});
  if (lookRef.current !== look) {
    lookRef.current = look;
    queueMicrotask(() => resync.current());
  }
  const bare = useRef(bareHead);
  bare.current = bareHead;
  useEffect(() => {
    // A fresh canvas per mount: the context is released on cleanup (forceContextLoss), and a canvas whose
    // context was lost can't host a new renderer (Fast Refresh re-runs this effect on the same DOM).
    const canvas = document.createElement('canvas');
    canvas.className = `char-preview${className ? ` ${className}` : ''}`;
    canvas.title = 'Drag to turn';
    ref.current!.appendChild(canvas);
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    void loadAssets().then((lib) => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
      cam.position.set(0, 1.25, 4.6);
      cam.lookAt(0, 0.95, 0);
      scene.add(new THREE.HemisphereLight(0xe0e8ee, 0x3a3428, 1.5));
      const key = new THREE.DirectionalLight(0xfff1d8, 2.6);
      key.position.set(2, 4, 3);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      const rim = new THREE.DirectionalLight(0xa8c4ff, 1.4);
      rim.position.set(-3, 2, -2);
      scene.add(key, rim);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.ShadowMaterial({ opacity: 0.45 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const u: WorldUniforms = {
        uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
        uMapSize: { value: new THREE.Vector2(1, 1) },
        uPlayer: { value: new THREE.Vector3(0, -100, 0) },
        uFowOn: { value: 0 },
      };
      (u.uFow.value as THREE.DataTexture).needsUpdate = true;

      let view: CharacterView | null = null;
      let headBone: THREE.Bone | null = null;
      const headPos = new THREE.Vector3(0, 1.6, 0);
      let lookKey = '';
      const actor = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: Math.PI / 2 - 0.5, crouching: false, sprinting: false, eq: null as Equipment | null, active: 'primary', faction: 'player', alive: true } as unknown as Actor;
      const sync = () => {
        const p = useProfile.getState().profile;
        if (!p) return;
        const pl = lookRef.current ?? p.look;
        const key = JSON.stringify(pl);
        const look = actorLook(playerAppearance(pl), p.equipment);
        if (key !== lookKey && !lookBodies(look).every((b) => bodySettled(lib, b))) {
          // Keep showing the old look until the models its clothes come from have loaded.
          void loadBodies(lib, lookBodies(look)).then(() => !disposed && sync());
        } else if (key !== lookKey) {
          if (view) {
            scene.remove(view.root);
            view.dispose();
          }
          view = new CharacterView(lib, look, u, true);
          scene.add(view.root);
          headBone = (view as unknown as { skinned: THREE.SkinnedMesh }).skinned.skeleton.bones.find((b) => /^head$/i.test(b.name)) ?? null;
          lookKey = key;
        }
        // Pointing at a piece of clothing tries it on: the preview wears it instead of what's in that slot.
        const hover = useHoverItem.getState().item;
        const slot = hover ? getDef(hover.def).clothing?.slot : undefined;
        actor.eq = slot && p.equipment.slots[slot] !== hover ? { ...p.equipment, slots: { ...p.equipment.slots, [slot]: hover } } : p.equipment;
        // Customising the face: nothing on the head (helmet, hat) in the way.
        if (bare.current) actor.eq = { ...actor.eq, slots: { ...actor.eq.slots, helmet: null, hat: null } };
        const s = p.equipment.slots;
        actor.active = s.primary ? 'primary' : s.secondary ? 'secondary' : 'melee';
      };
      sync();
      resync.current = sync;
      const unsub = useProfile.subscribe(sync);
      const unsubHover = useHoverItem.subscribe(sync);

      // Drag to turn; otherwise a slow idle turn.
      // Each framing turns the figure to its own angle (face: three-quarter front; back: from behind); after a
      // drag it stays where you left it until the framing changes; the full body idles round slowly.
      let dragging = false;
      let lastX = 0;
      let held = false;
      let shownFrame = frame.current;
      let spinVel = 0;
      const down = (e: PointerEvent) => {
        dragging = true;
        held = true;
        lastX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!dragging) return;
        const d = (e.clientX - lastX) * 0.012;
        actor.facing -= d;
        spinVel = -d * 30;
        lastX = e.clientX;
      };
      const up = () => {
        dragging = false;
      };
      const keyTurn = (e: KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        held = true;
        spinVel = e.key === 'ArrowLeft' ? -4 : 4;
      };
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', 'Character preview: drag or use the arrow keys to turn');
      canvas.addEventListener('keydown', keyTurn);
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);

      const resize = () => {
        const w = canvas.clientWidth || 200;
        const h = canvas.clientHeight || 300;
        renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      resize();

      let last = performance.now();
      const AIM: Record<PreviewFraming, number> = { face: Math.PI / 2 - 0.35, body: Math.PI / 2 - 0.5, back: -Math.PI / 2 + 0.3 };
      // Camera rigs [height, distance, look-at height]; eased between.
      const RIG: Record<PreviewFraming, [number, number, number]> = { face: [1.65, 1.3, 1.61], body: [1.25, 4.6, 0.95], back: [1.35, 4.2, 1.05] };
      const cur = [...RIG[frame.current]];
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const f = frame.current;
        if (f !== shownFrame) {
          shownFrame = f;
          held = false;
          spinVel = 0;
        }
        if (dragging) {
          /* following the pointer */
        } else if (Math.abs(spinVel) > 0.02) {
          // A flick keeps turning for a moment.
          actor.facing += spinVel * dt;
          spinVel *= Math.exp(-dt * 5);
        } else if (!held) {
          const d = Math.atan2(Math.sin(AIM[f] - actor.facing), Math.cos(AIM[f] - actor.facing));
          if (f === 'body' && Math.abs(d) < 0.05) held = true;
          actor.facing += d * Math.min(1, dt * 4);
        } else if (f === 'body') actor.facing += 0.22 * dt;
        if (view && actor.eq) view.update(actor, dt, true, false);
        const rig: [number, number, number] = [...RIG[f]];
        // The close-up frames the head wherever it is (a tall man, a short woman, a crouch in the idle).
        if (f === 'face' && headBone) {
          headBone.getWorldPosition(headPos);
          rig[0] = headPos.y + 0.02;
          rig[2] = headPos.y - 0.03;
        }
        const k = Math.min(1, dt * 5);
        for (let i = 0; i < 3; i++) cur[i]! += (rig[i]! - cur[i]!) * k;
        cam.position.set(0, cur[0]!, cur[1]!);
        cam.lookAt(0, cur[2]!, 0);
        renderer.render(scene, cam);
      };
      raf = requestAnimationFrame(tick);
      cleanup = () => {
        resync.current = () => {};
        cancelAnimationFrame(raf);
        unsub();
        unsubHover();
        ro.disconnect();
        canvas.removeEventListener('keydown', keyTurn);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        view?.dispose();
        renderer.dispose();
        // dispose() keeps the WebGL context alive; without this every visit to the stash leaked one, and past
        // ~16 the browser starts killing the oldest (item pictures, portraits, this view): white flashes.
        renderer.forceContextLoss();
      };
    });
    return () => {
      disposed = true;
      cleanup();
      canvas.remove();
    };
  }, []);
  return <div ref={ref} style={{ display: 'contents' }} />;
}
