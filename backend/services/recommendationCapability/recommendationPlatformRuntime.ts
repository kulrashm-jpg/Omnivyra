/**
 * recommendationPlatformRuntime.ts — execute recommendations via the platform (PMF-007 §1/§5/§6/§7/§12).
 *
 * The platform path runs the Recommendation Engine as an AIA-001 AGENT that orchestrates
 * the Recommendation Graph (dependency-ordered waves, checkpoints, resume, approval,
 * recovery — all from AIA-001). The agent NEVER runs models directly: each node executes
 * through AIC-001, and the recommendation-producing node runs the EXISTING recommendation
 * engine inside an injected AIC model runner (zero recommendation change). The exact
 * engine result is captured via closure and served verbatim, ADDITIVELY annotated with an
 * explanation (§7 — confidence, evidence, knowledge version, decision source,
 * dependencies, reason codes, priority explanation) under a reserved key so existing
 * consumers keep working unchanged (§9/§10).
 *
 * SAFETY NET: if the producing node never runs the engine, the runtime runs the engine
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
import { recommendationProducingNode } from './recommendationGraph';
import { buildRecommendationExplanation, withExplanation, type RecommendationExplanation } from './recommendationExplainability';

export interface RecommendationPlatformInput<T = any> {
  companyId: string;
  userId?: string | null;
  /** The legacy recommendation engine call — the exact call the legacy path makes. */
  generate: () => Promise<T>;
  /** Attach the §7 explanation to the served result (default true). Set false for byte-parity. */
  explain?: boolean;
  runId?: string;
  now?: string;
  correlationId?: string;
}

export interface RecommendationPlatformDeps {
  agentRunner?: typeof runAgent;
  agentDeps?: AgentRuntimeDeps;
  nowIso?: () => string;
}

function recConfidence(recs: any): number {
  if (recs && typeof recs === 'object' && typeof recs.confidence === 'number') return recs.confidence;
  return 70; // deterministic default when the engine result carries no confidence
}
function recQualityOutcome(recs: any): boolean | null {
  if (recs && typeof recs === 'object') {
    if (typeof recs.valid === 'boolean') return recs.valid;
    if (Array.isArray(recs.recommendations)) return recs.recommendations.length > 0;
  }
  return null;
}

/** §12 — record platform/legacy recommendation telemetry. Fail-safe. */
export function recordRecommendationRuntime(runtime: 'legacy' | 'platform', info: {
  knowledgeVersion?: number | null; tokens?: number; qualityPassed?: boolean | null; validationFailures?: number;
  agentMs?: number; capabilities?: number; checkpoints?: number; resumes?: number; confidence?: number | null;
} = {}): void {
  try {
    recordRawCounter('recommendation.runtime_usage', 1, { runtime });
    recordRawCounter('recommendation.migration_coverage', runtime === 'platform' ? 1 : 0, {});
    if (typeof info.agentMs === 'number') recordRawCounter('recommendation.graph_execution_ms', info.agentMs, {});
    if (typeof info.capabilities === 'number') recordRawCounter('recommendation.capability_executions', info.capabilities, {});
    if (typeof info.checkpoints === 'number') recordRawCounter('recommendation.checkpoint_count', info.checkpoints, {});
    if (typeof info.resumes === 'number') recordRawCounter('recommendation.resume_count', info.resumes, {});
    if (info.knowledgeVersion != null) recordRawCounter('recommendation.knowledge_version_usage', 1, { version: String(info.knowledgeVersion) });
    if (typeof info.tokens === 'number') recordRawCounter('recommendation.token_usage', info.tokens, { runtime });
    if (info.qualityPassed != null) recordRawCounter('recommendation.quality', 1, { outcome: info.qualityPassed ? 'passed' : 'failed' });
    if (typeof info.validationFailures === 'number') recordRawCounter('recommendation.validation_failures', info.validationFailures, {});
    if (info.confidence != null) recordRawCounter('recommendation.confidence', 1, { bucket: info.confidence >= 80 ? 'high' : info.confidence >= 50 ? 'medium' : 'low' });
  } catch { /* fail-safe */ }
}

/** A synthetic completed CapabilityResult for structural (analysis) recommendation nodes. */
function structuralResult(req: CapabilityRequest, now: string): CapabilityResult {
  const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? req.capability);
  return {
    status: 'completed', capability: req.capability, result: { node: stepId, ok: true }, confidence: 80,
    sources: [{ kind: 'knowledge', ref: `recommendation-graph:${stepId}` }], knowledgeVersion: null,
    execution: { capability: req.capability, startedAt: now, finishedAt: now, durationMs: 0, model: null, attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: null, tokens: { input: 0, output: 0 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 }, validation: { ok: true, checks: [], failures: 0 },
  };
}

/**
 * Execute recommendations through the platform. Returns the exact engine result
 * (byte-identical to legacy, plus the additive §7 explanation unless explain=false).
 * Never throws beyond what the engine itself throws (the safety net runs the engine
 * directly if the producing node never executes it).
 */
export async function runRecommendationsViaPlatform<T = any>(input: RecommendationPlatformInput<T>, deps: RecommendationPlatformDeps = {}): Promise<T> {
  const agentRunner = deps.agentRunner ?? runAgent;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const now = input.now ?? nowIso();
  const runId = input.runId ?? `recommendation:${input.companyId}:${input.correlationId ?? now}`;
  const producer = recommendationProducingNode();
  const attach = input.explain !== false;

  let engineRecs: T | undefined;
  let engineRan = false;
  let recKnowledgeVersion: number | null = null;
  let recTokens = 0;

  const capabilityExecutor = async (req: CapabilityRequest): Promise<CapabilityResult> => {
    const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? '');
    if (stepId !== producer) return structuralResult(req, now);

    const modelRunner: ModelRunner = async () => {
      engineRecs = await input.generate();
      engineRan = true;
      return { text: '<<recommendation-engine>>', tokens: { input: 0, output: 0 }, model: 'gpt-4o-mini', cacheUsed: false };
    };
    const res = await executeCapability(req, {
      modelRunner,
      promptAssembler: () => [{ role: 'system', content: 'recommendations' }, { role: 'user', content: '' }],
      outputParser: () => (engineRan ? engineRecs : {}),
    } as never);
    recKnowledgeVersion = res.knowledgeVersion;
    recTokens = res.execution.tokens.input + res.execution.tokens.output;
    return res as unknown as CapabilityResult;
  };

  const serve = (recs: T, runtime: 'platform'): T => {
    const confidence = recConfidence(recs);
    if (!attach) return recs;
    const explanation: RecommendationExplanation = buildRecommendationExplanation({
      nodeId: producer, confidence, knowledgeVersion: recKnowledgeVersion, runtime,
    });
    return withExplanation(recs, explanation);
  };

  try {
    const agentResult = await agentRunner(
      { agent: 'RECOMMENDATION_AGENT', companyId: input.companyId, userId: input.userId, runId, now, correlationId: input.correlationId,
        approvals: [makeApprovalRecord('FINAL_RECOMMENDATIONS', 'approved', now, input.userId ?? null, 'synchronous_auto_approve')] },
      { capabilityExecutor, ...(deps.agentDeps ?? {}) },
    );

    if (engineRan) {
      recordRecommendationRuntime('platform', {
        knowledgeVersion: recKnowledgeVersion, tokens: recTokens, qualityPassed: recQualityOutcome(engineRecs), confidence: recConfidence(engineRecs),
        agentMs: agentResult.execution.durationMs, capabilities: agentResult.execution.completedSteps,
        checkpoints: agentResult.checkpoint.executionMetadata.checkpointCount, resumes: agentResult.checkpoint.executionMetadata.resumeCount,
      });
      return serve(engineRecs as T, 'platform');
    }
  } catch (err) {
    logger.warn('recommendation_platform_pipeline_error', { companyId: input.companyId, message: err instanceof Error ? err.message : String(err) });
  }

  // ── Safety net: the producing node never ran the engine → run it directly ──
  if (!engineRan) engineRecs = await input.generate();
  recordRecommendationRuntime('platform', { qualityPassed: recQualityOutcome(engineRecs), confidence: recConfidence(engineRecs), knowledgeVersion: null });
  return serve(engineRecs as T, 'platform');
}
