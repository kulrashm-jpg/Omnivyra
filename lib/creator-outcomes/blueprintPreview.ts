/**
 * Blueprint Preview model (CREATOR-056) — browsing only, no runtime data.
 *
 * Describes what a visual blueprint LOOKS like so a card communicates the style
 * in words (and shows real curated images when they exist). `coverImage`/`gallery`
 * come from the curated showcase repository (real finished creatives); the
 * descriptive fields are derived deterministically from the blueprint's own
 * visual-language rules. No generation, no rendering, no AI.
 */

import { getBlueprint, type VisualBlueprint, type BlueprintCategory } from './creatorVisualBlueprintRegistry';
import { getShowcasesByVisualStyle } from './creatorShowcaseRepository';
import type { TemplateAssetFamily } from '../creator-templates/types';

export interface BlueprintPreview {
  blueprintId: string;
  coverImage: string;            // real curated image — '' until populated
  gallery: string[];             // 5–10 real curated images — [] until populated
  styleDescription: string;
  visualKeywords: string[];
  compositionNotes: string;
  cameraStyle: string;
  lighting: string;
  colorPalette: string[];        // descriptive metadata (not the card's main visual)
  subjectExamples: string[];
  industryExamples: string[];
}

const CATEGORY_KEYWORDS: Record<BlueprintCategory, string[]> = {
  photography: ['real photography', 'natural light', 'authentic'],
  illustration: ['illustrated', 'characters', 'expressive'],
  '3d': ['rendered 3D', 'depth', 'soft shadows'],
  modern: ['typographic', 'clean grid', 'brand-forward'],
  marketing: ['conversion-led', 'clear hierarchy', 'CTA'],
  ui: ['product UI', 'screens', 'data'],
};

const CATEGORY_SUBJECTS: Record<BlueprintCategory, string[]> = {
  photography: ['Executive portrait', 'Team at work', 'Product in use', 'Workspace scene'],
  illustration: ['Character scene', 'Icon set', 'Editorial spot', 'Concept illustration'],
  '3d': ['Rendered product', '3D character', 'Abstract object', 'Floating device'],
  modern: ['Bold headline', 'Editorial layout', 'Brand statement', 'Pull quote'],
  marketing: ['Before / after split', 'Statistic callout', 'Testimonial card', 'Comparison grid'],
  ui: ['Dashboard screen', 'App mockup', 'Analytics panel', 'Onboarding flow'],
};

/** Blueprint-specific subject overrides for the highlighted directions (STEP 3). */
const SUBJECT_OVERRIDES: Record<string, string[]> = {
  graffiti: ['Spray-paint mural', 'Street wall tag', 'Urban backdrop'],
  street: ['Urban mural', 'City wall', 'Stencil art'],
  anime: ['Anime hero', 'Cel-shaded scene', 'Dynamic pose'],
  manga: ['Manga panel', 'Ink line art', 'Screentone scene'],
  comic: ['Comic panel', 'Halftone hero', 'Speech bubbles'],
  watercolor: ['Watercolor landscape', 'Painted portrait', 'Soft floral wash'],
  sketch: ['Pencil portrait', 'Line sketch', 'Concept doodle'],
  clay: ['Clay character', 'Soft 3D scene', 'Matte object'],
  'pixel-art': ['Pixel hero', '8-bit scene', 'Retro sprite'],
  glassmorphism: ['Frosted UI panel', 'Glass card', 'Translucent overlay'],
  dashboard: ['SaaS dashboard', 'KPI tiles', 'Charts panel'],
  'mobile-app': ['App home screen', 'Onboarding', 'Profile screen'],
  luxury: ['Premium product', 'Gold-on-black hero', 'Editorial still life'],
  'corporate-portrait': ['Executive headshot', 'Leadership team', 'Boardroom'],
  food: ['Plated dish', 'Fresh ingredients', 'Top-down spread'],
  editorial: ['Magazine cover', 'Feature spread', 'Typographic hero'],
};

function cameraStyleFor(b: VisualBlueprint): string {
  switch (b.illustrationRules.kind) {
    case 'photo': return 'DSLR, shallow depth of field, real subjects';
    case '3d': return 'Rendered 3D, soft global illumination';
    case 'vector': return 'Flat vector illustration';
    case 'hand': return 'Hand-drawn, organic line';
    case 'mockup': return 'Device / screen mockup framing';
    default: return 'Graphic composition';
  }
}

/** The browsing preview for a blueprint — real images when curated, rich description always. */
export function getBlueprintPreview(blueprintId: string, family?: TemplateAssetFamily): BlueprintPreview | null {
  const b = getBlueprint(blueprintId);
  if (!b) return null;
  const shows = getShowcasesByVisualStyle(b.id, family);
  const keywords = Array.from(new Set([b.title.toLowerCase(), ...CATEGORY_KEYWORDS[b.visualCategory], b.brandCompatibility])).slice(0, 6);
  return {
    blueprintId: b.id,
    coverImage: shows[0]?.thumbnailUrl ?? '',
    gallery: shows.map((s) => s.previewUrl || s.thumbnailUrl).filter(Boolean).slice(0, 10),
    styleDescription: b.description,
    visualKeywords: keywords,
    compositionNotes: `${b.layoutRules.composition} composition · ${b.layoutRules.density} density · CTA ${b.layoutRules.ctaPlacement}`,
    cameraStyle: cameraStyleFor(b),
    lighting: b.colorRules.contrast === 'high' ? 'Dramatic, high-contrast' : 'Soft, even daylight',
    colorPalette: [b.colorRules.primary, b.colorRules.surface],
    subjectExamples: SUBJECT_OVERRIDES[b.id] ?? CATEGORY_SUBJECTS[b.visualCategory],
    industryExamples: b.recommendedIndustries,
  };
}

export function blueprintHasRealCover(blueprintId: string): boolean {
  return (getBlueprintPreview(blueprintId)?.coverImage ?? '').length > 0;
}
