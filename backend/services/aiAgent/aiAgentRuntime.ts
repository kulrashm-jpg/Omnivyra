/**
 * aiAgentRuntime.ts — THE canonical Agent Runtime (AIA-001 §1/§3/§4).
 *
 * One runtime that plans, coordinates, schedules, resumes, recovers, monitors,
 * delegates, and completes agent executions. It NEVER performs AI inference — it
 * orchestrates capabilities through AIC-001. It drives the deterministic lifecycle,
 * persists checkpoints (resumable), keeps versioned memory, enforces approval
 * gates, applies deterministic recovery, and emits AUTH-enveloped events.
 *
 * Deterministic given deterministic dependencies (injected executor, store,
 * predicates, clocks). Fail-safe: always returns an AgentResult, never throws.
 */

import {
  emptyMemory,
  type AgentCheckpoint, type AgentMemory, type AgentRequest, type AgentResult,
  type AgentState, type AgentStatus, type ApprovalRecord, type PendingApproval,
} from './agentContracts';
import { resolveAgent, type AgentDefinition } from './agentRegistry';
import { assertAgentTransition } from './agentLifecycle';
import { reportSettingsAgentStore, type AgentStore } from './agentStateStore';
import {
  computeReadySteps, executeStep, stepIsActive, defaultCapabilityExecutor,
  type CapabilityExecutor, type PredicateRegistry,
} from './agentCapabilityOrchestrator';
import { decideApprovalGate } from './agentApproval';
import { decideAgentRecovery } from './agentRecovery';
import {
  emitAgentEvent, recordAgentTelemetry, resolveAgentCorrelationId,
} from './agentEvents';

export interface AgentRuntimeDeps {
  store?: AgentStore;
  capabilityExecutor?: CapabilityExecutor;
  predicates?: PredicateRegistry;
  nowIso?: () => string;
  clockMs?: () => number;
}

function freshCheckpoint(def: AgentDefinition, req: AgentRequest, now: string): AgentCheckpoint {
  return {
    runId: req.runId, agentId: def.id, companyId: req.companyId, state: 'CREATED',
    currentStep: 0, completedCapabilities: [], pendingCapabilities: def.steps.map((s) => s.id),
    approvals: [], memory: emptyMemory({ input: req.input ?? {}, agent: def.id, runId: req.runId }),
    executionMetadata: { createdAt: now, updatedAt: now, attempts: {}, checkpointCount: 0, resumeCount: 0 },
  };
}

function transition(cp: AgentCheckpoint, to: AgentState): void {
  assertAgentTransition(cp.state, to);
  cp.state = to;
}

/**
 * Run (or resume) an agent to its next stable state: COMPLETED, WAITING (approval),
 * BLOCKED (manual), FAILED, or CANCELLED. Never throws.
 */
export async function runAgent(request: AgentRequest, deps: AgentRuntimeDeps = {}): Promise<AgentResult> {
  const store = deps.store ?? reportSettingsAgentStore;
  const executor = deps.capabilityExecutor ?? defaultCapabilityExecutor;
  const predicates = deps.predicates ?? {};
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const startedAt = request.now ?? nowIso();

  const def = resolveAgent(request.agent);
  const cid = request.correlationId ?? (await resolveAgentCorrelationId(null, request.companyId));

  const finalize = (cp: AgentCheckpoint, status: AgentStatus, resumed: boolean, pendingApproval: PendingApproval | null = null, error: string | null = null): AgentResult => {
    const finishedAt = nowIso();
    const durationMs = Math.max(0, (Date.parse(finishedAt) || 0) - (Date.parse(startedAt) || 0));
    const results = cp.memory.intermediateResults;
    const res: AgentResult = {
      status, agent: cp.agentId, runId: cp.runId, state: cp.state, results,
      pendingApproval, checkpoint: cp, error,
      execution: { startedAt, finishedAt, durationMs, completedSteps: cp.completedCapabilities.length, totalSteps: (def?.steps.length ?? 0), resumed },
    };
    recordAgentTelemetry(res);
    return res;
  };

  if (!def) {
    const now = startedAt;
    const cp = { runId: request.runId, agentId: request.agent, companyId: request.companyId, state: 'FAILED' as AgentState, currentStep: 0, completedCapabilities: [], pendingCapabilities: [], approvals: [], memory: emptyMemory({}), executionMetadata: { createdAt: now, updatedAt: now, attempts: {}, checkpointCount: 0, resumeCount: 0 } };
    void emitAgentEvent({ event: 'AgentFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: request.agent, runId: request.runId, reason: 'unknown_agent' });
    return finalize(cp, 'failed', false, null, 'unknown_agent');
  }
  if (!request.companyId || !request.runId) {
    const cp = freshCheckpoint(def, request, startedAt); cp.state = 'FAILED';
    return finalize(cp, 'failed', false, null, 'bad_request');
  }

  // ── Load or create the run (resume vs fresh) ──
  const existing = await store.load(request.companyId, request.runId);
  const resumed = !!existing && existing.state !== 'CREATED';
  const cp: AgentCheckpoint = existing ?? freshCheckpoint(def, request, startedAt);
  const clockMs = deps.clockMs ?? (() => Date.parse(nowIso()) || 0);

  if (!existing) {
    void emitAgentEvent({ event: 'AgentCreated', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId });
    transition(cp, 'PLANNING');            // plan = def.steps (deterministic template)
    cp.pendingCapabilities = def.steps.map((s) => s.id);
    transition(cp, 'READY');
    transition(cp, 'RUNNING');
    void emitAgentEvent({ event: 'AgentStarted', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, metadata: { steps: def.steps.length } });
  } else if (cp.state === 'WAITING' || cp.state === 'BLOCKED') {
    void emitAgentEvent({ event: 'CheckpointRestored', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId });
    transition(cp, 'RESUMING');
    cp.executionMetadata.resumeCount += 1;
    void emitAgentEvent({ event: 'AgentResumed', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId });
    transition(cp, 'RUNNING');
  } else if (cp.state !== 'RUNNING') {
    // Terminal or unexpected → return as-is (idempotent).
    return finalize(cp, cp.state === 'COMPLETED' ? 'completed' : cp.state === 'CANCELLED' ? 'cancelled' : 'failed', resumed);
  }

  // Apply any approval decisions supplied on this call.
  for (const a of request.approvals ?? []) {
    cp.approvals.push(a);
    void emitAgentEvent({ event: 'ApprovalReceived', outcome: a.decision === 'approved' ? 'allowed' : 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: `${a.stepId}:${a.decision}` });
  }

  const persist = async (): Promise<void> => {
    cp.executionMetadata.updatedAt = nowIso();
    cp.executionMetadata.checkpointCount += 1;
    await store.save(request.companyId, cp);
    void emitAgentEvent({ event: 'CheckpointCreated', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, metadata: { step: cp.currentStep } });
  };

  const record = (stepId: string, outcome: string, reason: string | null = null): void => {
    cp.memory.decisionHistory.push({ at: nowIso(), step: stepId, outcome, reason });
    cp.memory.version += 1;
  };

  const done = new Set(cp.completedCapabilities);
  const maxIterations = def.steps.length * (def.config.maxStepAttempts + 2) + 2;

  for (let iter = 0; iter < maxIterations; iter++) {
    const ready = computeReadySteps(def.steps, done);
    if (ready.length === 0) break; // all steps resolved

    // Conditional gating — skip inactive steps (count as done).
    const active = ready.filter((s) => {
      if (stepIsActive(s, cp.memory, predicates)) return true;
      done.add(s.id); cp.completedCapabilities.push(s.id); record(s.id, 'skipped', 'condition_false');
      return false;
    });
    if (active.length === 0) { await persist(); continue; }

    // Approval partition: runnable now vs blocked on a gate.
    const runnable = active.filter((s) => {
      if (!s.requiresApproval) return true;
      const gate = decideApprovalGate({ stepId: s.id, approvals: cp.approvals, requestedAtMs: null, nowMs: clockMs(), timeoutMs: def.config.approvalTimeoutMs });
      return gate.outcome === 'proceed';
    });

    if (runnable.length === 0) {
      // Everything ready is approval-blocked → WAIT on the first, or reject/fail.
      const blocker = active[0];
      const gate = decideApprovalGate({ stepId: blocker.id, approvals: cp.approvals, requestedAtMs: null, nowMs: clockMs(), timeoutMs: def.config.approvalTimeoutMs });
      if (gate.decision === 'rejected') {
        transition(cp, 'FAILED');
        record(blocker.id, 'approval_rejected');
        await store.save(request.companyId, cp);
        void emitAgentEvent({ event: 'AgentFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: 'approval_rejected' });
        return finalize(cp, 'failed', resumed, null, 'approval_rejected');
      }
      // wait / resubmit → pause for approval.
      transition(cp, 'WAITING');
      const pending: PendingApproval = { stepId: blocker.id, capability: blocker.capability, requestedAt: nowIso() };
      cp.pendingCapabilities = def.steps.filter((s) => !done.has(s.id)).map((s) => s.id);
      await store.save(request.companyId, cp);
      void emitAgentEvent({ event: 'ApprovalRequested', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: blocker.id, metadata: { capability: blocker.capability } });
      void emitAgentEvent({ event: 'AgentWaiting', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: 'approval' });
      return finalize(cp, 'waiting', resumed, pending);
    }

    // ── Execute the runnable wave in parallel through AIC-001 ──
    const executions = await Promise.all(runnable.map(async (s) => {
      const priorAttempts = cp.executionMetadata.attempts[s.id] ?? 0;
      const exec = await executeStep(s, request, cp.memory, executor, false);
      return { step: s, exec, attempt: priorAttempts + 1 };
    }));

    let terminal: AgentResult | null = null;
    for (const { step: s, exec, attempt } of executions) {
      cp.executionMetadata.attempts[s.id] = attempt;
      cp.currentStep = def.steps.findIndex((x) => x.id === s.id);

      if (exec.failure === 'none') {
        cp.memory.intermediateResults[s.id] = exec.result;
        cp.memory.workingMemory[s.id] = exec.result.result;
        done.add(s.id); cp.completedCapabilities.push(s.id);
        record(s.id, exec.result.status);
        continue;
      }

      // Deterministic agent-step recovery.
      const decision = decideAgentRecovery({
        failure: exec.failure, attempt, maxAttempts: def.config.maxStepAttempts,
        hasFallbackCapability: !!s.fallbackCapability, fallbackUsed: exec.fallbackUsed,
        bestEffort: def.completionStrategy === 'best_effort', hasCheckpoint: cp.executionMetadata.checkpointCount > 0,
      });
      record(s.id, `recover:${decision.action}`, decision.reason);

      if (decision.action === 'retry_step') { continue; /* not marked done → retried next iteration */ }

      if (decision.action === 'fallback_capability') {
        const fb = await executeStep(s, request, cp.memory, executor, true);
        cp.memory.intermediateResults[s.id] = fb.result;
        if (fb.failure === 'none') {
          cp.memory.workingMemory[s.id] = fb.result.result;
          done.add(s.id); cp.completedCapabilities.push(s.id);
          record(s.id, `fallback:${fb.result.status}`);
          continue;
        }
        record(s.id, 'fallback_failed', fb.result.error);
        if (def.completionStrategy === 'best_effort') {
          done.add(s.id); cp.completedCapabilities.push(s.id);
          continue;
        }
        transition(cp, 'FAILED');
        await store.save(request.companyId, cp);
        void emitAgentEvent({ event: 'AgentFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: 'fallback_failed' });
        terminal = finalize(cp, 'failed', resumed, null, 'fallback_failed');
        break;
      }

      if (decision.action === 'partial') {
        cp.memory.intermediateResults[s.id] = exec.result;
        done.add(s.id); cp.completedCapabilities.push(s.id);
        record(s.id, 'partial_accepted');
        continue;
      }

      if (decision.action === 'manual' || decision.action === 'rollback') {
        transition(cp, 'BLOCKED');
        cp.pendingCapabilities = def.steps.filter((x) => !done.has(x.id)).map((x) => x.id);
        await store.save(request.companyId, cp);
        void emitAgentEvent({ event: 'AgentWaiting', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: decision.action });
        terminal = finalize(cp, 'blocked', resumed, null, decision.reason);
        break;
      }

      // fail
      transition(cp, 'FAILED');
      await store.save(request.companyId, cp);
      void emitAgentEvent({ event: 'AgentFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: decision.reason });
      terminal = finalize(cp, 'failed', resumed, null, exec.result.error ?? decision.reason);
      break;
    }

    if (terminal) return terminal;

    if (def.config.checkpointEveryStep) await persist();
  }

  // ── Completion ──
  const allResolved = def.steps.every((s) => done.has(s.id));
  const anyPartial = Object.values(cp.memory.intermediateResults).some((r) => r.status === 'partial') || cp.memory.decisionHistory.some((d) => d.outcome === 'partial_accepted' || d.outcome === 'fallback_failed');

  if (!allResolved) {
    transition(cp, 'FAILED');
    await store.save(request.companyId, cp);
    void emitAgentEvent({ event: 'AgentFailed', outcome: 'denied', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, reason: 'loop_guard_unresolved' });
    return finalize(cp, 'failed', resumed, null, 'loop_guard_unresolved');
  }

  transition(cp, 'COMPLETED');
  cp.pendingCapabilities = [];
  await store.save(request.companyId, cp);
  void emitAgentEvent({ event: 'AgentCompleted', outcome: 'allowed', correlationId: cid, companyId: request.companyId, agent: def.id, runId: cp.runId, metadata: { steps: cp.completedCapabilities.length } });
  return finalize(cp, anyPartial ? 'partial' : 'completed', resumed);
}

/** Resume convenience — same as runAgent with approvals supplied. */
export async function resumeAgent(request: AgentRequest, deps: AgentRuntimeDeps = {}): Promise<AgentResult> {
  return runAgent(request, deps);
}

/** Cancel a run (deterministic terminal). Never throws. */
export async function cancelAgent(companyId: string, runId: string, deps: AgentRuntimeDeps = {}): Promise<boolean> {
  const store = deps.store ?? reportSettingsAgentStore;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const cp = await store.load(companyId, runId);
  if (!cp) return false;
  if (cp.state === 'COMPLETED' || cp.state === 'FAILED' || cp.state === 'CANCELLED') return false;
  cp.state = 'CANCELLED';
  cp.executionMetadata.updatedAt = nowIso();
  await store.save(companyId, cp);
  const cid = await resolveAgentCorrelationId(null, companyId);
  void emitAgentEvent({ event: 'AgentCancelled', outcome: 'allowed', correlationId: cid, companyId, agent: cp.agentId, runId });
  return true;
}
