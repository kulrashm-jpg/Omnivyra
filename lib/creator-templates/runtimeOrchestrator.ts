/**
 * Runtime Orchestrator — the ONE deterministic execution path for the entire
 * Creator platform. Every Creator entry point (image, carousel, infographic,
 * campaign, AI Creator, Writer→Creator, batch, regeneration, preview) converges
 * here and calls exactly `generateVerifiedCreative()`. This is the only place
 * allowed to compose the planning layers; no runtime caller invokes Communication
 * Strategy / Audience Journey / Story Blueprint / Visual Messaging / Conversion /
 * Asset Assembly individually.
 *
 * Integration only — it reuses every existing layer exactly and REDESIGNS
 * nothing. The renderer is INJECTED (`options.render`, default a deterministic
 * adapter) so the real renderer is reused untouched. Verification always precedes
 * rendering; a FAIL never reaches the renderer. Deterministic: same input → same
 * trace + output (timings via `options.now`, default `() => 0`).
 */

import { extractMessageDocument } from './messageExtraction';
import { createPackage, addIntakeSource, packageIntelligence, packageToArchitectureBody, type ContentPackage } from './contentPackage';
import { fromExistingContent } from './contentIntake';
import { classifyStrategy } from './communicationStrategy';
import { classifyAudienceJourney } from './audienceJourney';
import { buildVisualMessagingPlan } from './visualMessagingPlan';
import { buildConversionStrategy } from './conversionStrategy';
import { buildAssetAssembly, type AssetAssembly } from './assetAssembly';
import { buildPromptFromAssembly } from './assetAssemblyPrompt';
import { populateTemplateFromAssembly, type CreatorTemplatePopulation } from './templatePopulation';
import { generateCreative, type GeneratedCreative, type GenerateOptions } from './creativeGeneration';
import { verifyAndRegenerate, canRender, type CreativeVerificationReport, type VerifyOptions } from './creativeVerification';
import type { CreatorTemplate, TemplateAssetFamily } from './types';

/* ── Canonical pipeline ────────────────────────────────────────────────── */

export const PIPELINE_STAGES = [
  'Message Foundation', 'Content Package', 'Content Intelligence', 'Communication Strategy', 'Audience Journey',
  'Story Blueprint', 'Visual Messaging Plan', 'Conversion Strategy', 'Asset Assembly', 'Prompt Specification',
  'Template Population', 'Structured Creative Generation', 'Creative Verification', 'Renderer',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

/* ── Entry-point execution map (every entry point → the orchestrator) ──── */

export type CreatorEntryPoint =
  | 'image' | 'carousel' | 'infographic' | 'campaign' | 'aiCreator' | 'writerToCreator' | 'batch' | 'regeneration' | 'preview';

export const CREATOR_ENTRY_POINTS: Record<CreatorEntryPoint, 'generateVerifiedCreative'> = {
  image: 'generateVerifiedCreative', carousel: 'generateVerifiedCreative', infographic: 'generateVerifiedCreative',
  campaign: 'generateVerifiedCreative', aiCreator: 'generateVerifiedCreative', writerToCreator: 'generateVerifiedCreative',
  batch: 'generateVerifiedCreative', regeneration: 'generateVerifiedCreative', preview: 'generateVerifiedCreative',
};

/* ── Trace ─────────────────────────────────────────────────────────────── */

export interface TraceStage { name: PipelineStage; order: number; at: number; durationMs: number; status: 'ok' | 'skipped'; detail: string; }
export interface ExecutionTrace {
  stages: TraceStage[];
  executionOrder: PipelineStage[];
  totalTimeMs: number;
  verification: { status: CreativeVerificationReport['status']; score: number };
  renderStatus: 'RENDERED' | 'BLOCKED';
  retryHistory: number[];
  llmStages: string[];
  validation: { ok: boolean; errors: string[] };
}

export type RenderAdapter = (creative: GeneratedCreative, ctx: { assembly: AssetAssembly; population: CreatorTemplatePopulation }) => { ok: boolean; status: string; payload?: unknown };
const DEFAULT_RENDER: RenderAdapter = (creative) => ({ ok: true, status: 'RENDERED', payload: { creativeId: creative.creativeId, family: creative.assetFamily, fields: creative.fields, slides: creative.slides, sections: creative.sections } });

export interface RuntimeInput {
  assetFamily: TemplateAssetFamily;
  template: CreatorTemplate;
  package?: ContentPackage;
  sourceText?: string;
  packageId?: string;
  entryPoint?: CreatorEntryPoint;
}
export interface RuntimeOptions extends GenerateOptions, VerifyOptions { render?: RenderAdapter; allowWarn?: boolean; }

export interface VerifiedCreativeResult {
  creativeId: string;
  entryPoint: CreatorEntryPoint;
  assetFamily: string;
  assembly: AssetAssembly;
  population: CreatorTemplatePopulation;
  creative: GeneratedCreative;
  verification: CreativeVerificationReport;
  render: { ok: boolean; status: string; payload?: unknown } | null;
  trace: ExecutionTrace;
  diagnostics: RuntimeDiagnostics;
}

/* ── THE single orchestration function ─────────────────────────────────── */

export async function generateVerifiedCreative(input: RuntimeInput, options: RuntimeOptions = {}): Promise<VerifiedCreativeResult> {
  const now = options.now ?? (() => 0);
  const render = options.render ?? DEFAULT_RENDER;
  const entryPoint = input.entryPoint ?? input.assetFamily as CreatorEntryPoint;
  const stages: TraceStage[] = [];
  let order = 0;
  const rec = (name: PipelineStage, detail: string): void => { stages.push({ name, order: order++, at: now(), durationMs: 0, status: 'ok', detail }); };

  // 1. Message Foundation — from the raw source (or the package body).
  const pkgId = input.packageId ?? (input.package ? input.package.id : 'pkg-runtime');
  const sourceText = input.sourceText ?? (input.package ? packageToArchitectureBody(input.package) : '');
  const message = extractMessageDocument({ content: sourceText, source: 'extraction', id: pkgId });
  rec('Message Foundation', message.mainMessage);

  // 2. Content Package.
  let pkg = input.package;
  if (!pkg) { pkg = createPackage(pkgId); pkg = addIntakeSource(pkg, fromExistingContent(sourceText), { id: `${pkgId}-s0`, createdAt: '1970-01-01T00:00:00.000Z' }); }
  rec('Content Package', pkg.id);

  // 3. Content Intelligence.
  const intel = packageIntelligence(pkg);
  rec('Content Intelligence', `${intel.statistics.length} stats`);

  // 4. Communication Strategy.
  const strategy = classifyStrategy(intel);
  rec('Communication Strategy', strategy.selectedStrategy.id);

  // 5. Audience Journey.
  const journey = classifyAudienceJourney(strategy, intel);
  rec('Audience Journey', journey.selectedJourney.id);

  // 6 + 7. Story Blueprint (resolved inside) + Visual Messaging Plan.
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: input.assetFamily, planId: `vmp-${pkgId}-${input.assetFamily}` });
  rec('Story Blueprint', plan.storyBlueprint);
  rec('Visual Messaging Plan', `${plan.slides.length || plan.sections.length} units`);

  // 8. Conversion Strategy.
  const conversion = buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily: input.assetFamily });
  rec('Conversion Strategy', conversion.conversionGoal);

  // 9. Asset Assembly.
  const assembly = buildAssetAssembly({ message, strategy, journey, plan, conversion, assetFamily: input.assetFamily });
  rec('Asset Assembly', assembly.assemblyId);

  // 10. Prompt Specification.
  const prompt = buildPromptFromAssembly(assembly);
  rec('Prompt Specification', `coverage ${Object.values(prompt.coverage).filter(Boolean).length}/6`);

  // 11. Template Population.
  const population = populateTemplateFromAssembly(assembly, input.template);
  rec('Template Population', input.template.id);

  // 12. Structured Creative Generation.
  const genOptions: GenerateOptions = { generate: options.generate, now, maxRetries: options.maxRetries, creativeId: options.creativeId };
  const creative = await generateCreative({ assembly, population, prompt }, genOptions);
  rec('Structured Creative Generation', `${creative.stages.length} stages`);

  // 13. Creative Verification (+ selective regeneration).
  const verifyOptions: VerifyOptions = { generate: options.generate, now, maxRetries: options.maxRetries, passThreshold: options.passThreshold, warnThreshold: options.warnThreshold };
  const { report, creative: verified } = await verifyAndRegenerate({ assembly, population, prompt, creative }, verifyOptions);
  rec('Creative Verification', report.status);

  // 14. Renderer — ONLY when verification permits. FAIL never renders.
  let renderResult: { ok: boolean; status: string; payload?: unknown } | null = null;
  const mayRender = canRender(report, { allowWarn: options.allowWarn });
  if (mayRender) { renderResult = render(verified, { assembly, population }); rec('Renderer', renderResult.status); }
  else { stages.push({ name: 'Renderer', order: order++, at: now(), durationMs: 0, status: 'skipped', detail: 'BLOCKED' }); }

  const trace: ExecutionTrace = {
    stages,
    executionOrder: stages.map((s) => s.name),
    totalTimeMs: stages.reduce((a, s) => a + s.durationMs, 0),
    verification: { status: report.status, score: report.score },
    renderStatus: mayRender && renderResult && renderResult.ok ? 'RENDERED' : 'BLOCKED',
    retryHistory: report.history.map((h) => h.retryCount),
    llmStages: creative.stages.map((s) => s.stage),
    validation: { ok: true, errors: [] },
  };
  trace.validation = validateRuntimeExecution(trace);

  const diagnostics = buildDiagnostics(trace, assembly, prompt, input.template, report, verified);
  return { creativeId: verified.creativeId, entryPoint, assetFamily: verified.assetFamily, assembly, population, creative: verified, verification: report, render: renderResult, trace, diagnostics };
}

/* ── Runtime validation ────────────────────────────────────────────────── */

export function validateRuntimeExecution(trace: ExecutionTrace): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const executed = trace.stages.filter((s) => s.status === 'ok').map((s) => s.name);
  // Every stage executed (Renderer may be 'skipped' on a verification block).
  for (const stage of PIPELINE_STAGES) {
    if (stage === 'Renderer') continue;
    if (!executed.includes(stage)) errors.push(`Stage not executed: ${stage}.`);
  }
  // Correct order (executed-ok stages must follow canonical order).
  const canonicalIndex = (n: PipelineStage): number => PIPELINE_STAGES.indexOf(n);
  for (let i = 1; i < trace.stages.length; i++) {
    if (canonicalIndex(trace.stages[i].name) < canonicalIndex(trace.stages[i - 1].name)) errors.push(`Out-of-order: ${trace.stages[i].name} after ${trace.stages[i - 1].name}.`);
  }
  // No duplicate execution; exactly one of each single-shot stage.
  const counts = new Map<string, number>();
  for (const s of trace.stages) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  for (const [name, c] of counts) if (c > 1) errors.push(`Duplicate execution: ${name} (${c}×).`);
  for (const single of ['Prompt Specification', 'Template Population', 'Creative Verification', 'Renderer', 'Structured Creative Generation']) {
    if ((counts.get(single) ?? 0) !== 1) errors.push(`Expected exactly one ${single}.`);
  }
  return { ok: errors.length === 0, errors };
}

/* ── Diagnostics ───────────────────────────────────────────────────────── */

export interface RuntimeDiagnostics {
  pipelineHealth: 'HEALTHY' | 'DEGRADED' | 'BLOCKED';
  stageCoverage: number;
  executionTimeMs: number;
  verificationResult: CreativeVerificationReport['status'];
  retryCount: number;
  rendererStatus: 'RENDERED' | 'BLOCKED';
  promptVersion: string;
  assemblyVersion: string;
  templateVersion: number;
}
function buildDiagnostics(trace: ExecutionTrace, assembly: AssetAssembly, prompt: ReturnType<typeof buildPromptFromAssembly>, template: CreatorTemplate, report: CreativeVerificationReport, creative: GeneratedCreative): RuntimeDiagnostics {
  const executedOk = trace.stages.filter((s) => s.status === 'ok').length;
  const health: RuntimeDiagnostics['pipelineHealth'] = trace.renderStatus === 'BLOCKED' ? 'BLOCKED' : report.status === 'WARN' ? 'DEGRADED' : 'HEALTHY';
  return {
    pipelineHealth: health,
    stageCoverage: Math.round((executedOk / (PIPELINE_STAGES.length)) * 100) / 100,
    executionTimeMs: trace.totalTimeMs,
    verificationResult: report.status,
    retryCount: report.history.reduce((a, h) => a + h.retryCount, 0),
    rendererStatus: trace.renderStatus,
    promptVersion: `prompt-${Object.values(prompt.coverage).filter(Boolean).length}of6`,
    assemblyVersion: assembly.assemblyId,
    templateVersion: typeof template.version === 'number' ? template.version : 1,
  };
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface RuntimeSummary {
  entryPoint: CreatorEntryPoint; stagesExecuted: number; order: PipelineStage[];
  verification: CreativeVerificationReport['status']; rendered: boolean; valid: boolean; health: string;
}
export function summarizeRuntimeExecution(result: VerifiedCreativeResult): RuntimeSummary {
  return {
    entryPoint: result.entryPoint, stagesExecuted: result.trace.stages.filter((s) => s.status === 'ok').length,
    order: result.trace.executionOrder, verification: result.verification.status,
    rendered: result.trace.renderStatus === 'RENDERED', valid: result.trace.validation.ok, health: result.diagnostics.pipelineHealth,
  };
}
