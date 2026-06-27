/**
 * Intelligent Editor Assist — deterministic, read-only (NO AI).
 *
 * Powers in-editor assistance: per-field status + counters, an editor progress
 * panel, an always-visible summary, and click-only smart navigation. Derived
 * ONLY from formDefinition + validateTemplateValues + the ingestion content
 * classifier (+ buildReadinessReport at the call site for live readiness). It
 * measures / validates / guides — it never rewrites, expands, summarises, or
 * autocompletes.
 */

import type { CreatorTemplate, TemplateField } from './types';
import type { TemplateFieldValues } from './values';
import { validateTemplateValues } from './values';
import { ingestContent } from './contentIngestion';

export type FieldStatus = 'complete' | 'attention' | 'required' | 'empty';
export type NavSeverity = 'error' | 'warning' | 'ok';

/** Stable DOM id for a field — shared by the panel (anchor) and navigation. */
export function fieldAnchorId(scope: 'flat' | 'slide' | 'section', key: string, index?: number): string {
  return `tf-${scope}-${typeof index === 'number' ? index : 'x'}-${key}`;
}

/* ── Per-field assessment ────────────────────────────────────────────── */

export interface FieldAssessment {
  status: FieldStatus;
  characters: number;
  maxLength: number | null;
  over: boolean;
  message: string | null;
}

/** Status + length check for a single field. `error` is the matching
 *  validateTemplateValues message (authoritative), if any. */
export function assessField(field: TemplateField, value: string): FieldAssessment {
  const v = String(value ?? '');
  const trimmed = v.trim();
  const characters = v.length;
  const maxLength = field.maxLength ?? null;
  const over = !!maxLength && characters > maxLength;
  let status: FieldStatus;
  if (over) status = 'attention';
  else if (!trimmed) status = field.required ? 'required' : 'empty';
  else status = 'complete';
  const message = over
    ? `Too long — ${characters}/${maxLength}`
    : (!trimmed && field.required ? 'Required' : null);
  return { status, characters, maxLength, over, message };
}

/* ── Content counters (reuse ingestion classification) ───────────────── */

export interface ContentCounts {
  characters: number;
  words: number;
  paragraphs: number;
  bullets: number;
  statistics: number;
  quotes: number;
}

export function countContent(text: string): ContentCounts {
  const t = String(text ?? '');
  const trimmed = t.trim();
  const ing = ingestContent(t);
  return {
    characters: t.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    paragraphs: trimmed ? trimmed.split(/\n{2,}/).filter((s) => s.trim()).length : 0,
    bullets: ing.bullets.length,
    statistics: ing.statistics.length,
    quotes: ing.quotes.length,
  };
}

/* ── Field walk (shared) ─────────────────────────────────────────────── */

export interface FieldCell {
  field: TemplateField;
  value: string;
  scope: 'flat' | 'slide' | 'section';
  index?: number;
  anchorId: string;
  groupLabel: string;
}

export function walkEditorFields(template: CreatorTemplate, values: TemplateFieldValues): FieldCell[] {
  const fd = template.formDefinition;
  const cells: FieldCell[] = [];
  for (const f of fd.fields) {
    cells.push({ field: f, value: String(values.fields[f.key] ?? ''), scope: 'flat', anchorId: fieldAnchorId('flat', f.key), groupLabel: f.label });
  }
  if (fd.slides && values.slides) {
    values.slides.forEach((row, i) => {
      for (const f of fd.slides!.fields) cells.push({ field: f, value: String(row[f.key] ?? ''), scope: 'slide', index: i, anchorId: fieldAnchorId('slide', f.key, i), groupLabel: `Slide ${i + 1}` });
    });
  }
  if (fd.sections && values.sections) {
    values.sections.forEach((row, i) => {
      for (const f of fd.sections!.fields) cells.push({ field: f, value: String(row[f.key] ?? ''), scope: 'section', index: i, anchorId: fieldAnchorId('section', f.key, i), groupLabel: `${fd.sections!.sectionLabel} ${i + 1}` });
    });
  }
  return cells;
}

/* ── Editor progress ─────────────────────────────────────────────────── */

export interface EditorProgress {
  requiredTotal: number;
  requiredCompleted: number;
  requiredRemaining: number;
  optionalTotal: number;
  optionalCompleted: number;
  slidesTotal: number;
  slidesCompleted: number;
  sectionsTotal: number;
  sectionsCompleted: number;
  hasCta: boolean;
  ctaFilled: boolean;
  statistics: number;
  quotes: number;
  /** Overall completion across all fields (0–100). */
  completionPct: number;
  /** Remaining-item labels for the summary. */
  remaining: string[];
}

function isFilled(v: string): boolean { return !!String(v ?? '').trim(); }

export function computeEditorProgress(template: CreatorTemplate, values: TemplateFieldValues): EditorProgress {
  const fd = template.formDefinition;
  const cells = walkEditorFields(template, values);

  let requiredTotal = 0; let requiredCompleted = 0; let optionalTotal = 0; let optionalCompleted = 0;
  let filledFields = 0;
  const remaining: string[] = [];
  for (const c of cells) {
    const filled = isFilled(c.value);
    if (filled) filledFields += 1;
    if (c.field.required) {
      requiredTotal += 1;
      if (filled) requiredCompleted += 1;
      else remaining.push(c.scope === 'flat' ? c.field.label : `${c.groupLabel}: ${c.field.label.toLowerCase()}`);
    } else {
      optionalTotal += 1;
      if (filled) optionalCompleted += 1;
    }
  }

  const slidesTotal = values.slides?.length ?? 0;
  const slidesCompleted = (values.slides ?? []).filter((r) => Object.values(r).some(isFilled)).length;
  const sectionsTotal = values.sections?.length ?? 0;
  const sectionsCompleted = (values.sections ?? []).filter((r) => Object.values(r).some(isFilled)).length;

  // CTA (flat field whose key denotes a call-to-action).
  const ctaField = fd.fields.find((f) => /(^|_)cta($|_)|calltoaction|button/i.test(f.key)) ?? null;
  const hasCta = !!ctaField;
  const ctaFilled = !!ctaField && isFilled(values.fields[ctaField.key] ?? '');

  // Statistics: filled infographic value cells. Quotes: filled quote-class fields.
  const valueField = fd.sections?.fields.find((f) => /value|metric|number|statistic|stat|figure|percent|amount|count/i.test(f.key)) ?? null;
  const statistics = valueField ? (values.sections ?? []).filter((r) => isFilled(r[valueField.key] ?? '')).length : 0;
  const quotes = cells.filter((c) => /quote/i.test(c.field.key) && isFilled(c.value)).length;

  const totalFields = cells.length;
  const completionPct = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 100;

  return {
    requiredTotal,
    requiredCompleted,
    requiredRemaining: requiredTotal - requiredCompleted,
    optionalTotal,
    optionalCompleted,
    slidesTotal,
    slidesCompleted,
    sectionsTotal,
    sectionsCompleted,
    hasCta,
    ctaFilled,
    statistics,
    quotes,
    completionPct,
    remaining,
  };
}

/* ── Smart navigation targets ────────────────────────────────────────── */

export interface FieldNavTarget {
  anchorId: string;
  label: string;
  status: FieldStatus;
  severity: NavSeverity;
}

/**
 * Ordered navigation targets. `error` = a validateTemplateValues failure
 * (required-empty or too-long); `warning` = an empty optional field; `ok` =
 * complete. Used for next/previous-incomplete, first-error, next-warning —
 * all click-only (the panel performs the scroll, never automatically).
 */
export function buildFieldNav(template: CreatorTemplate, values: TemplateFieldValues): FieldNavTarget[] {
  const cells = walkEditorFields(template, values);
  const validation = validateTemplateValues(template, values);
  const hasError = (scope: string, key: string, index?: number): boolean =>
    validation.errors.some((e) => e.scope === scope && e.key === key && e.index === index);

  return cells.map((c) => {
    const a = assessField(c.field, c.value);
    const isError = a.status === 'required' || a.status === 'attention' || hasError(c.scope, c.field.key, c.index);
    const severity: NavSeverity = isError ? 'error' : a.status === 'empty' ? 'warning' : 'ok';
    return {
      anchorId: c.anchorId,
      label: c.scope === 'flat' ? c.field.label : `${c.groupLabel}: ${c.field.label}`,
      status: a.status,
      severity,
    };
  });
}
