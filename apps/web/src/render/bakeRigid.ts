import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the rigid meshes under `root` into one mesh per material, baked into `root`'s frame: a rig's forty
 * pouches or a gun's thirty parts become a handful of draw calls (each drawn again into every shadow map).
 * Subtrees in `keep` stay as they are (the magazine that comes out during a reload), and so do skinned,
 * hidden and multi-material meshes.
 */
export function bakeRigid(root: THREE.Object3D, keep: ReadonlySet<THREE.Object3D> = new Set()): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mesh: THREE.Mesh; geos: THREE.BufferGeometry[] }>();
  const baked: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();
  const visit = (o: THREE.Object3D): void => {
    if (keep.has(o) || !o.visible) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(mesh.material) && !mesh.morphTargetInfluences) {
      const g = mesh.geometry;
      const names = Object.keys(g.attributes).sort();
      const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${names}`;
      m.multiplyMatrices(toRoot, mesh.matrixWorld);
      const geo = plain(g, names).applyMatrix4(m);
      // A mirroring transform turns the faces inside out.
      if (m.determinant() < 0) flip(geo);
      const b = buckets.get(key) ?? { mesh, geos: [] };
      b.geos.push(geo);
      buckets.set(key, b);
      baked.push(mesh);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  // Nothing to gain from one mesh alone.
  if (baked.length <= buckets.size) return;
  for (const mesh of baked) mesh.removeFromParent();
  for (const { mesh, geos } of buckets.values()) {
    const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos);
    if (!geo) continue;
    const out = new THREE.Mesh(geo, mesh.material);
    out.castShadow = mesh.castShadow;
    out.receiveShadow = mesh.receiveShadow;
    out.renderOrder = mesh.renderOrder;
    root.add(out);
  }
  // Empty groups left behind cost a traversal every frame.
  const prune = (o: THREE.Object3D): boolean => {
    for (const c of [...o.children]) if (prune(c)) c.removeFromParent();
    return o !== root && !keep.has(o) && o.type === 'Group' && o.children.length === 0;
  };
  prune(root);
}

/** A float, non-interleaved, indexed copy (meshopt glbs store positions as normalised int16). */
function plain(g: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const a = g.attributes[n]!;
    const f = new Float32Array(a.count * a.itemSize);
    const get = [a.getX, a.getY, a.getZ, a.getW] as const;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = get[k]!.call(a, i);
    out.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize));
  }
  const idx = new Uint32Array(g.index ? g.index.count : g.attributes.position!.count);
  for (let i = 0; i < idx.length; i++) idx[i] = g.index ? g.index.getX(i) : i;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function flip(g: THREE.BufferGeometry): void {
  const idx = g.index!.array as Uint32Array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
}
