import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ItemInstance } from '@ashfall/engine';
import { loadAssets } from '../../render/assets';
import { buildGun, gunKey } from '../../render/gunsmith';
import { loadWeaponParts } from '../../render/weaponAssembly';

/**
 * The gun on the gunsmith bench, in 3D: turns slowly, drag to spin it. Rebuilt whenever its parts change (or the
 * part being tried on), and the part in `highlight` (a socket path, e.g. "handguard/foregrip") glows.
 * One small WebGL canvas, released on unmount.
 */
export function GunViewer({ item, highlight }: { item: ItemInstance; highlight: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef<{ setGun(item: ItemInstance): void; setHighlight(path: string | null): void } | null>(null);

  useEffect(() => {
    // A fresh canvas per mount: its context is released on cleanup (see CharacterPreview).
    const canvas = document.createElement('canvas');
    canvas.className = 'gun-viewer';
    canvas.title = 'Drag to turn';
    ref.current!.appendChild(canvas);
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    void Promise.all([loadAssets(), loadWeaponParts()]).then(([lib]) => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(24, 2, 0.05, 20);
      scene.add(new THREE.HemisphereLight(0xe0e8ee, 0x3a3428, 1.7));
      const key = new THREE.DirectionalLight(0xfff1d8, 2.8);
      key.position.set(1.5, 2.5, 2);
      const rim = new THREE.DirectionalLight(0xa8c4ff, 1.6);
      rim.position.set(-2, 1, -2);
      scene.add(key, rim);
      const turn = new THREE.Group();
      scene.add(turn);
      let gun: THREE.Object3D | null = null;
      let lit: string | null = null;
      const glow = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

      const applyHighlight = () => {
        for (const [m, mat] of glow) m.material = mat;
        glow.clear();
        if (!gun || !lit) return;
        gun.traverse((o) => {
          if (o.userData.socket !== lit) return;
          o.traverse((c) => {
            const m = c as THREE.Mesh;
            if (!m.isMesh || glow.has(m)) return;
            glow.set(m, m.material);
            const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            const hi = src.clone();
            hi.emissive = new THREE.Color(0xd6a74a);
            hi.emissiveIntensity = 0.35;
            m.material = hi;
          });
        });
      };

      const setGun = (it: ItemInstance) => {
        if (gun) turn.remove(gun);
        glow.clear();
        gun = buildGun(lib, it);
        if (!gun) return;
        turn.add(gun);
        // Frame the gun side-on with a little margin.
        const box = new THREE.Box3().setFromObject(gun);
        const size = box.getSize(new THREE.Vector3());
        gun.position.sub(box.getCenter(new THREE.Vector3()));
        const fit = Math.max(size.z / cam.aspect, size.y) / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
        cam.position.set(0, size.y * 0.35, fit * 1.25 + size.x);
        cam.lookAt(0, 0, 0);
        applyHighlight();
      };
      state.current = {
        setGun,
        setHighlight: (path) => {
          lit = path;
          applyHighlight();
        },
      };

      // Drag to turn; otherwise a slow idle turn.
      let dragging = false;
      let lastX = 0;
      let spin = 0.35;
      turn.rotation.y = Math.PI / 2 - 0.4;
      const down = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!dragging) return;
        turn.rotation.y += (e.clientX - lastX) * 0.012;
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
        const w = canvas.clientWidth || 400;
        const h = canvas.clientHeight || 200;
        renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      resize();
      setGun(item);

      let last = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!dragging) turn.rotation.y += spin * dt;
        renderer.render(scene, cam);
      };
      raf = requestAnimationFrame(tick);
      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        renderer.dispose();
        renderer.forceContextLoss();
      };
    });
    return () => {
      disposed = true;
      state.current = null;
      cleanup();
      canvas.remove();
    };
    // The canvas lives as long as the bench is open; the gun and highlight update through `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const k = gunKey(item);
  useEffect(() => state.current?.setGun(item), [k]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => state.current?.setHighlight(highlight), [highlight]);

  return <div ref={ref} className="gun-viewer-wrap" />;
}
