/**
 * MarketingSampleRegistry (CREATOR-076) — the ONE canonical user-facing object for
 * the Creator experience. A Marketing Sample is "a finished marketing creative that
 * teaches the AI how the final output should feel." It is the SINGLE registry; it
 * ADAPTS the existing blueprint registry + preview repository + runtime bridge — no
 * second registry, no duplicate runtime, no duplicate prompt builder.
 *
 * Blueprint/Template/Style/Layout are now INTERNAL metadata only. sampleId is the
 * one public id; internally sampleId === blueprintId, so the existing runtime thread
 * (creator_card.blueprint_id → bridge → assembler → renderer) is reused unchanged.
 */

import type { TemplateAssetFamily } from '../creator-templates/types';
import { VISUAL_BLUEPRINTS, getBlueprint } from './creatorVisualBlueprintRegistry';
import { getBlueprintPreview } from './blueprintPreview';
import { resolveBlueprintRuntime } from './blueprintRuntimeBridge';

/** Structured generation instructions (STEP 3) — never exposed to normal users. */
export interface GenerationDNA {
  composition: string;
  hierarchy: string;
  typography: string;
  colorLanguage: { primary: string; surface: string; contrast: 'high' | 'soft' };
  photography: string;
  illustration: string;
  spacing: string;
  lighting: string;
  camera: string;
  contrast: 'high' | 'soft';
  renderingStyle: string;
  shapeLanguage: string;
  promptModifiers: string;
  negativePromptModifiers: string;
  /** STEP 4 — what the renderer must keep vs may swap for the user's content. */
  adaptation: { immutable: string[]; adaptable: string[] };
}

/** STEP 2 — the canonical sample. Top-level holds nothing implementation-named. */
/**
 * MarketingSampleDefinition (CREATOR-082) — the ONE creative source of truth for
 * BOTH the gallery preview and the customer asset. It is a complete creative
 * blueprint with NO stored preview image / thumbnail: previews are generated from
 * this definition through the same rendering pipeline as customer assets.
 */
export interface MarketingSampleDefinition {
  sampleId: string;
  title: string;
  description: string;
  businessPurpose: string;
  businessGoal: string | null;
  supportedAssetTypes: TemplateAssetFamily[];
  industryTags: string[];
  audienceTags: string[];
  /** CREATOR-084: the ONE canonical preview image field (curated URL; '' until set). */
  previewImage: string;
  designSystem: string;
  generationDNA: GenerationDNA;
  lockedRegions: string[];     // STEP 7 — never change between sample and customer asset
  editableRegions: string[];   // STEP 7 — swapped for the customer's content
  previewRecipe: string;       // how the gallery preview is generated (neutral content)
  generationRecipe: string;    // how the customer asset is generated (user content)
  version: number;
}

/** Back-compat alias — the same single definition, no duplicate model. */
export type MarketingSample = MarketingSampleDefinition;

const NEGATIVE_BY_CATEGORY: Record<string, string> = {
  photography: 'no illustration, no cartoon, no 3d render, no warped text, no watermark',
  illustration: 'no photorealism, no photographic grain, no warped text',
  '3d': 'no flat illustration, no photograph, no warped text',
  modern: 'no clutter, no low contrast, no warped text, no watermark',
  marketing: 'no clutter, no low contrast, no warped text, no watermark',
  ui: 'no photographic noise, no clutter, no warped text',
};
const SHAPE_BY_CATEGORY: Record<string, string> = {
  photography: 'organic, natural forms', illustration: 'hand-drawn, expressive shapes',
  '3d': 'dimensional, rounded forms', modern: 'clean geometric shapes',
  marketing: 'bold blocks, strong shapes', ui: 'rectilinear, grid-based',
};
const SPACING_BY_DENSITY: Record<string, string> = {
  minimal: 'generous negative space', light: 'generous negative space',
  balanced: 'balanced spacing', heavy: 'dense, information-rich', dense: 'dense, information-rich',
};
// STEP 7 — explicit, exhaustive locked vs editable regions.
const LOCKED = ['composition', 'hierarchy', 'typography structure', 'spacing', 'scene framing', 'illustration language', 'photography language'];
const EDITABLE = ['headline', 'body', 'CTA', 'logo', 'brand colors', 'product', 'people', 'pricing', 'offer', 'statistics', 'industry examples'];

function toSample(blueprintId: string, family?: TemplateAssetFamily): MarketingSampleDefinition | null {
  const b = getBlueprint(blueprintId);
  const rt = resolveBlueprintRuntime(blueprintId);
  if (!b || !rt) return null;
  const pv = getBlueprintPreview(blueprintId);
  const camera = pv?.cameraStyle ?? '';
  const lighting = pv?.lighting ?? '';
  const photography = [camera, lighting].filter(Boolean).join(' · ');
  const dna: GenerationDNA = {
    composition: pv?.compositionNotes ?? rt.layoutGuidance,
    hierarchy: `${b.typographyRules.weight} ${b.typographyRules.case}-case emphasis`,
    typography: rt.typographyGuidance,
    colorLanguage: rt.colorLanguage,
    photography,
    illustration: b.illustrationRules.kind,
    spacing: SPACING_BY_DENSITY[b.layoutRules.density] ?? 'balanced spacing',
    lighting,
    camera,
    contrast: rt.colorLanguage.contrast,
    renderingStyle: b.visualCategory,
    shapeLanguage: SHAPE_BY_CATEGORY[b.visualCategory] ?? 'balanced shapes',
    promptModifiers: [rt.stylePrompt, rt.imagePrompt, photography, rt.layoutGuidance, rt.typographyGuidance]
      .map((s) => (s ?? '').trim()).filter(Boolean).join('. '),
    negativePromptModifiers: NEGATIVE_BY_CATEGORY[b.visualCategory] ?? 'no warped text, no watermark, no low quality, no clutter',
    adaptation: { immutable: [...LOCKED], adaptable: [...EDITABLE] },
  };
  return {
    sampleId: b.id,
    title: b.title,
    description: pv?.styleDescription || b.description,
    businessPurpose: pv?.styleDescription || b.description,
    businessGoal: null,
    supportedAssetTypes: b.supportedFamilies,
    industryTags: b.recommendedIndustries ?? [],
    audienceTags: b.recommendedAudiences ?? [],
    // CREATOR-106: each asset family shows its OWN asset-shaped, text-formatted preview
    // (all built on the same AI visual): image = finished post, carousel = multi-slide
    // deck, infographic = data layout. Default/getSample uses the clean AI base.
    previewImage: family === 'carousel' ? `/creator-showcases/${b.id}/carousel.png`
      : family === 'infographic' ? `/creator-showcases/${b.id}/infographic.png`
        : family === 'image' ? `/creator-showcases/${b.id}/image.png`
          : (pv?.coverImage ?? ''),
    designSystem: b.visualCategory,
    generationDNA: dna,
    lockedRegions: [...LOCKED],
    editableRegions: [...EDITABLE],
    previewRecipe: 'render the design DNA with neutral, brand-free placeholder content',
    generationRecipe: 'render the design DNA, swapping editable regions for the customer brief + brand',
    version: 1,
  };
}

export function getSample(sampleId: string | null | undefined): MarketingSample | null {
  return sampleId ? toSample(sampleId) : null;
}

export function listSamples(family?: TemplateAssetFamily): MarketingSample[] {
  const out: MarketingSample[] = [];
  for (const b of VISUAL_BLUEPRINTS) {
    if (family && !b.supportedFamilies.includes(family)) continue;
    const s = toSample(b.id, family);
    if (s) out.push(s);
  }
  return out;
}

/* ── STEP 5 — Goal-aware sample library. The gallery changes with the goal. ──── */
const GOAL_SAMPLE_CATEGORIES: Record<string, string[]> = {
  'generate-leads': ['marketing', 'modern'],
  'promote-offer': ['marketing', 'photography'],
  'launch-product': ['photography', 'marketing', '3d'],
  'educate-audience': ['illustration', 'ui'],
  'explain-process': ['ui', 'illustration'],
  'present-framework': ['ui', 'modern'],
  'answer-faqs': ['ui', 'illustration'],
  'industry-insight': ['photography', 'modern'],
  'highlight-statistic': ['ui', 'modern'],
  'compare-options': ['ui', 'modern'],
  'customer-success': ['photography', 'modern'],
  'announce-news': ['modern', 'marketing'],
  'company-update': ['modern', 'marketing'],
  'promote-event': ['marketing', 'photography'],
  'brand-awareness': ['photography', 'illustration', 'modern'],
};

/** Build the sample library for a goal (filtered to that goal's visual affinity).
 *  Falls back to the full library when a goal has no mapping or too few matches. */
export function listSamplesForGoal(goalId: string | null | undefined, family?: TemplateAssetFamily): MarketingSample[] {
  const cats = goalId ? GOAL_SAMPLE_CATEGORIES[goalId] : undefined;
  const pool = VISUAL_BLUEPRINTS.filter((b) => (!family || b.supportedFamilies.includes(family)));
  const scoped = cats ? pool.filter((b) => cats.includes(b.visualCategory)) : pool;
  const chosen = scoped.length >= 4 ? scoped : pool;
  return chosen.map((b) => toSample(b.id, family)).filter((s): s is MarketingSample => s !== null);
}

export function sampleCount(): number { return VISUAL_BLUEPRINTS.length; }
