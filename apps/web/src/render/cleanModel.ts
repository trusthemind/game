import * as THREE from 'three';

/** What a download needs before it's drawn (every glb goes through this as it loads). */
export function cleanModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    dropBadTangents(mesh.geometry);
    fixZeroNormals(mesh.geometry);
    noTransmission(mesh);
  });
}

/**
 * Some downloads carry zero-length tangents (the PBS-5 and 5.56 suppressors): the normal map normalises them
 * into NaN, and the bloom spreads one NaN pixel into a white flash over half the screen. Without a tangent
 * attribute three.js works the tangents out per pixel instead.
 */
function dropBadTangents(g: THREE.BufferGeometry): void {
  const t = g.attributes.tangent;
  if (!t) return;
  for (let i = 0; i < t.count; i++)
    if (!(Math.hypot(t.getX(i), t.getY(i), t.getZ(i)) > 0.1)) {
      g.deleteAttribute('tangent');
      return;
    }
}

/** A zero-length normal (a few in the whole-gun models and a sofa) normalises into NaN too: point it up. */
function fixZeroNormals(g: THREE.BufferGeometry): void {
  const n = g.attributes.normal;
  if (!n) return;
  let fixed = false;
  for (let i = 0; i < n.count; i++)
    if (!(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.1)) {
      n.setXYZ(i, 0, 1, 0);
      fixed = true;
    }
  if (fixed) n.needsUpdate = true;
}

/**
 * Downloads ship glass (a holo sight's window, some bodies' eyes) as transmissive material. One such mesh on
 * screen makes three.js draw every opaque thing in the scene twice a frame (into a transmission buffer first),
 * so glass becomes see-through the cheap way: a bare pane goes transparent, anything textured opaque.
 */
function noTransmission(mesh: THREE.Mesh): void {
  for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
    const p = m as THREE.MeshPhysicalMaterial;
    if (!p.isMeshPhysicalMaterial || !(p.transmission > 0)) continue;
    if (!p.map) {
      p.transparent = true;
      p.opacity = Math.min(p.opacity, 1 - p.transmission * 0.75);
      p.depthWrite = false;
    }
    p.transmission = 0;
    p.needsUpdate = true;
  }
}
