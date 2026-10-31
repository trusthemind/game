import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Soviet household pieces from Sketchfab (furniture_sf.glb, CC BY, see models/CREDITS.txt). They arrive raw;
 * here each is turned to face +Z, scaled to real size, stood on y = 0 and centred, then merged into one mesh
 * per material so the instanced world draws them in a handful of calls (some arrive as a dozen or more).
 * The results join `lib.furniture` beside the Quaternius pieces, same conventions.
 */
const SPEC: Record<string, { yaw: number; axis: 'w' | 'h' | 'd'; metres: number; strip?: RegExp }> = {
  // The stove ships standing on its own patch of parquet in front of a tiled wall: keep only the stove.
  gas_stove: { yaw: 0, axis: 'h', metres: 0.85, strip: /^background/ },
  // A rusty old fridge with its door on −X and a crate at its feet (dropped).
  fridge_old: { yaw: Math.PI / 2, axis: 'h', metres: 1.5, strip: /^polySurface2(0[89]|1[0-3])/ },
  bathtub: { yaw: Math.PI / 2, axis: 'w', metres: 1.6 },
  toilet: { yaw: -Math.PI / 2, axis: 'h', metres: 0.75 },
  tv: { yaw: 0, axis: 'w', metres: 0.6 },
  radiator: { yaw: 0, axis: 'w', metres: 0.9 },
  wardrobe_old: { yaw: Math.PI, axis: 'h', metres: 1.9 },
  chair_old: { yaw: 0, axis: 'h', metres: 0.85 },
};

/** A float copy of an attribute (the GLB is quantised: Int16 positions can't take a baked matrix). */
function floatAttr(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count;
  const s = a.itemSize;
  const out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, s);
}

function normalise(id: string, src: THREE.Object3D): THREE.Group | null {
  const spec = SPEC[id];
  if (!spec) return null;
  const wrapper = new THREE.Group();
  const model = src.clone(true);
  model.position.set(0, 0, 0);
  if (spec.strip) {
    const drop: THREE.Object3D[] = [];
    model.traverse((o) => (spec.strip!.test(o.name) ? drop.push(o) : undefined));
    for (const o of drop) o.removeFromParent();
  }
  wrapper.add(model);
  wrapper.rotation.y = spec.yaw;
  wrapper.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  wrapper.scale.setScalar(spec.metres / (spec.axis === 'h' ? size.y : spec.axis === 'd' ? size.z : size.x));
  wrapper.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrapper);
  const c = box.getCenter(new THREE.Vector3());
  wrapper.position.set(-c.x, -box.min.y, -c.z);
  wrapper.updateMatrixWorld(true);

  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  wrapper.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const groups = g0.groups.length ? g0.groups : [{ start: 0, count: g0.attributes.position!.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0]!;
      const part = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv'] as const) {
        const a = g0.getAttribute(name);
        if (!a) continue;
        const f = floatAttr(a);
        part.setAttribute(name, new THREE.BufferAttribute(f.array.slice(gr.start * f.itemSize, (gr.start + gr.count) * f.itemSize), f.itemSize));
      }
      if (!part.getAttribute('normal')) part.computeVertexNormals();
      part.applyMatrix4(mesh.matrixWorld);
      let list = byMat.get(m);
      if (!list) byMat.set(m, (list = []));
      list.push(part);
    }
  });
  const g = new THREE.Group();
  g.name = id;
  for (const [m, parts] of byMat) {
    // Parts of one material can disagree on having UVs; drop them where any lacks them.
    const hasUv = parts.every((p) => p.getAttribute('uv'));
    if (!hasUv) for (const p of parts) p.deleteAttribute('uv');
    const merged = mergeGeometries(parts);
    if (!merged) continue;
    // Some of these are single-sided shells.
    m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/** Add the normalised pieces to the furniture map (id → model). */
export function addSketchfabFurniture(target: Map<string, THREE.Object3D>, doc: GLTF | null): void {
  if (!doc) return;
  for (const root of doc.scene.children) {
    const g = normalise(root.name, root);
    if (g) target.set(root.name, g);
  }
}
