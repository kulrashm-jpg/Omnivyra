/**
 * Editor Migration & Parity — the staged, reversible cutover from the live
 * editor's legacy `templateValues` (user-typed form values) to the deterministic
 * `editorRuntime` (Asset Assembly → Template Population). It builds BOTH the
 * legacy population and the deterministic population, compares them (parity
 * diagnostics, STEP 2-3), and produces a seeded `EditorState` where the
 * deterministic values are the AUTO/canonical layer and the user's typed values
 * become MANUAL overrides — so the cutover is LOSSLESS (no user input is
 * discarded) and reversible. Pure + deterministic. No new runtime, no new model.
 */

import type { CreatorTemplate } from './types';
import type { TemplateFieldValues } from './values';
import type { CreatorTemplatePopulation, PopulationCoverage } from './templatePopulation';
import type { AssetAssembly } from './assetAssembly';
import { createEditorState, editField, type EditorState } from './editorRuntime';

/* ── Legacy population (the user's typed templateValues, in population shape) ── */

export function legacyPopulationFromValues(
  template: CreatorTemplate,
  values: TemplateFieldValues,
): CreatorTemplatePopulation {
  const fields = { ...values.fields };
  const slides = (values.slides ?? []).map((row) => ({ ...row }));
  const sections = (values.sections ?? []).map((row) => ({ ...row }));
  const all = [...Object.values(fields), ...slides.flatMap((r) => Object.values(r)), ...sections.flatMap((r) => Object.values(r))];
  const anyHeadline = Object.entries(fields).some(([k, v]) => /headline|title/i.test(k) && !!v) || slides.some((r) => Object.entries(r).some(([k, v]) => /title|label/i.test(k) && !!v));
  const coverage: PopulationCoverage = {
    headline: anyHeadline,
    body: all.some((v) => v && v.length > 24),
    bullets: false,
    evidence: Object.keys(fields).some((k) => /stat|quote|metric|value/i.test(k) && !!fields[k]) || sections.some((r) => Object.values(r).some(Boolean)),
    cta: Object.entries(fields).some(([k, v]) => /cta|button|action/i.test(k) && !!v),
    hierarchy: true,
    visualIntent: true,
    conversion: true,
  };
  return {
    templateId: template.id,
    assetFamily: template.assetFamily,
    fields,
    slides,
    sections,
    ownership: {},
    coverage,
    metadata: { source: 'legacy_template_values' },
  };
}

/* ── Parity comparison (STEP 3) ────────────────────────────────────────── */

export interface FieldMismatch { ref: string; legacy: string; deterministic: string; }
export interface PopulationParity {
  identical: boolean;
  parityScore: number;            // 0..1 across compared user-supplied fields
  comparedFields: number;
  matched: number;
  fieldMismatches: FieldMismatch[];
  slideMismatches: FieldMismatch[];
  sectionMismatches: FieldMismatch[];
  layoutCounts: { legacySlides: number; deterministicSlides: number; legacySections: number; deterministicSections: number; match: boolean };
  coverageDelta: Partial<Record<keyof PopulationCoverage, { legacy: boolean; deterministic: boolean }>>;
}

function compareRows(prefix: 'field' | 'slide' | 'section', legacy: Array<Record<string, string>>, det: Array<Record<string, string>>, out: FieldMismatch[], counters: { compared: number; matched: number }): void {
  const len = Math.max(legacy.length, det.length);
  for (let i = 0; i < len; i++) {
    const lrow = legacy[i] ?? {};
    const drow = det[i] ?? {};
    for (const key of new Set([...Object.keys(lrow), ...Object.keys(drow)])) {
      const lv = (lrow[key] ?? '').trim();
      const dv = (drow[key] ?? '').trim();
      if (!lv) continue; // only compare fields the user actually supplied (legacy non-empty)
      counters.compared++;
      if (lv === dv) counters.matched++;
      else out.push({ ref: `${prefix}:${i}:${key}`, legacy: lv, deterministic: dv });
    }
  }
}

export function comparePopulations(legacy: CreatorTemplatePopulation, deterministic: CreatorTemplatePopulation): PopulationParity {
  const counters = { compared: 0, matched: 0 };
  const fieldMismatches: FieldMismatch[] = [];
  const slideMismatches: FieldMismatch[] = [];
  const sectionMismatches: FieldMismatch[] = [];

  // Flat fields.
  for (const key of new Set([...Object.keys(legacy.fields), ...Object.keys(deterministic.fields)])) {
    const lv = (legacy.fields[key] ?? '').trim();
    const dv = (deterministic.fields[key] ?? '').trim();
    if (!lv) continue;
    counters.compared++;
    if (lv === dv) counters.matched++;
    else fieldMismatches.push({ ref: `field:${key}`, legacy: lv, deterministic: dv });
  }
  compareRows('slide', legacy.slides, deterministic.slides, slideMismatches, counters);
  compareRows('section', legacy.sections, deterministic.sections, sectionMismatches, counters);

  const coverageDelta: PopulationParity['coverageDelta'] = {};
  (Object.keys(legacy.coverage) as Array<keyof PopulationCoverage>).forEach((k) => {
    if (legacy.coverage[k] !== deterministic.coverage[k]) coverageDelta[k] = { legacy: legacy.coverage[k], deterministic: deterministic.coverage[k] };
  });

  const layoutCounts = {
    legacySlides: legacy.slides.length, deterministicSlides: deterministic.slides.length,
    legacySections: legacy.sections.length, deterministicSections: deterministic.sections.length,
    match: legacy.slides.length === deterministic.slides.length && legacy.sections.length === deterministic.sections.length,
  };
  const total = fieldMismatches.length + slideMismatches.length + sectionMismatches.length;
  return {
    identical: total === 0 && layoutCounts.match,
    parityScore: counters.compared ? Math.round((counters.matched / counters.compared) * 100) / 100 : 1,
    comparedFields: counters.compared,
    matched: counters.matched,
    fieldMismatches, slideMismatches, sectionMismatches, layoutCounts, coverageDelta,
  };
}

/* ── Lossless migration: deterministic AUTO + user values as MANUAL ────── */

/**
 * Seed an EditorState from the deterministic population, then re-apply every
 * non-empty user-typed value as a MANUAL override. The editor shows exactly
 * what the user typed where they typed it, and the deterministic canonical
 * value everywhere else — no user input is lost in the cutover.
 */
export function migrateToEditorState(
  deterministic: CreatorTemplatePopulation,
  legacyValues: TemplateFieldValues,
  assembly: AssetAssembly | null = null,
): EditorState {
  let state = createEditorState(deterministic, assembly);
  for (const [key, value] of Object.entries(legacyValues.fields)) {
    if (value && value.trim()) state = editField(state, `field:${key}`, value);
  }
  (legacyValues.slides ?? []).forEach((row, i) => {
    for (const [key, value] of Object.entries(row)) if (value && value.trim()) state = editField(state, `slide:${i}:${key}`, value);
  });
  (legacyValues.sections ?? []).forEach((row, i) => {
    for (const [key, value] of Object.entries(row)) if (value && value.trim()) state = editField(state, `section:${i}:${key}`, value);
  });
  return state;
}

/* ── Combined migration build + parity report (STEP 1-3, 8) ────────────── */

export interface EditorMigration {
  state: EditorState;
  parity: PopulationParity;
  cutoverReady: boolean;      // deterministic produced a usable population
  legacyPopulation: CreatorTemplatePopulation;
}

export function buildEditorMigration(input: {
  template: CreatorTemplate;
  legacyValues: TemplateFieldValues;
  deterministicPopulation: CreatorTemplatePopulation;
  assembly?: AssetAssembly | null;
}): EditorMigration {
  const legacyPopulation = legacyPopulationFromValues(input.template, input.legacyValues);
  const parity = comparePopulations(legacyPopulation, input.deterministicPopulation);
  const state = migrateToEditorState(input.deterministicPopulation, input.legacyValues, input.assembly ?? null);
  // The deterministic population is usable when it yields any populated field
  // OR the user supplied values (which become MANUAL and are never lost).
  const det = input.deterministicPopulation;
  const detHasContent =
    Object.values(det.fields).some(Boolean) ||
    det.slides.some((r) => Object.values(r).some(Boolean)) ||
    det.sections.some((r) => Object.values(r).some(Boolean));
  const cutoverReady = detHasContent || parity.comparedFields > 0;
  return { state, parity, cutoverReady, legacyPopulation };
}
