/**
 * Phase 20A — DistributedExecutionQueue
 *
 * Pluggable distributed queue interface backing the runner / claiming engine.
 * In-memory default keeps memory-mode operational with zero new dependencies;
 * a Supabase-backed implementation is available as an opt-in. Same pattern
 * as the Phase 16-18 store layering.
 *
 * CAPABILITIES (per spec):
 *   - enqueue execution         → enqueue()
 *   - claim execution           → claim()
 *   - acknowledge completion    → ack()
 *   - retry failed execution    → retry()
 *   - visibility timeout        → reclaimExpired()
 *   - delayed execution         → enqueue({runAtIso})
 *   - bounded retry policy      → ack() auto-dead-letters past maxAttempts
 *
 * GUARANTEES:
 *   - Deterministic ordering: (run_at ASC, priority DESC, created_at ASC, id ASC).
 *   - Replay-safe enqueue: same dedupKey returns the existing live entry.
 *   - Duplicate enqueue suppression: dedupKey collision is idempotent.
 *   - Lease-aware claiming: claim() pairs with the executionStore lease
 *     governor at the runner layer; the queue itself only enforces
 *     visibility-timeout at the entry level.
 *   - Idempotent scheduling: ack(completed) is idempotent; ack on a
 *     dead-lettered or completed entry is a no-op.
 *
 * SCOPE: queue persistence + lifecycle ONLY. No orchestration semantics.
 * No worker selection (that's the claiming engine + worker coordinator).
 * No queue fanout to external systems (Redis, SQS, etc.) — that's
 * explicitly out of scope per Phase 20 constraints.
 */

import type {
  AckOutcome,
  QueueEntry,
  QueueEntryKind,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type QueueTelemetryEvent =
  | 'execution_enqueued'
  | 'execution_claimed'
  | 'execution_completed'
  | 'execution_retry_scheduled'
  | 'execution_dead_lettered'
  | 'execution_visibility_reclaimed'
  | 'execution_dedup_suppressed';

export interface QueueTelemetrySink {
  emit(event: QueueTelemetryEvent, payload: Record<string, unknown>): void;
}

export const defaultQueueTelemetrySink: QueueTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'execution_dead_lettered') console.warn(`[exec_queue] ${line}`);
      else console.log(`[exec_queue] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  executionId: string;
  companyId: string;
  kind: QueueEntryKind;
  /** Higher = earlier. 0..100; default 50. */
  priority?: number;
  /** Earliest claim time. Default = now. */
  runAtIso?: string;
  /** Max attempts before dead-lettering. Default 5. */
  maxAttempts?: number;
  /**
   * Stable dedup key. Two enqueue() calls with the same key collapse into
   * one live entry. Default: `${kind}:${executionId}`.
   */
  dedupKey?: string;
  payload?: Record<string, unknown> | null;
}

export interface ClaimInput {
  workerId: string;
  /** Visibility timeout in ms. Default 60_000. */
  visibilityMs?: number;
  /** Maximum entries to claim in this call. Default 1. */
  limit?: number;
  /** Optional filter on entry kind. */
  kind?: QueueEntryKind;
  /** Optional filter on company. */
  companyId?: string;
  nowMs?: number;
}

export interface AckInput {
  queueEntryId: string;
  workerId: string;
  outcome: AckOutcome;
  resultPayload?: Record<string, unknown> | null;
  failureReason?: string | null;
  /** Retry backoff for failed ack. Default 30_000. */
  retryAfterMs?: number;
}

export interface ReclaimExpiredInput {
  nowMs?: number;
  limit?: number;
}

export interface DistributedExecutionQueue {
  enqueue(input: EnqueueInput): Promise<QueueEntry>;
  claim(input: ClaimInput): Promise<QueueEntry[]>;
  ack(input: AckInput): Promise<QueueEntry | null>;
  retry(input: { queueEntryId: string; runAtIso?: string; reason?: string }): Promise<QueueEntry | null>;
  reclaimExpired(input?: ReclaimExpiredInput): Promise<QueueEntry[]>;
  /** Read-only inspection helpers. */
  get(queueEntryId: string): Promise<QueueEntry | null>;
  listByExecution(executionId: string): Promise<QueueEntry[]>;
  /**
   * Phase 22C — list entries currently claimed by a specific worker.
   * Used by the replay coordinator to perform TARGETED reclaim when a
   * worker is confirmed dead (status=stale|offline). Returns only LIVE
   * entries (status='claimed').
   */
  listByClaimer(workerId: string, opts?: { limit?: number }): Promise<QueueEntry[]>;
  countByStatus(): Promise<Record<QueueEntry['status'], number>>;
  /** Currently-queued depth (eligible + delayed). */
  depth(input?: { companyId?: string; kind?: QueueEntryKind }): Promise<number>;
}

// ────────────────────────────────────────────────────────────────────
// In-memory implementation
// ────────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string { return new Date().toISOString(); }

function clampPriority(p?: number): number {
  if (!Number.isFinite(p)) return 50;
  return Math.max(0, Math.min(100, Math.floor(p as number)));
}

export interface InMemoryExecutionQueueOptions {
  telemetry?: QueueTelemetrySink;
  /** Cap on total entries kept in memory. Default 50_000. */
  maxEntries?: number;
}

export function createInMemoryExecutionQueue(options?: InMemoryExecutionQueueOptions): DistributedExecutionQueue {
  const telemetry = options?.telemetry ?? defaultQueueTelemetrySink;
  const cap = Math.max(1_000, options?.maxEntries ?? 50_000);
  const entries: QueueEntry[] = [];
  const byId = new Map<string, QueueEntry>();
  const byDedupKey = new Map<string, QueueEntry>();

  function trimIfOverCap(): void {
    if (entries.length <= cap) return;
    // Drop oldest dead_lettered / completed entries first.
    const expendable = entries
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.status === 'completed' || e.status === 'dead_lettered' || e.status === 'cancelled')
      .sort((a, b) => a.e.updatedAtIso.localeCompare(b.e.updatedAtIso));
    let overflow = entries.length - cap;
    for (const { e } of expendable) {
      if (overflow <= 0) break;
      const i = entries.indexOf(e);
      if (i >= 0) entries.splice(i, 1);
      byId.delete(e.queueEntryId);
      byDedupKey.delete(e.dedupKey);
      overflow -= 1;
    }
  }

  function defaultDedup(input: EnqueueInput): string {
    return input.dedupKey ?? `${input.kind}:${input.executionId}`;
  }

  function isLive(e: QueueEntry): boolean {
    return e.status === 'queued' || e.status === 'claimed';
  }

  return {
    async enqueue(input) {
      if (!input.executionId) throw new Error('executionId required');
      if (!input.companyId) throw new Error('companyId required');
      const dedupKey = defaultDedup(input);
      const existing = byDedupKey.get(dedupKey);
      // Idempotent: if a live entry exists, return it.
      if (existing && isLive(existing)) {
        telemetry.emit('execution_dedup_suppressed', {
          dedupKey, executionId: input.executionId,
          existingQueueEntryId: existing.queueEntryId,
          existingStatus: existing.status,
        });
        return existing;
      }
      const created = nowIso();
      const entry: QueueEntry = {
        queueEntryId: newId('qe'),
        executionId: input.executionId,
        companyId: input.companyId,
        kind: input.kind,
        status: 'queued',
        priority: clampPriority(input.priority ?? 50),
        runAtIso: input.runAtIso ?? created,
        visibilityDeadlineIso: null,
        claimedByWorkerId: null,
        attemptCount: 0,
        maxAttempts: Math.max(1, input.maxAttempts ?? 5),
        dedupKey,
        payload: input.payload ?? null,
        resultPayload: null,
        failureReason: null,
        createdAtIso: created,
        updatedAtIso: created,
      };
      entries.push(entry);
      byId.set(entry.queueEntryId, entry);
      byDedupKey.set(dedupKey, entry);
      trimIfOverCap();
      telemetry.emit('execution_enqueued', {
        queueEntryId: entry.queueEntryId,
        executionId: entry.executionId,
        kind: entry.kind, priority: entry.priority,
        runAtIso: entry.runAtIso, dedupKey,
      });
      return { ...entry };
    },

    async claim(input) {
      if (!input.workerId) throw new Error('workerId required');
      const nowMs = input.nowMs ?? Date.now();
      const nowIsoStr = new Date(nowMs).toISOString();
      // Visibility floor is 1ms so tests can simulate fast expiry. Production
      // callers should supply explicit values >= 5000ms.
      const visibility = Math.max(1, input.visibilityMs ?? 60_000);
      const limit = Math.max(1, Math.min(100, input.limit ?? 1));

      // Eligible = queued AND runAt <= now, OR claimed but visibility expired.
      const eligible = entries.filter((e) => {
        if (input.kind && e.kind !== input.kind) return false;
        if (input.companyId && e.companyId !== input.companyId) return false;
        if (e.status === 'queued' && e.runAtIso <= nowIsoStr) return true;
        if (e.status === 'claimed' && e.visibilityDeadlineIso && e.visibilityDeadlineIso <= nowIsoStr) return true;
        return false;
      });
      // Deterministic order: (run_at ASC, priority DESC, created_at ASC, id ASC).
      eligible.sort((a, b) => {
        if (a.runAtIso !== b.runAtIso) return a.runAtIso < b.runAtIso ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        if (a.createdAtIso !== b.createdAtIso) return a.createdAtIso < b.createdAtIso ? -1 : 1;
        return a.queueEntryId < b.queueEntryId ? -1 : 1;
      });

      const claimed: QueueEntry[] = [];
      for (const e of eligible) {
        if (claimed.length >= limit) break;
        const wasReclaim = e.status === 'claimed';
        e.status = 'claimed';
        e.claimedByWorkerId = input.workerId;
        e.attemptCount += 1;
        e.visibilityDeadlineIso = new Date(nowMs + visibility).toISOString();
        e.updatedAtIso = nowIsoStr;
        claimed.push({ ...e });
        telemetry.emit(wasReclaim ? 'execution_visibility_reclaimed' : 'execution_claimed', {
          queueEntryId: e.queueEntryId, executionId: e.executionId,
          workerId: input.workerId, attempt: e.attemptCount,
          visibilityDeadlineIso: e.visibilityDeadlineIso,
        });
      }
      return claimed;
    },

    async ack(input) {
      const entry = byId.get(input.queueEntryId);
      if (!entry) return null;
      // Worker-ownership check (best-effort — visibility-timeout reclaim is allowed).
      if (entry.claimedByWorkerId && entry.claimedByWorkerId !== input.workerId) {
        // Different worker took over; ack from old worker is a no-op for the entry.
        // We still record telemetry so forensics can flag it.
        telemetry.emit('execution_dedup_suppressed', {
          queueEntryId: entry.queueEntryId, reason: 'ack_by_non_owner',
          actualOwner: entry.claimedByWorkerId, ackingWorker: input.workerId,
        });
        return null;
      }
      // Once dead_lettered / completed / cancelled, further acks are no-ops.
      if (entry.status === 'completed' || entry.status === 'dead_lettered' || entry.status === 'cancelled') {
        return { ...entry };
      }
      entry.resultPayload = input.resultPayload ?? entry.resultPayload;
      entry.failureReason = input.failureReason ?? entry.failureReason;
      entry.updatedAtIso = nowIso();
      switch (input.outcome) {
        case 'completed':
          entry.status = 'completed';
          telemetry.emit('execution_completed', {
            queueEntryId: entry.queueEntryId, executionId: entry.executionId,
            workerId: input.workerId, attempts: entry.attemptCount,
          });
          break;
        case 'cancelled':
          entry.status = 'cancelled';
          telemetry.emit('execution_completed', {
            queueEntryId: entry.queueEntryId, executionId: entry.executionId,
            workerId: input.workerId, attempts: entry.attemptCount,
            cancelled: true,
          });
          break;
        case 'failed':
          if (entry.attemptCount >= entry.maxAttempts) {
            entry.status = 'dead_lettered';
            telemetry.emit('execution_dead_lettered', {
              queueEntryId: entry.queueEntryId, executionId: entry.executionId,
              attempts: entry.attemptCount, reason: entry.failureReason,
            });
          } else {
            // Schedule a retry with exponential backoff.
            const backoff = Math.max(1_000, input.retryAfterMs ?? 30_000) * Math.pow(2, entry.attemptCount - 1);
            const runAt = new Date(Date.now() + backoff).toISOString();
            entry.status = 'queued';
            entry.claimedByWorkerId = null;
            entry.visibilityDeadlineIso = null;
            entry.runAtIso = runAt;
            telemetry.emit('execution_retry_scheduled', {
              queueEntryId: entry.queueEntryId, executionId: entry.executionId,
              attempt: entry.attemptCount, runAtIso: runAt, backoffMs: backoff,
            });
          }
          break;
      }
      return { ...entry };
    },

    async retry(input) {
      const entry = byId.get(input.queueEntryId);
      if (!entry) return null;
      if (entry.status === 'dead_lettered' || entry.status === 'completed') return { ...entry };
      entry.status = 'queued';
      entry.claimedByWorkerId = null;
      entry.visibilityDeadlineIso = null;
      entry.runAtIso = input.runAtIso ?? nowIso();
      entry.updatedAtIso = nowIso();
      if (input.reason) entry.failureReason = input.reason;
      telemetry.emit('execution_retry_scheduled', {
        queueEntryId: entry.queueEntryId, executionId: entry.executionId,
        attempt: entry.attemptCount, runAtIso: entry.runAtIso, manual: true,
      });
      return { ...entry };
    },

    async reclaimExpired(input) {
      const nowMs = input?.nowMs ?? Date.now();
      const nowIsoStr = new Date(nowMs).toISOString();
      const limit = Math.max(1, input?.limit ?? 100);
      const candidates = entries.filter(
        (e) => e.status === 'claimed' && e.visibilityDeadlineIso && e.visibilityDeadlineIso <= nowIsoStr,
      );
      const reclaimed: QueueEntry[] = [];
      for (const e of candidates) {
        if (reclaimed.length >= limit) break;
        e.status = 'queued';
        e.claimedByWorkerId = null;
        e.visibilityDeadlineIso = null;
        e.updatedAtIso = nowIsoStr;
        reclaimed.push({ ...e });
        telemetry.emit('execution_visibility_reclaimed', {
          queueEntryId: e.queueEntryId, executionId: e.executionId,
          attempt: e.attemptCount,
        });
      }
      return reclaimed;
    },

    async get(queueEntryId) {
      const e = byId.get(queueEntryId);
      return e ? { ...e } : null;
    },

    async listByExecution(executionId) {
      return entries.filter((e) => e.executionId === executionId).map((e) => ({ ...e }));
    },

    async listByClaimer(workerId, opts) {
      if (!workerId) return [];
      const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
      const matching = entries.filter(
        (e) => e.status === 'claimed' && e.claimedByWorkerId === workerId,
      );
      // Deterministic order: claimed-at ascending so older claims surface first.
      matching.sort((a, b) => {
        const av = a.updatedAtIso;
        const bv = b.updatedAtIso;
        if (av === bv) return a.queueEntryId < b.queueEntryId ? -1 : 1;
        return av < bv ? -1 : 1;
      });
      return matching.slice(0, limit).map((e) => ({ ...e }));
    },

    async countByStatus() {
      const counts: Record<QueueEntry['status'], number> = {
        queued: 0, claimed: 0, completed: 0,
        failed: 0, dead_lettered: 0, cancelled: 0,
      };
      for (const e of entries) counts[e.status] += 1;
      return counts;
    },

    async depth(input) {
      const nowIsoStr = nowIso();
      return entries.filter((e) => {
        if (input?.kind && e.kind !== input.kind) return false;
        if (input?.companyId && e.companyId !== input.companyId) return false;
        if (e.status === 'queued' && e.runAtIso <= nowIsoStr) return true;
        return false;
      }).length;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: DistributedExecutionQueue | null = null;
export function getDefaultExecutionQueue(): DistributedExecutionQueue {
  if (!_default) _default = createInMemoryExecutionQueue();
  return _default;
}
export function setDefaultExecutionQueue(q: DistributedExecutionQueue): void {
  _default = q;
}
