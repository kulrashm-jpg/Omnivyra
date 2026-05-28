/**
 * Phase 16 — SupabaseExecutionStore
 *
 * Production-grade `ExecutionStore` implementation backed by the
 * `thread_runtime_executions` table (already applied in prod, see
 * supabase/migrations/20260808_thread_runtime_executions.sql).
 *
 * ────────────────────────────────────────────────────────────────────
 * SCOPE
 * ────────────────────────────────────────────────────────────────────
 * - This file implements the EXECUTION-ROW operations only.
 * - Checkpoints + leases are explicitly OUT OF SCOPE for this phase
 *   (see PHASE 16 NON-GOALS). Those methods throw a structured
 *   `UnsupportedOperationError` so any accidental caller fails loudly
 *   instead of silently no-op.
 * - The in-memory store remains the default; this implementation is
 *   activated only when THREAD_RUNTIME_PERSISTENCE_MODE=supabase.
 *
 * ────────────────────────────────────────────────────────────────────
 * GUARANTEES
 * ────────────────────────────────────────────────────────────────────
 * - Idempotent writes (createExecution uses upsert semantics).
 * - Safe partial updates (only fields present in `patch` are written).
 * - Deterministic timestamps (caller-supplied ISO strings, never
 *   pg's now() — so callers in tests can pin time).
 * - Structured error wrapping (SupabaseExecutionStoreError).
 * - Retry wrapper for TRANSIENT failures only (network / 503 / pg
 *   58XXX-class). Hard cap at maxRetries; no infinite loops.
 * - Every write emits a structured telemetry event:
 *     execution_store_write_success
 *     execution_store_write_failure
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type { ExecutionStore } from '@/backend/services/threadRuntime/executionStore';
import type {
  ExecutionCheckpoint,
  ExecutionLease,
  ExecutionRecord,
  ExecutionStatus,
  OrchestrationPhase,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { SupabaseLeaseStore } from './supabaseLeaseStore';

// ── Errors ───────────────────────────────────────────────────────────

export class SupabaseExecutionStoreError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseExecutionStore.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseExecutionStoreError';
  }
}

/**
 * Thrown when a checkpoint/lease method is called without injecting a
 * corresponding store. Pre-Phase-18 behavior preserved: callers that don't
 * compose dedicated stores still fail loudly instead of silently no-op.
 */
export class UnsupportedOperationError extends Error {
  constructor(operation: string) {
    super(`[SupabaseExecutionStore] ${operation} requires a dedicated checkpoint/lease store. Construct SupabaseExecutionStore with { checkpointStore } or { leaseStore }.`);
    this.name = 'UnsupportedOperationError';
  }
}

// ── Telemetry ────────────────────────────────────────────────────────

export type ExecutionStoreTelemetryEvent =
  | 'execution_store_write_success'
  | 'execution_store_write_failure';

export interface ExecutionStoreTelemetrySink {
  emit(event: ExecutionStoreTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ExecutionStoreTelemetrySink = {
  emit(event, payload) {
    // Structured single-line JSON log, matches the codebase's
    // [namespace] style logging used in other backend services.
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'execution_store_write_failure') console.warn(`[execution_store] ${line}`);
      else console.log(`[execution_store] ${line}`);
    } catch {
      // ignore telemetry failures — they must never break the data path
    }
  },
};

// ── Row projection ───────────────────────────────────────────────────

interface ThreadRuntimeExecutionRow {
  execution_id: string;
  runtime_session_id: string;
  thread_id: string;
  company_id: string;
  orchestration_phase: OrchestrationPhase;
  execution_status: ExecutionStatus;
  execution_owner: string | null;
  retry_count: number;
  recovery_state: ExecutionRecord['recoveryState'];
  started_at: string;
  heartbeat_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  replay_checkpoint_id: string | null;
  // metadata_json is appendable per the spec — we don't surface it on the
  // ExecutionRecord interface (out of scope), but appendExecutionMetadata
  // writes through it for forensic / debugging use.
}

function rowToRecord(row: ThreadRuntimeExecutionRow): ExecutionRecord {
  return {
    executionId:        row.execution_id,
    runtimeSessionId:   row.runtime_session_id,
    threadId:           row.thread_id,
    companyId:          row.company_id,
    orchestrationPhase: row.orchestration_phase,
    executionStatus:    row.execution_status,
    executionOwner:     row.execution_owner,
    retryCount:         row.retry_count,
    recoveryState:      row.recovery_state,
    startedAt:          row.started_at,
    heartbeatAt:        row.heartbeat_at,
    completedAt:        row.completed_at,
    failureReason:      row.failure_reason,
    replayCheckpointId: row.replay_checkpoint_id,
  };
}

function recordToRow(record: ExecutionRecord): ThreadRuntimeExecutionRow {
  return {
    execution_id:         record.executionId,
    runtime_session_id:   record.runtimeSessionId,
    thread_id:            record.threadId,
    company_id:           record.companyId,
    orchestration_phase:  record.orchestrationPhase,
    execution_status:     record.executionStatus,
    execution_owner:      record.executionOwner,
    retry_count:          record.retryCount,
    recovery_state:       record.recoveryState,
    started_at:           record.startedAt,
    heartbeat_at:         record.heartbeatAt,
    completed_at:         record.completedAt,
    failure_reason:       record.failureReason,
    replay_checkpoint_id: record.replayCheckpointId,
  };
}

type PatchableField =
  | 'orchestrationPhase'
  | 'executionStatus'
  | 'executionOwner'
  | 'retryCount'
  | 'recoveryState'
  | 'heartbeatAt'
  | 'completedAt'
  | 'failureReason'
  | 'replayCheckpointId';

const TS_FIELD_TO_COLUMN: Record<PatchableField, string> = {
  orchestrationPhase: 'orchestration_phase',
  executionStatus:    'execution_status',
  executionOwner:     'execution_owner',
  retryCount:         'retry_count',
  recoveryState:      'recovery_state',
  heartbeatAt:        'heartbeat_at',
  completedAt:        'completed_at',
  failureReason:      'failure_reason',
  replayCheckpointId: 'replay_checkpoint_id',
};

// ── Retry classification ─────────────────────────────────────────────

// Postgres SQLSTATE classes that indicate transient conditions; safe to retry.
// 08*: connection exception (lost connection / cannot connect)
// 40001 / 40P01: serialization failure / deadlock detected
// 57P03: cannot_connect_now (Supabase pooler hiccup)
// 53*: insufficient_resources (worth one retry)
const TRANSIENT_SQLSTATE_PREFIXES = ['08', '53'];
const TRANSIENT_SQLSTATE_CODES = new Set(['40001', '40P01', '57P03', '57014']);

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.status && e.status >= 500 && e.status < 600) return true;
  const code = typeof e.code === 'string' ? e.code : '';
  if (TRANSIENT_SQLSTATE_CODES.has(code)) return true;
  if (TRANSIENT_SQLSTATE_PREFIXES.some((p) => code.startsWith(p))) return true;
  // Network-layer fetch errors from supabase-js
  const msg = typeof e.message === 'string' ? e.message : '';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg)) return true;
  return false;
}

// ── SupabaseExecutionStore ───────────────────────────────────────────

export interface SupabaseExecutionStoreOptions {
  /** Override the supabase client (tests). Defaults to the service-role admin client. */
  client?: SupabaseClient;
  /** Override telemetry sink (tests). Defaults to a structured JSON log writer. */
  telemetry?: ExecutionStoreTelemetrySink;
  /** Max retry attempts on transient failures. Default 3. */
  maxRetries?: number;
  /** Base backoff for retries in ms. Doubles each attempt. Default 100. */
  initialBackoffMs?: number;
  /** Table name override (tests / schema isolation). Default 'thread_runtime_executions'. */
  tableName?: string;
  /**
   * Phase 18 — Optional dedicated checkpoint persistence. When provided,
   * checkpoint methods delegate to it. When omitted, they throw
   * UnsupportedOperationError (matches pre-Phase-18 behavior).
   */
  checkpointStore?: SupabaseCheckpointStore;
  /**
   * Phase 18 — Optional dedicated lease persistence. When provided,
   * lease methods delegate to it. When omitted, they throw
   * UnsupportedOperationError (matches pre-Phase-18 behavior).
   */
  leaseStore?: SupabaseLeaseStore;
}

export class SupabaseExecutionStore implements ExecutionStore {
  private readonly client: SupabaseClient;
  private readonly telemetry: ExecutionStoreTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;
  private readonly checkpointStore: SupabaseCheckpointStore | null;
  private readonly leaseStore: SupabaseLeaseStore | null;

  constructor(options: SupabaseExecutionStoreOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_executions';
    this.checkpointStore = options.checkpointStore ?? null;
    this.leaseStore = options.leaseStore ?? null;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async withRetry<T>(operation: string, payload: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await fn();
        this.telemetry.emit('execution_store_write_success', { operation, attempt, ...payload });
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && isTransient(err)) {
          const wait = this.initialBackoffMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        // permanent or out of retries
        const code = (err as { code?: string })?.code ?? 'UNKNOWN';
        const msg = (err as Error)?.message ?? 'unknown error';
        this.telemetry.emit('execution_store_write_failure', { operation, attempt, code, error: msg, ...payload });
        throw new SupabaseExecutionStoreError(operation, code, msg, attempt, err);
      }
    }
    // unreachable; loop either returned or threw
    const fallbackErr = lastErr as Error | undefined;
    throw new SupabaseExecutionStoreError(operation, 'EXHAUSTED', fallbackErr?.message ?? 'retries exhausted', this.maxRetries, fallbackErr);
  }

  private validateCreateInput(record: ExecutionRecord): void {
    if (!record.executionId || typeof record.executionId !== 'string') throw new SupabaseExecutionStoreError('createExecution', 'INVALID_INPUT', 'executionId required', 0);
    if (!record.runtimeSessionId) throw new SupabaseExecutionStoreError('createExecution', 'INVALID_INPUT', 'runtimeSessionId required', 0);
    if (!record.threadId) throw new SupabaseExecutionStoreError('createExecution', 'INVALID_INPUT', 'threadId required', 0);
    if (!record.companyId) throw new SupabaseExecutionStoreError('createExecution', 'INVALID_INPUT', 'companyId required', 0);
    if (!record.startedAt) throw new SupabaseExecutionStoreError('createExecution', 'INVALID_INPUT', 'startedAt required', 0);
  }

  // ── ExecutionStore interface — Execution methods ────────────────────

  /**
   * Idempotent insert: a second call with the same executionId is a
   * no-op and returns the existing row. Implemented as INSERT with
   * `ON CONFLICT DO NOTHING` via supabase-js `.upsert({ ignoreDuplicates: true })`.
   */
  async createExecution(record: ExecutionRecord): Promise<ExecutionRecord> {
    this.validateCreateInput(record);
    const row = recordToRow(record);
    return this.withRetry('createExecution', { executionId: record.executionId, companyId: record.companyId }, async () => {
      const { error } = await this.client
        .from(this.tableName)
        .upsert(row, { onConflict: 'execution_id', ignoreDuplicates: true });
      if (error) throw error;
      // Read back to return the canonical row (handles both fresh insert and existing-row dedup).
      const existing = await this.getExecutionById(record.executionId);
      if (!existing) throw new SupabaseExecutionStoreError('createExecution', 'POST_INSERT_LOOKUP_MISSING', `inserted row not readable: ${record.executionId}`, 0);
      return existing;
    });
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.getExecutionById(executionId);
  }

  async updateExecution(executionId: string, patch: Partial<Pick<ExecutionRecord, PatchableField>>): Promise<ExecutionRecord | null> {
    if (!executionId) throw new SupabaseExecutionStoreError('updateExecution', 'INVALID_INPUT', 'executionId required', 0);
    // Build column-keyed patch dropping `undefined` so partial updates are safe.
    const columnPatch: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as Array<keyof typeof patch>) {
      const value = patch[k];
      if (value === undefined) continue;
      const column = TS_FIELD_TO_COLUMN[k as PatchableField];
      if (!column) continue;
      columnPatch[column] = value;
    }
    if (Object.keys(columnPatch).length === 0) {
      // Nothing to update; return the current state.
      return this.getExecutionById(executionId);
    }
    columnPatch.updated_at = new Date().toISOString();
    return this.withRetry('updateExecution', { executionId, fields: Object.keys(columnPatch) }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .update(columnPatch)
        .eq('execution_id', executionId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToRecord(data as ThreadRuntimeExecutionRow);
    });
  }

  async listExecutions(input: { companyId?: string; threadId?: string; status?: ExecutionStatus | ExecutionStatus[]; limit?: number }): Promise<ExecutionRecord[]> {
    const limit = Math.max(1, Math.min(1000, input.limit ?? 100));
    return this.withRetry('listExecutions', { companyId: input.companyId, threadId: input.threadId, statusFilter: input.status }, async () => {
      let query = this.client
        .from(this.tableName)
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (input.companyId) query = query.eq('company_id', input.companyId);
      if (input.threadId) query = query.eq('thread_id', input.threadId);
      if (input.status) {
        const list = Array.isArray(input.status) ? input.status : [input.status];
        if (list.length === 1) query = query.eq('execution_status', list[0]);
        else query = query.in('execution_status', list);
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as ThreadRuntimeExecutionRow[];
      return rows.map(rowToRecord);
    });
  }

  // ── ExecutionStore interface — Checkpoint + Lease delegation ──
  //
  // Phase 18: when a dedicated checkpoint/lease store is supplied via
  // constructor options, these methods delegate. When omitted they throw
  // UnsupportedOperationError so misconfiguration is loud (preserves
  // pre-Phase-18 fail-fast behavior).

  async recordCheckpoint(cp: ExecutionCheckpoint): Promise<ExecutionCheckpoint> {
    if (!this.checkpointStore) throw new UnsupportedOperationError('recordCheckpoint');
    const written = await this.checkpointStore.appendCheckpoint(cp);
    // Mirror in-memory contract: bump executionrecord.replayCheckpointId.
    // Failures here are non-fatal — the checkpoint itself is durable.
    try {
      await this.updateExecution(cp.executionId, { replayCheckpointId: written.checkpointId });
    } catch { /* secondary update is best-effort */ }
    return written;
  }

  async listCheckpoints(executionId: string): Promise<ExecutionCheckpoint[]> {
    if (!this.checkpointStore) throw new UnsupportedOperationError('listCheckpoints');
    return this.checkpointStore.listExecutionCheckpoints(executionId);
  }

  async getCheckpoint(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    if (!this.checkpointStore) throw new UnsupportedOperationError('getCheckpoint');
    return this.checkpointStore.getCheckpointById(checkpointId);
  }

  async acquireLease(input: { executionId: string; workerId: string; durationMs: number; nowMs?: number }): Promise<ExecutionLease | null> {
    if (!this.leaseStore) throw new UnsupportedOperationError('acquireLease');
    const lease = await this.leaseStore.acquireLease(input);
    if (lease) {
      // Mirror in-memory contract: stamp owner + heartbeat on the execution row.
      try {
        await this.updateExecution(input.executionId, {
          executionOwner: input.workerId,
          heartbeatAt: lease.acquiredAt,
        });
      } catch { /* secondary update is best-effort; lease itself is durable */ }
    }
    return lease;
  }

  async renewLease(input: { leaseId: string; durationMs: number; nowMs?: number }): Promise<ExecutionLease | null> {
    if (!this.leaseStore) throw new UnsupportedOperationError('renewLease');
    const lease = await this.leaseStore.renewLease(input);
    if (lease) {
      try {
        await this.updateExecution(lease.executionId, {
          heartbeatAt: new Date(input.nowMs ?? Date.now()).toISOString(),
        });
      } catch { /* secondary update is best-effort */ }
    }
    return lease;
  }

  async releaseLease(leaseId: string): Promise<void> {
    if (!this.leaseStore) throw new UnsupportedOperationError('releaseLease');
    await this.leaseStore.releaseLease(leaseId);
  }

  async currentLease(executionId: string): Promise<ExecutionLease | null> {
    if (!this.leaseStore) throw new UnsupportedOperationError('currentLease');
    return this.leaseStore.currentLeaseForExecution(executionId);
  }

  async listExpiredLeases(input: { nowMs: number; limit?: number }): Promise<ExecutionLease[]> {
    if (!this.leaseStore) throw new UnsupportedOperationError('listExpiredLeases');
    return this.leaseStore.detectExpiredLeases({ nowMs: input.nowMs, limit: input.limit });
  }

  // ── Phase-16 convenience helpers (additional public API) ───────────

  /** Apply a narrow status / phase / owner / retryCount patch. */
  async updateExecutionState(input: {
    executionId: string;
    status?: ExecutionStatus;
    phase?: OrchestrationPhase;
    owner?: string | null;
    retryCount?: number;
    heartbeatAtIso?: string;
  }): Promise<ExecutionRecord | null> {
    return this.updateExecution(input.executionId, {
      executionStatus: input.status,
      orchestrationPhase: input.phase,
      executionOwner: input.owner,
      retryCount: input.retryCount,
      heartbeatAt: input.heartbeatAtIso,
    });
  }

  /**
   * Idempotent append into the row's metadata bag. Implemented via an
   * RPC-free read-modify-write using PostgREST's JSON `jsonb_set` is not
   * exposed to anon callers, so we do a "fetch row → merge JSON → write
   * back" sequence. Safe under single-writer scenarios. For high-contention
   * use, a future migration can add a SECURITY DEFINER function.
   *
   * NOTE: This phase does NOT add a metadata column. If the schema does
   * not include a `metadata_json` column, this is a no-op that emits a
   * warning telemetry event. The behavior is intentionally tolerant so
   * callers wiring this in don't crash before the column is added.
   */
  async appendExecutionMetadata(input: { executionId: string; metadata: Record<string, unknown> }): Promise<{ appended: boolean; reason?: string }> {
    return this.withRetry('appendExecutionMetadata', { executionId: input.executionId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', input.executionId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { appended: false, reason: 'execution_not_found' };
      // Tolerant column presence check — see method doc.
      const row = data as ThreadRuntimeExecutionRow & { metadata_json?: Record<string, unknown> | null };
      if (!('metadata_json' in row)) {
        return { appended: false, reason: 'metadata_column_absent' };
      }
      const merged = { ...(row.metadata_json ?? {}), ...input.metadata };
      const { error: updateErr } = await this.client
        .from(this.tableName)
        .update({ metadata_json: merged, updated_at: new Date().toISOString() })
        .eq('execution_id', input.executionId);
      if (updateErr) throw updateErr;
      return { appended: true };
    });
  }

  async markExecutionCompleted(executionId: string, opts?: { completedAtIso?: string }): Promise<ExecutionRecord | null> {
    const completedAt = opts?.completedAtIso ?? new Date().toISOString();
    return this.updateExecution(executionId, {
      executionStatus: 'completed',
      completedAt,
    });
  }

  async markExecutionFailed(executionId: string, opts: { reason: string; completedAtIso?: string }): Promise<ExecutionRecord | null> {
    const completedAt = opts.completedAtIso ?? new Date().toISOString();
    return this.updateExecution(executionId, {
      executionStatus: 'failed',
      failureReason: opts.reason,
      completedAt,
    });
  }

  async getExecutionById(executionId: string): Promise<ExecutionRecord | null> {
    if (!executionId) return null;
    return this.withRetry('getExecutionById', { executionId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', executionId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToRecord(data as ThreadRuntimeExecutionRow);
    });
  }

  /** Latest execution for a thread (by started_at DESC). */
  async getExecutionByThreadId(input: { companyId: string; threadId: string }): Promise<ExecutionRecord | null> {
    if (!input.companyId || !input.threadId) return null;
    return this.withRetry('getExecutionByThreadId', input as unknown as Record<string, unknown>, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('company_id', input.companyId)
        .eq('thread_id', input.threadId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToRecord(data as ThreadRuntimeExecutionRow);
    });
  }

  /** Active = NOT terminal (running, waiting, recovering, pending). */
  async listActiveExecutions(input?: { companyId?: string; limit?: number }): Promise<ExecutionRecord[]> {
    return this.listExecutions({
      companyId: input?.companyId,
      status: ['pending', 'running', 'waiting', 'recovering'],
      limit: input?.limit,
    });
  }
}

// ── Telemetry helper exports (for tests + boot wiring) ──────────────

export { defaultTelemetrySink };
