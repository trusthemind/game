import * as THREE from 'three';

/** Uniforms shared by every world material (one object → one upload per frame). */
export interface WorldUniforms {
  uFow: { value: THREE.Texture };
  uMapSize: { value: THREE.Vector2 };
  uPlayer: { value: THREE.Vector3 };
  uFowOn: { value: number };
}

const DECL_V = /* glsl */ `varying vec3 vFowPos;\n`;
const DECL_F = /* glsl */ `
varying vec3 vFowPos;
uniform sampler2D uFow;
uniform vec2 uMapSize;
uniform vec3 uPlayer;
uniform float uFowOn;
float ashBayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return (m[idx] + 0.5) / 16.0;
}
`;

/**
 * Inject two effects into a stock three.js material:
 *  - fog of war: darken by the per-tile visibility texture (bright = in view, dim = explored, black = unknown);
 *  - occlusion cut-away: screen-door dither walls/canopies that stand between the camera and the player.
 * Shadow/depth passes use their own materials, so shadows stay intact.
 */
export function patchWorldMaterial<T extends THREE.Material>(mat: T, u: WorldUniforms, opts: { fow?: boolean; occlude?: 'wall' | 'canopy' } = {}): T {
  const fow = opts.fow ?? true;
  const occ = opts.occlude ?? '';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      DECL_V +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 fowWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWP = instanceMatrix * fowWP;
        #endif
        vFowPos = (modelMatrix * fowWP).xyz;`,
      );
    let frag = DECL_F + shader.fragmentShader;
    if (occ) {
      const cond =
        occ === 'wall'
          ? /* glsl */ `float dz = vFowPos.z - uPlayer.z;
             float occ = (vFowPos.y > 0.55 && dz > 0.15 && dz < 5.0) ? (1.0 - smoothstep(1.6, 3.4, abs(vFowPos.x - uPlayer.x))) * (1.0 - smoothstep(3.5, 5.0, dz)) : 0.0;`
          : /* glsl */ `float occ = 1.0 - smoothstep(2.0, 3.6, length(vFowPos.xz - uPlayer.xz - vec2(0.0, 0.8)));`;
      frag = frag.replace(
        'void main() {',
        /* glsl */ `void main() {
        ${cond}
        if (ashBayer(gl_FragCoord.xy) < occ * 0.88) discard;`,
      );
    }
    if (fow) {
      frag = frag.replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
        if (uFowOn > 0.5) {
          vec2 fuv = vFowPos.xz / uMapSize;
          vec4 fw = texture2D(uFow, fuv);
          float f = mix(mix(0.035, 0.30, fw.g), 1.0, fw.r);
          if (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) f = 0.03;
          gl_FragColor.rgb *= f;
        }`,
      );
    }
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `ash-${fow ? 1 : 0}-${occ}`;
  return mat;
}
