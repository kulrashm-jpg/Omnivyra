/**
 * Content Contract Validation — deterministic check that GENERATED content
 * conforms to the selected template's rendering contract + form definition,
 * run BEFORE rendering. Pure, no AI, no DB, no renderer/generation change.
 *
 * It validates only the structurally-checkable contract — the count and shape
 * the template declares — using ONLY `renderingContract` + `formDefinition`:
 *   - carousel    : slides[] count ∈ countOptions/frameCount; required slide field filled
 *   - infographic : section/item count ∈ [min,max]; required title present
 *   - image/banner: required on-image text field present
 *
 * Semantic "flow" (educational / chronological / comparison narrative) is NOT
 * asserted here — that is not deterministically verifiable without AI, which is
 * out of scope. The selected template already drives that flow through the
 * contract inputs (purposeKey / infographicLayout / frameCount / formDefinition)
 * that reach planning; this gate enforces the structural contract.
 */

import type { CreatorTemplate } from './types';

export interface ContentValidationResult {
  ok: boolean;
  errors: string[];
}

type Rec = Record<string, unknown>;
function obj(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}
function arr(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).map((x) => x as Rec) : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/**
 * Validate a generated `asset_payload` against the template contract. Returns
 * explicit, deterministic errors. The caller rejects generation (before render)
 * when `ok === false`.
 */
export function validateGeneratedContentAgainstTemplate(template: CreatorTemplate, assetPayload: unknown): ContentValidationResult {
  const errors: string[] = [];
  const payload = obj(assetPayload);
  const md = obj(obj(payload.media_bundle).metadata);
  const fd = template.formDefinition;

  if (template.assetFamily === 'carousel') {
    const slides = arr(payload.slides);
    if (slides.length === 0) {
      errors.push('Carousel generated no slides.');
    } else {
      // Generated slide count must match the count the template/plan requested
      // (catches truncated/over-produced generation). `countOptions` is a
      // selection-time UI constraint, not a generated-content property.
      const requestedRaw = (typeof md.slide_count === 'number' ? md.slide_count
        : typeof payload.slide_count === 'number' ? payload.slide_count : null);
      const requested = requestedRaw != null && requestedRaw > 0 ? requestedRaw : null;
      if (requested && slides.length !== requested) {
        errors.push(`Carousel generated ${slides.length} slide(s) but the template/plan requested ${requested}.`);
      }
      const requiredSlideField = (fd.slides?.fields ?? []).find((f) => f.required)?.key ?? null;
      if (requiredSlideField) {
        slides.forEach((s, i) => {
          const title = str(s.title) || str(s.headline);
          if (!title) errors.push(`Slide ${i + 1} is missing its required "${requiredSlideField}".`);
        });
      }
    }
  } else if (template.assetFamily === 'infographic') {
    const tvt = obj(md.thread_visual_transform);
    const items = (Array.isArray(tvt.items) ? tvt.items : []).map((x) => str(x)).filter((x) => x.length > 0);
    const sectionsCfg = fd.sections;
    if (sectionsCfg && items.length > 0) {
      if (items.length < sectionsCfg.min) errors.push(`Infographic has ${items.length} section(s); this template requires at least ${sectionsCfg.min}.`);
      if (items.length > sectionsCfg.max) errors.push(`Infographic has ${items.length} section(s); this template allows at most ${sectionsCfg.max}.`);
    }
    const requiresTitle = fd.fields.some((f) => f.required);
    const title = str(md.topic) || str(obj(payload.visual_descriptor).headline) || str(obj(md.overlay_text).headline);
    if (requiresTitle && !title) errors.push('Infographic is missing its required title.');
  } else {
    // image / banner — required on-image text field must be present.
    const overlay = { ...obj(payload.overlay_text), ...obj(md.overlay_text) };
    const requiresText = fd.fields.some((f) => f.required && (f.control === 'text' || f.control === 'textarea'));
    const hasText = str(overlay.headline) || str(overlay.quote) || str(overlay.keyInsight);
    if (requiresText && !hasText) errors.push('Image is missing its required on-image text.');
  }

  return { ok: errors.length === 0, errors };
}
