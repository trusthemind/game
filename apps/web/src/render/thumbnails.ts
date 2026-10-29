import * as THREE from 'three';
import { getDef, type ItemInstance } from '@ashfall/engine';
import { getAssets, loadAssets } from './assets';
import { buildGun, gunKey } from './gunsmith';

/**
 * Inventory pictures for guns and melee weapons, rendered from their 3D models (with installed
 * attachments) in a tiny offscreen WebGL context. Results are cached as data URLs by look, so a stash full
 * of AKs renders one image. Work is queued and done a few per frame so the UI never stalls.
 */
const cache = new Map<string, string>();
const queue: { key: string; item: ItemInstance }[] = [];
const listeners = new Set<() => void>();
let renderer: THREE.WebGLRenderer | null = null;
let scheduled = false;

export function thumbKey(item: ItemInstance): string | null {
  const d = getDef(item.def);
  if (d.weapon) return `g:${gunKey(item)}`;
  if (d.melee) return `m:${item.def}`;
  return null;
}

export function getThumb(item: ItemInstance): string | null {
  const key = thumbKey(item);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!queue.some((q) => q.key === key)) queue.push({ key, item: structuredClone(item) });
  schedule();
  return null;
}

export function onThumbsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const lib = getAssets();
  const run = () => {
    scheduled = false;
    const l = getAssets();
    if (!l) return;
    let n = 0;
    while (queue.length && n++ < 4) {
      const q = queue.shift()!;
      const url = render(l, q.item);
      if (url) cache.set(q.key, url);
    }
    for (const fn of listeners) fn();
    if (queue.length) schedule();
  };
  if (lib) requestAnimationFrame(run);
  else void loadAssets().then(() => requestAnimationFrame(run));
}

function render(lib: NonNullable<ReturnType<typeof getAssets>>, item: ItemInstance): string | null {
  const d = getDef(item.def);
  const obj = d.weapon ? buildGun(lib, item) : lib.melee.get(item.def)?.clone() ?? null;
  if (!obj) return null;
  const W = d.w * 64;
  const H = d.h * 64;
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8eef2, 0x3a3630, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 2);
  scene.add(key);
  // Side-on: model's +Z (muzzle) points right. Melee: blade up-right, like Tarkov's icons.
  const g = new THREE.Group();
  g.add(obj);
  obj.rotation.y = Math.PI / 2;
  if (d.melee) g.rotation.z = d.h >= d.w ? Math.PI / 2 - 0.35 : 0.35;
  scene.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  g.position.sub(c);
  const size = box.getSize(new THREE.Vector3());
  const aspect = W / H;
  const fit = Math.max(size.x / aspect, size.y) * 0.56;
  const cam = new THREE.OrthographicCamera(-fit * aspect, fit * aspect, fit, -fit, -10, 10);
  cam.position.set(0, 0, 5);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}
