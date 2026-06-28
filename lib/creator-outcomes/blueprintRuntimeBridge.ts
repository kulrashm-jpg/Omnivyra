/**
 * Blueprint → Runtime bridge (CREATOR-054 STEP 7 / wired in CREATOR-059 follow-up).
 *
 * The SINGLE place runtime derives visual guidance from a blueprint id — style
 * prompt, image prompt, colour language, layout + typography guidance. No
 * duplicate prompt logic. Pure + deterministic. It does NOT modify the renderer
 * or generation engine; it produces additive `blueprint_*` fields that ride on
 * the existing `creator_card` (the generation seam already accepts an arbitrary
 * record), so the runtime can consume them and legacy paths ignore them.
 */

import { getBlueprint } from './creatorVisualBlueprintRegistry';

export interface BlueprintRuntime {
  blueprintId: string;
  visualCategory: string;
  stylePrompt: string;
  imagePrompt: string;
  colorLanguage: { primary: string; surface: string; contrast: 'high' | 'soft' };
  layoutGuidance: string;
  typographyGuidance: string;
  brandBehavior: string;
}

/** Resolve the canonical runtime visual guidance for a blueprint id. */
export function resolveBlueprintRuntime(blueprintId: string | null | undefined): BlueprintRuntime | null {
  const b = blueprintId ? getBlueprint(blueprintId) : null;
  if (!b) return null;
  return {
    blueprintId: b.id,
    visualCategory: b.visualCategory,
    stylePrompt: b.stylePrompt,
    imagePrompt: b.imagePrompt,
    colorLanguage: { primary: b.colorRules.primary, surface: b.colorRules.surface, contrast: b.colorRules.contrast },
    layoutGuidance: `${b.layoutRules.composition} composition · ${b.layoutRules.density} density · CTA ${b.layoutRules.ctaPlacement}`,
    typographyGuidance: `${b.typographyRules.weight} ${b.typographyRules.family} · ${b.typographyRules.case} case`,
    brandBehavior: b.brandCompatibility,
  };
}

/**
 * Additive `creator_card` fields derived from a blueprint id. Prefixed `blueprint_`
 * so they never collide with template/renderingContract fields and are safe for
 * legacy paths to ignore. Returns {} when no blueprint — a no-op merge.
 */
export function blueprintCreatorCardFields(blueprintId: string | null | undefined): Record<string, unknown> {
  const r = resolveBlueprintRuntime(blueprintId);
  if (!r) return {};
  return {
    blueprint_id: r.blueprintId,
    blueprint_visual_category: r.visualCategory,
    blueprint_style_prompt: r.stylePrompt,
    blueprint_image_prompt: r.imagePrompt,
    blueprint_color_primary: r.colorLanguage.primary,
    blueprint_color_surface: r.colorLanguage.surface,
    blueprint_color_contrast: r.colorLanguage.contrast,
    blueprint_layout_guidance: r.layoutGuidance,
    blueprint_typography_guidance: r.typographyGuidance,
    blueprint_brand_behavior: r.brandBehavior,
  };
}

/**
 * Merge blueprint guidance into a creator_card WITHOUT overwriting existing keys
 * (template/renderingContract values always win). Pure; safe no-op when absent.
 */
export function mergeBlueprintIntoCreatorCard(creatorCard: Record<string, unknown>, blueprintId?: string | null): Record<string, unknown> {
  const id = (typeof blueprintId === 'string' && blueprintId) || (typeof creatorCard.blueprint_id === 'string' ? creatorCard.blueprint_id as string : null);
  const fields = blueprintCreatorCardFields(id);
  if (Object.keys(fields).length === 0) return creatorCard;
  return { ...fields, ...creatorCard };   // existing creator_card keys take precedence
}
