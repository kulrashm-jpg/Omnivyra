/**
 * Creator Template Foundation — form value model + payload projection.
 *
 * Holds the user-entered values for a template's FormDefinition and projects
 * them onto the EXISTING generate payload shapes:
 *   - image      → overlay_text { hook, headline, keyInsight, cta, supportingText }
 *   - carousel   → slides[] { slide_number, title, body }
 *   - infographic→ infographic_sections[] (additive; ingestion staged)
 *
 * Pure — client/server safe. No renderer change: image overlay_text is already
 * consumed by the pipeline; slides/sections ride along additively and are the
 * documented next-phase ingestion point.
 */

import type { CreatorTemplate, TemplateField } from './types';

export interface TemplateFieldValues {
  /** Flat field key → value (image text fields, shared CTA, titles). */
  fields: Record<string, string>;
  /** Carousel: chosen slide count. */
  slideCount?: number;
  /** Carousel: per-slide field maps (length === slideCount). */
  slides?: Array<Record<string, string>>;
  /** Infographic: per-section field maps. */
  sections?: Array<Record<string, string>>;
}

function emptyMap(fields: readonly TemplateField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = '';
  return out;
}

/** Initialise empty values for a template (respecting slide/section defaults). */
export function initTemplateValues(template: CreatorTemplate): TemplateFieldValues {
  const values: TemplateFieldValues = { fields: emptyMap(template.formDefinition.fields) };

  const slides = template.formDefinition.slides;
  if (slides) {
    values.slideCount = slides.defaultCount;
    values.slides = Array.from({ length: slides.defaultCount }, () => emptyMap(slides.fields));
  }

  const sections = template.formDefinition.sections;
  if (sections) {
    values.sections = Array.from({ length: sections.min }, () => emptyMap(sections.fields));
  }

  return values;
}

/** Resize the carousel slide array when the user changes the slide count. */
export function setSlideCount(template: CreatorTemplate, values: TemplateFieldValues, count: number): TemplateFieldValues {
  const slides = template.formDefinition.slides;
  if (!slides) return values;
  const next = Array.from({ length: count }, (_unused, i) => values.slides?.[i] ?? emptyMap(slides.fields));
  return { ...values, slideCount: count, slides: next };
}

/** Add a section row (repeatable infographic groups), respecting `max`. */
export function addSection(template: CreatorTemplate, values: TemplateFieldValues): TemplateFieldValues {
  const sections = template.formDefinition.sections;
  if (!sections) return values;
  const current = values.sections ?? [];
  if (current.length >= sections.max) return values;
  return { ...values, sections: [...current, emptyMap(sections.fields)] };
}

/** Remove a section row, respecting `min`. */
export function removeSection(template: CreatorTemplate, values: TemplateFieldValues, index: number): TemplateFieldValues {
  const sections = template.formDefinition.sections;
  if (!sections) return values;
  const current = values.sections ?? [];
  if (current.length <= sections.min) return values;
  return { ...values, sections: current.filter((_row, i) => i !== index) };
}

/** Validate required fields. Returns a list of missing field labels. */
export function missingRequiredFields(template: CreatorTemplate, values: TemplateFieldValues): string[] {
  const missing: string[] = [];
  for (const f of template.formDefinition.fields) {
    if (f.required && !String(values.fields[f.key] || '').trim()) missing.push(f.label);
  }
  const slides = template.formDefinition.slides;
  if (slides && values.slides) {
    values.slides.forEach((row, i) => {
      for (const f of slides.fields) {
        if (f.required && !String(row[f.key] || '').trim()) missing.push(`Slide ${i + 1}: ${f.label}`);
      }
    });
  }
  const sections = template.formDefinition.sections;
  if (sections && values.sections) {
    values.sections.forEach((row, i) => {
      for (const f of sections.fields) {
        if (f.required && !String(row[f.key] || '').trim()) missing.push(`${sections.sectionLabel} ${i + 1}: ${f.label}`);
      }
    });
  }
  return missing;
}

/* ── Live validation against the template contract (CAMPAIGN-002) ─────── */

export interface TemplateValueError {
  scope: 'flat' | 'slide' | 'section' | 'count';
  /** Field key, or '__count__' for slide/section count errors. */
  key: string;
  index?: number;
  message: string;
}
export interface TemplateValuesValidation {
  ok: boolean;
  errors: TemplateValueError[];
  /** Flat list of human messages (live display). */
  messages: string[];
}

/**
 * Deterministic, contract-driven validation of editor values. Checks required
 * fields, declared field lengths (maxLength), allowed slide count
 * (countOptions), and section count bounds (min/max). Pure — drives both live
 * editor feedback and the save gate. Empty optional fields are valid.
 */
export function validateTemplateValues(template: CreatorTemplate, values: TemplateFieldValues): TemplateValuesValidation {
  const errors: TemplateValueError[] = [];
  const fd = template.formDefinition;
  const check = (f: TemplateField, raw: unknown, scope: TemplateValueError['scope'], index?: number) => {
    const v = String(raw ?? '').trim();
    if (f.required && !v) errors.push({ scope, key: f.key, index, message: `${prefix(scope, index)}${f.label} is required.` });
    if (f.maxLength && v.length > f.maxLength) errors.push({ scope, key: f.key, index, message: `${prefix(scope, index)}${f.label} exceeds ${f.maxLength} characters.` });
  };
  const prefix = (scope: TemplateValueError['scope'], index?: number): string =>
    scope === 'slide' && typeof index === 'number' ? `Slide ${index + 1}: `
      : scope === 'section' && typeof index === 'number' ? `${fd.sections?.sectionLabel ?? 'Section'} ${index + 1}: `
        : '';

  for (const f of fd.fields) check(f, values.fields[f.key], 'flat');

  if (fd.slides) {
    const count = values.slideCount ?? values.slides?.length ?? 0;
    const opts = fd.slides.countOptions;
    if (Array.isArray(opts) && opts.length > 0 && !opts.includes(count)) {
      errors.push({ scope: 'count', key: '__count__', message: `Slide count must be one of ${opts.join(' / ')}.` });
    }
    (values.slides ?? []).forEach((row, i) => { for (const f of fd.slides!.fields) check(f, row[f.key], 'slide', i); });
  }

  if (fd.sections) {
    const n = values.sections?.length ?? 0;
    if (n < fd.sections.min) errors.push({ scope: 'count', key: '__count__', message: `At least ${fd.sections.min} ${fd.sections.sectionLabel.toLowerCase()}(s) required.` });
    if (n > fd.sections.max) errors.push({ scope: 'count', key: '__count__', message: `At most ${fd.sections.max} ${fd.sections.sectionLabel.toLowerCase()}(s) allowed.` });
    (values.sections ?? []).forEach((row, i) => { for (const f of fd.sections!.fields) check(f, row[f.key], 'section', i); });
  }

  return { ok: errors.length === 0, errors, messages: errors.map((e) => e.message) };
}

/* ── Template-switch migration (CAMPAIGN-002) ────────────────────────── */

export interface TemplateMigrationResult {
  values: TemplateFieldValues;
  /** Keys preserved from the previous template (by matching field key). */
  preserved: string[];
  /** Keys dropped because they are not valid for the new template. */
  dropped: string[];
}

/**
 * Deterministically migrate editor values when the user switches templates.
 * Starts from a clean init of the target template, then preserves any value
 * whose field KEY exists in the target (same family group), clamping slide/
 * section counts to the target's contract. Incompatible fields are dropped (not
 * corrupted); missing required slots are left empty for the user to fill.
 */
export function migrateTemplateValues(from: CreatorTemplate, to: CreatorTemplate, values: TemplateFieldValues): TemplateMigrationResult {
  const base = initTemplateValues(to);
  const preserved: string[] = [];
  const dropped: string[] = [];

  // Flat fields — preserve by matching key.
  const toFlatKeys = new Set(to.formDefinition.fields.map((f) => f.key));
  for (const [k, v] of Object.entries(values.fields ?? {})) {
    const val = String(v ?? '').trim();
    if (!val) continue;
    if (toFlatKeys.has(k)) { base.fields[k] = val; preserved.push(`field.${k}`); }
    else dropped.push(`field.${k}`);
  }

  // Slides — only when both templates use slides.
  if (to.formDefinition.slides && from.formDefinition.slides && Array.isArray(values.slides)) {
    const toFields = to.formDefinition.slides.fields.map((f) => f.key);
    const opts = to.formDefinition.slides.countOptions;
    const wanted = values.slideCount ?? values.slides.length;
    const count = opts.includes(wanted) ? wanted : to.formDefinition.slides.defaultCount;
    base.slideCount = count;
    base.slides = Array.from({ length: count }, (_u, i) => {
      const src = values.slides![i] ?? {};
      const row: Record<string, string> = {};
      for (const k of toFields) {
        const val = String(src[k] ?? '').trim();
        row[k] = val;
        if (val) preserved.push(`slide[${i}].${k}`);
      }
      for (const k of Object.keys(src)) if (!toFields.includes(k) && String(src[k] ?? '').trim()) dropped.push(`slide[${i}].${k}`);
      return row;
    });
  } else if (Array.isArray(values.slides) && values.slides.some((r) => Object.values(r).some((v) => String(v ?? '').trim()))) {
    dropped.push('slides');
  }

  // Sections — only when both templates use sections.
  if (to.formDefinition.sections && from.formDefinition.sections && Array.isArray(values.sections)) {
    const cfg = to.formDefinition.sections;
    const toFields = cfg.fields.map((f) => f.key);
    const srcRows = values.sections.slice(0, cfg.max);
    const rows = srcRows.map((src, i) => {
      const row: Record<string, string> = {};
      for (const k of toFields) {
        const val = String(src[k] ?? '').trim();
        row[k] = val;
        if (val) preserved.push(`section[${i}].${k}`);
      }
      for (const k of Object.keys(src)) if (!toFields.includes(k) && String(src[k] ?? '').trim()) dropped.push(`section[${i}].${k}`);
      return row;
    });
    while (rows.length < cfg.min) rows.push(emptyMap(cfg.fields));
    base.sections = rows;
  } else if (Array.isArray(values.sections) && values.sections.some((r) => Object.values(r).some((v) => String(v ?? '').trim()))) {
    dropped.push('sections');
  }

  return { values: base, preserved: Array.from(new Set(preserved)), dropped: Array.from(new Set(dropped)) };
}

/**
 * Merge field-assist updates (from the field-assist endpoint) back into the
 * template values. Only the targeted field(s) change; everything else is
 * preserved. Out-of-range slide/section indices are ignored.
 */
export function applyTemplateFieldUpdates(
  values: TemplateFieldValues,
  updates: Array<{ scope: string; field_key: string; index?: number; value: string }>,
): TemplateFieldValues {
  let fields = values.fields;
  let slides = values.slides;
  let sections = values.sections;
  for (const u of updates) {
    const key = String(u.field_key || '');
    if (!key) continue;
    const value = String(u.value ?? '');
    if (u.scope === 'flat') {
      fields = { ...fields, [key]: value };
    } else if (u.scope === 'slide' && typeof u.index === 'number' && slides && slides[u.index]) {
      slides = slides.map((row, i) => (i === u.index ? { ...row, [key]: value } : row));
    } else if (u.scope === 'section' && typeof u.index === 'number' && sections && sections[u.index]) {
      sections = sections.map((row, i) => (i === u.index ? { ...row, [key]: value } : row));
    }
  }
  return { ...values, fields, slides, sections };
}

/**
 * Project image-family field values onto the existing overlay_text shape the
 * renderer already consumes. Unknown keys are ignored.
 */
export function projectImageOverlayText(template: CreatorTemplate, values: TemplateFieldValues): Record<string, string> {
  const f = values.fields;
  const overlay: Record<string, string> = { hook: '', headline: '', keyInsight: '', cta: '', supportingText: '' };
  if (f.headline) overlay.headline = f.headline.trim();
  if (f.quote) overlay.headline = f.quote.trim();
  if (f.subheadline) overlay.supportingText = f.subheadline.trim();
  if (f.author) overlay.keyInsight = f.author.trim();
  if (f.cta) overlay.cta = f.cta.trim();
  return overlay;
}

/** Project carousel slide values onto the existing slides[] payload shape. */
export function projectCarouselSlides(values: TemplateFieldValues): Array<Record<string, unknown>> {
  if (!values.slides) return [];
  return values.slides.map((row, i) => ({
    slide_number: i + 1,
    title: String(row.title || '').trim(),
    headline: String(row.title || '').trim(),
    body: String(row.body || '').trim(),
    body_text: String(row.body || '').trim(),
  }));
}

/** Project infographic section values onto an additive sections[] payload. */
export function projectInfographicSections(values: TemplateFieldValues): Array<Record<string, string>> {
  if (!values.sections) return [];
  return values.sections.map((row) => ({ ...row }));
}
