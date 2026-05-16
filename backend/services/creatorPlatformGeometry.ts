import { resolvePlatformVisualProfile } from './creatorAssetGovernance';

export type PlatformGeometryProfile = {
  engine: 'framework_grid' | 'rapid_scan' | 'immersive_visual' | 'balanced_engagement';
  margin: number;
  gap: number;
  headlineScale: number;
  bodyScale: number;
  maxTextBlocks: number;
  ctaPlacement: 'none' | 'lower_right' | 'footer' | 'soft_footer';
  compositionBalance: 'restrained' | 'compressed' | 'visual_first' | 'readability_first';
};

export function resolvePlatformGeometryProfile(platform: string): PlatformGeometryProfile {
  const normalized = String(platform || '').trim().toLowerCase();
  const visual = resolvePlatformVisualProfile(normalized);
  if (normalized === 'instagram') {
    return { engine: 'immersive_visual', margin: 72, gap: 34, headlineScale: 1.22, bodyScale: 1.08, maxTextBlocks: 3, ctaPlacement: visual.ctaTolerance === 'medium' ? 'soft_footer' : 'none', compositionBalance: 'visual_first' };
  }
  if (normalized === 'x' || normalized === 'twitter') {
    return { engine: 'rapid_scan', margin: 44, gap: 18, headlineScale: 0.9, bodyScale: 0.86, maxTextBlocks: 2, ctaPlacement: 'footer', compositionBalance: 'compressed' };
  }
  if (normalized === 'facebook') {
    return { engine: 'balanced_engagement', margin: 64, gap: 26, headlineScale: 1.02, bodyScale: 1, maxTextBlocks: 4, ctaPlacement: 'soft_footer', compositionBalance: 'readability_first' };
  }
  return { engine: 'framework_grid', margin: 82, gap: 30, headlineScale: 1, bodyScale: 0.96, maxTextBlocks: 4, ctaPlacement: 'lower_right', compositionBalance: 'restrained' };
}

export function platformTextBoxY(input: {
  platform: string;
  index: number;
  baseY: number;
}): number {
  const profile = resolvePlatformGeometryProfile(input.platform);
  return input.baseY + input.index * (profile.engine === 'rapid_scan' ? 160 : profile.engine === 'immersive_visual' ? 250 : 220);
}
