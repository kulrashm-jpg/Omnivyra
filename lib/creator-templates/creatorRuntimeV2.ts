/**
 * Creator Runtime v2 (CREATOR-PROD-001). The deterministic runtime composition
 * the feature flag gates — it ONLY chains the already-built, frozen modules:
 *
 *   content → editorRuntime (Asset Assembly + Template Population)
 *           → Asset Size Recommendation
 *           → Template Variant Resolver
 *           → Population Projection Bridge
 *           → editorRuntime generate payload
 *
 * No new runtime logic, no planner called directly, no duplicate engine. Pure +
 * deterministic. `shadowCompare` produces a parity report vs the legacy payload
 * (log-only — never changes behaviour). `runShadow` is the safe best-effort
 * wrapper the live generate route calls: it NEVER throws and NEVER affects the
 * response.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import type { TemplateFieldValues } from './values';
import { liveContentToEditorState, editorStateToGeneratePayload } from './creatorRuntimeBridge';
import { recommendAssetSize, type AssetSizeRecommendation } from './assetSizeRecommendation';
import { resolveTemplateVariant, derivableSlideCounts, type ResolvedTemplate } from './templateVariantResolver';
import { projectPopulation, validateProjection, type ProjectedTemplatePopulation } from './populationProjectionBridge';
import { createEditorState, effectivePopulation } from './editorRuntime';
import { runTypographyGate, type GeneratePayloadFragment } from './creatorRuntimeBridge';

export interface RuntimeV2Input {
  template: CreatorTemplate;
  sourceText: string;
  existingValues?: TemplateFieldValues;
  requestedFamily?: TemplateAssetFamily;
}

export interface RuntimeV2Result {
  recommendation: AssetSizeRecommendation;
  resolved: ResolvedTemplate;
  projected: ProjectedTemplatePopulation;
  payload: GeneratePayloadFragment;
  projectionValid: boolean;
  typographyStatus: string;
}

/** The deterministic runtime — chains the frozen modules end to end. */
export function runCreatorRuntimeV2(input: RuntimeV2Input): RuntimeV2Result {
  const editorState = liveContentToEditorState({ template: input.template, sourceText: input.sourceText, existingValues: input.existingValues });
  const assembly = editorState.assembly;
  // EFFECTIVE population — canonical AUTO values with the user's MANUAL overrides
  // applied (so user-typed content flows through; CREATOR-PROD-004).
  const population = effectivePopulation(editorState);
  const family = input.requestedFamily ?? input.template.assetFamily;

  const recommendation = recommendAssetSize(assembly ?? ({ assets: [] } as never), {
    requestedFamily: family,
    slideCountOptions: derivableSlideCounts(input.template),
    sectionMin: input.template.formDefinition.sections?.min,
    sectionMax: input.template.formDefinition.sections?.max,
  });
  const resolved = resolveTemplateVariant({ recommendation, requestedTemplate: input.template });
  const projected = projectPopulation(population, resolved.template);
  const projectedState = createEditorState(projected, assembly);
  const payload = editorStateToGeneratePayload(projectedState, resolved.template);
  const typography = runTypographyGate(projectedState, resolved.template);

  return {
    recommendation,
    resolved,
    projected,
    payload,
    projectionValid: validateProjection(projected, resolved.template).ok,
    typographyStatus: typography.status,
  };
}

/* ── Parity comparison (STEP 6/7) — log-only, never mutates ─────────────── */

export interface ParityReport {
  match: boolean;
  fieldMismatches: Array<{ key: string; legacy: unknown; v2: unknown }>;
  slideCountLegacy: number;
  slideCountV2: number;
  sectionCountLegacy: number;
  sectionCountV2: number;
  recommendation: string;
  resolution: string;
}

/** The RENDERER-FACING text only (what the renderer actually overlays). The
 * `template_fields` block and the `__template_authoritative` marker are auxiliary
 * and excluded from parity. */
function rendererOverlay(payload: GeneratePayloadFragment): Record<string, unknown> {
  const overlay = { ...(payload.overlay_text ?? {}) } as Record<string, unknown>;
  delete overlay.__template_authoritative;
  return overlay;
}

export function shadowCompare(legacyPayload: GeneratePayloadFragment, v2: RuntimeV2Result): ParityReport {
  const lo = rendererOverlay(legacyPayload);
  const vo = rendererOverlay(v2.payload);
  const fieldMismatches: ParityReport['fieldMismatches'] = [];
  for (const key of new Set([...Object.keys(lo), ...Object.keys(vo)])) {
    if (JSON.stringify(lo[key]) !== JSON.stringify(vo[key])) fieldMismatches.push({ key, legacy: lo[key], v2: vo[key] });
  }
  // Slides / sections compared structurally (count) + content.
  const lSlides = Array.isArray(legacyPayload.slides) ? legacyPayload.slides : [];
  const vSlides = Array.isArray(v2.payload.slides) ? v2.payload.slides : [];
  const lSections = Array.isArray(legacyPayload.infographic_sections) ? legacyPayload.infographic_sections : [];
  const vSections = Array.isArray(v2.payload.infographic_sections) ? v2.payload.infographic_sections : [];
  if (JSON.stringify(lSlides) !== JSON.stringify(vSlides)) fieldMismatches.push({ key: 'slides', legacy: lSlides.length, v2: vSlides.length });
  if (JSON.stringify(lSections) !== JSON.stringify(vSections)) fieldMismatches.push({ key: 'sections', legacy: lSections.length, v2: vSections.length });
  return {
    match: fieldMismatches.length === 0,
    fieldMismatches,
    slideCountLegacy: lSlides.length, slideCountV2: vSlides.length,
    sectionCountLegacy: lSections.length, sectionCountV2: vSections.length,
    recommendation: v2.recommendation.recommendedVariantLabel,
    resolution: v2.resolved.resolution,
  };
}

/* ── Safe best-effort shadow hook for the live route ───────────────────── */

export interface ShadowHookInput {
  template: CreatorTemplate | null;
  sourceText: string;
  legacyPayload: GeneratePayloadFragment;
  requestedFamily?: TemplateAssetFamily;
  /** User-authored values (from the request) seeded as MANUAL overrides. */
  existingValues?: TemplateFieldValues;
}

/* ── Recover user-typed values from the request (CREATOR-PROD-004) ─────── */

// Inverse of the renderer projectors (projectImageOverlayText / slides / sections):
// the request carries the PROJECTED user content; map it back to template field
// values so editorRuntime can seed them as MANUAL overrides.
const OVERLAY_TO_FIELD: Record<string, string> = {
  headline: 'headline', subheadline: 'supportingText', body: 'supportingText',
  cta: 'cta', quote: 'headline', author: 'keyInsight',
};

export function extractExistingValues(creatorCard: Record<string, unknown>, template: CreatorTemplate): TemplateFieldValues {
  const overlay = (creatorCard.overlay_text && typeof creatorCard.overlay_text === 'object' ? creatorCard.overlay_text : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const f of template.formDefinition.fields) {
    const overlayKey = OVERLAY_TO_FIELD[f.key] ?? f.key;
    const v = overlay[overlayKey];
    if (typeof v === 'string' && v.trim()) fields[f.key] = v.trim();
  }
  const out: TemplateFieldValues = { fields };
  if (template.assetFamily === 'carousel' && Array.isArray(creatorCard.slides)) {
    out.slides = (creatorCard.slides as Array<Record<string, unknown>>).map((r) => ({ title: String(r.title ?? '').trim(), body: String(r.body ?? '').trim() }));
    out.slideCount = out.slides.length;
  }
  if (template.assetFamily === 'infographic' && Array.isArray(creatorCard.infographic_sections)) {
    out.sections = (creatorCard.infographic_sections as Array<Record<string, string>>).map((r) => ({ ...r }));
  }
  return out;
}

/**
 * Run the deterministic runtime SILENTLY and return a parity report. NEVER
 * throws — on any failure it returns a skip report. The caller logs the result;
 * the user-visible response is never affected. (STEP 7 shadow mode.)
 */
export function runShadow(input: ShadowHookInput): { ran: boolean; skipReason?: string; parity?: ParityReport } {
  try {
    if (!input.template) return { ran: false, skipReason: 'no_resolved_template' };
    if (!input.sourceText || !input.sourceText.trim()) return { ran: false, skipReason: 'no_source_text' };
    const v2 = runCreatorRuntimeV2({ template: input.template, sourceText: input.sourceText, requestedFamily: input.requestedFamily, existingValues: input.existingValues });
    return { ran: true, parity: shadowCompare(input.legacyPayload, v2) };
  } catch (e) {
    return { ran: false, skipReason: `shadow_error:${(e as Error).message}` };
  }
}

/* ── Route-friendly extraction (CREATOR-PROD-002) ──────────────────────── */

/** Map the live request's contentType onto a template asset family. */
function familyFromContentType(contentType: string): TemplateAssetFamily {
  const c = (contentType || '').trim().toLowerCase();
  if (c === 'carousel' || c === 'slider' || c === 'pdf') return 'carousel';
  if (c === 'infographic') return 'infographic';
  return 'image'; // image / banner / brand_card → image
}

export interface ShadowDiagnostics {
  ran: boolean;
  skipReason?: string;
  parityMatch?: boolean;
  fieldMismatchCount?: number;
  slideCountLegacy?: number;
  slideCountV2?: number;
  sectionCountLegacy?: number;
  sectionCountV2?: number;
  recommendation?: string;
  resolution?: string;
  templateId?: string;
  family: string;
  durationMs: number;
}

/**
 * The SINGLE function the live `generate.ts` route calls (once, flag-gated). It
 * resolves the template + extracts the canonical inputs from the request and
 * runs the deterministic runtime in shadow. NEVER throws. Returns diagnostics
 * only (no asset data, no user content) — the caller logs them. `now` is
 * injectable for deterministic tests.
 */
export function shadowFromRequest(
  input: { creatorCard: Record<string, unknown>; contentType: string; topic: string },
  resolveTemplate: (id: string, family: TemplateAssetFamily) => CreatorTemplate | null,
  now: () => number = () => Date.now(),
): ShadowDiagnostics {
  const family = familyFromContentType(input.contentType);
  const start = now();
  try {
    const card = input.creatorCard;
    const templateId = typeof card.template_id === 'string' ? card.template_id : '';
    const template = templateId ? resolveTemplate(templateId, family) : null;
    const sourceContent = (card.source_content && typeof card.source_content === 'object' ? card.source_content : {}) as Record<string, unknown>;
    const sourceText = String((typeof sourceContent.snippet === 'string' ? sourceContent.snippet : '') || input.topic || '').trim();

    const overlay = (card.overlay_text && typeof card.overlay_text === 'object' ? card.overlay_text : undefined) as Record<string, unknown> | undefined;
    const legacyPayload: GeneratePayloadFragment = {
      overlay_text: overlay,
      slides: Array.isArray(card.slides) ? (card.slides as Array<Record<string, unknown>>) : undefined,
      infographic_sections: Array.isArray(card.infographic_sections) ? (card.infographic_sections as Array<Record<string, string>>) : undefined,
      template_fields: (overlay ?? {}) as Record<string, string>,
    };

    // Seed the user's authored values as MANUAL so typed flows preserve content.
    const existingValues = template ? extractExistingValues(card, template) : undefined;
    const res = runShadow({ template, sourceText, legacyPayload, requestedFamily: family, existingValues });
    const durationMs = now() - start;
    if (!res.ran || !res.parity) return { ran: false, skipReason: res.skipReason, family, templateId: templateId || undefined, durationMs };
    const p = res.parity;
    return {
      ran: true, parityMatch: p.match, fieldMismatchCount: p.fieldMismatches.length,
      slideCountLegacy: p.slideCountLegacy, slideCountV2: p.slideCountV2,
      sectionCountLegacy: p.sectionCountLegacy, sectionCountV2: p.sectionCountV2,
      recommendation: p.recommendation, resolution: p.resolution,
      templateId: templateId || undefined, family, durationMs,
    };
  } catch (e) {
    return { ran: false, skipReason: `shadow_extract_error:${(e as Error).message}`, family, durationMs: now() - start };
  }
}
