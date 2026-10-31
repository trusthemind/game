import { Uniform } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * Contrast-adaptive sharpening (after AMD's CAS): sharpens edges in flat areas more than in already
 * contrasty ones, so detail on gear and faces pops without ringing. Runs last, on the tone-mapped image,
 * and also hides the softness of the adaptive resolution scale.
 */
export class SharpenEffect extends Effect {
  constructor(strength = 0.55) {
    super(
      'SharpenEffect',
      /* glsl */ `
      uniform float strength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
        vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
        vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
        vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
        vec3 mn = min(c, min(min(n, s), min(e, w)));
        vec3 mx = max(c, max(max(n, s), max(e, w)));
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
        vec3 wgt = -amp * mix(0.125, 0.2, strength);
        outputColor = vec4(clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0), inputColor.a);
      }`,
      { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['strength', new Uniform(strength)]]) },
    );
  }
}

/**
 * Sanitises the HDR scene before bloom. The frame renders into a half-float target, and one pixel that
 * overflows (a muzzle-flash light a few centimetres from a gun or hand, a razor-sharp specular highlight)
 * or goes NaN gets smeared over the whole screen by bloom's blur chain: a full-white frame. Kill NaN/Inf and
 * cap radiance at a level bloom still reads as "very bright".
 */
export class SanitizeEffect extends Effect {
  constructor(maxRadiance = 32) {
    super(
      'SanitizeEffect',
      /* glsl */ `
      uniform float maxRadiance;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        outputColor = vec4(clamp(c, 0.0, maxRadiance), inputColor.a);
      }`,
      { uniforms: new Map([['maxRadiance', new Uniform(maxRadiance)]]) },
    );
  }
}
