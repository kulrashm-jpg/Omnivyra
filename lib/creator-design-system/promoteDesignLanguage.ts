/**
 * PHASE 11 promotion (CREATOR-130) — promote an existing CreatorTemplate's style
 * tokens into the canonical DesignLanguage. Pure + deterministic; touches no
 * renderer. Proves the migration path: every curated design can be expressed as a
 * DesignLanguage without loss, so the foundation is real (not vaporware).
 */

import type { CreatorTemplate } from '../creator-templates/types';
import type { DesignLanguage } from './designSystem';

const ILLO: Record<string, DesignLanguage['illustrationStyle']> = {
  photography: 'photo', illustration: 'vector', '3d': '3d', modern: 'graphic', marketing: 'graphic', ui: 'graphic',
};

export function designLanguageFromTemplate(t: CreatorTemplate): DesignLanguage {
  const dna = t.generationDNA;
  const vl = t.visualLanguage;
  const fam = (t.designFamily ?? 'modern').toLowerCase();
  const primary = dna?.colorLanguage.primary ?? vl.accent ?? '#2563eb';
  const surface = dna?.colorLanguage.surface ?? vl.surface ?? '#0b1220';
  const contrast: 'high' | 'soft' = dna?.colorLanguage.contrast ?? (vl.densityBias === 'dense' ? 'high' : 'soft');

  return {
    id: `dl-${t.id}`,
    typography: {
      family: 'Inter, Arial, sans-serif',
      scale: [14, 18, 24, 32, 44, 60],
      headingWeight: vl.typographyWeight === 'feature' ? 800 : vl.typographyWeight === 'lead' ? 700 : 600,
      bodyWeight: 400,
      case: 'sentence',
      letterSpacing: 0,
      lineHeight: 1.3,
    },
    colorTokens: {
      primary, surface, onSurface: '#ffffff', accent: primary, muted: '#94a3b8', contrast, palette: [primary],
    },
    spacingScale: [4, 8, 12, 16, 24, 32, 48],
    cornerRadius: 16,
    shadowLanguage: 'soft',
    borderLanguage: 'accent-stripe',
    photographyStyle: dna?.photography || 'editorial',
    illustrationStyle: ILLO[fam] ?? 'graphic',
    iconography: 'glyph',
    chartStyle: /financ|finance/.test(fam) ? 'financial' : /luxury|editorial/.test(fam) ? 'editorial' : 'minimal',
    motionRules: 'none',
    shapeLanguage: /organic|hand/.test(dna?.shapeLanguage ?? '') ? 'organic' : 'geometric',
    brandPersonality: dna?.renderingStyle || fam,
    visualDensity: t.composition ? (t.composition.densityScale > 1.1 ? 'dense' : 'balanced') : (vl.densityBias ?? 'balanced'),
    contrastRules: contrast,
    whitespaceRules: vl.densityBias === 'minimal' ? 'generous' : vl.densityBias === 'dense' ? 'compact' : 'balanced',
  };
}
