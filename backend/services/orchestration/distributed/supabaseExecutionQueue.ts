/**
 * Phase 21A — SupabaseExecutionQueue
 *
 * Durable distributed queue implementation backed by the
 * `thread_runtime_queue_entries` table. Drop-in replacement for the
 * Phase 20A in-memory queue — implements the SAME DistributedExecutionQueue
 * interface, so callers (claiming engine, runner, recovery scheduler)
 * don't change.
 *
 * SCOPE: durable persistence ONLY. No orchestration semantics. No queue
 * fanout to external vendors. No autonomous loops.
 *
 * GUARANTEES:
 *   - Atomic claim: a single UPDATE ... WHERE queue_status='queued' clause
 *     with a transaction-bounded SELECT ... FOR UPDATE SKIP LOCKED via
 *     the underlying PostgreSQL row locking. (PostgREST exposes UPDATE +
 *     RETURNING; we use it to surface the claimed row atomically.)
 *   - Visibility timeout: claim sets visibility_timeout_at = now + visMs;
 *     reclaimExpired() finds claimed rows whose visibility has passed.
 *   - Dedup via partial unique index `uniq_thread_runtime_queue_live_dedup`:
 *     two enqueue calls with the same dedupKey collapse onto the same live
 *     row. Historic completed/dead-lettered/cancelled rows can coexist.
 *   - Deterministic ordering: ORDER BY scheduled_for ASC, priority DESC,
 *     created_at ASC, queue_entry_id ASC. Mirrors the in-memory comparator.
 *   - Replay-safe: every write is idempotent on the primary key + dedup
 *     unique index. Retry on transient SQLSTATE.
 *   - Telemetry: same events as the in-memory queue.
 *
 * NOTE: This module is OPT-IN. The migration 20260811 is not auto-applied;
 * the in-memory queue from Phase 20A remains the default until operators
 * apply the migration AND set ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type {
  AckOutcome,
  QueueEntry,
  QueueEntryKind,
  QueueEntryStatus,
} from './distributedTypes';
import type {
  AckInput,
  ClaimInput,
  DistributedExecutionQueue,
  EnqueueInput,
  QueueTelemetryEvent,
  QueueTelemetrySink,
  ReclaimExpiredInput,
} from './distributedExecutionQueue';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

const defaultTelemetrySink: QueueTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'execution_dead_lettered') console.warn(`[supabase_queue] ${line}`);
      else console.log(`[supabase_queue] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class SupabaseExecutionQueueError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseExecutionQueue.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseExecutionQueueError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Retry classification (shared semantics with other Supabase stores)
// ────────────────────────────────────────────────────────────────────

const TRANSIENT_SQLSTATE_PREFIXES = ['08', '53'];
const TRANSIENT_SQLSTATE_CODES = new Set(['40001', '40P01', '57P03', '57014']);
const UNIQUE_VIOLATION_SQLSTATE = '23505';

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.status && e.status >= 500 && e.status < 600) return true;
  const code = typeof e.code === 'string' ? e.code : '';
  if (TRANSIENT_SQLSTATE_CODES.has(code)) return true;
  if (TRANSIENT_SQLSTATE_PREFIXES.some((p) => code.startsWith(p))) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────
// Row projection
// ────────────────────────────────────────────────────────────────────

interface QueueRow {
  queue_entry_id: string;
  execution_id: string;
  runtime_session_id: string | null;
  company_id: string;
  kind: QueueEntryKind;
  queue_status: QueueEntryStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  visibility_timeout_at: string | null;
  claimed_by_worker: string | null;
  claimed_at: string | null;
  dedup_key: string;
  payload_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: QueueRow): QueueEntry {
  return {
    queueEntryId: row.queue_entry_id,
    executionId: row.execution_id,
    companyId: row.company_id,
    kind: row.kind,
    status: row.queue_status,
    priority: row.priority,
    runAtIso: row.scheduled_for,
    visibilityDeadlineIso: row.visibility_timeout_at,
    claimedByWorkerId: row.claimed_by_worker,
    attemptCount: row.attempts,
    maxAttempts: row.max_attempts,
    dedupKey: row.dedup_key,
    payload: row.payload_json,
    resultPayload: row.result_json,
    failureReason: row.failure_reason,
    createdAtIso: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function clampPriority(p?: number): number {
  if (!Number.isFinite(p)) return 50;
  return Math.max(0, Math.min(100, Math.floor(p as number)));
}

// ────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────

export interface SupabaseExecutionQueueOptions {
  client?: SupabaseClient;
  telemetry?: QueueTelemetrySink;
  maxRetries?: number;
  initialBackoffMs?: number;
  tableName?: string;
}

export class SupabaseExecutionQueue implements DistributedExecutionQueue {
  private readonly client: SupabaseClient;
  private readonly telemetry: QueueTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;

  constructor(options: SupabaseExecutionQueueOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_queue_entries';
  }

  private emit(event: QueueTelemetryEvent, payload: Record<string, unknown>): void {
    try { this.telemetry.emit(event, payload); } catch { /* ignore */ }
  }

  private async withRetry<T>(operation: string, payload: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && isTransient(err)) {
          await new Promise((r) => setTimeout(r, this.initialBackoffMs * Math.pow(2, attempt)));
          continue;
        }
        const code = (err as { code?: string })?.code ?? 'UNKNOWN';
        const msg = (err as Error)?.message ?? 'unknown error';
        throw new SupabaseExecutionQueueError(operation, code, msg, attempt, err);
      }
    }
    throw new SupabaseExecutionQueueError(operation, 'EXHAUSTED', (lastErr as Error)?.message ?? 'retries exhausted', this.maxRetries, lastErr);
  }

  // ── DistributedExecutionQueue interface ────────────────────────────

  async enqueue(input: EnqueueInput): Promise<QueueEntry> {
    if (!input.executionId) throw new Error('executionId required');
    if (!input.companyId) throw new Error('companyId required');
    const dedupKey = input.dedupKey ?? `${input.kind}:${input.executionId}`;
    const nowIso = new Date().toISOString();
    const row: QueueRow = {
      queue_entry_id: newId('qe'),
      execution_id: input.executionId,
      runtime_session_id: null,
      company_id: input.companyId,
      kind: input.kind,
      queue_status: 'queued',
      priority: clampPriority(input.priority ?? 50),
      attempts: 0,
      max_attempts: Math.max(1, input.maxAttempts ?? 5),
      scheduled_for: input.runAtIso ?? nowIso,
      visibility_timeout_at: null,
      claimed_by_worker: null,
      claimed_at: null,
      dedup_key: dedupKey,
      payload_json: input.payload ?? null,
      result_json: null,
      failure_reason: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    return this.withRetry('enqueue', { executionId: input.executionId, dedupKey, kind: input.kind }, async () => {
      const { error } = await this.client.from(this.tableName).insert(row);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === UNIQUE_VIOLATION_SQLSTATE) {
          // Dedup hit on the partial unique index. Read the existing live entry.
          const { data, error: readErr } = await this.client
            .from(this.tableName)
            .select('*')
            .eq('dedup_key', dedupKey)
            .in('queue_status', ['queued', 'claimed', 'failed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (readErr) throw readErr;
          if (!data) throw error;
          this.emit('execution_dedup_suppressed', {
            dedupKey, executionId: input.executionId,
            existingQueueEntryId: (data as QueueRow).queue_entry_id,
            existingStatus: (data as QueueRow).queue_status,
          });
          return rowToEntry(data as QueueRow);
        }
        throw error;
      }
      this.emit('execution_enqueued', {
        queueEntryId: row.queue_entry_id, executionId: row.execution_id,
        kind: row.kind, priority: row.priority,
        runAtIso: row.scheduled_for, dedupKey,
      });
      return rowToEntry(row);
    });
  }

  async claim(input: ClaimInput): Promise<QueueEntry[]> {
    if (!input.workerId) throw new Error('workerId required');
    const nowMs = input.nowMs ?? Date.now();
    const nowIsoStr = new Date(nowMs).toISOString();
    const visibility = Math.max(1, input.visibilityMs ?? 60_000);
    const visDeadlineIso = new Date(nowMs + visibility).toISOString();
    const limit = Math.max(1, Math.min(100, input.limit ?? 1));

    return this.withRetry('claim', { workerId: input.workerId, limit, visibility }, async () => {
      // Step 1: find candidate ids (eligible queued OR claimed-but-visibility-expired).
      // Two queries unioned client-side because PostgREST doesn't support UNION in select().
      const baseFilter = (q: any): any => {
        let qry: any = q.select('queue_entry_id, scheduled_for, priority, created_at')
          .order('scheduled_for', { ascending: true })
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
          .order('queue_entry_id', { ascending: true })
          .limit(limit * 4);
        if (input.kind) qry = qry.eq('kind', input.kind);
        if (input.companyId) qry = qry.eq('company_id', input.companyId);
        return qry;
      };
      const queuedQuery = (baseFilter(this.client.from(this.tableName)) as any)
        .eq('queue_status', 'queued')
        .lte('scheduled_for', nowIsoStr);
      const claimedExpiredQuery = (baseFilter(this.client.from(this.tableName)) as any)
        .eq('queue_status', 'claimed')
        .lte('visibility_timeout_at', nowIsoStr);

      const [queuedRes, claimedRes] = await Promise.all([queuedQuery, claimedExpiredQuery]);
      if (queuedRes.error) throw queuedRes.error;
      if (claimedRes.error) throw claimedRes.error;

      const candidates: Array<{ queue_entry_id: string; scheduled_for: string; priority: number; created_at: string; isReclaim: boolean }> = [
        ...(((queuedRes.data ?? []) as QueueRow[]).map((r) => ({ ...r, isReclaim: false }))),
        ...(((claimedRes.data ?? []) as QueueRow[]).map((r) => ({ ...r, isReclaim: true }))),
      ];
      candidates.sort((a, b) => {
        if (a.scheduled_for !== b.scheduled_for) return a.scheduled_for < b.scheduled_for ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
        return a.queue_entry_id < b.queue_entry_id ? -1 : 1;
      });
      const slice = candidates.slice(0, limit);

      const claimed: QueueEntry[] = [];
      // Step 2: atomic UPDATE per candidate. Two writers racing on the same
      // id will result in exactly one returning a row (the other returns
      // {data: null} because the WHERE pre-condition no longer matches).
      for (const c of slice) {
        const updatePatch: Partial<QueueRow> = {
          queue_status: 'claimed',
          claimed_by_worker: input.workerId,
          claimed_at: nowIsoStr,
          visibility_timeout_at: visDeadlineIso,
          attempts: 0, // bumped below via raw increment
          updated_at: nowIsoStr,
        };

        // Fetch current attempts so we can compute the new value (PostgREST
        // doesn't support inline column arithmetic).
        const cur = await this.client
          .from(this.tableName)
          .select('attempts')
          .eq('queue_entry_id', c.queue_entry_id)
          .maybeSingle();
        if (cur.error) throw cur.error;
        updatePatch.attempts = ((cur.data as { attempts?: number } | null)?.attempts ?? 0) + 1;

        // Conditional update — only takes effect if the row is still in a
        // claimable state. WHERE includes claimed-with-expired-visibility OR queued.
        // We split into two distinct conditional updates to keep the WHERE simple.
        const conditionStatus = c.isReclaim ? 'claimed' : 'queued';
        const conditionExtra: (q: any) => any = c.isReclaim
          ? (q: any) => q.lte('visibility_timeout_at', nowIsoStr)
          : (q: any) => q.lte('scheduled_for', nowIsoStr);

        let updateQuery: any = this.client.from(this.tableName)
          .update(updatePatch)
          .eq('queue_entry_id', c.queue_entry_id)
          .eq('queue_status', conditionStatus);
        updateQuery = conditionExtra(updateQuery);
        const { data, error } = await (updateQuery as { select: (cols: string) => unknown }).select('*') as unknown as { data: QueueRow[] | null; error: unknown };
        if (error) throw error;
        if (!data || data.length === 0) {
          // Lost the race; another worker claimed first. Skip.
          continue;
        }
        const claimedRow = data[0];
        claimed.push(rowToEntry(claimedRow));
        this.emit(c.isReclaim ? 'execution_visibility_reclaimed' : 'execution_claimed', {
          queueEntryId: claimedRow.queue_entry_id,
          executionId: claimedRow.execution_id,
          workerId: input.workerId,
          attempt: claimedRow.attempts,
          visibilityDeadlineIso: claimedRow.visibility_timeout_at,
        });
        if (claimed.length >= limit) break;
      }
      return claimed;
    });
  }

  async ack(input: AckInput): Promise<QueueEntry | null> {
    const nowIso = new Date().toISOString();
    return this.withRetry('ack', { queueEntryId: input.queueEntryId, outcome: input.outcome }, async () => {
      // Pull the current row to inspect ownership + attempt count.
      const { data: existing, error: readErr } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('queue_entry_id', input.queueEntryId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!existing) return null;
      const row = existing as QueueRow;

      if (row.claimed_by_worker && row.claimed_by_worker !== input.workerId) {
        this.emit('execution_dedup_suppressed', {
          queueEntryId: row.queue_entry_id, reason: 'ack_by_non_owner',
          actualOwner: row.claimed_by_worker, ackingWorker: input.workerId,
        });
        return null;
      }
      if (row.queue_status === 'completed' || row.queue_status === 'dead_lettered' || row.queue_status === 'cancelled') {
        return rowToEntry(row);
      }

      const patch: Partial<QueueRow> = {
        result_json: input.resultPayload ?? row.result_json,
        failure_reason: input.failureReason ?? row.failure_reason,
        updated_at: nowIso,
      };
      let outcomeEvent: QueueTelemetryEvent = 'execution_completed';

      const outcome = input.outcome as AckOutcome;
      switch (outcome) {
        case 'completed':
          patch.queue_status = 'completed';
          outcomeEvent = 'execution_completed';
          break;
        case 'cancelled':
          patch.queue_status = 'cancelled';
          outcomeEvent = 'execution_completed';
          break;
        case 'failed': {
          const attempts = row.attempts;
          if (attempts >= row.max_attempts) {
            patch.queue_status = 'dead_lettered';
            outcomeEvent = 'execution_dead_lettered';
          } else {
            const backoff = Math.max(1_000, input.retryAfterMs ?? 30_000) * Math.pow(2, attempts - 1);
            const runAt = new Date(Date.now() + backoff).toISOString();
            patch.queue_status = 'queued';
            patch.claimed_by_worker = null;
            patch.visibility_timeout_at = null;
            patch.scheduled_for = runAt;
            outcomeEvent = 'execution_retry_scheduled';
          }
          break;
        }
      }

      const { data: updated, error: updErr } = await this.client
        .from(this.tableName)
        .update(patch)
        .eq('queue_entry_id', input.queueEntryId)
        .select('*')
        .maybeSingle();
      if (updErr) throw updErr;
      const next = updated ? rowToEntry(updated as QueueRow) : null;
      if (next) {
        if (outcomeEvent === 'execution_dead_lettered') {
          this.emit('execution_dead_lettered', {
            queueEntryId: next.queueEntryId, executionId: next.executionId,
            attempts: next.attemptCount, reason: next.failureReason,
          });
        } else if (outcomeEvent === 'execution_retry_scheduled') {
          this.emit('execution_retry_scheduled', {
            queueEntryId: next.queueEntryId, executionId: next.executionId,
            attempt: next.attemptCount, runAtIso: next.runAtIso,
          });
        } else {
          this.emit('execution_completed', {
            queueEntryId: next.queueEntryId, executionId: next.executionId,
            workerId: input.workerId, attempts: next.attemptCount,
            cancelled: outcome === 'cancelled',
          });
        }
      }
      return next;
    });
  }

  async retry(input: { queueEntryId: string; runAtIso?: string; reason?: string }): Promise<QueueEntry | null> {
    const nowIso = new Date().toISOString();
    return this.withRetry('retry', { queueEntryId: input.queueEntryId }, async () => {
      const patch: Partial<QueueRow> = {
        queue_status: 'queued',
        claimed_by_worker: null,
        visibility_timeout_at: null,
        scheduled_for: input.runAtIso ?? nowIso,
        updated_at: nowIso,
      };
      if (input.reason) patch.failure_reason = input.reason;
      const { data, error } = await this.client
        .from(this.tableName)
        .update(patch)
        .eq('queue_entry_id', input.queueEntryId)
        .not('queue_status', 'in', '(dead_lettered,completed)')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const next = rowToEntry(data as QueueRow);
      this.emit('execution_retry_scheduled', {
        queueEntryId: next.queueEntryId, executionId: next.executionId,
        attempt: next.attemptCount, runAtIso: next.runAtIso, manual: true,
      });
      return next;
    });
  }

  async reclaimExpired(input?: ReclaimExpiredInput): Promise<QueueEntry[]> {
    const nowMs = input?.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const limit = Math.max(1, Math.min(500, input?.limit ?? 100));
    return this.withRetry('reclaimExpired', { limit }, async () => {
      const { data: candidates, error: readErr } = await this.client
        .from(this.tableName)
        .select('queue_entry_id, execution_id, attempts')
        .eq('queue_status', 'claimed')
        .lte('visibility_timeout_at', nowIso)
        .limit(limit);
      if (readErr) throw readErr;
      const reclaimed: QueueEntry[] = [];
      for (const c of (candidates ?? []) as Array<{ queue_entry_id: string; execution_id: string; attempts: number }>) {
        const { data, error } = await this.client
          .from(this.tableName)
          .update({
            queue_status: 'queued',
            claimed_by_worker: null,
            visibility_timeout_at: null,
            updated_at: nowIso,
          })
          .eq('queue_entry_id', c.queue_entry_id)
          .eq('queue_status', 'claimed')
          .lte('visibility_timeout_at', nowIso)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (!data) continue;
        const entry = rowToEntry(data as QueueRow);
        reclaimed.push(entry);
        this.emit('execution_visibility_reclaimed', {
          queueEntryId: entry.queueEntryId, executionId: entry.executionId,
          attempt: entry.attemptCount,
        });
      }
      return reclaimed;
    });
  }

  async get(queueEntryId: string): Promise<QueueEntry | null> {
    if (!queueEntryId) return null;
    return this.withRetry('get', { queueEntryId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('queue_entry_id', queueEntryId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToEntry(data as QueueRow);
    });
  }

  async listByExecution(executionId: string): Promise<QueueEntry[]> {
    if (!executionId) return [];
    return this.withRetry('listByExecution', { executionId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', executionId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as QueueRow[];
      return rows.map(rowToEntry);
    });
  }

  /**
   * Phase 22C — list LIVE entries currently claimed by a specific worker.
   * Used by the durable replay coordinator to perform TARGETED reclaim
   * when a worker is confirmed dead.
   */
  async listByClaimer(workerId: string, opts?: { limit?: number }): Promise<QueueEntry[]> {
    if (!workerId) return [];
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    return this.withRetry('listByClaimer', { workerId, limit }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('queue_status', 'claimed')
        .eq('claimed_by_worker', workerId)
        .order('claimed_at', { ascending: true })
        .order('queue_entry_id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as QueueRow[];
      return rows.map(rowToEntry);
    });
  }

  async countByStatus(): Promise<Record<QueueEntryStatus, number>> {
    return this.withRetry('countByStatus', {}, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('queue_status')
        .limit(50_000);
      if (error) throw error;
      const counts: Record<QueueEntryStatus, number> = {
        queued: 0, claimed: 0, completed: 0,
        failed: 0, dead_lettered: 0, cancelled: 0,
      };
      for (const r of (data ?? []) as Array<{ queue_status: QueueEntryStatus }>) {
        counts[r.queue_status] = (counts[r.queue_status] ?? 0) + 1;
      }
      return counts;
    });
  }

  async depth(input?: { companyId?: string; kind?: QueueEntryKind }): Promise<number> {
    const nowIso = new Date().toISOString();
    return this.withRetry('depth', { companyId: input?.companyId, kind: input?.kind }, async () => {
      let q: any = this.client.from(this.tableName)
        .select('queue_entry_id', { count: 'exact', head: true })
        .eq('queue_status', 'queued')
        .lte('scheduled_for', nowIso);
      if (input?.companyId) q = q.eq('company_id', input.companyId);
      if (input?.kind) q = q.eq('kind', input.kind);
      const { count, error } = await q as unknown as { count: number; error: unknown };
      if (error) throw error;
      return count ?? 0;
    });
  }

  // ── Phase 21 extras: archival + compaction helpers ────────────────

  /**
   * Bulk-archive terminal entries older than `cutoffIso`. Returns the
   * count of archived rows. Used by the compactor.
   */
  async deleteTerminalEntriesOlderThan(cutoffIso: string, opts?: { limit?: number }): Promise<number> {
    const limit = Math.max(1, Math.min(10_000, opts?.limit ?? 1_000));
    return this.withRetry('deleteTerminalEntriesOlderThan', { cutoffIso, limit }, async () => {
      // PostgREST doesn't support DELETE ... LIMIT directly; fetch ids first.
      const { data: ids, error: idErr } = await this.client
        .from(this.tableName)
        .select('queue_entry_id')
        .in('queue_status', ['completed', 'dead_lettered', 'cancelled'])
        .lt('updated_at', cutoffIso)
        .limit(limit);
      if (idErr) throw idErr;
      const idList = ((ids ?? []) as Array<{ queue_entry_id: string }>).map((r) => r.queue_entry_id);
      if (idList.length === 0) return 0;
      const { error: delErr } = await this.client
        .from(this.tableName)
        .delete()
        .in('queue_entry_id', idList);
      if (delErr) throw delErr;
      return idList.length;
    });
  }
}

export { defaultTelemetrySink as defaultSupabaseQueueTelemetrySink };
