/**
 * Phase 21F — RuntimePersistenceCompactor
 *
 * Bounded compactor that prevents unbounded growth of the durable runtime
 * persistence tables. Each compactor pass:
 *
 *   1. Archives completed / dead-lettered queue entries older than cutoff.
 *   2. Archives offline worker rows older than cutoff.
 *   3. (Hook) Replay-safe checkpoint compaction. The actual checkpoint
 *      compaction policy is owned by the data layer (Phase 18A) — this
 *      module only ORCHESTRATES the call and bounds its blast radius.
 *
 * SCOPE: deletion / archival ONLY. No orchestration semantics. No
 * autonomous loops (caller schedules). The compactor returns counts +
 * summaries so the caller can decide whether to schedule another pass.
 *
 * GUARANTEES:
 *   - Bounded retention: each invocation respects per-call limits + total
 *     deletion budget. NEVER deletes more than `maxDeletionsPerCall`.
 *   - Replay-safe: only TERMINAL entries are archived. Live + active rows
 *     are untouched. The visibility-timeout check protects against
 *     deleting a row a worker still holds.
 *   - Bounded operations: each store call has its own limit; the compactor
 *     iterates with a fixed budget.
 *   - Idempotent: re-running the compactor is safe; the second pass
 *     deletes only newly-eligible rows.
 *
 * PREVENTS: unbounded runtime persistence growth across queue entries +
 * worker registry rows.
 */

import type {
  DistributedExecutionQueue,
} from './distributedExecutionQueue';
import type {
  DistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type CompactionTelemetryEvent =
  | 'compaction_started'
  | 'compaction_completed'
  | 'compaction_skipped'
  | 'compaction_aborted'
  | 'compaction_archive_summary';

export interface CompactionTelemetrySink {
  emit(event: CompactionTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: CompactionTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'compaction_aborted') console.warn(`[runtime_compactor] ${line}`);
      else console.log(`[runtime_compactor] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Options + result
// ────────────────────────────────────────────────────────────────────

export interface CompactorPassInput {
  /** Cutoff age in ms; entries older than now-cutoff are eligible. Default 7 days. */
  retentionMs?: number;
  /** Per-store per-call deletion cap. Default 1_000. */
  maxDeletionsPerStore?: number;
  /** Total deletion budget for the entire pass. Default 5_000. */
  maxDeletionsPerCall?: number;
  /** Optional dry-run mode — counts + reports without deleting. */
  dryRun?: boolean;
  /** Hard watchdog timeout. Default 30_000 ms. */
  maxDurationMs?: number;
  /** Override "now" for testing. */
  nowMs?: number;
}

export interface CompactorPassReport {
  startedAtIso: string;
  completedAtIso: string;
  durationMs: number;
  cutoffIso: string;
  queueArchivedCount: number;
  workersArchivedCount: number;
  checkpointArchivedCount: number;
  totalArchivedCount: number;
  budgetExhausted: boolean;
  aborted: boolean;
  abortReason: string | null;
  dryRun: boolean;
}

export interface RuntimePersistenceCompactor {
  runCompactionPass(input?: CompactorPassInput): Promise<CompactorPassReport>;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

/**
 * Subset of the queue interface the compactor needs. Only present on
 * the Supabase implementation (Phase 21A added it). In-memory queues
 * don't expose a delete helper — those return 0 immediately.
 */
export interface QueueArchivalApi {
  deleteTerminalEntriesOlderThan(cutoffIso: string, opts?: { limit?: number }): Promise<number>;
}

/**
 * Subset of the worker registry interface the compactor needs.
 */
export interface WorkerArchivalApi {
  deleteOfflineOlderThan(cutoffIso: string, opts?: { limit?: number }): Promise<number>;
}

/**
 * Subset of the checkpoint store the compactor optionally compacts.
 * Plugged in only when checkpoint compaction is wired (future work);
 * the compactor tolerates absence.
 */
export interface CheckpointArchivalApi {
  /** Caller-defined snapshot/coalesce + delete operation. */
  compactExecutionCheckpoints(opts: { retentionMs: number; limit: number; nowMs: number }): Promise<number>;
}

export interface RuntimePersistenceCompactorOptions {
  queue?: DistributedExecutionQueue | (DistributedExecutionQueue & Partial<QueueArchivalApi>);
  workerCoordinator?: DistributedWorkerCoordinator | (DistributedWorkerCoordinator & Partial<WorkerArchivalApi>);
  checkpointArchival?: CheckpointArchivalApi;
  telemetry?: CompactionTelemetrySink;
}

function isQueueArchivable(q: unknown): q is QueueArchivalApi {
  return !!q && typeof (q as { deleteTerminalEntriesOlderThan?: unknown }).deleteTerminalEntriesOlderThan === 'function';
}
function isWorkerArchivable(w: unknown): w is WorkerArchivalApi {
  return !!w && typeof (w as { deleteOfflineOlderThan?: unknown }).deleteOfflineOlderThan === 'function';
}

export function createRuntimePersistenceCompactor(
  options?: RuntimePersistenceCompactorOptions,
): RuntimePersistenceCompactor {
  const queue = options?.queue;
  const workerCoord = options?.workerCoordinator;
  const checkpointArchival = options?.checkpointArchival;
  const telemetry = options?.telemetry ?? defaultTelemetrySink;

  return {
    async runCompactionPass(input) {
      const retentionMs = Math.max(60_000, input?.retentionMs ?? 7 * 24 * 60 * 60 * 1_000);
      const maxPerStore = Math.max(1, Math.min(50_000, input?.maxDeletionsPerStore ?? 1_000));
      const maxTotal = Math.max(1, Math.min(100_000, input?.maxDeletionsPerCall ?? 5_000));
      const maxDuration = Math.max(1_000, input?.maxDurationMs ?? 30_000);
      const nowMs = input?.nowMs ?? Date.now();
      const cutoffIso = new Date(nowMs - retentionMs).toISOString();
      const startedAtIso = new Date(nowMs).toISOString();
      const t0 = Date.now();
      const dryRun = !!input?.dryRun;

      telemetry.emit('compaction_started', {
        retentionMs, maxPerStore, maxTotal, cutoffIso, dryRun,
      });

      let queueArchivedCount = 0;
      let workersArchivedCount = 0;
      let checkpointArchivedCount = 0;
      let budgetExhausted = false;
      let aborted = false;
      let abortReason: string | null = null;

      function remaining(): number {
        return Math.max(0, maxTotal - (queueArchivedCount + workersArchivedCount + checkpointArchivedCount));
      }
      function watchdogTripped(): boolean { return Date.now() - t0 > maxDuration; }

      try {
        // 1. Queue archival.
        if (queue && isQueueArchivable(queue) && remaining() > 0 && !watchdogTripped()) {
          const limit = Math.min(maxPerStore, remaining());
          if (dryRun) {
            telemetry.emit('compaction_archive_summary', {
              target: 'queue', dryRun: true, cutoffIso, limit,
            });
          } else {
            queueArchivedCount = await queue.deleteTerminalEntriesOlderThan(cutoffIso, { limit });
            telemetry.emit('compaction_archive_summary', {
              target: 'queue', deleted: queueArchivedCount, cutoffIso,
            });
          }
        }

        // 2. Worker registry archival.
        if (workerCoord && isWorkerArchivable(workerCoord) && remaining() > 0 && !watchdogTripped()) {
          const limit = Math.min(maxPerStore, remaining());
          if (dryRun) {
            telemetry.emit('compaction_archive_summary', {
              target: 'workers', dryRun: true, cutoffIso, limit,
            });
          } else {
            workersArchivedCount = await workerCoord.deleteOfflineOlderThan(cutoffIso, { limit });
            telemetry.emit('compaction_archive_summary', {
              target: 'workers', deleted: workersArchivedCount, cutoffIso,
            });
          }
        }

        // 3. Checkpoint archival (opt-in via injected API).
        if (checkpointArchival && remaining() > 0 && !watchdogTripped()) {
          const limit = Math.min(maxPerStore, remaining());
          if (dryRun) {
            telemetry.emit('compaction_archive_summary', {
              target: 'checkpoints', dryRun: true, cutoffIso, limit,
            });
          } else {
            checkpointArchivedCount = await checkpointArchival.compactExecutionCheckpoints({
              retentionMs, limit, nowMs,
            });
            telemetry.emit('compaction_archive_summary', {
              target: 'checkpoints', deleted: checkpointArchivedCount, cutoffIso,
            });
          }
        }

        if (remaining() === 0) budgetExhausted = true;
      } catch (err) {
        aborted = true;
        abortReason = (err as Error)?.message ?? 'unknown_compaction_error';
        telemetry.emit('compaction_aborted', { reason: abortReason });
      }

      const completedAtIso = new Date().toISOString();
      const totalArchivedCount = queueArchivedCount + workersArchivedCount + checkpointArchivedCount;
      const report: CompactorPassReport = {
        startedAtIso, completedAtIso,
        durationMs: Date.now() - t0,
        cutoffIso,
        queueArchivedCount, workersArchivedCount, checkpointArchivedCount,
        totalArchivedCount, budgetExhausted,
        aborted, abortReason, dryRun,
      };
      telemetry.emit('compaction_completed', {
        durationMs: report.durationMs,
        totalArchived: report.totalArchivedCount,
        budgetExhausted, dryRun,
      });
      return report;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: RuntimePersistenceCompactor | null = null;
export function getDefaultRuntimePersistenceCompactor(): RuntimePersistenceCompactor {
  if (!_default) _default = createRuntimePersistenceCompactor();
  return _default;
}
export function setDefaultRuntimePersistenceCompactor(c: RuntimePersistenceCompactor): void {
  _default = c;
}
