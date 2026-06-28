/**
 * Creator Runtime Bridge — the mechanism for the live editor cutover. It makes
 * `editorRuntime` the single source of truth for the live Creator page while
 * REUSING the renderer's existing input contract (the `project*` projectors).
 * editorRuntime → effectivePopulation → the SAME projectors the renderer already
 * consumes → generate payload. No new typography engine, no new state model, no
 * renderer change, no parallel mapping (the projectors ARE the renderer API).
 *
 * Three entry points the live page calls:
 *   1. liveContentToEditorState  — STEP 2: build editorRuntime from content.
 *   2. editorStateToGeneratePayload — STEP 4: payload from effectivePopulation.
 *   3. runTypographyGate         — STEP 5: typography verification before generate.
 */

import type { CreatorTemplate } from './types';
import type { TemplateFieldValues } from './values';
import { projectImageOverlayText, projectCarouselSlides, projectInfographicSections, initTemplateValues } from './values';
import type { CreatorTemplatePopulation } from './templatePopulation';
import { populateTemplateFromAssembly } from './templatePopulation';
import { packageAssetAssembly } from './assetAssembly';
import { createPackage, addIntakeSource } from './contentPackage';
import { fromExistingContent } from './contentIntake';
import { buildEditorMigration } from './editorMigration';
import { effectivePopulation, type EditorState } from './editorRuntime';
import { verifyTypographyRuntime, type TypographyVerificationReport } from './typographyVerification';

/* ── effectivePopulation → TemplateFieldValues (renderer projector input) ── */

export function populationToTemplateFieldValues(pop: CreatorTemplatePopulation): TemplateFieldValues {
  const values: TemplateFieldValues = { fields: { ...pop.fields } };
  if (pop.slides.length) { values.slides = pop.slides.map((r) => ({ ...r })); values.slideCount = pop.slides.length; }
  if (pop.sections.length) { values.sections = pop.sections.map((r) => ({ ...r })); }
  return values;
}

/* ── STEP 2 — build editorRuntime from live content ────────────────────── */

export interface LiveContentInput {
  template: CreatorTemplate;
  /** Writer source text OR creator-first brief — the content the package is built from. */
  sourceText: string;
  /** Any values the user already typed (legacy templateValues) — preserved as MANUAL. */
  existingValues?: TemplateFieldValues;
  packageId?: string;
}

/**
 * Build the deterministic population (Asset Assembly → Template Population) and
 * seed an EditorState where deterministic values are AUTO and the user's existing
 * typed values are MANUAL overrides (lossless). Reuses buildEditorMigration.
 */
export function liveContentToEditorState(input: LiveContentInput): EditorState {
  const family = input.template.assetFamily;
  const id = input.packageId ?? `pkg-${input.template.id}`;
  let pkg = createPackage(id);
  pkg = addIntakeSource(pkg, fromExistingContent(input.sourceText), { id: `${id}-s0`, createdAt: '1970-01-01T00:00:00.000Z' });
  const assembly = packageAssetAssembly(pkg, family);
  const population = populateTemplateFromAssembly(assembly, input.template);
  const legacyValues = input.existingValues ?? initTemplateValues(input.template);
  return buildEditorMigration({ template: input.template, legacyValues, deterministicPopulation: population, assembly }).state;
}

/* ── STEP 4 — generate payload from effectivePopulation ─────────────────── */

export interface GeneratePayloadFragment {
  overlay_text?: Record<string, unknown>;
  slides?: Array<Record<string, unknown>>;
  slide_count?: number | null;
  infographic_sections?: Array<Record<string, string>>;
  template_fields: Record<string, string>;
}

/**
 * Produce exactly the generate-payload fragment the live page builds today
 * (lines 3003-3044), but sourced from editorRuntime's effective population
 * instead of legacy `templateValues`. Reuses the renderer's existing projectors,
 * so the renderer input is byte-identical for identical content.
 */
export function editorStateToGeneratePayload(state: EditorState, template: CreatorTemplate): GeneratePayloadFragment {
  const values = populationToTemplateFieldValues(effectivePopulation(state));
  if (template.assetFamily === 'image') {
    return {
      overlay_text: { ...projectImageOverlayText(template, values), __template_authoritative: true },
      template_fields: values.fields,
    };
  }
  if (template.assetFamily === 'carousel') {
    return { slides: projectCarouselSlides(values), slide_count: values.slideCount ?? null, template_fields: values.fields };
  }
  return { infographic_sections: projectInfographicSections(values), template_fields: values.fields };
}

/* ── STEP 5 — typography gate before generation ────────────────────────── */

export interface TypographyGate { ok: boolean; status: TypographyVerificationReport['status']; report: TypographyVerificationReport; }

/** Run Typography Verification before generation. Diagnostics-only — never blocks
 * unless the runtime FAILs parity (editor↔preview↔renderer divergence). */
export function runTypographyGate(state: EditorState, template: CreatorTemplate, composedImagePrompt?: string): TypographyGate {
  const report = verifyTypographyRuntime(state, template, composedImagePrompt);
  return { ok: report.status !== 'FAIL', status: report.status, report };
}
