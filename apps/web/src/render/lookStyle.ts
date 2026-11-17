import * as THREE from 'three';
import { FACE_KEYS, NEUTRAL_FACE, type FaceShape, type IdentityMix } from '@ashfall/engine';

/**
 * Render-style layer (pilot): `?look=sculpt` (or `&look=sculpt` in a dev view's hash) switches the characters to a
 * stylised-realistic, hand-sculpted look: identity features exaggerated (a gain on the identity morphs and the face
 * sliders, plus a sculpted bias: brow ridge, nose, jaw, cheekbones, chin, eyes, lips), painted skin (soft albedo,
 * warm/cool painted zones, little pore detail, wrapped diffuse with a warm terminator, a gentle rim), bold
 * stylised eyes, clean brow shapes, and hair / beards as solid sculpted masses with painted strand grooves and a
 * root-to-tip gradient. Off by default: nothing changes without the flag. Read once per page load.
 */
export const SCULPT = typeof location !== 'undefined' && /[?&#]look=sculpt(&|#|$)/.test(location.href);

/** Identity morph gain in the sculpt look (exaggerates what makes a face that face). */
const ID_GAIN = 1.3;
/** Face-slider gain, and the sculpted bias added to every face (per sex). */
const FACE_GAIN = 1.3;
const FACE_BIAS: Record<'m' | 'f', Partial<FaceShape>> = {
  m: { brow: 0.35, jaw: 0.25, chin: 0.15, noseBridge: 0.1, cheeks: 0.3, eyeSize: 0.25, lips: 0.1 },
  f: { brow: 0.1, chin: 0.1, cheeks: 0.3, eyeSize: 0.35, lips: 0.3 },
};
const FACE_LIMIT = 1;

/** The identity mix as the sculpt look bakes it (weights x ID_GAIN, each at most 1.7). */
export function sculptMix(mix: IdentityMix | null | undefined): IdentityMix | null | undefined {
  if (!SCULPT || !mix?.length) return mix;
  return mix.map((e) => ({ id: e.id, w: Math.min(1.4, e.w * ID_GAIN) }));
}

/** The face sliders as the sculpt look bakes them (gain + sculpted bias, clamped to stay believable). */
export function sculptFace(face: FaceShape | undefined, sex: 'm' | 'f'): FaceShape | undefined {
  if (!SCULPT) return face;
  const f = { ...NEUTRAL_FACE, ...(face ?? {}) };
  const b = FACE_BIAS[sex];
  for (const k of FACE_KEYS) f[k] = Math.max(-FACE_LIMIT, Math.min(FACE_LIMIT, f[k] * FACE_GAIN + (b[k] ?? 0)));
  return f;
}

// ── Face landmarks for the painted skin ─────────────────────────────────────

/**
 * Per body material: body geometry space → face-local space (origin between the eyes, x right, y up, z forward;
 * one unit = half the eyes' outer width, ~4.5 cm). Filled by CharacterView once the body is in.
 */
const FACE_M = new WeakMap<THREE.Material, { value: THREE.Matrix4 }>();
export function faceMarkUniform(src: THREE.Material): { value: THREE.Matrix4 } {
  let u = FACE_M.get(src);
  if (!u) FACE_M.set(src, (u = { value: new THREE.Matrix4().makeScale(0, 0, 0) }));
  return u;
}
/** Measures the face frame from the eyes' mesh (the model's matrices updated). */
export function setFaceMarks(src: THREE.Material, body: THREE.Mesh, eyes: THREE.Mesh, model: THREE.Object3D): void {
  const u = faceMarkUniform(src);
  const g = (eyes.userData.neutralGeo as THREE.BufferGeometry | undefined) ?? eyes.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const eyeToModel = new THREE.Matrix4().multiplyMatrices(toModel, eyes.matrixWorld);
  const box = g.boundingBox!.clone().applyMatrix4(eyeToModel);
  const c = box.getCenter(new THREE.Vector3());
  c.z = box.max.z;
  const unit = Math.max(1e-4, (box.max.x - box.min.x) / 2);
  const bodyToModel = new THREE.Matrix4().multiplyMatrices(toModel, body.matrixWorld);
  u.value.makeScale(1 / unit, 1 / unit, 1 / unit).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(bodyToModel);
}

// ── Skin ─────────────────────────────────────────────────────────────────────

/** GLSL (fragment, after the skin tint; needs vObjPos, uFaceM, sampledDiffuseColor): painted skin albedo. */
export const SCULPT_SKIN_GLSL = /* glsl */ `
  {
    // Soft, painted base: the photographic texture mostly replaced by its blurred mip (keeps the colour, loses the grain).
    vec3 skSharp = sampledDiffuseColor.rgb;
    vec3 skSoft = texture2D(map, vMapUv, 2.5).rgb;
    vec3 skBase = mix(skSharp, skSoft, 0.72);
    diffuseColor.rgb *= skBase / max(skSharp, vec3(0.02));
    int skRi = int(vRegion + 0.5);
    vec3 skQ = (uFaceM * vec4(vObjPos, 1.0)).xyz;
    vec3 skK = vec3(1.0);
    if (skRi == 0 || skRi == 8) {
      vec2 skX = vec2(abs(skQ.x), skQ.y);
      // Warm: cheeks, nose, ears, lips; cool / darker: under the eyes, the jaw and beard line, the temples.
      float cheek = exp(-dot(skX - vec2(0.85, -0.85), skX - vec2(0.85, -0.85)) * 2.2);
      float nose = exp(-(skQ.x * skQ.x * 9.0 + pow(skQ.y + 0.95, 2.0) * 4.0)) * smoothstep(-0.2, 0.5, skQ.z);
      float ear = exp(-(pow(abs(skQ.x) - 1.75, 2.0) * 6.0 + pow(skQ.y + 0.45, 2.0) * 1.5));
      float lips = exp(-(skQ.x * skQ.x * 3.5 + pow(skQ.y + 1.75, 2.0) * 22.0)) * smoothstep(-0.4, 0.2, skQ.z);
      float under = exp(-(pow(abs(skQ.x) - 0.5, 2.0) * 9.0 + pow(skQ.y + 0.32, 2.0) * 40.0));
      float jaw = smoothstep(-1.9, -2.6, skQ.y) * smoothstep(0.3, 1.2, abs(skQ.x) + max(0.0, -skQ.z) * 0.6);
      float temple = exp(-(pow(abs(skQ.x) - 1.45, 2.0) * 5.0 + pow(skQ.y - 0.35, 2.0) * 3.0));
      skK *= mix(vec3(1.0), vec3(1.07, 0.95, 0.93), clamp(cheek * 0.8 + nose * 0.5 + ear * 0.6, 0.0, 1.0));
      skK *= mix(vec3(1.0), vec3(1.06, 0.86, 0.86), lips * 0.8);
      skK *= mix(vec3(1.0), vec3(0.90, 0.88, 0.95), clamp(under * 0.8 + temple * 0.35, 0.0, 1.0));
      skK *= mix(vec3(1.0), vec3(0.92, 0.92, 0.96), jaw * uJawCool);
      // A lighter forehead and nose bridge (the painter's planes catching light).
      float plane = exp(-(skQ.x * skQ.x * 1.2 + pow(skQ.y - 0.7, 2.0) * 1.0)) * 0.05 + exp(-(skQ.x * skQ.x * 14.0 + pow(skQ.y + 0.4, 2.0) * 3.0)) * 0.04;
      skK *= 1.0 + plane;
    } else if (skRi == 1) skK *= vec3(1.05, 0.97, 0.95);
    diffuseColor.rgb = min(diffuseColor.rgb * skK, vec3(1.0));
  }
`;

/** The physical lights chunk with a wrapped, warm-terminator diffuse (the painted look's soft light falloff). */
export function wrappedLightsChunk(): string {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'vec3 irradiance = dotNL * directLight.color;';
  const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!src.includes(a) || !src.includes(b)) return src;
  return src
    .replace(
      a,
      `${a}
      float skNL = dot( geometryNormal, directLight.direction );
      float skWrap = saturate( ( skNL + 0.5 ) / 1.5 );
      // Soft value step: the lit side flattens a little, the falloff rolls off softly into a warm terminator.
      float skLit = smoothstep( 0.0, 1.0, skWrap );
      vec3 skIrr = directLight.color * mix( vec3( dotNL ), vec3( skLit ) * vec3( 1.0, 0.9, 0.84 ), vec3( 0.7, 0.62, 0.58 ) );`,
    )
    .replace(b, 'reflectedLight.directDiffuse += skIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );');
}

/** GLSL before opaque_fragment: a gentle cool rim on the silhouette. */
export const SCULPT_RIM_GLSL = /* glsl */ `
  {
    float skRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
    outgoingLight += vec3(0.75, 0.85, 1.0) * skRim * 0.10 * (0.4 + diffuseColor.rgb);
  }
`;

// ── Eyes ─────────────────────────────────────────────────────────────────────

/** GLSL (fragment, after map_fragment) for the identity eye atlas tile: bold stylised irises. */
export const SCULPT_EYE_GLSL = /* glsl */ `
  float eyHL = 0.0;
  {
    vec2 et = fract(vMapUv * uEyeGrid);
    vec2 c1 = vec2(0.703, 0.281);
    vec2 c2 = vec2(0.293, 0.703);
    vec2 ed = (distance(et, c1) < distance(et, c2) ? et - c1 : et - c2) / 0.112;
    float er = length(ed);
    vec3 eSoft = texture2D(map, vMapUv, 3.0).rgb;
    vec3 eCol = mix(sampledDiffuseColor.rgb, eSoft, 0.45);
    if (er < 1.08) {
      // Clean, saturated iris with simple radial streaks, a dark limbal ring and a crisp pupil.
      float l = dot(eCol, vec3(0.299, 0.587, 0.114));
      eCol = clamp(mix(vec3(l), eCol, 1.45) * 1.08, 0.0, 1.0);
      float ang = atan(ed.y, ed.x);
      eCol *= 1.0 + 0.14 * sin(ang * 23.0 + sin(ang * 7.0) * 2.0) * smoothstep(0.35, 0.8, er);
      eCol *= mix(1.15, 1.0, smoothstep(0.35, 0.6, er));
      eCol *= mix(1.0, 0.28, smoothstep(0.72, 0.97, er));
      eCol = mix(vec3(0.015), eCol, smoothstep(0.30, 0.36, er));
      // A bold painted catchlight up and to the side of the pupil, and a small second one below.
      eyHL = smoothstep(0.30, 0.22, length(ed - vec2(-0.38, -0.42))) + 0.5 * smoothstep(0.12, 0.07, length(ed - vec2(0.42, 0.40)));
    } else {
      // The whites: clean and light, a touch of shadow towards the lids.
      float l = dot(eCol, vec3(0.299, 0.587, 0.114));
      eCol = mix(eCol, vec3(l) * vec3(1.02, 1.0, 0.97), 0.6) * 1.06 * mix(1.0, 0.82, smoothstep(1.6, 2.6, er));
    }
    diffuseColor.rgb = diffuse * eCol;
  }
`;

// ── Hair ─────────────────────────────────────────────────────────────────────

/**
 * GLSL (fragment, at the end of hairGen's map edits; vStrand: across / along in cm, vHair: edge, density, shade):
 * the procedural hair as sculpted masses: broad clumps parted by dark painted grooves, a few painted strand strokes,
 * dark roots to light ends, a hard-ish clean hairline, and a painted anisotropic sheen band (in hcSheen).
 */
export const SCULPT_HAIR_GLSL = /* glsl */ `
  float hcSheen = 0.0;
  {
    // Clumps: bands across the strands, their borders wandering along them.
    float hcW = hgN(vec2(vStrand.y * 0.12, vStrand.x * 0.35)) * 1.6 + hgN(vStrand * vec2(0.45, 0.08) + 9.0) * 1.1;
    // Clump width varies (a cheap domain warp across the strands), so they never read as regular stripes.
    float hcC = vStrand.x * (0.32 + 0.22 * hgN(vec2(vStrand.x * 0.15, 3.0))) + hcW;
    float hcF = fract(hcC);
    float hcId = floor(hcC);
    float hcGroove = mix(1.0, smoothstep(0.0, 0.12, hcF) * smoothstep(1.0, 0.88, hcF), 0.75 * smoothstep(1.0, 4.0, vStrand.y));
    // Each clump a rounded mass: lit in its middle, darker into the grooves.
    float hcRound = 0.72 + 0.28 * sin(hcF * 3.14159);
    float hcStroke = hgN(vStrand * vec2(6.0, 0.22) + hcId * 3.1) * 0.6 + hgN(vStrand * vec2(14.0, 0.5) + 2.0) * 0.4;
    float hcTone = mix(0.62, 1.0, hcGroove) * hcRound * (0.88 + 0.24 * hcStroke) * (0.92 + 0.16 * hgH(vec2(hcId, 1.0)));
    // Replace the strand-cloud shading with the painted one (keeping the colour's own treatment applied above).
    diffuseColor.rgb *= hcTone / max(0.62 + 0.62 * hgS, 0.2);
    // Roots dark, ends light.
    diffuseColor.rgb *= mix(0.62, 1.12, smoothstep(0.0, 9.0, vStrand.y + hcStroke * 2.0));
    // Clean, hard-ish hairline: no wisps.
    if (vHair.y >= 0.995) diffuseColor.a = vHair.x >= 0.995 ? 1.0 : smoothstep(0.02, 0.6, vHair.x);
    // The sheen: a broken band across the strands (screen-space strand direction from vStrand.y).
    vec3 hcT = dFdx(-vViewPosition) * dFdy(vStrand.y) - dFdy(-vViewPosition) * dFdx(vStrand.y);
    float hcTl = length(hcT);
    if (hcTl > 1e-8) {
      hcT /= hcTl;
      float hcFace = 1.0 - abs(dot(hcT, normalize(vViewPosition)));
      vec3 hcH = normalize(normalize(vec3(0.25, 0.85, 0.5)) + normalize(vViewPosition));
      float hcTH = dot(hcT, hcH) + (hcStroke - 0.5) * 0.35 + (hgH(vec2(hcId, 7.0)) - 0.5) * 0.25;
      hcSheen = pow(sqrt(max(0.0, 1.0 - hcTH * hcTH)), 40.0) * hcGroove * hcRound * uSheenK * hcFace * hcFace;
    }
  }
`;

/** GLSL for the asset hair cards in the sculpt look (after map_fragment): masses from the blurred cards. */
export const SCULPT_CARD_GLSL = /* glsl */ `
  float hcSheen = 0.0;
  {
    vec4 hcB = texture2D(map, vMapUv, 2.0);
    float hcStr = sampledDiffuseColor.r;
    // (The cards' UV islands don't blur into masses: blurring them made camouflage blotches. Only a calmer
    // strand contrast, darker where the cards thin out, and the painted sheen.)
    diffuseColor.rgb = diffuse * mix(0.8, 1.0, smoothstep(0.2, 0.8, hcB.a)) * (0.62 + 0.4 * mix(hcB.r, hcStr, 0.5));
    vec3 hcT = dFdx(-vViewPosition) * dFdy(vMapUv.y) - dFdy(-vViewPosition) * dFdx(vMapUv.y);
    float hcTl = length(hcT);
    if (hcTl > 1e-8) {
      hcT /= hcTl;
      float hcFace = 1.0 - abs(dot(hcT, normalize(vViewPosition)));
      vec3 hcH = normalize(normalize(vec3(0.25, 0.85, 0.5)) + normalize(vViewPosition));
      float hcTH = dot(hcT, hcH) + (hcStr - 0.5) * 0.3;
      hcSheen = pow(sqrt(max(0.0, 1.0 - hcTH * hcTH)), 36.0) * smoothstep(0.3, 0.8, hcB.a) * uSheenK * hcFace * hcFace;
    }
  }
`;

/** GLSL at emissivemap_fragment: the painted sheen, a light tint of the hair's own colour. */
export const SCULPT_SHEEN_GLSL = /* glsl */ `
  totalEmissiveRadiance += (diffuse * 0.6 + vec3(0.08, 0.07, 0.06)) * hcSheen * 0.4;
`;
