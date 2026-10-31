import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { extractSolids, type Extraction, type ExtractKind } from '@ashfall/engine';
import { buildExtractProps } from '../render/extracts';
import { getTexture } from '../render/textures';
import type { WorldUniforms } from '../render/patches';

const ALL: ExtractKind[] = ['checkpoint', 'outpost', 'gate', 'bridge', 'tunnel', 'station', 'path', 'pier', 'boat', 'tower', 'camp', 'mill', 'dam', 'depot', 'outlet', 'crane', 'overpass'];
const NAMES: Partial<Record<ExtractKind, string>> = { bridge: 'Rail Bridge', path: 'Hunters’ Trail' };

/**
 * Dev view of extraction set dressing, away from a raid: `#extractlab?kinds=station,pier&dir=90&zoom=1.2&open=0.5`.
 * Up to four kinds side by side under the game's camera angle and day light, the map edge drawn where the
 * treeline starts, the engine's solid footprints outlined in red.
 */
export function ExtractLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const kinds = (q.get('kinds')?.split(',') ?? ALL.slice(0, 4)).filter((k): k is ExtractKind => ALL.includes(k as ExtractKind)).slice(0, 4);
    const dir = ((Number(q.get('dir') ?? 90) * Math.PI) / 180);
    const zoom = Number(q.get('zoom') ?? (kinds.length > 1 ? 2.2 : 1.2));
    const open = Number(q.get('open') ?? 0);
    const footprints = q.get('solids') !== '0';

    const canvas = ref.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c0b);
    const u: WorldUniforms = {
      uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) },
      uMapSize: { value: new THREE.Vector2(1e4, 1e4) },
      uPlayer: { value: new THREE.Vector3(-1e4, 0, -1e4) },
      uFowOn: { value: 0 },
    };

    // 2×2 grid, 26 m apart; the map edge of each place is drawn by its own dark band.
    const list: Extraction[] = kinds.map((kind, i) => ({ id: i, name: NAMES[kind] ?? kind, kind, x: (i % 2) * 26, y: Math.floor(i / 2) * 26, radius: 2.4, dir }));
    const props = buildExtractProps(list, u, true);
    scene.add(props.group);
    const grass = getTexture('grass');
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    (ground.material.map as THREE.Texture).wrapS = (ground.material.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
    ground.geometry.attributes.uv!.array.forEach((_, i, a) => ((a as Float32Array)[i] *= 35));
    ground.position.set(13, -0.01, 13);
    ground.receiveShadow = true;
    scene.add(ground);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff3030 });
    for (const e of list) {
      const c = Math.round(Math.cos(e.dir));
      const s = Math.round(Math.sin(e.dir));
      // Beyond the edge (local z > 9.5): darkness, as in a raid.
      const band = new THREE.Mesh(new THREE.PlaneGeometry(20, 14).rotateX(-Math.PI / 2), edgeMat);
      band.position.set(e.x + c * 16.5, 0.05, e.y + s * 16.5);
      band.rotation.y = -e.dir + Math.PI / 2;
      scene.add(band);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.28, 2.4, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4dff9a }));
      ring.position.set(e.x, 0.04, e.y);
      scene.add(ring);
      if (footprints)
        for (const [x0, y0, x1, y1] of extractSolids(e)) {
          const g = new THREE.BufferGeometry().setFromPoints([x0, x1, x1, x0, x0].map((x, k) => new THREE.Vector3(x, 0.08, [y0, y0, y1, y1, y0][k]!)));
          scene.add(new THREE.Line(g, lineMat));
        }
    }
    props.update(0);
    for (const e of list) props.setProgress(e.id, open);

    const hemi = new THREE.HemisphereLight(0xd8e4ea, 0x4a4636, 1.5);
    const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
    sun.shadow.bias = -0.0006;
    const cx = kinds.length > 1 ? 13 : 0;
    const cz = kinds.length > 2 ? 13 : 0;
    sun.position.set(cx - 25, 50, cz + 17.5);
    sun.target.position.set(cx, 0, cz);
    scene.add(hemi, sun, sun.target);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    camera.position.set(cx, 19 * zoom, cz + 11.5 * zoom);
    camera.lookAt(cx, 0, cz);
    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * renderer.getPixelRatio()) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      props.update((performance.now() - t0) / 1000);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    frame();
    (window as unknown as { __labReady?: boolean }).__labReady = true;
    return () => {
      cancelAnimationFrame(raf);
      props.dispose();
      renderer.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ width: '100vw', height: '100vh', display: 'block' }} />;
}
