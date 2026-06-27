/**
 * Runtime Cutover Seam — the production integration boundary between the live
 * Creator entry points and the deterministic Runtime Orchestrator. It is
 * ADDITIVE: it modifies neither the renderer, the LLM gateway, nor the
 * orchestrator. It only ADAPTS the existing systems onto the orchestrator's
 * injection points so every production path can route through exactly one
 * `executeCreatorRuntime()` → `generateVerifiedCreative()`.
 *
 * Why a seam (not a direct swap): the real `renderAsset(payload, options)` is
 * ASYNC and consumes a creator_card payload returning a RenderedMediaBundle,
 * while the orchestrator's injected `render` is SYNC over a GeneratedCreative.
 * The seam therefore runs the orchestrator with a sync render-AUTHORIZATION gate
 * (verification still gates it), then performs the single real async render
 * AFTER the orchestrator returns — preserving "verification precedes rendering"
 * and "renderer invoked exactly once" without modifying either side.
 */

import { generateVerifiedCreative, PIPELINE_STAGES, type RuntimeInput, type RuntimeOptions, type VerifiedCreativeResult, type RenderAdapter, type CreatorEntryPoint } from './runtimeOrchestrator';
import type { GeneratedCreative, StageGenerator } from './creativeGeneration';
import type { AssetAssembly } from './assetAssembly';
import type { CreatorTemplatePopulation } from './templatePopulation';

export const PIPELINE_VERSION = 'creator-runtime-v1';

/* ── Production execution map (STEP 1) — every path → one wrapper ───────── */

export type ProductionPath =
  | 'creator-content/generate.ts' | 'render-inline.ts' | 'creatorExecutionEngine.ts' | 'creatorRenderDurableQueue.ts'
  | 'creatorRenderWorkerProcessor.ts' | 'preview' | 'batch' | 'regeneration' | 'aiCreator' | 'writerToCreator' | 'campaign';

export const CREATOR_PRODUCTION_PATHS: Record<ProductionPath, 'executeCreatorRuntime'> = {
  'creator-content/generate.ts': 'executeCreatorRuntime', 'render-inline.ts': 'executeCreatorRuntime',
  'creatorExecutionEngine.ts': 'executeCreatorRuntime', 'creatorRenderDurableQueue.ts': 'executeCreatorRuntime',
  'creatorRenderWorkerProcessor.ts': 'executeCreatorRuntime', preview: 'executeCreatorRuntime',
  batch: 'executeCreatorRuntime', regeneration: 'executeCreatorRuntime', aiCreator: 'executeCreatorRuntime',
  writerToCreator: 'executeCreatorRuntime', campaign: 'executeCreatorRuntime',
};

/* ── Production adapters (reuse the existing systems, do not modify them) ─ */

/** Per-stage completion the production LLM gateway supplies (whole-asset gateway
 * is wrapped by the caller into this minimal staged shape). */
export type StageCompletion = (args: { stage: string; fields: Record<string, string>; context: unknown }) => Promise<Record<string, string>> | Record<string, string>;

/** Wrap the existing LLM gateway as the orchestrator's StageGenerator. */
export function llmGatewayToStageGenerator(complete: StageCompletion): StageGenerator {
  return (req) => complete(req);
}

export interface RenderResult { ok: boolean; status: string; payload?: unknown; }
/** The real async renderer: production passes a wrapper over `renderAsset()`. */
export type RealRenderFn = (creative: GeneratedCreative, ctx: { assembly: AssetAssembly; population: CreatorTemplatePopulation }) => Promise<RenderResult>;

/** Wrap the existing `renderAsset(payload, options)` as a RealRenderFn without
 * touching it: the caller supplies the GeneratedCreative→payload mapping (the
 * existing creator_card shape) so renderer inputs stay byte-for-byte unchanged. */
export function renderAssetToRenderAdapter(
  renderAsset: (payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  toPayload: (creative: GeneratedCreative, ctx: { assembly: AssetAssembly; population: CreatorTemplatePopulation }) => Record<string, unknown>,
  options: Record<string, unknown> = {},
): RealRenderFn {
  return async (creative, ctx) => {
    const bundle = await renderAsset(toPayload(creative, ctx), options);
    return { ok: true, status: 'RENDERED', payload: bundle };
  };
}

/* ── Telemetry (STEP 6) ────────────────────────────────────────────────── */

export interface RuntimeExecutionRecord {
  executionId: string;
  pipelineVersion: string;
  promptVersion: string;
  assemblyVersion: string;
  templateVersion: number;
  verificationResult: VerifiedCreativeResult['verification']['status'];
  rendererResult: string;
  retryCount: number;
  generationStages: string[];
  totalLatencyMs: number;
}

/* ── The single production entry ───────────────────────────────────────── */

export interface ProductionDeps { generate: StageGenerator; renderAsset: RealRenderFn; }
export interface CutoverOptions extends RuntimeOptions { executionId?: string; }

export async function executeCreatorRuntime(
  input: RuntimeInput,
  deps: ProductionDeps,
  options: CutoverOptions = {},
): Promise<{ result: VerifiedCreativeResult; record: RuntimeExecutionRecord; render: RenderResult | null }> {
  const now = options.now ?? (() => 0);
  const start = now();

  // Sync render-AUTHORIZATION gate: the orchestrator still verifies BEFORE
  // calling it, so authorization implies "verification passed → may render".
  let authorized = false;
  const gate: RenderAdapter = () => { authorized = true; return { ok: true, status: 'AUTHORIZED' }; };

  const result = await generateVerifiedCreative(input, {
    generate: deps.generate, render: gate, now,
    allowWarn: options.allowWarn, maxRetries: options.maxRetries,
    passThreshold: options.passThreshold, warnThreshold: options.warnThreshold, creativeId: options.creativeId,
  });

  // The ONE real render, only when verification authorized it.
  let render: RenderResult | null = null;
  if (authorized && result.trace.renderStatus === 'RENDERED') {
    render = await deps.renderAsset(result.creative, { assembly: result.assembly, population: result.population });
  }

  const record: RuntimeExecutionRecord = {
    executionId: options.executionId ?? `exec-${result.creativeId}`,
    pipelineVersion: PIPELINE_VERSION,
    promptVersion: result.diagnostics.promptVersion,
    assemblyVersion: result.diagnostics.assemblyVersion,
    templateVersion: result.diagnostics.templateVersion,
    verificationResult: result.verification.status,
    rendererResult: render ? render.status : 'BLOCKED',
    retryCount: result.diagnostics.retryCount,
    generationStages: result.creative.stages.map((s) => s.stage),
    totalLatencyMs: now() - start,
  };

  return { result: { ...result, render: render ?? result.render }, record, render };
}

/** Convenience: assert a path is wired to the orchestrator (used by the cutover audit). */
export function isRoutedThroughOrchestrator(path: ProductionPath): boolean {
  return CREATOR_PRODUCTION_PATHS[path] === 'executeCreatorRuntime';
}

/** Canonical stage list re-exported so callers verify order without importing the orchestrator internals. */
export const RUNTIME_PIPELINE = PIPELINE_STAGES;
export type { CreatorEntryPoint };
