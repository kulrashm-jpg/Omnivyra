/**
 * Asset Review & Quick Refine — deterministic, read-only analysis (NO AI, NO pixels).
 *
 * Powers the post-generation Asset Review: a family-aware VISUAL checklist and a
 * CONTENT checklist (reusing buildReadinessReport / computeEditorProgress), plus
 * a read-only version timeline. Everything derives from the canonical
 * formDefinition + TemplateFieldValues + existing render metadata — never from
 * inspecting rendered pixels, and never changing generation/rendering. Quick
 * refine itself edits the EXISTING TemplateFieldValues in the editor (handled in
 * the UI); this module only measures and guides.
 */

import type { CreatorTemplate } from './types';
import type { TemplateFieldValues } from './values';
import { fieldClass } from './contentIngestion';
import { buildReadinessReport } from './readinessReview';
import { computeEditorProgress } from './editorAssist';

export interface ChecklistItem { label: string; ok: boolean; detail?: string }

function obj(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}; }
function filled(v: unknown): boolean { return !!String(v ?? '').trim(); }

function flatField(template: CreatorTemplate, cls: string) {
  return template.formDefinition.fields.find((f) => fieldClass(f.key) === cls) ?? null;
}
function flatFilled(template: CreatorTemplate, values: TemplateFieldValues, cls: string): boolean {
  const f = flatField(template, cls);
  return !!f && filled(values.fields[f.key]);
}

/**
 * Family-aware visual checklist derived from the editor values + render metadata.
 * `meta` is the existing render metadata (e.g. diagnostic.rendering / brand). No
 * pixel inspection — only declared structure + recorded metadata.
 */
export function buildVisualChecklist(template: CreatorTemplate, values: TemplateFieldValues, meta?: unknown): ChecklistItem[] {
  const fd = template.formDefinition;
  const m = obj(meta);
  const brandingApplied = filled(m.brandingProfile) || String(m.brand_mode ?? '') === 'brand-aware' || String(m.brandingProfile ?? '') !== '';
  const hasCtaField = !!flatField(template, 'cta');
  const items: ChecklistItem[] = [];

  if (fd.slides) {
    const slides = values.slides ?? [];
    const filledSlides = slides.filter((r) => Object.values(r).some(filled)).length;
    items.push({ label: 'Slide count', ok: filledSlides > 0, detail: `${filledSlides}/${slides.length} slides with content` });
    items.push({ label: 'Cover present', ok: !!slides[0] && Object.values(slides[0]).some(filled) });
    if (hasCtaField) items.push({ label: 'Closing CTA', ok: flatFilled(template, values, 'cta') });
  } else if (fd.sections) {
    const sections = values.sections ?? [];
    const filledSections = sections.filter((r) => Object.values(r).some(filled)).length;
    const valueField = fd.sections.fields.find((f) => fieldClass(f.key) === 'value') ?? null;
    const hasStats = !!valueField && sections.some((r) => filled(r[valueField.key]));
    const titleField = flatField(template, 'title');
    if (titleField) items.push({ label: 'Title', ok: flatFilled(template, values, 'title') });
    items.push({ label: 'Section count', ok: filledSections >= fd.sections.min, detail: `${filledSections}/${sections.length} (min ${fd.sections.min})` });
    if (valueField) items.push({ label: 'Statistics', ok: hasStats });
    if (hasCtaField) items.push({ label: 'CTA', ok: flatFilled(template, values, 'cta') });
  } else {
    items.push({ label: 'Headline present', ok: flatFilled(template, values, 'title') });
    if (hasCtaField) items.push({ label: 'CTA visible', ok: flatFilled(template, values, 'cta') });
    items.push({ label: 'Branding applied', ok: brandingApplied });
  }
  return items;
}

/** Content checklist — reuses the Readiness Review + editor progress (read-only). */
export function buildContentChecklist(template: CreatorTemplate, values: TemplateFieldValues): ChecklistItem[] {
  const r = buildReadinessReport(template, values);
  const p = computeEditorProgress(template, values);
  const fd = template.formDefinition;
  const hasStatField = !!fd.sections?.fields.some((f) => fieldClass(f.key) === 'value');
  const hasQuoteField = [...fd.fields, ...(fd.slides?.fields ?? []), ...(fd.sections?.fields ?? [])].some((f) => /quote/i.test(f.key));

  const items: ChecklistItem[] = [
    { label: 'Required content present', ok: r.completeness.requiredMissing.length === 0, detail: `${r.completeness.requiredFilled}/${r.completeness.requiredTotal}` },
    { label: 'Optional content', ok: r.completeness.optionalEmpty === 0, detail: `${r.completeness.optionalFilled}/${r.completeness.optionalTotal} filled` },
  ];
  if (hasStatField) items.push({ label: 'Statistics', ok: p.statistics > 0, detail: String(p.statistics) });
  if (hasQuoteField) items.push({ label: 'Quotes', ok: p.quotes > 0, detail: String(p.quotes) });
  if (p.hasCta) items.push({ label: 'CTA', ok: p.ctaFilled });
  return items;
}

/* ── Version history (read-only timeline) ────────────────────────────── */

export type VersionKind = 'original' | 'edited' | 'regenerated';
export interface VersionEntry {
  kind: VersionKind;
  label: string;
  timestamp: string | null;
  templateVersion: number | null;
}

export interface VersionHistoryInput {
  createdAt?: string | null;
  templateVersion?: number | null;
  /** True when the editor values differ from what produced the asset. */
  edited?: boolean;
  /** Count of regenerations observed this session (UI-tracked). */
  regenerations?: number;
}

/**
 * Build the read-only version timeline from available metadata. Always includes
 * the Original; appends Regenerated entries (one per observed regenerate) and an
 * Edited entry when the editor values have changed since generation.
 */
export function buildVersionHistory(input: VersionHistoryInput): VersionEntry[] {
  const templateVersion = typeof input.templateVersion === 'number' ? input.templateVersion : null;
  const entries: VersionEntry[] = [{ kind: 'original', label: 'Original', timestamp: input.createdAt ?? null, templateVersion }];
  const regens = Math.max(0, input.regenerations ?? 0);
  for (let i = 1; i <= regens; i += 1) entries.push({ kind: 'regenerated', label: `Regenerated #${i}`, timestamp: null, templateVersion });
  if (input.edited) entries.push({ kind: 'edited', label: 'Edited (current draft)', timestamp: null, templateVersion });
  return entries;
}

/** Summarise a checklist into pass/total for headline status. */
export function checklistScore(items: ChecklistItem[]): { passed: number; total: number; allOk: boolean } {
  const passed = items.filter((i) => i.ok).length;
  return { passed, total: items.length, allOk: items.length > 0 && passed === items.length };
}
