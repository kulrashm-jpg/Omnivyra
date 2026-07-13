/**
 * campaignPlatformRuntime.ts — execute the Campaign Planner via the platform (PMF-005 §1/§4/§6/§11).
 *
 * The platform path runs the Campaign Planner as an AIA-001 AGENT that orchestrates
 * the capability graph (dependency-ordered waves, checkpoints, resume, approval,
 * recovery — all from AIA-001). The agent NEVER runs models directly: each graph
 * node executes through AIC-001, and the plan-producing node runs the EXISTING
 * planner engine inside an injected AIC model runner (zero prompt/quality change).
 * The exact engine plan is captured via closure and served verbatim (parity).
 *
 * The synchronous planner has no human approval gate today, so the modeled approval
 * gate on CAMPAIGN_VALIDATION is auto-approved here (preserving current behavior);
 * an async/review workflow would withhold approval and require a human decision.
 *
 * SAFETY NET: if the plan node never runs the engine (e.g. AIC grounding guard trips
 * on a company with no CKC knowledge), the runtime runs the engine directly — so the
 * platform path can never be worse than legacy.
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest, CapabilityResult } from '../aiCapability/capabilityContracts';
import type { ModelRunner } from '../aiCapability/capabilityModelRunner';
import { runAgent } from '../aiAgent/aiAgentRuntime';
import type { AgentRuntimeDeps } from '../aiAgent/aiAgentRuntime';
import { makeApprovalRecord } from '../aiAgent/agentApproval';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { planProducingCapability } from './campaignCapabilityGraph';

export interface CampaignPlatformInput<T = any> {
  companyId: string;
  userId?: string | null;
  /** The legacy planner engine call — the exact call the legacy path makes. */
  generate: () => Promise<T>;
  runId?: string;
  now?: string;
  correlationId?: string;
}

export interface CampaignPlatformDeps {
  agentRunner?: typeof runAgent;
  agentDeps?: AgentRuntimeDeps;
  nowIso?: () => string;
}

function planQualityOutcome(plan: any): boolean | null {
  if (plan && typeof plan === 'object') {
    if (plan.validation_result && typeof plan.validation_result.valid === 'boolean') return plan.validation_result.valid;
    if (plan.campaign_validation && typeof plan.campaign_validation.passed === 'boolean') return plan.campaign_validation.passed;
  }
  return null;
}

/** §11 — record platform/legacy campaign-planner telemetry. Fail-safe. */
export function recordCampaignRuntime(runtime: 'legacy' | 'platform', info: {
  knowledgeVersion?: number | null; tokens?: number; qualityPassed?: boolean | null; validationFailures?: number;
  agentMs?: number; capabilities?: number; checkpoints?: number; resumes?: number;
} = {}): void {
  try {
    recordRawCounter('campaign.runtime_usage', 1, { runtime });
    recordRawCounter('campaign.migration_coverage', runtime === 'platform' ? 1 : 0, {});
    if (typeof info.agentMs === 'number') recordRawCounter('campaign.agent_execution_ms', info.agentMs, {});
    if (typeof info.capabilities === 'number') recordRawCounter('campaign.capability_executions', info.capabilities, {});
    if (typeof info.checkpoints === 'number') recordRawCounter('campaign.checkpoint_count', info.checkpoints, {});
    if (typeof info.resumes === 'number') recordRawCounter('campaign.resume_count', info.resumes, {});
    if (info.knowledgeVersion != null) recordRawCounter('campaign.knowledge_version_usage', 1, { version: String(info.knowledgeVersion) });
    if (typeof info.tokens === 'number') recordRawCounter('campaign.token_usage', info.tokens, { runtime });
    if (info.qualityPassed != null) recordRawCounter('campaign.planning_quality', 1, { outcome: info.qualityPassed ? 'passed' : 'failed' });
    if (typeof info.validationFailures === 'number') recordRawCounter('campaign.validation_failures', info.validationFailures, {});
  } catch { /* fail-safe */ }
}

/** A synthetic completed CapabilityResult for structural (analysis/validation) graph nodes. */
function structuralResult(req: CapabilityRequest, now: string): CapabilityResult {
  const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? req.capability);
  return {
    status: 'completed', capability: req.capability, result: { node: stepId, ok: true }, confidence: 80,
    sources: [{ kind: 'knowledge', ref: `campaign-graph:${stepId}` }], knowledgeVersion: null,
    execution: { capability: req.capability, startedAt: now, finishedAt: now, durationMs: 0, model: null, attempts: 1, resumed: false, stagesCompleted: [], knowledgeVersion: null, tokens: { input: 0, output: 0 }, cacheUsed: false },
    tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 }, validation: { ok: true, checks: [], failures: 0 },
  };
}

/**
 * Execute campaign planning through the platform. Returns the exact engine plan
 * (byte-identical to legacy). Never throws beyond what the engine itself throws (the
 * safety net runs the engine directly if the plan node never executes it).
 */
export async function runCampaignPlanViaPlatform<T = any>(input: CampaignPlatformInput<T>, deps: CampaignPlatformDeps = {}): Promise<T> {
  const agentRunner = deps.agentRunner ?? runAgent;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const now = input.now ?? nowIso();
  const runId = input.runId ?? `campaign:${input.companyId}:${input.correlationId ?? now}`;
  const planNode = planProducingCapability();

  let enginePlan: T | undefined;
  let engineRan = false;
  let planKnowledgeVersion: number | null = null;
  let planTokens = 0;

  // The agent's capability executor: the plan node runs the engine inside AIC; other
  // nodes are structural (no engine, no extra inference — they orchestrate only).
  const capabilityExecutor = async (req: CapabilityRequest): Promise<CapabilityResult> => {
    const stepId = String((req.input as { __agentStep?: unknown } | undefined)?.__agentStep ?? '');
    if (stepId !== planNode) return structuralResult(req, now);

    const modelRunner: ModelRunner = async () => {
      enginePlan = await input.generate();
      engineRan = true;
      return { text: '<<campaign-planner-engine>>', tokens: { input: 0, output: 0 }, model: 'gpt-4o-mini', cacheUsed: false };
    };
    const res = await executeCapability(req, {
      modelRunner,
      promptAssembler: () => [{ role: 'system', content: 'campaign-plan' }, { role: 'user', content: '' }],
      outputParser: () => (engineRan ? enginePlan : {}),
    } as never);
    planKnowledgeVersion = res.knowledgeVersion;
    planTokens = res.execution.tokens.input + res.execution.tokens.output;
    return res as unknown as CapabilityResult;
  };

  try {
    const agentResult = await agentRunner(
      { agent: 'CAMPAIGN_PLANNER_AGENT', companyId: input.companyId, userId: input.userId, runId, now, correlationId: input.correlationId,
        // Auto-approve the modeled validation gate for the synchronous path (no human gate today).
        approvals: [makeApprovalRecord('CAMPAIGN_VALIDATION', 'approved', now, input.userId ?? null, 'synchronous_auto_approve')] },
      { capabilityExecutor, ...(deps.agentDeps ?? {}) },
    );

    if (engineRan) {
      recordCampaignRuntime('platform', {
        knowledgeVersion: planKnowledgeVersion, tokens: planTokens, qualityPassed: planQualityOutcome(enginePlan),
        agentMs: agentResult.execution.durationMs, capabilities: agentResult.execution.completedSteps,
        checkpoints: agentResult.checkpoint.executionMetadata.checkpointCount, resumes: agentResult.checkpoint.executionMetadata.resumeCount,
      });
      return enginePlan as T;
    }
  } catch (err) {
    logger.warn('campaign_platform_pipeline_error', { companyId: input.companyId, message: err instanceof Error ? err.message : String(err) });
  }

  // ── Safety net: the plan node never ran the engine → run it directly ──
  if (!engineRan) enginePlan = await input.generate();
  recordCampaignRuntime('platform', { qualityPassed: planQualityOutcome(enginePlan), knowledgeVersion: null });
  return enginePlan as T;
}
