import * as THREE from 'three';

/**
 * The one offscreen WebGL context behind the item pictures and the survivor portraits. Each caller sets the size,
 * tone mapping and clear colour it needs before drawing.
 *
 * It lives here, in a module nothing ever edits, rather than in thumbnails.ts / character.ts: every hot update of
 * those re-ran their module and opened a fresh context while the old one stayed alive. A dozen edits later the
 * browser hit its cap (~16), warned "Too many active WebGL contexts" and began killing the oldest ones, the
 * stash's character preview and the raid view among them: the white flashes.
 */
let renderer: THREE.WebGLRenderer | null = null;

export function offscreenRenderer(): THREE.WebGLRenderer {
  // The browser may still drop it (GPU reset); start a fresh one rather than drawing blanks.
  if (!renderer || renderer.getContext().isContextLost())
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  return renderer;
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
  });
