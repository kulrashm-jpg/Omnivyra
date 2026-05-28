/**
 * Phase 1 substrate — Execution store interface.
 *
 * Pluggable persistence for `ExecutionRecord` + `ExecutionCheckpoint` +
 * `ExecutionLease`. Default implementation is in-memory so the durable
 * execution layer is testable without a database. A Supabase-backed
 * implementation can drop in once the `thread_runtime_executions`
 * migration is applied.
 *
 * No I/O at construction; backends are caller-supplied via
 * `setDefaultExecutionStore`.
 */

import type {
  ExecutionCheckpoint,
  ExecutionLease,
  ExecutionRecord,
  ExecutionStatus,
  OrchestrationPhase,
} from './threadRuntimeTypes';

export interface ExecutionStore {
  // ── Execution lifecycle ───────────────────────────────────────────
  createExecution(record: ExecutionRecord): Promise<ExecutionRecord>;
  getExecution(executionId: string): Promise<ExecutionRecord | null>;
  updateExecution(executionId: string, patch: Partial<Pick<ExecutionRecord,
    | 'orchestrationPhase' | 'executionStatus' | 'executionOwner'
    | 'retryCount' | 'recoveryState' | 'heartbeatAt' | 'completedAt'
    | 'failureReason' | 'replayCheckpointId'>>
  ): Promise<ExecutionRecord | null>;
  listExecutions(input: { companyId?: string; threadId?: string; status?: ExecutionStatus | ExecutionStatus[]; limit?: number }): Promise<ExecutionRecord[]>;

  // ── Checkpoints ──────────────────────────────────────────────────
  recordCheckpoint(cp: ExecutionCheckpoint): Promise<ExecutionCheckpoint>;
  listCheckpoints(executionId: string): Promise<ExecutionCheckpoint[]>;
  getCheckpoint(checkpointId: string): Promise<ExecutionCheckpoint | null>;

  // ── Leases ───────────────────────────────────────────────────────
  acquireLease(input: { executionId: string; workerId: string; durationMs: number; nowMs?: number }): Promise<ExecutionLease | null>;
  renewLease(input: { leaseId: string; durationMs: number; nowMs?: number }): Promise<ExecutionLease | null>;
  releaseLease(leaseId: string): Promise<void>;
  currentLease(executionId: string): Promise<ExecutionLease | null>;
  listExpiredLeases(input: { nowMs: number; limit?: number }): Promise<ExecutionLease[]>;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInMemoryExecutionStore(options?: {
  maxExecutionsPerCompany?: number;
  maxCheckpointsPerExecution?: number;
}): ExecutionStore {
  const execCap = Math.max(50, options?.maxExecutionsPerCompany ?? 1000);
  const cpCap = Math.max(5, options?.maxCheckpointsPerExecution ?? 50);
  const executions = new Map<string, ExecutionRecord>();
  const checkpoints = new Map<string, ExecutionCheckpoint[]>(); // executionId → cps
  const leases = new Map<string, ExecutionLease>();              // leaseId → lease
  const activeLeaseByExec = new Map<string, string>();           // executionId → leaseId

  function ensureCompanyCapacity(companyId: string): void {
    const list = Array.from(executions.values())
      .filter((e) => e.companyId === companyId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    while (list.length > execCap) {
      const oldest = list.shift();
      if (!oldest) break;
      executions.delete(oldest.executionId);
      checkpoints.delete(oldest.executionId);
    }
  }

  return {
    async createExecution(record) {
      executions.set(record.executionId, { ...record });
      ensureCompanyCapacity(record.companyId);
      return { ...record };
    },
    async getExecution(id) {
      const e = executions.get(id);
      return e ? { ...e } : null;
    },
    async updateExecution(id, patch) {
      const e = executions.get(id);
      if (!e) return null;
      const next: ExecutionRecord = { ...e, ...patch };
      executions.set(id, next);
      return { ...next };
    },
    async listExecutions(input) {
      const limit = Math.max(1, input.limit ?? 100);
      const statusSet = input.status
        ? new Set(Array.isArray(input.status) ? input.status : [input.status])
        : null;
      const out: ExecutionRecord[] = [];
      executions.forEach((e) => {
        if (input.companyId && e.companyId !== input.companyId) return;
        if (input.threadId && e.threadId !== input.threadId) return;
        if (statusSet && !statusSet.has(e.executionStatus)) return;
        out.push({ ...e });
      });
      out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return out.slice(0, limit);
    },
    async recordCheckpoint(cp) {
      const arr = checkpoints.get(cp.executionId) ?? [];
      arr.push({ ...cp });
      while (arr.length > cpCap) arr.shift();
      checkpoints.set(cp.executionId, arr);
      // Sync executionrecord.replayCheckpointId
      const e = executions.get(cp.executionId);
      if (e) executions.set(cp.executionId, { ...e, replayCheckpointId: cp.checkpointId });
      return { ...cp };
    },
    async listCheckpoints(executionId) {
      return [...(checkpoints.get(executionId) ?? [])];
    },
    async getCheckpoint(checkpointId) {
      for (const list of checkpoints.values()) {
        const found = list.find((c) => c.checkpointId === checkpointId);
        if (found) return { ...found };
      }
      return null;
    },

    async acquireLease(input) {
      const nowMs = input.nowMs ?? Date.now();
      const existingId = activeLeaseByExec.get(input.executionId);
      if (existingId) {
        const existing = leases.get(existingId);
        if (existing && !existing.released && Date.parse(existing.expiresAt) > nowMs) {
          // already-active lease; refuse claim
          return null;
        }
      }
      const lease: ExecutionLease = {
        leaseId: newId('lease'),
        executionId: input.executionId,
        ownerWorkerId: input.workerId,
        acquiredAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + input.durationMs).toISOString(),
        released: false,
      };
      leases.set(lease.leaseId, lease);
      activeLeaseByExec.set(input.executionId, lease.leaseId);
      const e = executions.get(input.executionId);
      if (e) executions.set(input.executionId, { ...e, executionOwner: input.workerId, heartbeatAt: lease.acquiredAt });
      return { ...lease };
    },
    async renewLease(input) {
      const nowMs = input.nowMs ?? Date.now();
      const existing = leases.get(input.leaseId);
      if (!existing || existing.released) return null;
      const next: ExecutionLease = { ...existing, expiresAt: new Date(nowMs + input.durationMs).toISOString() };
      leases.set(input.leaseId, next);
      const e = executions.get(existing.executionId);
      if (e) executions.set(existing.executionId, { ...e, heartbeatAt: new Date(nowMs).toISOString() });
      return { ...next };
    },
    async releaseLease(leaseId) {
      const existing = leases.get(leaseId);
      if (!existing) return;
      leases.set(leaseId, { ...existing, released: true });
      const cur = activeLeaseByExec.get(existing.executionId);
      if (cur === leaseId) activeLeaseByExec.delete(existing.executionId);
    },
    async currentLease(executionId) {
      const id = activeLeaseByExec.get(executionId);
      if (!id) return null;
      const l = leases.get(id);
      return l ? { ...l } : null;
    },
    async listExpiredLeases(input) {
      const limit = Math.max(1, input.limit ?? 50);
      const out: ExecutionLease[] = [];
      leases.forEach((l) => {
        if (l.released) return;
        if (Date.parse(l.expiresAt) <= input.nowMs) out.push({ ...l });
      });
      return out.slice(0, limit);
    },
  };
}

let _default: ExecutionStore | null = null;
export function getDefaultExecutionStore(): ExecutionStore {
  if (!_default) _default = createInMemoryExecutionStore();
  return _default;
}
export function setDefaultExecutionStore(s: ExecutionStore): void {
  _default = s;
}

// Re-export type aliases for ergonomic imports.
export type { ExecutionStatus, OrchestrationPhase };
