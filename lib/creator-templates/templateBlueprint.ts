/**
 * Template Content Blueprint — deterministic, NO AI.
 *
 * Answers "what will this create?", "what information do I need?", and "how much
 * work is involved?" BEFORE the editor opens. Derived entirely from the canonical
 * `formDefinition` + `renderingContract` (via `describeTemplatePlan`). Reuses the
 * existing metadata models — no new metadata model, no generation/rendering/
 * planner/governance change.
 */

import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from './types';
import type { TemplateFieldValues } from './values';
import { describeTemplatePlan } from './plannerContract';

export interface BlueprintField {
  key: string;
  label: string;
  scope: 'flat' | 'slide' | 'section';
}
export interface BlueprintStep {
  label: string;
  kind: 'cover' | 'slide' | 'section' | 'headline' | 'support' | 'cta' | 'closing' | 'title' | 'visual';
}
export type EditingEffort = 'Low' | 'Medium' | 'High';
export type Readiness = 'Ready' | 'Almost Ready' | 'Needs More Content';

export interface TemplateBlueprint {
  templateId: string;
  family: TemplateAssetFamily;
  /** Plain-English deliverable (e.g. "Statistics Infographic"). */
  deliverable: string;
  /** 'slides' | 'sections' | null (single-visual). */
  unitLabel: 'slides' | 'sections' | null;
  /** Representative unit count for the flow. */
  unitCount: number | null;
  /** Allowed range, e.g. "5 / 7 / 10" (slides) or "2–6" (sections). */
  unitRange: string | null;
  requiredFields: BlueprintField[];
  optionalFields: BlueprintField[];
  hasCTA: boolean;
  editingEffort: EditingEffort;
  /** Deterministic time estimate (minutes). */
  estimatedMinutes: number;
  /** Visual structure flow (cover → … → cta). */
  structure: BlueprintStep[];
}

function familyNoun(family: TemplateAssetFamily, isBanner: boolean): string {
  if (family === 'carousel') return 'Carousel';
  if (family === 'infographic') return 'Infographic';
  return isBanner ? 'Banner' : 'Image';
}
function bp(f: TemplateField, scope: BlueprintField['scope']): BlueprintField {
  return { key: f.key, label: f.label, scope };
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function hasField(fields: TemplateField[], ...keys: string[]): boolean {
  return fields.some((f) => keys.includes(f.key));
}

function buildStructure(t: CreatorTemplate, hasCTA: boolean, unitCount: number | null): BlueprintStep[] {
  const fd = t.formDefinition;
  if (t.assetFamily === 'carousel') {
    const n = Math.max(1, unitCount ?? fd.slides?.defaultCount ?? 5);
    if (n <= 2) return Array.from({ length: n }, (_v, i) => ({ label: `Slide ${i + 1}`, kind: 'slide' as const }));
    const middle = Array.from({ length: n - 2 }, (_v, i) => ({ label: `Slide ${i + 2}`, kind: 'slide' as const }));
    return [{ label: 'Cover', kind: 'cover' }, ...middle, { label: 'Closing', kind: 'closing' }];
  }
  if (t.assetFamily === 'infographic') {
    const m = Math.max(1, unitCount ?? fd.sections?.min ?? 3);
    const sections = Array.from({ length: m }, (_v, i) => ({ label: `Section ${i + 1}`, kind: 'section' as const }));
    return [{ label: 'Title', kind: 'title' }, ...sections, hasCTA ? { label: 'CTA', kind: 'cta' } : { label: 'Conclusion', kind: 'closing' }];
  }
  // image / banner
  if (hasField(fd.fields, 'quote')) {
    const out: BlueprintStep[] = [{ label: 'Quote', kind: 'headline' }];
    if (hasField(fd.fields, 'author')) out.push({ label: 'Attribution', kind: 'support' });
    return out;
  }
  if (hasField(fd.fields, 'headline')) {
    const out: BlueprintStep[] = [{ label: 'Headline', kind: 'headline' }];
    if (hasField(fd.fields, 'subheadline')) out.push({ label: 'Supporting text', kind: 'support' });
    if (hasCTA) out.push({ label: 'Call to action', kind: 'cta' });
    return out;
  }
  return [{ label: 'Branded visual', kind: 'visual' }];
}

/** Build the deterministic content blueprint for a template. */
export function buildTemplateBlueprint(t: CreatorTemplate): TemplateBlueprint {
  const fd = t.formDefinition;
  const d = describeTemplatePlan(t);
  const noun = familyNoun(d.family, d.isBanner);
  const deliverable = t.name.toLowerCase().includes(noun.toLowerCase()) ? t.name : `${t.name} ${noun}`;

  const slideFields = fd.slides?.fields ?? [];
  const sectionFields = fd.sections?.fields ?? [];
  const requiredFields: BlueprintField[] = [
    ...fd.fields.filter((f) => f.required).map((f) => bp(f, 'flat')),
    ...slideFields.filter((f) => f.required).map((f) => bp(f, 'slide')),
    ...sectionFields.filter((f) => f.required).map((f) => bp(f, 'section')),
  ];
  const optionalFields: BlueprintField[] = [
    ...fd.fields.filter((f) => !f.required).map((f) => bp(f, 'flat')),
    ...slideFields.filter((f) => !f.required).map((f) => bp(f, 'slide')),
    ...sectionFields.filter((f) => !f.required).map((f) => bp(f, 'section')),
  ];

  let unitLabel: TemplateBlueprint['unitLabel'] = null;
  let unitCount: number | null = null;
  let unitRange: string | null = null;
  if (fd.slides) {
    unitLabel = 'slides';
    unitCount = fd.slides.defaultCount;
    unitRange = fd.slides.countOptions.join(' / ');
  } else if (fd.sections) {
    unitLabel = 'sections';
    unitCount = clamp(3, fd.sections.min, fd.sections.max);
    unitRange = `${fd.sections.min}–${fd.sections.max}`;
  }

  // Deterministic effort + time from content units.
  const flatRequired = fd.fields.filter((f) => f.required).length;
  const repeatUnits = fd.slides ? fd.slides.defaultCount : (fd.sections ? (unitCount ?? fd.sections.min) : 0);
  const contentUnits = flatRequired + repeatUnits;
  const editingEffort: EditingEffort = contentUnits <= 3 ? 'Low' : contentUnits <= 8 ? 'Medium' : 'High';
  const estimatedMinutes = Math.max(1, Math.round(contentUnits * 1.2 + 1));

  return {
    templateId: t.id,
    family: d.family,
    deliverable,
    unitLabel,
    unitCount,
    unitRange,
    requiredFields,
    optionalFields,
    hasCTA: d.hasCTA,
    editingEffort,
    estimatedMinutes,
    structure: buildStructure(t, d.hasCTA, unitCount),
  };
}

/* ── Readiness (Part C) — based ONLY on required fields ───────────────── */

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Deterministic readiness from required fields. With no values (the blueprint,
 * pre-editor) → "Needs More Content" (unless nothing is required). In the editor,
 * pass live values to track Almost Ready → Ready.
 */
export function computeReadiness(template: CreatorTemplate, values?: TemplateFieldValues): Readiness {
  const fd = template.formDefinition;
  let total = 0;
  let filled = 0;

  for (const f of fd.fields) {
    if (!f.required) continue;
    total += 1;
    if (values && str(values.fields?.[f.key])) filled += 1;
  }
  const reqSlide = (fd.slides?.fields ?? []).filter((f) => f.required);
  if (fd.slides) {
    const rows = values?.slides ?? Array.from({ length: fd.slides.defaultCount }, () => ({} as Record<string, string>));
    for (const row of rows) for (const f of reqSlide) { total += 1; if (str(row[f.key])) filled += 1; }
  }
  const reqSection = (fd.sections?.fields ?? []).filter((f) => f.required);
  if (fd.sections) {
    const rows = values?.sections ?? Array.from({ length: fd.sections.min }, () => ({} as Record<string, string>));
    for (const row of rows) for (const f of reqSection) { total += 1; if (str(row[f.key])) filled += 1; }
  }

  if (total === 0) return 'Ready';
  if (filled === 0) return 'Needs More Content';
  if (filled < total) return 'Almost Ready';
  return 'Ready';
}
