import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Actor, Equipment } from '@ashfall/engine';
import { loadAssets } from '../../render/assets';
import { CharacterView, playerAppearance } from '../../render/character';
import type { WorldUniforms } from '../../render/patches';
import { useProfile } from '../../state/profileStore';

/**
 * Your survivor in 3D, wearing exactly what's in the loadout slots. Turns slowly on its own; drag to spin.
 * One small WebGL canvas, paused while the tab is hidden.
 */
export function CharacterPreview() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
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
      let lookKey = '';
      const actor = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: Math.PI / 2 - 0.5, crouching: false, sprinting: false, eq: null as Equipment | null, active: 'primary', faction: 'player', alive: true } as unknown as Actor;
      const sync = () => {
        const p = useProfile.getState().profile;
        if (!p) return;
        const key = JSON.stringify(p.look);
        if (key !== lookKey) {
          if (view) {
            scene.remove(view.root);
            view.dispose();
          }
          view = new CharacterView(lib, playerAppearance(p.look), u, true);
          scene.add(view.root);
          lookKey = key;
        }
        actor.eq = p.equipment;
        const s = p.equipment.slots;
        actor.active = s.primary ? 'primary' : s.secondary ? 'secondary' : 'melee';
      };
      sync();
      const unsub = useProfile.subscribe(sync);

      // Drag to turn; otherwise a slow idle turn.
      let dragging = false;
      let lastX = 0;
      let spin = 0.25;
      const down = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!dragging) return;
        actor.facing -= (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      };
      const up = () => {
        dragging = false;
        spin = 0;
      };
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
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!dragging) actor.facing += spin * dt;
        if (view && actor.eq) view.update(actor, dt, true, false);
        renderer.render(scene, cam);
      };
      raf = requestAnimationFrame(tick);
      cleanup = () => {
        cancelAnimationFrame(raf);
        unsub();
        ro.disconnect();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        view?.dispose();
        renderer.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return <canvas ref={ref} className="char-preview" title="Drag to turn" />;
}
