export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;
  smaa: boolean;
  flashlightShadow: boolean;
  muzzleLights: boolean;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, post: false, smaa: false, flashlightShadow: false, muzzleLights: false },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, post: true, smaa: false, flashlightShadow: false, muzzleLights: true },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, post: true, smaa: true, flashlightShadow: true, muzzleLights: true },
};

/** Pick a starting level from the device: Apple Silicon Macs comfortably run "high" at a capped pixel ratio. */
export function detectQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}
