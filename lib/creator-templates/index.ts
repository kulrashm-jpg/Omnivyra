/**
 * Creator Template Foundation — query + resolution helpers.
 *
 * Client- and server-safe (pure, no DB/fetch). Wraps the in-code system
 * template registry. When the persistence phase adds user/AI templates, the
 * DB-backed lookups slot in BEHIND these helpers without changing callers.
 */

import {
  type CreatorTemplate,
  type TemplateAssetFamily,
  type TemplateCategory,
  isTemplateAssetFamily,
} from './types';
import { SYSTEM_TEMPLATES, ALL_SYSTEM_TEMPLATES } from './systemTemplates';
import { DEFAULT_INFOGRAPHIC_STYLE, type InfographicStyleSchema } from './infographicStyle';
import { DEFAULT_IMAGE_STYLE, type ImageStyleSchema } from './imageStyle';
import { DEFAULT_CAROUSEL_STYLE, type CarouselStyleSchema } from './carouselStyle';
import { validateGeneratedContentAgainstTemplate, type ContentValidationResult } from './contentContract';

export * from './types';
export * from './infographicStyle';
export * from './imageStyle';
export * from './carouselStyle';
export { SYSTEM_TEMPLATES, ALL_SYSTEM_TEMPLATES } from './systemTemplates';
export * from './styleVariants';
export * from './styleSerialization';
export * from './templateGovernance';
export * from './contentContract';
export * from './values';
export * from './plannerContract';
export * from './templateRecommendation';
export * from './autoSelection';
export * from './operationalHealth';
export * from './previewExamples';
export * from './templateBlueprint';
export * from './creatorStageRequirements';
export * from './contentIngestion';
export * from './readinessReview';
export * from './editorAssist';
export * from './generationReview';
export * from './assetReview';
export * from './campaignPackage';
export * from './campaignPackageHandoff';
export * from './creatorPackageBridge';

/* ── User-template runtime registry ──────────────────────────────────────
 * User templates REUSE the canonical CreatorTemplate model (ownership: 'user').
 * They are registered at runtime — loaded from storage by the app/service layer
 * and registered into THIS one registry — so getTemplateById() / resolveTemplate()
 * resolve them IDENTICALLY to system templates (one resolver, one model, one
 * rendering pipeline). The registry is empty by default, so system-template
 * resolution and all existing behavior remain byte-identical.
 */
const userTemplateRegistry = new Map<string, CreatorTemplate>();

/** Register (or replace) a user template so it resolves like a system template. */
export function registerUserTemplate(template: CreatorTemplate): void {
  if (template && typeof template.id === 'string' && template.id.trim()) {
    userTemplateRegistry.set(template.id.trim(), template);
  }
}
/** Register many user templates at once. */
export function registerUserTemplates(templates: readonly CreatorTemplate[]): void {
  for (const t of templates) registerUserTemplate(t);
}
/** Remove a user template from the runtime registry. */
export function unregisterUserTemplate(id: string): void {
  userTemplateRegistry.delete(String(id || '').trim());
}
/** Clear the runtime registry (test isolation / context resets). */
export function clearUserTemplateRegistry(): void {
  userTemplateRegistry.clear();
}
/** All currently-registered user templates. */
export function listRegisteredUserTemplates(): CreatorTemplate[] {
  return Array.from(userTemplateRegistry.values());
}

/** Every template for a family (system only, this phase). */
export function listTemplatesForFamily(family: TemplateAssetFamily): CreatorTemplate[] {
  return [...SYSTEM_TEMPLATES[family]];
}

/** Distinct categories present for a family, in first-seen order. */
export function listCategoriesForFamily(family: TemplateAssetFamily): TemplateCategory[] {
  const seen = new Set<string>();
  const out: TemplateCategory[] = [];
  for (const t of SYSTEM_TEMPLATES[family]) {
    if (seen.has(t.category)) continue;
    seen.add(t.category);
    out.push({ key: t.category, label: t.category, family });
  }
  return out;
}

/** Resolve a template by id. Family is optional but, when given, must match. */
export function getTemplateById(id: string, family?: TemplateAssetFamily): CreatorTemplate | null {
  const normalized = String(id || '').trim();
  if (!normalized) return null;
  // System templates (in-code) first, then runtime-registered user templates —
  // resolved through the SAME path so a user template behaves like a system one.
  const found = ALL_SYSTEM_TEMPLATES.find((t) => t.id === normalized)
    ?? userTemplateRegistry.get(normalized)
    ?? null;
  if (!found) return null;
  if (family && found.assetFamily !== family) return null;
  return found;
}

/**
 * Resolve the infographic visual-language schema for a template. Returns the
 * template's own style when present, otherwise the canonical default (the
 * faithful encoding of current production constants). This is the single home
 * of the infographic family's visual language.
 */
export function resolveInfographicStyle(template: CreatorTemplate | null): InfographicStyleSchema {
  return template?.infographicStyle ?? DEFAULT_INFOGRAPHIC_STYLE;
}

/** Resolve the image visual-language schema (template's own, else canonical default). */
export function resolveImageStyle(template: CreatorTemplate | null): ImageStyleSchema {
  return template?.imageStyle ?? DEFAULT_IMAGE_STYLE;
}

/** Resolve the carousel visual-language schema (template's own, else canonical default). */
export function resolveCarouselStyle(template: CreatorTemplate | null): CarouselStyleSchema {
  return template?.carouselStyle ?? DEFAULT_CAROUSEL_STYLE;
}

/** Output of the unified, family-dispatching template resolver. */
export interface ResolvedTemplate {
  /** The matched canonical template, or null when none matched. */
  template: CreatorTemplate | null;
  /** Asset family resolved (from the template, or the requested `family`). */
  family: TemplateAssetFamily | null;
  /** True when `templateId` matched a registry entry. */
  matched: boolean;
  /** Provenance for telemetry. */
  source: 'registry' | 'default';
  /** Infographic family ONLY — the visual-language schema (defaulted). Null otherwise. */
  infographicStyle: InfographicStyleSchema | null;
  /** Image/banner family ONLY — the visual-language schema (defaulted). Null otherwise. */
  imageStyle: ImageStyleSchema | null;
  /** Carousel/slider/pdf family ONLY — the visual-language schema (defaulted). Null otherwise. */
  carouselStyle: CarouselStyleSchema | null;
}

/**
 * The ONE canonical template resolver. Dispatches by asset family rather than
 * routing to separate per-family template systems:
 *
 *   - resolves the canonical `CreatorTemplate` by id (back-compat: existing
 *     `sys-*` identifiers continue to work),
 *   - attaches the family's visual-language schema (defaulted): infographic →
 *     `infographicStyle`, image/banner → `imageStyle`, carousel/slider/pdf →
 *     `carouselStyle`. Non-matching family fields are null.
 *
 * Total + deterministic — never throws. Absent/blank/unknown id with a
 * `family` hint still resolves that family's defaults (e.g. the default
 * infographic style), preserving "no template selected → current look".
 */
export function resolveTemplate(
  templateId: string | null | undefined,
  opts: { family?: TemplateAssetFamily | null } = {},
): ResolvedTemplate {
  const template = getTemplateById(String(templateId ?? '').trim(), opts.family ?? undefined);
  const matched = template !== null;
  const family = template?.assetFamily ?? opts.family ?? null;
  return {
    template,
    family,
    matched,
    source: matched ? 'registry' : 'default',
    infographicStyle: family === 'infographic' ? resolveInfographicStyle(template) : null,
    imageStyle: family === 'image' ? resolveImageStyle(template) : null,
    carouselStyle: family === 'carousel' ? resolveCarouselStyle(template) : null,
  };
}

/**
 * Map the creator page's URL `type` param onto a template asset family.
 * Returns null for non-template types (post/thread/video/etc.) so the
 * template gallery only engages for image/carousel/infographic.
 */
export function familyForCreatorType(type: string | null | undefined): TemplateAssetFamily | null {
  const t = String(type || '').trim().toLowerCase();
  // Consolidation aliases — banner renders through the image family,
  // slider through the carousel family (mirrors the creator page redirects).
  if (t === 'image' || t === 'banner') return 'image';
  if (t === 'carousel' || t === 'slider') return 'carousel';
  if (t === 'infographic') return 'infographic';
  return isTemplateAssetFamily(t) ? t : null;
}

/**
 * Project a template onto the EXISTING `creator_card` inputs the generate
 * route already understands. This is the entire "rendering contract → renderer"
 * seam for this phase — NO renderer change. Callers spread this over the
 * creator_card they already build.
 *
 * Only non-null fields are returned so this never clobbers existing values
 * with nulls when a template doesn't drive a given input.
 */
export function resolveTemplateCreatorCardPatch(template: CreatorTemplate): Record<string, unknown> {
  const c = template.renderingContract;
  const patch: Record<string, unknown> = {
    template_id: template.id,
    template_version: template.version,
    template_asset_family: template.assetFamily,
    template_category: template.category,
  };
  if (c.purposeKey) patch.purpose_key = c.purposeKey;
  if (c.subtype) patch.subtype = c.subtype;
  if (c.infographicLayout) patch.infographic_layout = c.infographicLayout;
  if (c.attachmentMode) patch.attachment_mode = c.attachmentMode;
  // Renderer-lane selection — text image templates route to the text-capable
  // 'banner' lane; logo/no-text route to 'supporting_image'. Drives both the
  // generate route's attachment-mode resolution and the renderer dispatch so
  // declared on-image text actually renders.
  if (c.writerAssetType) patch.writer_asset_type = c.writerAssetType;
  if (typeof c.frameCount === 'number') patch.slide_count = c.frameCount;
  return patch;
}

/**
 * Gate generated content against the SELECTED template's contract, before
 * rendering. Resolves the template_id carried on the asset payload (same field
 * order as the renderer's templateIdForRender) and validates the generated
 * content structurally. Non-template payloads (no/unknown template_id) return
 * `{ matched: false, ok: true }` — a strict no-op, so existing flows are
 * unaffected. Deterministic; no AI.
 */
export function validateAssetPayloadAgainstTemplate(
  assetPayload: unknown,
): { matched: boolean; ok: boolean; errors: string[] } {
  const payload = (assetPayload && typeof assetPayload === 'object' ? assetPayload : {}) as Record<string, unknown>;
  const bundle = (payload.media_bundle && typeof payload.media_bundle === 'object' ? payload.media_bundle : {}) as Record<string, unknown>;
  const md = (bundle.metadata && typeof bundle.metadata === 'object' ? bundle.metadata : {}) as Record<string, unknown>;
  const card = (md.creator_card && typeof md.creator_card === 'object' ? md.creator_card : {}) as Record<string, unknown>;
  const raw = md.template_id ?? md.infographic_template_id ?? card.template_id;
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return { matched: false, ok: true, errors: [] };
  const template = getTemplateById(id);
  if (!template) return { matched: false, ok: true, errors: [] };
  const result: ContentValidationResult = validateGeneratedContentAgainstTemplate(template, assetPayload);
  return { matched: true, ok: result.ok, errors: result.errors };
}
