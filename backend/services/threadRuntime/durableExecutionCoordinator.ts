/**
 * Phase 2 — Durable execution coordinator.
 *
 * Owns the single canonical execution lifecycle:
 *   pending → running → (waiting | recovering) → (completed | failed | abandoned)
 *
 * Every transition is gated through `transition()` so illegal moves throw
 * (in dev) or are silently denied (in prod). State changes flow through the
 * pluggable ExecutionStore so they survive restart.
 *
 * Pure / deterministic. No I/O beyond the store.
 */

import type {
  ExecutionRecord,
  ExecutionStatus,
  OrchestrationPhase,
} from './threadRuntimeTypes';
import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from './executionStore';

const LEGAL_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  pending:    ['running', 'abandoned'],
  running:    ['waiting', 'recovering', 'completed', 'failed', 'abandoned'],
  waiting:    ['running', 'recovering', 'failed', 'abandoned'],
  recovering: ['running', 'completed', 'failed', 'abandoned'],
  failed:     ['recovering', 'abandoned'],   // operator can retry a failed execution
  completed:  [],
  abandoned:  ['recovering'],                 // operator can revive an abandoned one
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ExecutionTransitionError extends Error {
  constructor(public from: ExecutionStatus, public to: ExecutionStatus) {
    super(`Illegal execution transition ${from} → ${to}`);
    this.name = 'ExecutionTransitionError';
  }
}

export interface DurableExecutionCoordinator {
  start(input: { runtimeSessionId: string; threadId: string; companyId: string; phase?: OrchestrationPhase; workerId?: string }): Promise<ExecutionRecord>;
  transition(input: { executionId: string; to: ExecutionStatus; phase?: OrchestrationPhase; failureReason?: string }): Promise<ExecutionRecord>;
  recordHeartbeat(input: { executionId: string }): Promise<ExecutionRecord | null>;
  /** Reconcile abandoned executions: stale leases → status=abandoned, ready for revival. */
  reconcileAbandoned(input: { nowMs?: number; leaseTimeoutMs: number }): Promise<{ abandonedExecutionIds: string[] }>;
  /** Convenience: get a record. */
  get(executionId: string): Promise<ExecutionRecord | null>;
}

export interface DurableExecutionCoordinatorOptions {
  store?: ExecutionStore;
  /** When true (default), illegal transitions throw. When false they're no-op. */
  strictTransitions?: boolean;
}

export function createDurableExecutionCoordinator(options?: DurableExecutionCoordinatorOptions): DurableExecutionCoordinator {
  const store = options?.store ?? getDefaultExecutionStore();
  const strict = options?.strictTransitions ?? true;

  return {
    async start(input) {
      const now = new Date().toISOString();
      const rec: ExecutionRecord = {
        executionId: newId('exec'),
        runtimeSessionId: input.runtimeSessionId,
        threadId: input.threadId,
        companyId: input.companyId,
        orchestrationPhase: input.phase ?? 'precheck',
        executionStatus: 'pending',
        executionOwner: input.workerId ?? null,
        retryCount: 0,
        recoveryState: 'idle',
        startedAt: now,
        heartbeatAt: input.workerId ? now : null,
        completedAt: null,
        failureReason: null,
        replayCheckpointId: null,
      };
      return store.createExecution(rec);
    },
    async transition(input) {
      const cur = await store.getExecution(input.executionId);
      if (!cur) throw new Error(`execution not found: ${input.executionId}`);
      const allowed = LEGAL_TRANSITIONS[cur.executionStatus];
      if (!allowed.includes(input.to)) {
        if (strict) throw new ExecutionTransitionError(cur.executionStatus, input.to);
        return cur;
      }
      const now = new Date().toISOString();
      const patch: Partial<ExecutionRecord> = {
        executionStatus: input.to,
      };
      if (input.phase) patch.orchestrationPhase = input.phase;
      if (input.to === 'completed') patch.completedAt = now;
      if (input.to === 'failed' || input.to === 'abandoned') {
        patch.failureReason = input.failureReason ?? cur.failureReason ?? null;
        patch.completedAt = patch.completedAt ?? now;
      }
      if (input.to === 'recovering') {
        patch.recoveryState = 'attempting';
        patch.retryCount = cur.retryCount + 1;
      }
      const next = await store.updateExecution(input.executionId, patch);
      return next!;
    },
    async recordHeartbeat(input) {
      const cur = await store.getExecution(input.executionId);
      if (!cur) return null;
      return store.updateExecution(input.executionId, { heartbeatAt: new Date().toISOString() });
    },
    async reconcileAbandoned(input) {
      const nowMs = input.nowMs ?? Date.now();
      const cutoffIso = new Date(nowMs - input.leaseTimeoutMs).toISOString();
      // Any execution with heartbeatAt older than cutoff AND status in {running, waiting, recovering}
      const active = await store.listExecutions({ status: ['running', 'waiting', 'recovering'], limit: 1000 });
      const abandoned: string[] = [];
      for (const e of active) {
        if (!e.heartbeatAt) continue;
        if (e.heartbeatAt > cutoffIso) continue;
        await store.updateExecution(e.executionId, {
          executionStatus: 'abandoned',
          failureReason: `heartbeat stale since ${e.heartbeatAt} (cutoff ${cutoffIso})`,
          completedAt: new Date(nowMs).toISOString(),
        });
        abandoned.push(e.executionId);
      }
      return { abandonedExecutionIds: abandoned };
    },
    async get(id) {
      return store.getExecution(id);
    },
  };
}

let _default: DurableExecutionCoordinator | null = null;
export function getDefaultDurableExecutionCoordinator(): DurableExecutionCoordinator {
  if (!_default) _default = createDurableExecutionCoordinator();
  return _default;
}
export function setDefaultDurableExecutionCoordinator(c: DurableExecutionCoordinator): void {
  _default = c;
}

export { LEGAL_TRANSITIONS };
