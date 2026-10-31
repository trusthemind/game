import * as THREE from 'three';
import { getDef, type ItemInstance } from '@ashfall/engine';
import { getAssets, loadAssets, type AssetLibrary } from './assets';
import { buildGun, gunKey, MOD_MODEL } from './gunsmith';
import { meleeModel } from './melee3d';
import { ARMOR_SPECS, details, RIG_SPECS, shellParts, shellShader, type ArmorSpec } from './armorShell';
import {
  ammoModel,
  armorModel,
  BACKPACK_TINT,
  foodModel,
  helmetModel,
  magModel,
  medModel,
  miscModel,
  rigModel,
  slingModel,
} from './gear3d';

/**
 * Inventory pictures for every item, rendered from 3D models in a tiny offscreen WebGL context: guns with
 * their installed attachments, melee weapons, and the procedural gear / ammo / meds / valuables from
 * gear3d.ts. Results are cached as data URLs by look, so a stash full of AKs renders one image. Work is
 * queued and done a few per frame so the UI never stalls.
 */
const cache = new Map<string, string>();
const queue: { key: string; item: ItemInstance }[] = [];
const listeners = new Set<() => void>();
let renderer: THREE.WebGLRenderer | null = null;
let scheduled = false;
/** Pixels per inventory cell (2× the on-screen cell so the inspector's big picture stays sharp). */
const PX = 112;

export function thumbKey(item: ItemInstance): string | null {
  const d = getDef(item.def);
  if (d.weapon) return `g:${gunKey(item)}`;
  return `i:${item.def}`;
}

export function getThumb(item: ItemInstance): string | null {
  const key = thumbKey(item);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit || null;
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
      // Empty string = no model; ItemArt falls back to the flat icon.
      cache.set(q.key, render(l, q.item) ?? '');
    }
    for (const fn of listeners) fn();
    if (queue.length) schedule();
  };
  if (lib) requestAnimationFrame(run);
  else void loadAssets().then(() => requestAnimationFrame(run));
}

type View = 'side' | 'front' | 'top';

function tinted(src: THREE.Object3D, tint: number): THREE.Object3D {
  const o = src.clone(true);
  const c = new THREE.Color(tint);
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    // Keep the pack's light/dark detail but recolour it.
    const l = mat.color.getHSL({ h: 0, s: 0, l: 0 }).l;
    mat.color.copy(c).multiplyScalar(0.7 + l);
    mesh.material = mat;
  });
  return o;
}

/** The 3D model for an item and how to frame it. Exported for the character preview and loot piles. */
export function itemModel(lib: AssetLibrary, item: ItemInstance): { obj: THREE.Object3D; view: View } | null {
  const d = getDef(item.def);
  const id = item.def;
  const prop = (name: string, upright = false) => {
    const p = lib.props.get(name)?.clone();
    if (!p) return null;
    // The prop set is normalised with the longest axis on Z; stand bottles and cans back up.
    const w = new THREE.Group();
    if (upright) p.rotation.x = -Math.PI / 2;
    w.add(p);
    return w;
  };
  const side = (obj: THREE.Object3D | null) => (obj ? { obj, view: 'side' as const } : null);
  const front = (obj: THREE.Object3D | null) => (obj ? { obj, view: 'front' as const } : null);
  const top = (obj: THREE.Object3D | null) => (obj ? { obj, view: 'top' as const } : null);
  switch (d.category) {
    case 'weapon': {
      const g = buildGun(lib, item);
      if (!g) return null;
      const w = new THREE.Group();
      g.rotation.y = Math.PI / 2;
      w.add(g);
      return side(w);
    }
    case 'melee': {
      const m = meleeModel(id) ?? lib.melee.get(id)?.clone();
      if (!m) return null;
      const w = new THREE.Group();
      m.rotation.y = Math.PI / 2;
      w.add(m);
      w.rotation.z = d.h >= d.w ? Math.PI / 2 - 0.35 : 0.35;
      return side(w);
    }
    case 'mod': {
      const mag = magModel(id);
      if (mag) return side(mag);
      const spec = MOD_MODEL[id];
      const m = spec && lib.mods.get(spec.model)?.clone();
      if (!m) return null;
      const w = new THREE.Group();
      m.rotation.y = Math.PI / 2;
      w.add(m);
      return side(w);
    }
    case 'helmet':
      return front(helmetModel(id));
    case 'armor':
      return front(shellModel(lib, id, ARMOR_SPECS[id]) ?? armorModel(id));
    case 'rig':
      return front(shellModel(lib, id, RIG_SPECS[id]) ?? rigModel(id));
    case 'backpack': {
      if (id === 'b_sling') return front(slingModel());
      const bp = lib.props.get('backpack');
      return front(bp ? tinted(bp, BACKPACK_TINT[id] ?? 0x666666) : null);
    }
    case 'ammo':
      return side(ammoModel(id, d.ammo!.caliber));
    case 'med':
      if (id === 'bandage') return front(prop('bandage'));
      return front(medModel(id));
    case 'food':
    case 'drink':
      if (id === 'tushonka') return front(prop('can', true));
      if (id === 'water') return front(prop('water', true));
      return front(foodModel(id));
    case 'junk':
      if (id === 'tank') return front(prop('propane', true));
      return front(miscModel(id));
    case 'secure':
      return front(miscModel(id));
    default: {
      const m = miscModel(id);
      return m ? top(m) : null;
    }
  }
}

const thumbMats = new Map<number, THREE.MeshStandardMaterial>();
const thumbMat = (c: number) => {
  let m = thumbMats.get(c);
  if (!m) thumbMats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.88, side: THREE.DoubleSide })));
  return m;
};

/** Armour / rig picture: the same body-conforming shell the characters wear, cut from the base male body. */
function shellModel(lib: AssetLibrary, id: string, spec: ArmorSpec | undefined): THREE.Object3D | null {
  if (!spec || !lib.humanM) return null;
  let body: THREE.SkinnedMesh | null = null;
  lib.humanM.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!body || m.geometry.attributes.position!.count > body.geometry.attributes.position!.count))
      body = m;
  });
  if (!body) return null;
  const parts = shellParts(body, id, spec);
  const g = new THREE.Group();
  for (const { shell, color } of parts) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => shellShader(sh, spec, shell.frame.k, color);
    g.add(new THREE.Mesh(shell.geometry, m), new THREE.Mesh(shell.rim, m));
  }
  const shell = parts[0]!.shell;
  for (const d of details(shell, spec, thumbMat)) g.add(d);
  return g;
}

function render(lib: AssetLibrary, item: ItemInstance): string | null {
  const d = getDef(item.def);
  const model = itemModel(lib, item);
  if (!model) return null;
  const W = d.w * PX;
  const H = d.h * PX;
  // The browser may drop this context when too many are open; start a fresh one rather than caching blanks.
  if (!renderer || renderer.getContext().isContextLost()) renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef2f4, 0x4a4640, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(1.5, 2.5, 2.5);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.2);
  rim.position.set(-2, 1, -1.5);
  scene.add(key, rim);

  // Pose: gear turned three-quarters towards the camera, flat things seen from above.
  const g = new THREE.Group();
  g.add(model.obj);
  if (model.view === 'front') {
    g.rotation.set(0.32, -0.55, 0);
  } else if (model.view === 'top') {
    g.rotation.set(0.95, -0.35, 0);
  } else {
    g.rotation.set(0.12, 0, 0);
  }
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
