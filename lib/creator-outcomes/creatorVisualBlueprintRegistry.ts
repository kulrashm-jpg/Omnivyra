/**
 * Canonical Visual Blueprint registry (CREATOR-054).
 *
 * A Creator Template is a VISUAL BLUEPRINT — it defines the visual LANGUAGE
 * (composition, hierarchy, typography, colour, imagery/illustration style, CTA
 * placement, slide rhythm, info flow). It stores NO runtime content: the user's
 * content is injected later by AI, which derives prompts/colour/layout from the
 * blueprint (STEP 7).
 *
 * Built ON TOP of the 051 visual-style registry (promotes each style into a
 * blueprint, id-aligned so the curated showcase repository's `visualStyle` keeps
 * matching) + the missing STEP-3 categories. No duplicate registry; no runtime
 * fields. Preview images come from the curated repository (empty until populated).
 */

import type { TemplateAssetFamily } from '../creator-templates/types';
import { VISUAL_STYLES, type VisualStyle } from './creatorVisualStyleRegistry';

export type BlueprintCategory = 'photography' | 'illustration' | '3d' | 'modern' | 'marketing' | 'ui';

export const BLUEPRINT_CATEGORY_LABELS: Record<BlueprintCategory, string> = {
  photography: 'Photography', illustration: 'Illustration', '3d': '3D', modern: 'Modern Design', marketing: 'Marketing', ui: 'UI',
};

export interface VisualBlueprint {
  id: string;
  title: string;
  description: string;
  visualCategory: BlueprintCategory;
  /** Curated preview (from the showcase repository) — empty until populated. */
  previewImage: string;
  previewGallery: string[];
  supportedFamilies: TemplateAssetFamily[];
  supportedLayouts: string[];
  recommendedIndustries: string[];
  recommendedAudiences: string[];
  stylePrompt: string;
  imagePrompt: string;
  layoutRules: { composition: 'centered' | 'split' | 'grid' | 'asymmetric'; density: 'minimal' | 'balanced' | 'dense'; ctaPlacement: 'bottom' | 'inline' | 'corner' };
  typographyRules: { weight: 'regular' | 'medium' | 'bold'; case: 'sentence' | 'upper'; family: 'sans' | 'serif' };
  colorRules: { primary: string; surface: string; contrast: 'high' | 'soft' };
  animationRules?: { motion: 'none' | 'subtle' | 'dynamic' };
  illustrationRules: { kind: 'photo' | 'vector' | 'hand' | '3d' | 'graphic' | 'mockup' };
  brandCompatibility: string;
}

const ALL_FAM: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const IMG_CAR: TemplateAssetFamily[] = ['image', 'carousel'];

/** Category for each 051 style id (default 'modern'). */
const STYLE_CATEGORY: Record<string, BlueprintCategory> = {
  lifestyle: 'photography', 'real-photography': 'photography', 'portrait-photography': 'photography', 'product-photography': 'photography', studio: 'photography',
  technology: 'photography', healthcare: 'photography', finance: 'photography', education: 'photography', construction: 'photography', restaurant: 'photography', travel: 'photography', retail: 'photography', fashion: 'photography', 'luxury-brand': 'photography',
  graffiti: 'illustration', street: 'illustration', comic: 'illustration', anime: 'illustration', clay: 'illustration', watercolor: 'illustration', sketch: 'illustration', illustration: 'illustration', 'flat-illustration': 'illustration', isometric: 'illustration', 'hand-drawn': 'illustration', 'paper-cut': 'illustration',
  '3d': '3d',
  'ui-mockup': 'ui', dashboard: 'ui', infographic: 'ui',
};

const SERIF = new Set(['editorial', 'magazine', 'luxury', 'luxury-brand', 'vintage', 'fashion']);
function illoKind(c: BlueprintCategory): VisualBlueprint['illustrationRules']['kind'] {
  return c === 'photography' ? 'photo' : c === '3d' ? '3d' : c === 'ui' ? 'mockup' : c === 'illustration' ? 'vector' : 'graphic';
}

function promote(s: VisualStyle): VisualBlueprint {
  const visualCategory = STYLE_CATEGORY[s.id] ?? 'modern';
  const highContrast = s.brandBehavior === 'high-contrast';
  return {
    id: s.id, title: s.title, description: s.description, visualCategory,
    previewImage: '', previewGallery: [],
    supportedFamilies: s.supportedFamilies,
    supportedLayouts: ['single', 'split', 'grid'],
    recommendedIndustries: s.industries,
    recommendedAudiences: ['prospects', 'customers', 'executives'],
    stylePrompt: s.stylePrompt,
    imagePrompt: s.stylePrompt,
    layoutRules: { composition: 'centered', density: 'balanced', ctaPlacement: 'bottom' },
    typographyRules: { weight: highContrast ? 'bold' : 'medium', case: 'sentence', family: SERIF.has(s.id) ? 'serif' : 'sans' },
    colorRules: { primary: s.thumbnail.accent, surface: s.thumbnail.surface, contrast: highContrast ? 'high' : 'soft' },
    illustrationRules: { kind: illoKind(visualCategory) },
    brandCompatibility: s.brandBehavior,
  };
}

/** Extra blueprints required by the STEP-3 taxonomy and not present as 051 styles. */
function extra(id: string, title: string, description: string, visualCategory: BlueprintCategory, accent: string, surface: string, stylePrompt: string, o: Partial<VisualBlueprint> = {}): VisualBlueprint {
  return {
    id, title, description, visualCategory, previewImage: '', previewGallery: [],
    supportedFamilies: o.supportedFamilies ?? ALL_FAM,
    supportedLayouts: o.supportedLayouts ?? ['single', 'split', 'grid'],
    recommendedIndustries: o.recommendedIndustries ?? ['general'],
    recommendedAudiences: o.recommendedAudiences ?? ['prospects', 'customers'],
    stylePrompt, imagePrompt: o.imagePrompt ?? stylePrompt,
    layoutRules: o.layoutRules ?? { composition: 'centered', density: 'balanced', ctaPlacement: 'bottom' },
    typographyRules: o.typographyRules ?? { weight: 'bold', case: 'sentence', family: 'sans' },
    colorRules: { primary: accent, surface, contrast: o.colorRules?.contrast ?? 'high' },
    illustrationRules: o.illustrationRules ?? { kind: illoKind(visualCategory) },
    brandCompatibility: o.brandCompatibility ?? 'accent-led',
  };
}

const EXTRAS: VisualBlueprint[] = [
  extra('corporate-portrait', 'Corporate Portrait', 'Professional headshot-led layouts.', 'photography', '#1e3a8a', '#0b1220', 'corporate portrait photography, professional headshots', { supportedFamilies: IMG_CAR }),
  extra('food', 'Food', 'Appetising food photography.', 'photography', '#dc2626', '#1a1a1a', 'food photography, fresh appetising, rich warm tones', { supportedFamilies: IMG_CAR, recommendedIndustries: ['restaurant', 'retail'] }),
  extra('manga', 'Manga', 'Black-and-white manga line art.', 'illustration', '#111827', '#f8fafc', 'manga style, ink line art, screentones, dynamic panels', { supportedFamilies: IMG_CAR }),
  extra('pixel-art', 'Pixel Art', 'Retro pixel-art aesthetic.', 'illustration', '#22c55e', '#0b1220', 'pixel art, 8-bit, crisp pixels, retro game palette', { supportedFamilies: IMG_CAR }),
  extra('product-3d', '3D Product', 'Rendered 3D product hero.', '3d', '#8b5cf6', '#0b1220', '3D rendered product, studio lighting, soft reflections', { supportedFamilies: IMG_CAR, recommendedIndustries: ['technology', 'retail'] }),
  extra('character-3d', '3D Character', 'Friendly 3D character scenes.', '3d', '#fb7185', '#1f2937', '3D character, soft rounded, expressive, brand mascot', { supportedFamilies: IMG_CAR }),
  extra('abstract-3d', '3D Abstract', 'Abstract 3D forms and depth.', '3d', '#06b6d4', '#020617', '3D abstract shapes, depth, gradient lighting', { supportedFamilies: ALL_FAM }),
  extra('minimal-3d', '3D Minimal', 'Clean minimal 3D objects.', '3d', '#94a3b8', '#0f172a', 'minimal 3D, single object, soft shadow, neutral set', { supportedFamilies: ALL_FAM }),
  extra('before-after', 'Before / After', 'Split transformation composition.', 'marketing', '#10b981', '#0b1220', 'before and after split, clear contrast, transformation', { supportedFamilies: IMG_CAR, layoutRules: { composition: 'split', density: 'balanced', ctaPlacement: 'bottom' } }),
  extra('comparison', 'Comparison', 'Side-by-side comparison layout.', 'marketing', '#2563eb', '#0b1220', 'side-by-side comparison, two columns, clear winner', { layoutRules: { composition: 'split', density: 'dense', ctaPlacement: 'bottom' } }),
  extra('testimonial', 'Testimonial', 'Quote + person social proof.', 'marketing', '#f43f5e', '#0b1220', 'testimonial card, portrait, quotation, trust', { supportedFamilies: IMG_CAR }),
  extra('statistic', 'Statistic', 'Big-number stat hero.', 'marketing', '#0ea5e9', '#0b1220', 'big statistic, oversized number, supporting label', { layoutRules: { composition: 'centered', density: 'minimal', ctaPlacement: 'bottom' } }),
  extra('quote', 'Quote', 'Editorial pull-quote card.', 'marketing', '#94a3b8', '#111827', 'pull quote, elegant typography, attribution', { typographyRules: { weight: 'bold', case: 'sentence', family: 'serif' } }),
  extra('timeline', 'Timeline', 'Chronological timeline flow.', 'marketing', '#2563eb', '#0b1220', 'timeline, milestones along an axis, dates', { supportedFamilies: ['carousel', 'infographic'], layoutRules: { composition: 'grid', density: 'balanced', ctaPlacement: 'corner' } }),
  extra('checklist', 'Checklist', 'Actionable checklist layout.', 'marketing', '#16a34a', '#0b1220', 'checklist, ticked items, clean rows', { layoutRules: { composition: 'grid', density: 'dense', ctaPlacement: 'bottom' } }),
  extra('framework', 'Framework', 'Named framework / model.', 'marketing', '#7c3aed', '#0b1220', 'framework diagram, named pillars, structured', { supportedFamilies: ['carousel', 'infographic'] }),
  extra('faq', 'FAQ', 'Question-and-answer layout.', 'marketing', '#0ea5e9', '#0b1220', 'FAQ layout, question and answer pairs', { supportedFamilies: ['carousel'] }),
  extra('hero-banner', 'Hero Banner', 'Wide headline hero banner.', 'marketing', '#2563eb', '#0b1220', 'hero banner, bold headline, supporting visual, CTA', { supportedFamilies: ['image'] }),
  extra('mobile-app', 'Mobile App', 'App screen mockup framing.', 'ui', '#2563eb', '#0b1220', 'mobile app UI in phone frame, clean product screens', { supportedFamilies: IMG_CAR, recommendedIndustries: ['technology'], illustrationRules: { kind: 'mockup' } }),
  extra('saas', 'SaaS', 'SaaS product UI aesthetic.', 'ui', '#06b6d4', '#0b1220', 'SaaS product UI, dashboard hints, gradients', { recommendedIndustries: ['technology'], illustrationRules: { kind: 'mockup' } }),
  extra('analytics', 'Analytics', 'Charts and metrics layout.', 'ui', '#0ea5e9', '#0b1220', 'analytics dashboard, charts, KPIs, data theme', { supportedFamilies: ['image', 'infographic'], illustrationRules: { kind: 'mockup' } }),
  extra('ecommerce', 'Ecommerce', 'Product grid / shop UI.', 'ui', '#e11d48', '#0b1220', 'ecommerce UI, product grid, price tags, CTA', { supportedFamilies: IMG_CAR, recommendedIndustries: ['retail'], illustrationRules: { kind: 'mockup' } }),
];

export const VISUAL_BLUEPRINTS: VisualBlueprint[] = [...VISUAL_STYLES.map(promote), ...EXTRAS];
export const BLUEPRINT_BY_ID: Record<string, VisualBlueprint> = Object.fromEntries(VISUAL_BLUEPRINTS.map((b) => [b.id, b]));

export function getBlueprint(id: string | null | undefined): VisualBlueprint | null { return id ? BLUEPRINT_BY_ID[id] ?? null : null; }
export function listBlueprints(family?: TemplateAssetFamily): VisualBlueprint[] {
  return family ? VISUAL_BLUEPRINTS.filter((b) => b.supportedFamilies.includes(family)) : VISUAL_BLUEPRINTS;
}
const CATEGORY_ORDER: BlueprintCategory[] = ['photography', 'illustration', '3d', 'modern', 'marketing', 'ui'];
export function listBlueprintsByCategory(family?: TemplateAssetFamily): { category: BlueprintCategory; label: string; blueprints: VisualBlueprint[] }[] {
  const pool = listBlueprints(family);
  return CATEGORY_ORDER.map((category) => ({ category, label: BLUEPRINT_CATEGORY_LABELS[category], blueprints: pool.filter((b) => b.visualCategory === category) })).filter((g) => g.blueprints.length > 0);
}
export function blueprintCount(): { total: number; byCategory: Record<BlueprintCategory, number> } {
  const byCategory = { photography: 0, illustration: 0, '3d': 0, modern: 0, marketing: 0, ui: 0 } as Record<BlueprintCategory, number>;
  for (const b of VISUAL_BLUEPRINTS) byCategory[b.visualCategory] += 1;
  return { total: VISUAL_BLUEPRINTS.length, byCategory };
}
