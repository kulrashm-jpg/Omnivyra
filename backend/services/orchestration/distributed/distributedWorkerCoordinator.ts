/**
 * Phase 20B — DistributedWorkerCoordinator
 *
 * In-process worker registry + lifecycle coordinator. Each long-running
 * worker (queue worker, recovery worker, cron, standalone) registers a
 * `WorkerRecord`, heartbeats periodically, and drains gracefully on
 * shutdown.
 *
 * RESPONSIBILITIES (per spec):
 *   - worker registration
 *   - worker heartbeat
 *   - worker capability tracking
 *   - active execution ownership counter
 *   - stale-worker detection
 *   - graceful worker shutdown
 *   - execution drain coordination
 *
 * STATUSES (per spec): active | draining | recovering | stale | offline
 *
 * SCOPE: registry + lifecycle ONLY. No work selection (that's the runner
 * + claiming engine). No autonomous worker scaling. No process forking.
 *
 * GUARANTEES:
 *   - Atomic register: a second register() with the same workerId returns
 *     the existing record (idempotent boot).
 *   - Deterministic stale detection: a worker is stale when
 *     now - heartbeatAt > staleThresholdMs.
 *   - Graceful drain: drain() prevents the worker from picking up new
 *     work (callers check status === 'active' before claim) but leaves
 *     active executions alone — they finish naturally.
 *   - Idempotent shutdown: offline() → offline is a no-op.
 */

import type {
  WorkerCapability,
  WorkerKind,
  WorkerRecord,
  WorkerStatus,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type WorkerCoordinatorTelemetryEvent =
  | 'worker_registered'
  | 'worker_heartbeat'
  | 'worker_status_changed'
  | 'worker_drain_started'
  | 'worker_marked_stale'
  | 'worker_offline';

export interface WorkerCoordinatorTelemetrySink {
  emit(event: WorkerCoordinatorTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: WorkerCoordinatorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'worker_marked_stale' || event === 'worker_offline') console.warn(`[worker_coord] ${line}`);
      else console.log(`[worker_coord] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface RegisterWorkerInput {
  workerId: string;
  workerKind: WorkerKind;
  capabilities: WorkerCapability[];
  hostname?: string;
  processIdentity?: string;
  meta?: Record<string, unknown>;
}

export interface HeartbeatInput {
  workerId: string;
  /** Caller-supplied count of currently active executions. */
  activeExecutionCount?: number;
  recoveryLoad?: number;
  nowMs?: number;
}

export interface DistributedWorkerCoordinator {
  register(input: RegisterWorkerInput): Promise<WorkerRecord>;
  heartbeat(input: HeartbeatInput): Promise<WorkerRecord | null>;
  /** Begin graceful drain. New work claims should refuse for this worker. */
  drain(workerId: string): Promise<WorkerRecord | null>;
  /** Move to 'recovering' status (worker doing recovery work, accepts no new). */
  enterRecovery(workerId: string): Promise<WorkerRecord | null>;
  /** Mark offline. Idempotent. */
  offline(workerId: string): Promise<WorkerRecord | null>;
  /** Atomically increment / decrement active execution counter. */
  noteExecutionStarted(workerId: string): Promise<WorkerRecord | null>;
  noteExecutionFinished(workerId: string): Promise<WorkerRecord | null>;
  /** Inspection helpers. */
  get(workerId: string): Promise<WorkerRecord | null>;
  list(opts?: { status?: WorkerStatus | WorkerStatus[]; kind?: WorkerKind }): Promise<WorkerRecord[]>;
  /** Mark all workers whose heartbeat is older than staleThresholdMs as 'stale'. */
  sweepStale(input?: { nowMs?: number; staleThresholdMs?: number }): Promise<{ markedStale: string[] }>;
}

// ────────────────────────────────────────────────────────────────────
// In-memory implementation
// ────────────────────────────────────────────────────────────────────

export interface DistributedWorkerCoordinatorOptions {
  telemetry?: WorkerCoordinatorTelemetrySink;
  /** Stale threshold in ms. Default 90_000. */
  defaultStaleThresholdMs?: number;
}

export function createDistributedWorkerCoordinator(
  options?: DistributedWorkerCoordinatorOptions,
): DistributedWorkerCoordinator {
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const staleThreshold = options?.defaultStaleThresholdMs ?? 90_000;
  const byId = new Map<string, WorkerRecord>();

  function setStatus(rec: WorkerRecord, status: WorkerStatus, telemetryReason?: string): void {
    if (rec.status === status) return;
    const previous = rec.status;
    rec.status = status;
    telemetry.emit('worker_status_changed', {
      workerId: rec.workerId, previous, current: status,
      reason: telemetryReason ?? 'explicit',
    });
  }

  return {
    async register(input) {
      if (!input.workerId) throw new Error('workerId required');
      const existing = byId.get(input.workerId);
      if (existing && existing.status !== 'offline') {
        // Idempotent: refresh capabilities + heartbeat.
        existing.capabilities = input.capabilities;
        existing.heartbeatAtIso = new Date().toISOString();
        if (input.meta) existing.meta = { ...existing.meta, ...input.meta };
        return { ...existing };
      }
      const now = new Date().toISOString();
      const rec: WorkerRecord = {
        workerId: input.workerId,
        workerKind: input.workerKind,
        status: 'active',
        capabilities: input.capabilities,
        activeExecutionCount: 0,
        recoveryLoad: 0,
        hostname: input.hostname ?? null,
        processIdentity: input.processIdentity ?? null,
        registeredAtIso: now,
        heartbeatAtIso: now,
        drainStartedAtIso: null,
        offlineAtIso: null,
        meta: input.meta ?? {},
      };
      byId.set(input.workerId, rec);
      telemetry.emit('worker_registered', {
        workerId: input.workerId, workerKind: input.workerKind,
        capabilities: input.capabilities.map((c) => c.name),
      });
      return { ...rec };
    },

    async heartbeat(input) {
      const rec = byId.get(input.workerId);
      if (!rec) return null;
      if (rec.status === 'offline') return { ...rec };
      const nowMs = input.nowMs ?? Date.now();
      rec.heartbeatAtIso = new Date(nowMs).toISOString();
      if (typeof input.activeExecutionCount === 'number') {
        rec.activeExecutionCount = Math.max(0, input.activeExecutionCount);
      }
      if (typeof input.recoveryLoad === 'number') {
        rec.recoveryLoad = Math.max(0, input.recoveryLoad);
      }
      // A previously-stale worker that heartbeats again goes back to active.
      if (rec.status === 'stale') setStatus(rec, 'active', 'heartbeat_resumed');
      telemetry.emit('worker_heartbeat', {
        workerId: rec.workerId, active: rec.activeExecutionCount,
        recovery: rec.recoveryLoad, atIso: rec.heartbeatAtIso,
      });
      return { ...rec };
    },

    async drain(workerId) {
      const rec = byId.get(workerId);
      if (!rec) return null;
      if (rec.status === 'offline') return { ...rec };
      rec.drainStartedAtIso = new Date().toISOString();
      setStatus(rec, 'draining', 'explicit_drain');
      telemetry.emit('worker_drain_started', {
        workerId, atIso: rec.drainStartedAtIso,
        activeExecutions: rec.activeExecutionCount,
      });
      return { ...rec };
    },

    async enterRecovery(workerId) {
      const rec = byId.get(workerId);
      if (!rec) return null;
      if (rec.status === 'offline') return { ...rec };
      setStatus(rec, 'recovering', 'enter_recovery');
      return { ...rec };
    },

    async offline(workerId) {
      const rec = byId.get(workerId);
      if (!rec) return null;
      if (rec.status === 'offline') return { ...rec };
      rec.offlineAtIso = new Date().toISOString();
      setStatus(rec, 'offline', 'explicit_offline');
      telemetry.emit('worker_offline', {
        workerId, atIso: rec.offlineAtIso,
        leftoverActive: rec.activeExecutionCount,
      });
      return { ...rec };
    },

    async noteExecutionStarted(workerId) {
      const rec = byId.get(workerId);
      if (!rec) return null;
      rec.activeExecutionCount += 1;
      return { ...rec };
    },

    async noteExecutionFinished(workerId) {
      const rec = byId.get(workerId);
      if (!rec) return null;
      rec.activeExecutionCount = Math.max(0, rec.activeExecutionCount - 1);
      return { ...rec };
    },

    async get(workerId) {
      const rec = byId.get(workerId);
      return rec ? { ...rec } : null;
    },

    async list(opts) {
      const statusSet = opts?.status
        ? new Set(Array.isArray(opts.status) ? opts.status : [opts.status])
        : null;
      const out: WorkerRecord[] = [];
      byId.forEach((rec) => {
        if (statusSet && !statusSet.has(rec.status)) return;
        if (opts?.kind && rec.workerKind !== opts.kind) return;
        out.push({ ...rec });
      });
      out.sort((a, b) => a.registeredAtIso < b.registeredAtIso ? -1 : 1);
      return out;
    },

    async sweepStale(input) {
      const nowMs = input?.nowMs ?? Date.now();
      const threshold = input?.staleThresholdMs ?? staleThreshold;
      const cutoff = nowMs - threshold;
      const markedStale: string[] = [];
      byId.forEach((rec) => {
        if (rec.status === 'offline' || rec.status === 'stale') return;
        if (!rec.heartbeatAtIso) return;
        if (Date.parse(rec.heartbeatAtIso) <= cutoff) {
          setStatus(rec, 'stale', 'heartbeat_drift');
          markedStale.push(rec.workerId);
          telemetry.emit('worker_marked_stale', {
            workerId: rec.workerId,
            lastHeartbeatIso: rec.heartbeatAtIso,
            staleAgeMs: nowMs - Date.parse(rec.heartbeatAtIso),
          });
        }
      });
      return { markedStale };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: DistributedWorkerCoordinator | null = null;
export function getDefaultDistributedWorkerCoordinator(): DistributedWorkerCoordinator {
  if (!_default) _default = createDistributedWorkerCoordinator();
  return _default;
}
export function setDefaultDistributedWorkerCoordinator(c: DistributedWorkerCoordinator): void {
  _default = c;
}
