import * as THREE from 'three';

/**
 * Downloads ship glass (a holo sight's window, some bodies' eyes) as transmissive material. One such mesh on
 * screen makes three.js draw every opaque thing in the scene twice a frame (into a transmission buffer first),
 * so glass becomes see-through the cheap way: a bare pane goes transparent, anything textured opaque.
 */
export function noTransmission(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
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
  });
}
