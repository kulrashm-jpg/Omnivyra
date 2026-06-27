/**
 * Content Readiness Review — deterministic, read-only analysis (NO AI).
 *
 * Sits between Content Ingestion and the Template Editor. Composes ONLY existing
 * canonical systems (formDefinition + renderingContract via describeTemplatePlan,
 * validateTemplateValues, contentIngestion's field classifier, TemplateFieldValues,
 * the ingestion result) into one report: completeness, structure, quality,
 * distribution, generation-readiness, and actionable guidance. It NEVER rewrites
 * content, generates suggestions, or mutates anything — it only identifies gaps.
 */

import type { CreatorTemplate, TemplateField } from './types';
import type { TemplateFieldValues } from './values';
import { validateTemplateValues } from './values';
import { fieldClass } from './contentIngestion';
import type { IngestionResult } from './contentIngestion';

export type SectionStatus = 'good' | 'attention' | 'blocking';
export type GenerationReadiness = 'READY' | 'ALMOST READY' | 'NOT READY';

export interface StructureCheck { label: string; ok: boolean }

export interface CompletenessReport {
  status: SectionStatus;
  requiredTotal: number;
  requiredFilled: number;
  requiredMissing: string[];
  optionalTotal: number;
  optionalFilled: number;
  optionalEmpty: number;
}
export interface StructureReport {
  status: SectionStatus;
  checks: StructureCheck[];
  issues: string[];
}
export interface QualityReport {
  status: SectionStatus;
  issues: string[];
}
export interface DistributionReport {
  status: SectionStatus;
  slidesTotal: number; slidesFilled: number; slidesEmpty: number;
  sectionsTotal: number; sectionsFilled: number; sectionsEmpty: number;
  mappedCount: number;
  unusedCount: number;
  remainingCapacity: number;
  notes: string[];
}
export interface ReadinessReport {
  overall: GenerationReadiness;
  overallStatus: SectionStatus;
  completeness: CompletenessReport;
  structure: StructureReport;
  quality: QualityReport;
  distribution: DistributionReport;
  guidance: string[];
}

/* ── Field walk ──────────────────────────────────────────────────────── */

interface FieldCell { field: TemplateField; value: string; scope: 'flat' | 'slide' | 'section'; index?: number }

function walkFields(template: CreatorTemplate, values: TemplateFieldValues): FieldCell[] {
  const fd = template.formDefinition;
  const cells: FieldCell[] = [];
  for (const f of fd.fields) cells.push({ field: f, value: String(values.fields[f.key] ?? '').trim(), scope: 'flat' });
  if (fd.slides && values.slides) {
    values.slides.forEach((row, i) => { for (const f of fd.slides!.fields) cells.push({ field: f, value: String(row[f.key] ?? '').trim(), scope: 'slide', index: i }); });
  }
  if (fd.sections && values.sections) {
    values.sections.forEach((row, i) => { for (const f of fd.sections!.fields) cells.push({ field: f, value: String(row[f.key] ?? '').trim(), scope: 'section', index: i }); });
  }
  return cells;
}

function rowFilled(row: Record<string, string> | undefined): boolean {
  return !!row && Object.values(row).some((v) => String(v ?? '').trim());
}
function flatHasClass(template: CreatorTemplate, values: TemplateFieldValues, cls: string): { exists: boolean; filled: boolean } {
  let exists = false; let filled = false;
  for (const f of template.formDefinition.fields) {
    if (fieldClass(f.key) === cls) { exists = true; if (String(values.fields[f.key] ?? '').trim()) filled = true; }
  }
  return { exists, filled };
}

/* ── Section analyses ────────────────────────────────────────────────── */

function analyzeCompleteness(template: CreatorTemplate, values: TemplateFieldValues): CompletenessReport {
  const cells = walkFields(template, values);
  let requiredTotal = 0; let requiredFilled = 0; let optionalTotal = 0; let optionalFilled = 0;
  const requiredMissing: string[] = [];
  for (const c of cells) {
    if (c.field.required) {
      requiredTotal += 1;
      if (c.value) requiredFilled += 1;
      else requiredMissing.push(c.scope === 'flat' ? c.field.label : `${c.scope === 'slide' ? 'Slide' : 'Section'} ${(c.index ?? 0) + 1}: ${c.field.label}`);
    } else {
      optionalTotal += 1;
      if (c.value) optionalFilled += 1;
    }
  }
  const optionalEmpty = optionalTotal - optionalFilled;
  const status: SectionStatus = requiredMissing.length >= 2 ? 'blocking' : (requiredMissing.length === 1 || optionalEmpty > 0) ? 'attention' : 'good';
  return { status, requiredTotal, requiredFilled, requiredMissing, optionalTotal, optionalFilled, optionalEmpty };
}

function analyzeStructure(template: CreatorTemplate, values: TemplateFieldValues): StructureReport {
  const fd = template.formDefinition;
  const checks: StructureCheck[] = [];
  const issues: string[] = [];
  let blocking = false; let attention = false;

  if (fd.slides && values.slides) {
    const total = values.slides.length;
    const filled = values.slides.filter(rowFilled).length;
    const empty = total - filled;
    checks.push({ label: 'Slide content present', ok: filled > 0 });
    checks.push({ label: 'No empty slides', ok: empty === 0 });
    if (filled === 0) { blocking = true; issues.push('No slide has any content.'); }
    else if (empty > 0) { attention = true; issues.push(`${empty} slide${empty === 1 ? '' : 's'} ${empty === 1 ? 'is' : 'are'} empty.`); }
  } else if (fd.sections && values.sections) {
    const total = values.sections.length;
    const filled = values.sections.filter(rowFilled).length;
    const empty = total - filled;
    const title = flatHasClass(template, values, 'title');
    const valueField = fd.sections.fields.find((f) => fieldClass(f.key) === 'value') ?? null;
    const hasStat = !!valueField && values.sections.some((r) => String(r[valueField.key] ?? '').trim());
    checks.push({ label: 'Title available', ok: !title.exists || title.filled });
    checks.push({ label: `Enough ${fd.sections.sectionLabel.toLowerCase()}s`, ok: filled >= fd.sections.min });
    if (valueField) checks.push({ label: 'Statistics available', ok: hasStat });
    if (filled === 0) { blocking = true; issues.push('No section has any content.'); }
    else if (filled < fd.sections.min) { blocking = true; issues.push(`Only ${filled} of the required ${fd.sections.min} ${fd.sections.sectionLabel.toLowerCase()}s have content.`); }
    else if (empty > 0) { attention = true; issues.push(`${empty} ${fd.sections.sectionLabel.toLowerCase()}${empty === 1 ? '' : 's'} ${empty === 1 ? 'is' : 'are'} empty.`); }
    if (title.exists && !title.filled) { attention = true; issues.push('Title is empty.'); }
    if (valueField && !hasStat) { attention = true; issues.push('No statistics provided.'); }
  } else {
    // image / banner
    const headline = flatHasClass(template, values, 'title');
    const body = flatHasClass(template, values, 'body');
    checks.push({ label: 'Headline available', ok: !headline.exists || headline.filled });
    if (body.exists) checks.push({ label: 'Supporting copy available', ok: body.filled });
    if (headline.exists && !headline.filled) { blocking = true; issues.push('Headline is empty.'); }
    if (body.exists && !body.filled) { attention = true; issues.push('Supporting copy is empty.'); }
  }

  const status: SectionStatus = blocking ? 'blocking' : attention ? 'attention' : 'good';
  return { status, checks, issues };
}

function analyzeQuality(template: CreatorTemplate, values: TemplateFieldValues): QualityReport {
  const fd = template.formDefinition;
  const cells = walkFields(template, values);
  const issues: string[] = [];

  // Length (reuse declared maxLength rules).
  for (const c of cells) {
    if (c.field.maxLength && c.value.length > c.field.maxLength) {
      const where = c.scope === 'flat' ? c.field.label : `${c.scope === 'slide' ? 'Slide' : 'Section'} ${(c.index ?? 0) + 1} ${c.field.label.toLowerCase()}`;
      issues.push(`${where} exceeds the recommended length (${c.value.length}/${c.field.maxLength}).`);
    }
  }

  // Count violations (structural) — reuse validateTemplateValues.
  const validation = validateTemplateValues(template, values);
  let blocking = false;
  for (const e of validation.errors) {
    if (e.scope === 'count') { issues.push(e.message); blocking = true; }
  }

  // Duplicates + empties.
  if (fd.slides && values.slides) {
    const titleKey = fd.slides.fields.find((f) => fieldClass(f.key) === 'title')?.key;
    if (titleKey) {
      const titles = values.slides.map((r) => String(r[titleKey] ?? '').trim().toLowerCase()).filter(Boolean);
      if (new Set(titles).size < titles.length) issues.push('Some slide headings are duplicated.');
    }
    const empty = values.slides.filter((r) => !rowFilled(r)).length;
    if (empty > 0) issues.push(`${empty} empty slide${empty === 1 ? '' : 's'}.`);
  }
  if (fd.sections && values.sections) {
    const sig = values.sections.map((r) => Object.values(r).map((v) => String(v ?? '').trim().toLowerCase()).join('|')).filter((s) => s.replace(/\|/g, ''));
    if (new Set(sig).size < sig.length) issues.push('Some sections are duplicated.');
    const empty = values.sections.filter((r) => !rowFilled(r)).length;
    if (empty > 0) issues.push(`${empty} empty ${fd.sections.sectionLabel.toLowerCase()}${empty === 1 ? '' : 's'}.`);
    const valueField = fd.sections.fields.find((f) => fieldClass(f.key) === 'value') ?? null;
    if (valueField && !values.sections.some((r) => String(r[valueField.key] ?? '').trim())) issues.push('No statistics provided.');
  }

  // CTA missing (if the template supports one).
  const cta = flatHasClass(template, values, 'cta');
  if (cta.exists && !cta.filled) issues.push('CTA is missing.');

  const status: SectionStatus = blocking ? 'blocking' : issues.length > 0 ? 'attention' : 'good';
  return { status, issues };
}

function analyzeDistribution(template: CreatorTemplate, values: TemplateFieldValues, ingestion?: IngestionResult): DistributionReport {
  const fd = template.formDefinition;
  const notes: string[] = [];
  let slidesTotal = 0; let slidesFilled = 0; let sectionsTotal = 0; let sectionsFilled = 0;

  if (fd.slides && values.slides) {
    slidesTotal = values.slides.length;
    slidesFilled = values.slides.filter(rowFilled).length;
    notes.push(`${slidesTotal} slide${slidesTotal === 1 ? '' : 's'} available, ${slidesFilled} populated, ${slidesTotal - slidesFilled} empty.`);
  }
  if (fd.sections && values.sections) {
    sectionsTotal = values.sections.length;
    sectionsFilled = values.sections.filter(rowFilled).length;
    notes.push(`${sectionsTotal} ${fd.sections.sectionLabel.toLowerCase()}${sectionsTotal === 1 ? '' : 's'} available, ${sectionsFilled} populated, ${sectionsTotal - sectionsFilled} empty.`);
  }

  const slidesEmpty = slidesTotal - slidesFilled;
  const sectionsEmpty = sectionsTotal - sectionsFilled;
  const remainingCapacity = slidesEmpty + sectionsEmpty;

  const mappedCount = ingestion ? ingestion.mappedTo.reduce((a, m) => a + m.count, 0) : walkFields(template, values).filter((c) => c.value).length;
  const unusedCount = ingestion ? ingestion.unused.length : 0;

  if (ingestion && unusedCount > 0) {
    const byKind = ingestion.unused.reduce<Record<string, number>>((acc, u) => { acc[u.kind] = (acc[u.kind] ?? 0) + 1; return acc; }, {});
    const parts = Object.entries(byKind).map(([k, n]) => `${n} unused ${k}${n === 1 ? '' : 's'}`);
    notes.push(parts.join(', ') + '.');
  }

  const status: SectionStatus = (unusedCount > 0 || remainingCapacity > 0) ? 'attention' : 'good';
  return { status, slidesTotal, slidesFilled, slidesEmpty, sectionsTotal, sectionsFilled, sectionsEmpty, mappedCount, unusedCount, remainingCapacity, notes };
}

/* ── Composition ─────────────────────────────────────────────────────── */

function statusToReadiness(s: SectionStatus): GenerationReadiness {
  return s === 'good' ? 'READY' : s === 'attention' ? 'ALMOST READY' : 'NOT READY';
}

function buildGuidance(c: CompletenessReport, s: StructureReport, q: QualityReport, d: DistributionReport): string[] {
  const out: string[] = [];
  for (const m of c.requiredMissing) out.push(`Add ${m}.`);
  for (const i of s.issues) out.push(i);
  for (const i of q.issues) out.push(i);
  if (d.unusedCount > 0) {
    const paragraphs = d.notes.find((n) => /unused/.test(n));
    if (paragraphs) out.push(paragraphs);
  }
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  return out.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Build the deterministic readiness report. `ingestion` is optional — when given,
 * distribution reflects mapped/unused content; otherwise it reflects the values.
 */
export function buildReadinessReport(template: CreatorTemplate, values: TemplateFieldValues, ingestion?: IngestionResult): ReadinessReport {
  const completeness = analyzeCompleteness(template, values);
  const structure = analyzeStructure(template, values);
  const quality = analyzeQuality(template, values);
  const distribution = analyzeDistribution(template, values, ingestion);

  // Generation readiness rules (pure).
  const reqMissing = completeness.requiredMissing.length;
  const structuralFailure = structure.status === 'blocking' || quality.status === 'blocking';
  let overall: GenerationReadiness;
  if (structuralFailure || reqMissing >= 2) overall = 'NOT READY';
  else if (reqMissing === 1 || (reqMissing === 0 && completeness.optionalEmpty > 0)) overall = 'ALMOST READY';
  else overall = 'READY';

  const overallStatus: SectionStatus = overall === 'READY' ? 'good' : overall === 'ALMOST READY' ? 'attention' : 'blocking';

  return {
    overall,
    overallStatus,
    completeness,
    structure,
    quality,
    distribution,
    guidance: buildGuidance(completeness, structure, quality, distribution),
  };
}

/** Map a section status to its display glyph. */
export function readinessStatusGlyph(s: SectionStatus): '✓' | '!' | '✕' {
  return s === 'good' ? '✓' : s === 'attention' ? '!' : '✕';
}

export { statusToReadiness };
