/**
 * agentCapabilityOrchestrator.ts — capability orchestration (AIA-001 §4).
 *
 * Agents execute ONLY through AIC-001. This module resolves the plan into
 * dependency-ordered waves (parallel within a wave, sequential across waves),
 * evaluates conditional gates, and runs each step's capability via the injected
 * CapabilityExecutor (default = executeCapability). It NEVER runs inference,
 * assembles prompts, or reads Company Knowledge — AIC does all of that.
 */

import { executeCapability } from '../aiCapability/aiCapabilityRuntime';
import type { CapabilityRequest, CapabilityResult } from '../aiCapability/capabilityContracts';
import type { AgentMemory, AgentRequest, AgentStep } from './agentContracts';
import type { StepFailureKind } from './agentRecovery';

/** The capability executor the orchestrator depends on (injectable for tests). */
export type CapabilityExecutor = (req: CapabilityRequest) => Promise<CapabilityResult>;

export const defaultCapabilityExecutor: CapabilityExecutor = (req) => executeCapability(req);

/** Named predicates for conditional steps (injected). */
export type PredicateRegistry = Record<string, (memory: AgentMemory) => boolean>;

/** Steps whose dependencies are all satisfied and which are not yet done. Deterministic order. */
export function computeReadySteps(steps: AgentStep[], done: Set<string>): AgentStep[] {
  return steps
    .filter((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** True when a conditional step's predicate holds (or it is unconditional). */
export function stepIsActive(step: AgentStep, memory: AgentMemory, predicates: PredicateRegistry): boolean {
  if (!step.when) return true;
  const p = predicates[step.when];
  return p ? !!p(memory) : true; // unknown predicate → do not block (fail-open, deterministic)
}

/** Build the capability request for a step. Prior results flow via working memory. */
export function buildCapabilityRequest(agentReq: AgentRequest, step: AgentStep, memory: AgentMemory, capability = step.capability): CapabilityRequest {
  return {
    capability,
    companyId: agentReq.companyId,
    userId: agentReq.userId,
    input: {
      ...(agentReq.input ?? {}),
      ...(step.input ?? {}),
      __agentStep: step.id,
      __priorResults: Object.fromEntries(Object.entries(memory.intermediateResults).map(([k, v]) => [k, v.result])),
      __working: memory.workingMemory,
    },
    now: agentReq.now,
    correlationId: agentReq.correlationId,
  };
}

/** Map a capability result to an agent step failure kind. Partial is accepted as usable. */
export function stepFailureKind(result: CapabilityResult): StepFailureKind {
  switch (result.status) {
    case 'completed':
    case 'partial':  return 'none';
    case 'blocked':  return 'capability_blocked';
    case 'failed':
    default:         return 'capability_failed';
  }
}

export interface StepExecution {
  result: CapabilityResult;
  failure: StepFailureKind;
  fallbackUsed: boolean;
}

/**
 * Execute one step through AIC-001, optionally via its fallback capability.
 * Never throws — a thrown executor is surfaced as a failed capability result-shaped
 * failure so the agent recovery model can act on it deterministically.
 */
export async function executeStep(
  step: AgentStep,
  agentReq: AgentRequest,
  memory: AgentMemory,
  executor: CapabilityExecutor,
  useFallback: boolean,
): Promise<StepExecution> {
  const capability = useFallback && step.fallbackCapability ? step.fallbackCapability : step.capability;
  const req = buildCapabilityRequest(agentReq, step, memory, capability);
  try {
    const result = await executor(req);
    return { result, failure: stepFailureKind(result), fallbackUsed: useFallback };
  } catch (err) {
    const now = agentReq.now ?? new Date().toISOString();
    const failedResult: CapabilityResult = {
      status: 'failed', capability, result: null, confidence: 0, sources: [], knowledgeVersion: null,
      execution: { capability, startedAt: now, finishedAt: now, durationMs: 0, model: null, attempts: 0, resumed: false, stagesCompleted: [], knowledgeVersion: null, tokens: { input: 0, output: 0 }, cacheUsed: false },
      tools: { calls: [], totalMs: 0, okCount: 0, failedCount: 0 },
      validation: { ok: false, checks: [], failures: 1 },
      error: err instanceof Error ? err.message : String(err),
    };
    return { result: failedResult, failure: 'capability_failed', fallbackUsed: useFallback };
  }
}
