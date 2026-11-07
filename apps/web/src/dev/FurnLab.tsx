import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FURNITURE_SIZE, type FurnitureKind } from '@ashfall/engine';
import { loadAssets } from '../render/assets';

/**
 * Dev view of furniture models against the sim's footprints: `#furnlab?ids=bunk_bed,locker&top=1`.
 * Each model stands on its footprint (red: w across the front × d deep, front to +Z, the wall it backs on
 * at −Z drawn as a grey strip), in a grid, seen from the front-right (or from above with top=1).
 */
export function FurnLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const top = q.get('top') === '1';
    const front = q.get('front') === '1';
    const canvas = ref.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2120);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    let disposed = false;
    loadAssets().then((lib) => {
      if (disposed) return;
      (window as unknown as { __furn: unknown }).__furn = lib.furniture;
      const ids = (q.get('ids')?.split(',') ?? [...lib.furniture.keys()]).filter((id) => lib.furniture.has(id));
      const cols = Math.ceil(Math.sqrt(ids.length));
      const cell = 3;
      ids.forEach((id, i) => {
        const x = (i % cols) * cell;
        const z = Math.floor(i / cols) * cell;
        const m = lib.furniture.get(id)!.clone();
        m.position.set(x, 0, z);
        scene.add(m);
        const size = FURNITURE_SIZE[id as FurnitureKind];
        if (size) {
          const r = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(size.w, 0.02, size.d)),
            new THREE.LineBasicMaterial({ color: 0xff3030 }),
          );
          r.position.set(x, 0.01, z);
          const wall = new THREE.Mesh(new THREE.BoxGeometry(size.w + 0.4, 0.3, 0.08), new THREE.MeshBasicMaterial({ color: 0x777777 }));
          wall.position.set(x, 0.15, z - size.d / 2 - 0.04);
          scene.add(r, wall);
        }
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 48;
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.font = '28px sans-serif';
        g.fillText(id, 4, 34);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
        label.scale.set(1.6, 0.3, 1);
        label.position.set(x, 2.4, z + 1);
        scene.add(label);
      });
      const span = cols * cell;
      const cam = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
      const mid = new THREE.Vector3(((cols - 1) * cell) / 2, 0, ((Math.ceil(ids.length / cols) - 1) * cell) / 2);
      if (top) cam.position.set(mid.x, span * 1.3, mid.z + 0.01);
      else if (front) cam.position.set(mid.x, span * 0.35, mid.z + span * 1.1);
      else cam.position.set(mid.x + span * 0.35, span * 0.55, mid.z + span * 0.85);
      cam.lookAt(mid);
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      renderer.render(scene, cam);
    });
    return () => {
      disposed = true;
      renderer.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ width: '100vw', height: '100vh', display: 'block' }} />;
}
