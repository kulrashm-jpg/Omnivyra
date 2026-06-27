/**
 * Structured Creative Generation — the single orchestration layer that turns the
 * planning outputs into a GeneratedCreative through controlled, deterministic
 * STAGES (Headline → Body → Evidence → CTA → Consistency). The LLM never
 * generates a whole asset at once: each stage receives only its own slots and
 * the approved output of prior stages. Planning stays deterministic, templates
 * stay presentation-only, the renderer is unchanged.
 *
 * The LLM gateway is INJECTED via `options.generate`. The default generator is a
 * deterministic pass-through (planning already produced the content), so the
 * orchestrator is pure and byte-identical by default; production injects the
 * existing LLM gateway. `options.now` (default `() => 0`) keeps timings
 * deterministic in tests. No rendering data is produced here.
 */

import type { AssetAssembly } from './assetAssembly';
import type { CreatorTemplatePopulation } from './templatePopulation';
import type { PromptAssemblySpecification } from './assetAssemblyPrompt';

export type StageName = 'headline' | 'body' | 'evidence' | 'cta' | 'consistency';
export const STAGE_ORDER: StageName[] = ['headline', 'body', 'evidence', 'cta', 'consistency'];

export type SlotKind = 'headline' | 'body' | 'evidence' | 'cta';

export interface Slot { ref: string; key: string; kind: SlotKind; value: string; }

export interface StageResult {
  stage: StageName;
  values: Record<string, string>;
  coverage: { requested: number; filled: number; ratio: number };
  validation: { ok: boolean; errors: string[] };
  diagnostics: { slotCount: number; kinds: SlotKind[] };
  tokenUsage: number;
  executionTimeMs: number;
  retries: number;
}

export interface GeneratedCreative {
  creativeId: string;
  assetFamily: string;
  fields: Record<string, string>;
  slides: Array<Record<string, string>>;
  sections: Array<Record<string, string>>;
  cta: string;
  stages: StageResult[];
  executionReport: { stages: StageName[]; totalTokenUsage: number; totalTimeMs: number; totalRetries: number; coverage: number };
  validation: { ok: boolean; errors: string[] };
  metadata: Record<string, unknown>;
}

export type StageGenerator = (req: { stage: StageName; fields: Record<string, string>; context: StageContext }) => Promise<Record<string, string>> | Record<string, string>;
export interface StageContext { approved: Record<string, string>; assemblyGoal: string; tone: string | null; ctaIntensity: string; }

export interface GenerateOptions { generate?: StageGenerator; now?: () => number; maxRetries?: number; creativeId?: string; }

/* ── Slot model (each stage sees only its own slots) ───────────────────── */

function kindOf(key: string): SlotKind {
  const k = key.toLowerCase();
  if (/cta|button|action/.test(k)) return 'cta';
  if (/headline|title|heading|label|step|year|milestone|stage/.test(k)) return 'headline';
  if (/quote|stat|metric|value|number|percent|figure|bullet|list|point|item|evidence|proof/.test(k)) return 'evidence';
  return 'body';
}

function flattenSlots(pop: CreatorTemplatePopulation): Slot[] {
  const slots: Slot[] = [];
  for (const [key, value] of Object.entries(pop.fields)) slots.push({ ref: `field:${key}`, key, kind: kindOf(key), value });
  pop.slides.forEach((row, i) => { for (const [key, value] of Object.entries(row)) slots.push({ ref: `slide:${i}:${key}`, key, kind: kindOf(key), value }); });
  pop.sections.forEach((row, i) => { for (const [key, value] of Object.entries(row)) slots.push({ ref: `section:${i}:${key}`, key, kind: kindOf(key), value }); });
  return slots;
}

function writeBack(pop: CreatorTemplatePopulation, ref: string, value: string): void {
  const parts = ref.split(':');
  if (parts[0] === 'field') { pop.fields[parts[1]] = value; return; }
  const i = Number(parts[1]);
  const key = parts.slice(2).join(':');
  if (parts[0] === 'slide' && pop.slides[i]) pop.slides[i][key] = value;
  if (parts[0] === 'section' && pop.sections[i]) pop.sections[i][key] = value;
}

const estTokens = (vals: Record<string, string>): number => Object.values(vals).reduce((a, s) => a + Math.ceil((s || '').length / 4), 0);
const normalizeText = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();

const DEFAULT_GENERATOR: StageGenerator = ({ stage, fields }) => {
  if (stage === 'consistency') { const out: Record<string, string> = {}; for (const [k, v] of Object.entries(fields)) out[k] = normalizeText(v); return out; }
  return fields; // planning already produced the content → deterministic pass-through.
};

/* ── Single-stage runner (isolated, with partial retry) ────────────────── */

function slotsForStage(stage: StageName, slots: Slot[]): Slot[] {
  if (stage === 'headline') return slots.filter((s) => s.kind === 'headline');
  if (stage === 'body') return slots.filter((s) => s.kind === 'body');
  if (stage === 'evidence') return slots.filter((s) => s.kind === 'evidence');
  if (stage === 'cta') return slots.filter((s) => s.kind === 'cta');
  return slots; // consistency touches everything
}

export async function runStage(stage: StageName, slots: Slot[], context: StageContext, options: GenerateOptions = {}): Promise<StageResult> {
  const generate = options.generate ?? DEFAULT_GENERATOR;
  const now = options.now ?? (() => 0);
  const maxRetries = options.maxRetries ?? 1;
  const mine = slotsForStage(stage, slots);
  const request: Record<string, string> = {};
  for (const s of mine) request[s.ref] = s.value;

  const start = now();
  let retries = 0;
  let values: Record<string, string> = {};
  let ok = false;
  let errors: string[] = [];
  while (retries <= maxRetries) {
    try {
      errors = []; // clear any prior-attempt error so a successful retry is clean
      values = await generate({ stage, fields: request, context });
      ok = true;
      break;
    } catch (e) {
      errors = [`Stage ${stage} failed: ${(e as Error).message}`];
      retries++;
    }
  }
  const filled = Object.values(values).filter(Boolean).length;
  const requested = mine.length;
  return {
    stage, values,
    coverage: { requested, filled, ratio: requested ? Math.round((filled / requested) * 100) / 100 : 1 },
    validation: { ok: ok && errors.length === 0, errors: ok ? [] : errors },
    diagnostics: { slotCount: mine.length, kinds: Array.from(new Set(mine.map((s) => s.kind))) },
    tokenUsage: estTokens(values),
    executionTimeMs: now() - start,
    retries,
  };
}

/* ── Orchestrator ──────────────────────────────────────────────────────── */

export interface GenerateInput { assembly: AssetAssembly; population: CreatorTemplatePopulation; prompt: PromptAssemblySpecification; }

/** THE single entry point — callers never manage stages. */
export async function generateCreative(input: GenerateInput, options: GenerateOptions = {}): Promise<GeneratedCreative> {
  // Work on a copy so the input population is never mutated.
  const pop: CreatorTemplatePopulation = JSON.parse(JSON.stringify(input.population));
  const slots = flattenSlots(pop);
  const context: StageContext = {
    approved: {}, assemblyGoal: input.assembly.conversion.goal,
    tone: input.assembly.message.tone, ctaIntensity: input.assembly.conversion.ctaIntensity,
  };

  const stages: StageResult[] = [];
  for (const stage of STAGE_ORDER) {
    // Re-flatten so each stage sees the latest values (consistency sees prior output).
    const current = flattenSlots(pop);
    const result = await runStage(stage, current, context, options);
    for (const [ref, value] of Object.entries(result.values)) { writeBack(pop, ref, value); context.approved[ref] = value; }
    stages.push(result);
  }

  const ctaSlot = flattenSlots(pop).find((s) => s.kind === 'cta' && s.value);
  const creative: GeneratedCreative = {
    creativeId: options.creativeId ?? `gen-${input.assembly.assemblyId}`,
    assetFamily: pop.assetFamily, fields: pop.fields, slides: pop.slides, sections: pop.sections,
    cta: ctaSlot ? ctaSlot.value : '',
    stages,
    executionReport: {
      stages: stages.map((s) => s.stage),
      totalTokenUsage: stages.reduce((a, s) => a + s.tokenUsage, 0),
      totalTimeMs: stages.reduce((a, s) => a + s.executionTimeMs, 0),
      totalRetries: stages.reduce((a, s) => a + s.retries, 0),
      coverage: Math.round((stages.reduce((a, s) => a + s.coverage.ratio, 0) / stages.length) * 100) / 100,
    },
    validation: { ok: true, errors: [] },
    metadata: { blueprint: input.assembly.storyBlueprint.id, conversionGoal: input.assembly.conversion.goal, slotCount: slots.length },
  };
  creative.validation = validateGeneratedCreative(creative);
  return creative;
}

/** Failure recovery — rerun ONE stage without regenerating the whole asset. */
export async function rerunStage(input: GenerateInput, creative: GeneratedCreative, stage: StageName, options: GenerateOptions = {}): Promise<{ creative: GeneratedCreative; stageResult: StageResult }> {
  const pop: CreatorTemplatePopulation = { ...creative, fields: { ...creative.fields }, slides: creative.slides.map((r) => ({ ...r })), sections: creative.sections.map((r) => ({ ...r })) } as unknown as CreatorTemplatePopulation;
  const context: StageContext = { approved: {}, assemblyGoal: input.assembly.conversion.goal, tone: input.assembly.message.tone, ctaIntensity: input.assembly.conversion.ctaIntensity };
  const result = await runStage(stage, flattenSlots(pop), context, options);
  for (const [ref, value] of Object.entries(result.values)) writeBack(pop, ref, value);
  const stages = creative.stages.map((s) => (s.stage === stage ? result : s));
  const ctaSlot = flattenSlots(pop).find((s) => s.kind === 'cta' && s.value);
  const next: GeneratedCreative = { ...creative, fields: pop.fields, slides: pop.slides, sections: pop.sections, cta: ctaSlot ? ctaSlot.value : creative.cta, stages };
  next.validation = validateGeneratedCreative(next);
  return { creative: next, stageResult: result };
}

/* ── Validation ────────────────────────────────────────────────────────── */

export function validateGeneratedCreative(creative: GeneratedCreative): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const all: Slot[] = flattenSlots({ assetFamily: creative.assetFamily, fields: creative.fields, slides: creative.slides, sections: creative.sections } as unknown as CreatorTemplatePopulation);
  // Duplicate headlines are only a defect WITHIN a repeated group (slide titles /
  // section labels). A flat cover headline matching slide 0 is the cover, not a dupe.
  const slideHeadlines = all.filter((s) => s.kind === 'headline' && s.ref.startsWith('slide:') && s.value).map((s) => s.value);
  const sectionHeadlines = all.filter((s) => s.kind === 'headline' && s.ref.startsWith('section:') && s.value).map((s) => s.value);
  if (new Set(slideHeadlines).size !== slideHeadlines.length) errors.push('Duplicate slide headlines.');
  if (new Set(sectionHeadlines).size !== sectionHeadlines.length) errors.push('Duplicate section headlines.');
  if (!all.some((s) => s.kind === 'cta' && s.value)) errors.push('Missing CTA.');
  const evidenceSlots = all.filter((s) => s.kind === 'evidence');
  if (evidenceSlots.length && !evidenceSlots.some((s) => s.value)) errors.push('Evidence slots present but none filled.');
  // No stage may have failed.
  for (const st of creative.stages) if (!st.validation.ok) errors.push(`Stage ${st.stage} did not complete.`);
  return { ok: errors.length === 0, errors };
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface GenerationSummary {
  completedStages: StageName[]; coverage: number; missingSlots: string[]; valid: boolean;
  timings: Record<string, number>; tokenUsage: number; retries: number;
}
export function summarizeGeneration(creative: GeneratedCreative): GenerationSummary {
  const all: Slot[] = flattenSlots({ assetFamily: creative.assetFamily, fields: creative.fields, slides: creative.slides, sections: creative.sections } as unknown as CreatorTemplatePopulation);
  const timings: Record<string, number> = {};
  for (const s of creative.stages) timings[s.stage] = s.executionTimeMs;
  return {
    completedStages: creative.stages.filter((s) => s.validation.ok).map((s) => s.stage),
    coverage: creative.executionReport.coverage,
    missingSlots: all.filter((s) => s.kind !== 'body' && !s.value).map((s) => s.ref),
    valid: creative.validation.ok,
    timings, tokenUsage: creative.executionReport.totalTokenUsage, retries: creative.executionReport.totalRetries,
  };
}
