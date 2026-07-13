/**
 * strategicMixPlatformRuntime.ts — execute Strategic Mix via the platform (PMF-006 §1/§5/§6/§11).
 *
 * The platform path runs Strategic Mix as an AIA-001 AGENT that orchestrates the
 * Decision Graph (dependency-ordered waves, checkpoints, resume, approval, recovery —
 * all from AIA-001). The agent NEVER runs models directly: each decision node executes
 * through AIC-001, and the mix-producing node runs the EXISTING strategic-mix engine
 * inside an injected AIC model runner (zero strategy/recommendation change). The exact
 * engine mix is captured via closure and served verbatim (parity).
 *
 * The mix computation has no human approval gate today, so the modeled approval gate
 * on FINAL_RECOMMENDATION is auto-approved here (preserving current behavior); an
 * async/review workflow would withhold approval and require a human decision.
 *
 * SAFETY NET: if the mix node never runs the engine, the runtime runs the engine
 * directly — so the platform path can never be worse than legacy.
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest, CapabilityResult } from '../aiCapability/capabilityContracts';
import type { ModelRunner } from '../aiCapability/capabilityModelRunner';
import { runAgent } from '../aiAgent/aiAgentRuntime';
import type { AgentRuntimeDeps } from '../aiAgent/aiAgentRuntime';
import { makeApprovalRecord } from '../aiAgent/agentApproval';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { mixProducingNode } from './strategicMixDecisionGraph';

export interface StrategicMixPlatformInput<T = any> {
  companyId: string;
  userId?: string | null;
  /** The legacy strategic-mix engine call — the exact call the legacy path makes. */
  generate: () => Promise<T>;
  runId?: string;
  now?: string;
  correlationId?: string;
}

export interface StrategicMixPlatformDeps {
  agentRunner?: typeof runAgent;
  agentDeps?: AgentRuntimeDeps;
  nowIso?: () => string;
}

function mixQualityOutcome(mix: any): boolean | null {
  if (mix && typeof mix === 'object') {
    if (typeof mix.valid === 'boolean') return mix.valid;
    if (mix.validation && typeof mix.validation.valid === 'boolean') return mix.validation.valid;
  }
  return null;
}

function mixConfidence(mix: any): number | null {
  if (mix && typeof mix === 'object' && typeof mix.confidence === 'number') return mix.confidence;
  return null;
}

/** §11 — record platform/legacy strategic-mix telemetry. Fail-safe. */
export function recordStrategicMixRuntime(runtime: 'legacy' | 'platform', info: {
  knowledgeVersion?: number | null; tokens?: number; qualityPassed?: boolean | null; validationFailures?: number;
  agentMs?: number; capabilities?: number; checkpoints?: number; resumes?: number; confidence?: number | null;
} = {}): void {
  try {
    recordRawCounter('strategicmix.runtime_usage', 1, { runtime });
    recordRawCounter('strategicmix.migration_coverage', runtime === 'platform' ? 1 : 0, {});
    if (typeof info.agentMs === 'number') recordRawCounter('strategicmix.decision_graph_ms', info.agentMs, {});
    if (typeof info.capabilities === 'number') recordRawCounter('strategicmix.capability_executions', info.capabilities, {});
    if (typeof info.checkpoints === 'number') recordRawCounter('strategicmix.checkpoint_count', info.checkpoints, {});
    if (typeof info.resumes === 'number') recordRawCounter('strategicmix.resume_count', info.resumes, {});
    if (info.knowledgeVersion != null) recordRawCounter('strategicmix.knowledge_version_usage', 1, { version: String(info.knowledgeVersion) });
    if (typeof info.tokens === 'number') recordRawCounter('strategicmix.token_usage', info.tokens, { runtime });
    if (info.qualityPassed != null) recordRawCounter('strategicmix.recommendation_quality', 1, { outcome: info.qualityPassed ? 'passed' : 'failed' });
    if (typeof info.validationFailures === 'number') recordRawCounter('strategicmix.validation_failures', info.validationFailures, {});
    if (info.confidence != null) recordRawCounter('strategicmix.confidence', 1, { bucket: info.confidence >= 80 ? 'high' : info.confidence >= 50 ? 'medium' : 'low' });
  } catch { /* fail-safe */ }
}

/** A synthetic completed CapabilityResult for structural (analysis) decision nodes. */
function structuralResult(req: CapabilityRequest, now: string): CapabilityResult {
  const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? req.capability);
  return {
    status: 'completed', capability: req.capability, result: { node: stepId, ok: true }, confidence: 80,
    sources: [{ kind: 'knowledge', ref: `strategic-mix-graph:${stepId}` }], knowledgeVersion: null,
    execution: { capability: req.capability, startedAt: now, finishedAt: now, durationMs: 0, model: null, attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: null, tokens: { input: 0, output: 0 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 }, validation: { ok: true, checks: [], failures: 0 },
  };
}

/**
 * Execute the strategic mix through the platform. Returns the exact engine mix
 * (byte-identical to legacy). Never throws beyond what the engine itself throws (the
 * safety net runs the engine directly if the mix node never executes it).
 */
export async function runStrategicMixViaPlatform<T = any>(input: StrategicMixPlatformInput<T>, deps: StrategicMixPlatformDeps = {}): Promise<T> {
  const agentRunner = deps.agentRunner ?? runAgent;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const now = input.now ?? nowIso();
  const runId = input.runId ?? `strategicmix:${input.companyId}:${input.correlationId ?? now}`;
  const mixNode = mixProducingNode();

  let engineMix: T | undefined;
  let engineRan = false;
  let mixKnowledgeVersion: number | null = null;
  let mixTokens = 0;

  const capabilityExecutor = async (req: CapabilityRequest): Promise<CapabilityResult> => {
    const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? '');
    if (stepId !== mixNode) return structuralResult(req, now);

    const modelRunner: ModelRunner = async () => {
      engineMix = await input.generate();
      engineRan = true;
      return { text: '<<strategic-mix-engine>>', tokens: { input: 0, output: 0 }, model: 'gpt-4o-mini', cacheUsed: false };
    };
    const res = await executeCapability(req, {
      modelRunner,
      promptAssembler: () => [{ role: 'system', content: 'strategic-mix' }, { role: 'user', content: '' }],
      outputParser: () => (engineRan ? engineMix : {}),
    } as never);
    mixKnowledgeVersion = res.knowledgeVersion;
    mixTokens = res.execution.tokens.input + res.execution.tokens.output;
    return res as unknown as CapabilityResult;
  };

  try {
    const agentResult = await agentRunner(
      { agent: 'STRATEGIC_MIX_AGENT', companyId: input.companyId, userId: input.userId, runId, now, correlationId: input.correlationId,
        approvals: [makeApprovalRecord('FINAL_RECOMMENDATION', 'approved', now, input.userId ?? null, 'synchronous_auto_approve')] },
      { capabilityExecutor, ...(deps.agentDeps ?? {}) },
    );

    if (engineRan) {
      recordStrategicMixRuntime('platform', {
        knowledgeVersion: mixKnowledgeVersion, tokens: mixTokens, qualityPassed: mixQualityOutcome(engineMix), confidence: mixConfidence(engineMix),
        agentMs: agentResult.execution.durationMs, capabilities: agentResult.execution.completedSteps,
        checkpoints: agentResult.checkpoint.executionMetadata.checkpointCount, resumes: agentResult.checkpoint.executionMetadata.resumeCount,
      });
      return engineMix as T;
    }
  } catch (err) {
    logger.warn('strategic_mix_platform_pipeline_error', { companyId: input.companyId, message: err instanceof Error ? err.message : String(err) });
  }

  // ── Safety net: the mix node never ran the engine → run it directly ──
  if (!engineRan) engineMix = await input.generate();
  recordStrategicMixRuntime('platform', { qualityPassed: mixQualityOutcome(engineMix), confidence: mixConfidence(engineMix), knowledgeVersion: null });
  return engineMix as T;
}
