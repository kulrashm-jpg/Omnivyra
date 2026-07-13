/**
 * aiCapabilityRuntime.ts — THE canonical AI execution runtime (AIC-001 §1/§4).
 *
 * One runtime, one pipeline, for every AI capability:
 *
 *   knowledge → planning → prompt assembly → tool selection → tool execution →
 *   grounding → validation → confidence → output assembly → response
 *
 * It ORCHESTRATES the existing platform — CKC-001 for knowledge, the current AI
 * gateway for the model call (via ModelRunner), existing services as tools, the
 * AUTH-001 event envelope, and HARDEN-001 observability. It reimplements none of
 * them. Deterministic given deterministic dependencies; fail-safe (returns a
 * failed/partial result, never throws); backward compatible (additive).
 */

import {
  clampConfidence, estimateTokens,
  type CapabilityRequest, type CapabilityResult, type CapabilitySource,
  type ExecutionMetadata, type PipelineStage, type ToolSummary, type ValidationSummary,
} from './capabilityContracts';
import { resolveCapability, isModelSupported, type CapabilityDefinition } from './capabilityRegistry';
import { acquireCapabilityKnowledge, defaultKnowledgeFetcher, type KnowledgeFetcher } from './capabilityKnowledge';
import {
  orchestrateTools, buildToolPlan, EMPTY_TOOL_SUMMARY, type ToolRegistry, type ToolContext,
} from './capabilityTools';
import { validateCapabilityOutput, OUTPUT_CONTRACTS, type ValidationRules } from './capabilityValidation';
import { decideRecovery, type FailureKind } from './capabilityRecovery';
import { defaultModelRunner, type ModelRunner } from './capabilityModelRunner';
import {
  emitCapabilityEvent, recordCapabilityTelemetry, resolveCapabilityCorrelationId,
} from './capabilityEvents';
import type { KnowledgeContext } from '../knowledgeConsumption/knowledgeContextContracts';

export interface CapabilityRuntimeDeps {
  knowledgeFetcher?: KnowledgeFetcher;
  toolRegistry?: ToolRegistry;
  modelRunner?: ModelRunner;
  /** Per-capability business/policy rules (composed by the validation framework). */
  rules?: Record<string, ValidationRules>;
  /** Wall clock (ms) for tool timing/duration. Injectable for determinism. */
  clockMs?: () => number;
  /** ISO clock for timestamps. Injectable for determinism. */
  nowIso?: () => string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Default deterministic prompt assembly (§4 prompt_assembly). */
function assemblePrompt(def: CapabilityDefinition, request: CapabilityRequest, knowledge: KnowledgeContext | null, toolOutputs: Record<string, unknown>) {
  const required = OUTPUT_CONTRACTS[def.outputContract] ?? [];
  const system = [
    `You are Omnivyra's ${def.id} capability. ${def.description}`,
    'Use ONLY the provided company knowledge and tool outputs. Do not fabricate facts.',
    `Respond with a single JSON object for the "${def.outputContract}" contract` + (required.length ? ` containing keys: ${required.join(', ')}.` : '.'),
  ].join(' ');
  const user = JSON.stringify({
    input: request.input ?? {},
    knowledge: knowledge?.knowledge ?? {},
    tools: toolOutputs,
  });
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/** Default deterministic output parsing. */
function parseOutput(def: CapabilityDefinition, text: string): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Lenient fallback for free-text content contracts.
    if (def.outputContract === 'content') return { body: trimmed };
    return null;
  }
}

/** Deterministic knowledge → sources (§4 grounding). */
function knowledgeSources(knowledge: KnowledgeContext | null): CapabilitySource[] {
  if (!knowledge) return [];
  return knowledge.metadata.domainsIncluded.map((d) => ({
    kind: 'knowledge' as const, ref: `knowledge:${d}@v${knowledge.metadata.version}`, domain: d,
    confidence: knowledge.metadata.confidence.byDomain[d],
  }));
}

/** Deterministic confidence assessment (§4 confidence). */
function assessConfidence(knowledge: KnowledgeContext | null, tools: ToolSummary, hasOutput: boolean): number {
  if (!hasOutput) return 0;
  const base = knowledge?.metadata.confidence.overall ?? 0;
  // Tool success factor (only when tools ran).
  const toolFactor = tools.calls.length === 0 ? 1 : (0.7 + 0.3 * (tools.okCount / tools.calls.length));
  // Freshness penalty when knowledge is flagged not-fresh.
  const freshFactor = knowledge && knowledge.metadata.freshness.fresh === false ? 0.9 : 1;
  return clampConfidence(base * toolFactor * freshFactor);
}

const FAILED_VALIDATION: ValidationSummary = { ok: false, checks: [], failures: 1 };

/**
 * Execute a capability through the canonical pipeline. Never throws.
 */
export async function executeCapability<T = unknown>(
  request: CapabilityRequest,
  deps: CapabilityRuntimeDeps = {},
): Promise<CapabilityResult<T>> {
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const startedAt = request.now ?? nowIso();
  const startMs = clockMs();
  const def = resolveCapability(request.capability);
  const cid = request.correlationId ?? (await resolveCapabilityCorrelationId(null, request.companyId));

  const baseExecution = (model: string | null, attempts: number, stages: PipelineStage[], knowledgeVersion: number | null, tokens: { input: number; output: number }, cacheUsed: boolean): ExecutionMetadata => {
    const finishedAt = nowIso();
    const durationMs = Math.max(0, (Date.parse(finishedAt) || 0) - (Date.parse(startedAt) || 0));
    return { capability: request.capability, startedAt, finishedAt, durationMs, model, attempts, resumed: false, stagesCompleted: stages, knowledgeVersion, tokens, cacheUsed };
  };

  // Unknown capability → blocked (deterministic, no side effects beyond an event).
  if (!def) {
    void emitCapabilityEvent({ event: 'CapabilityFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, capability: request.capability, reason: 'unknown_capability' });
    return { status: 'blocked', capability: request.capability, result: null, confidence: 0, sources: [], knowledgeVersion: null, execution: baseExecution(null, 0, [], null, { input: 0, output: 0 }, false), tools: EMPTY_TOOL_SUMMARY, validation: FAILED_VALIDATION, error: 'unknown_capability' };
  }

  if (!request.companyId) {
    return { status: 'blocked', capability: def.id, result: null, confidence: 0, sources: [], knowledgeVersion: null, execution: baseExecution(null, 0, [], null, { input: 0, output: 0 }, false), tools: EMPTY_TOOL_SUMMARY, validation: FAILED_VALIDATION, error: 'no_company' };
  }

  const model0 = request.model && isModelSupported(def, request.model) ? request.model : def.config.defaultModel;
  const maxAttempts = Math.max(1, (request.maxRetries ?? def.config.maxRetries) + 1);
  const rules: ValidationRules = deps.rules?.[def.id] ?? {};
  const stages: PipelineStage[] = [];

  void emitCapabilityEvent({ event: 'CapabilityRequested', outcome: 'allowed', correlationId: cid, companyId: request.companyId, capability: def.id, reason: def.id });
  void emitCapabilityEvent({ event: 'CapabilityStarted', outcome: 'allowed', correlationId: cid, companyId: request.companyId, capability: def.id, metadata: { model: model0, strategy: def.executionStrategy } });

  // ── Stage: knowledge (CKC-001) ──
  const knowledge = await acquireCapabilityKnowledge(def, request, deps.knowledgeFetcher ?? defaultKnowledgeFetcher);
  stages.push('knowledge');
  const knowledgeVersion = knowledge?.metadata.version ?? null;

  // ── Stage: planning + prompt_assembly + tool_selection + tool_execution + grounding ──
  stages.push('planning');
  const toolCtx: ToolContext = { companyId: request.companyId, input: request.input ?? {}, memo: {}, now: startedAt };
  const toolPlan = buildToolPlan(def.tools, deps.toolRegistry ?? {});
  stages.push('tool_selection');
  const tools = await orchestrateTools(toolPlan, toolCtx, clockMs);
  stages.push('tool_execution');
  const sources: CapabilitySource[] = [...knowledgeSources(knowledge), ...tools.sources];
  stages.push('grounding');

  // No knowledge AND no tool sources → recover per policy (deterministic).
  if (sources.length === 0) {
    const decision = decideRecovery({ failure: 'no_knowledge', attempt: maxAttempts, maxAttempts, hasFallbackModel: !!def.config.fallbackModel, fallbackModelUsed: false, partialAllowed: def.config.partialAllowed });
    const status = decision.action === 'partial' ? 'partial' : 'failed';
    void emitCapabilityEvent({ event: 'CapabilityFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, capability: def.id, reason: 'no_grounding' });
    const res: CapabilityResult<T> = { status, capability: def.id, result: null, confidence: 0, sources, knowledgeVersion, execution: baseExecution(model0, 0, stages, knowledgeVersion, { input: 0, output: 0 }, false), tools: tools.summary, validation: FAILED_VALIDATION, error: 'no_grounding', recovered: status === 'partial' };
    recordCapabilityTelemetry(res);
    return res;
  }

  // ── Stages: prompt_assembly → model → validation → confidence (with recovery) ──
  let attempt = 0;
  let currentModel = model0;
  let fallbackModelUsed = false;
  let recovered = false;
  let tokens = { input: 0, output: 0 };
  let cacheUsed = false;
  let lastError: string | null = null;
  // Carried across attempts so a partial/fail terminal can return the best attempt.
  let lastValidation: ValidationSummary = FAILED_VALIDATION;
  let lastParsed: unknown = null;
  let lastConfidence = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const messages = assemblePrompt(def, request, knowledge, tools.outputs);
    if (!stages.includes('prompt_assembly')) stages.push('prompt_assembly');

    let failure: FailureKind = 'none';
    let parsed: unknown = null;
    try {
      const runner = deps.modelRunner ?? defaultModelRunner;
      const out = await runner({
        capability: def.id, companyId: request.companyId, model: currentModel,
        temperature: def.config.temperature, maxTokens: def.config.maxOutputTokens,
        operation: `capability:${def.id}`, messages, responseFormatJson: true, correlationId: cid,
      });
      tokens = { input: out.tokens.input || estimateTokens(messages), output: out.tokens.output || estimateTokens(out.text) };
      cacheUsed = out.cacheUsed;
      currentModel = out.model || currentModel;
      parsed = parseOutput(def, out.text);
    } catch (err) {
      failure = 'model_error';
      lastError = err instanceof Error ? err.message : String(err);
    }

    // ── Stage: confidence + validation ──
    if (failure === 'none') {
      const hasOutput = isPlainObject(parsed) ? Object.keys(parsed).length > 0 : parsed != null;
      const confidence = assessConfidence(knowledge, tools.summary, hasOutput);
      if (!stages.includes('confidence')) stages.push('confidence');
      const validation = validateCapabilityOutput(def, parsed, { sources, confidence, input: request.input ?? {}, knowledgeAvailable: !!knowledge }, rules);
      if (!stages.includes('validation')) stages.push('validation');
      void emitCapabilityEvent({ event: 'CapabilityValidated', outcome: validation.ok ? 'allowed' : 'denied', correlationId: cid, companyId: request.companyId, capability: def.id, metadata: { failures: validation.failures, attempt } });

      if (validation.ok) {
        stages.push('output_assembly');
        const res: CapabilityResult<T> = { status: 'completed', capability: def.id, result: parsed as T, confidence, sources, knowledgeVersion, execution: baseExecution(currentModel, attempt, stages, knowledgeVersion, tokens, cacheUsed), tools: tools.summary, validation, recovered };
        void emitCapabilityEvent({ event: 'CapabilityCompleted', outcome: 'allowed', correlationId: cid, companyId: request.companyId, capability: def.id, metadata: { confidence, attempts: attempt } });
        recordCapabilityTelemetry(res);
        return res;
      }
      failure = 'validation_failure';
      lastError = validation.checks.filter((c) => !c.ok).map((c) => c.name).join(',');
      lastValidation = validation;
      lastParsed = parsed;
      lastConfidence = confidence;
    }

    // ── Recovery decision (deterministic) ──
    const decision = decideRecovery({ failure, attempt, maxAttempts, hasFallbackModel: !!def.config.fallbackModel, fallbackModelUsed, partialAllowed: def.config.partialAllowed });
    if (decision.action === 'retry') {
      void emitCapabilityEvent({ event: 'CapabilityRetried', outcome: 'allowed', correlationId: cid, companyId: request.companyId, capability: def.id, reason: decision.reason, metadata: { attempt } });
      continue;
    }
    if (decision.action === 'fallback_model') {
      currentModel = def.config.fallbackModel!;
      fallbackModelUsed = true;
      recovered = true;
      void emitCapabilityEvent({ event: 'CapabilityRecovered', outcome: 'allowed', correlationId: cid, companyId: request.companyId, capability: def.id, reason: decision.reason, metadata: { fallbackModel: currentModel } });
      continue;
    }
    // partial | fail — terminal.
    const status = decision.action === 'partial' ? 'partial' : 'failed';
    if (status === 'partial') { recovered = true; stages.push('output_assembly'); }
    const res: CapabilityResult<T> = { status, capability: def.id, result: (status === 'partial' ? (lastParsed as T) : null), confidence: status === 'partial' ? lastConfidence : 0, sources, knowledgeVersion, execution: baseExecution(currentModel, attempt, stages, knowledgeVersion, tokens, cacheUsed), tools: tools.summary, validation: lastValidation, error: lastError, recovered };
    void emitCapabilityEvent({ event: status === 'partial' ? 'CapabilityRecovered' : 'CapabilityFailed', outcome: status === 'partial' ? 'allowed' : 'denied', correlationId: cid, companyId: request.companyId, capability: def.id, reason: decision.reason, metadata: { attempts: attempt } });
    recordCapabilityTelemetry(res);
    return res;
  }

  // Loop exhausted without returning (shouldn't happen — recovery is terminal) → fail.
  const res: CapabilityResult<T> = { status: 'failed', capability: def.id, result: null, confidence: 0, sources, knowledgeVersion, execution: baseExecution(currentModel, attempt, stages, knowledgeVersion, tokens, cacheUsed), tools: tools.summary, validation: FAILED_VALIDATION, error: lastError ?? 'exhausted' };
  void emitCapabilityEvent({ event: 'CapabilityFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, capability: def.id, reason: 'exhausted' });
  recordCapabilityTelemetry(res);
  return res;
}
