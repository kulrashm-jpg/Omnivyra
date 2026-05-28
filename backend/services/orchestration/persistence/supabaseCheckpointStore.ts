/**
 * Phase 18A — SupabaseCheckpointStore
 *
 * Append-only durable checkpoint persistence backed by
 * `thread_runtime_checkpoints` (migration 20260808 already in prod).
 *
 * Methods (per spec):
 *   - appendCheckpoint()
 *   - getLatestCheckpoint()
 *   - listExecutionCheckpoints()
 *   - restoreCheckpointState()  // coalesced view across all checkpoints
 *   - checkpointExists()
 *
 * Guarantees:
 *   - append-only (no update / delete; reject by INSERT-only API surface)
 *   - deterministic replay ordering ((taken_at, checkpoint_id) tiebreak)
 *   - payload validation (executionId / phase / id-array shape)
 *   - payload size guardrail (MAX_PAYLOAD_BYTES; rejects with 'PAYLOAD_TOO_LARGE')
 *   - replay-safe serialization (JSON-safe shape; arrays defaulted to [])
 *   - structured telemetry on every write
 *
 * Scope: PERSISTENCE ONLY. No replay orchestration. No autonomous recovery.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type {
  ExecutionCheckpoint,
  OrchestrationPhase,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';

// ── Errors ───────────────────────────────────────────────────────────

export class SupabaseCheckpointStoreError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseCheckpointStore.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseCheckpointStoreError';
  }
}

// ── Telemetry (compatible with the execution-store sink shape) ────

export type CheckpointStoreTelemetryEvent =
  | 'checkpoint_store_write_success'
  | 'checkpoint_store_write_failure';

export interface CheckpointStoreTelemetrySink {
  emit(event: CheckpointStoreTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: CheckpointStoreTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'checkpoint_store_write_failure') console.warn(`[checkpoint_store] ${line}`);
      else console.log(`[checkpoint_store] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Retry classification (shared semantics with execution store) ──

const TRANSIENT_SQLSTATE_PREFIXES = ['08', '53'];
const TRANSIENT_SQLSTATE_CODES = new Set(['40001', '40P01', '57P03', '57014']);

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

// ── Row projection ───────────────────────────────────────────────────

interface CheckpointRow {
  checkpoint_id: string;
  execution_id: string;
  taken_at: string;
  phase: OrchestrationPhase;
  completed_node_operation_ids: string[];
  pending_node_operation_ids: string[];
  pending_topology_mutation_ids: string[];
  recovery_progress: Record<string, unknown> | null;
  replay_continuity: Record<string, unknown> | null;
}

function rowToCheckpoint(row: CheckpointRow): ExecutionCheckpoint {
  return {
    checkpointId:                  row.checkpoint_id,
    executionId:                   row.execution_id,
    takenAt:                       row.taken_at,
    phase:                         row.phase,
    completedNodeOperationIds:     row.completed_node_operation_ids ?? [],
    pendingNodeOperationIds:       row.pending_node_operation_ids ?? [],
    pendingTopologyMutationIds:    row.pending_topology_mutation_ids ?? [],
    recoveryProgress:              row.recovery_progress ?? null,
    replayContinuity:              row.replay_continuity ?? null,
  };
}

function checkpointToRow(cp: ExecutionCheckpoint): CheckpointRow {
  return {
    checkpoint_id:                  cp.checkpointId,
    execution_id:                   cp.executionId,
    taken_at:                       cp.takenAt,
    phase:                          cp.phase,
    completed_node_operation_ids:   cp.completedNodeOperationIds ?? [],
    pending_node_operation_ids:     cp.pendingNodeOperationIds ?? [],
    pending_topology_mutation_ids:  cp.pendingTopologyMutationIds ?? [],
    recovery_progress:              cp.recoveryProgress ?? null,
    replay_continuity:              cp.replayContinuity ?? null,
  };
}

// ── Payload validation + size guard ──────────────────────────────────

const MAX_PAYLOAD_BYTES = 256 * 1024;
const VALID_PHASES = new Set<OrchestrationPhase>([
  'precheck', 'generation', 'persistence', 'topology_settle', 'recovery', 'finalize',
]);

function validateCheckpoint(cp: ExecutionCheckpoint): void {
  if (!cp || typeof cp !== 'object') {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'checkpoint must be an object', 0);
  }
  if (!cp.checkpointId || typeof cp.checkpointId !== 'string') {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'checkpointId required', 0);
  }
  if (!cp.executionId || typeof cp.executionId !== 'string') {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'executionId required', 0);
  }
  if (!cp.takenAt || typeof cp.takenAt !== 'string') {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'takenAt required', 0);
  }
  if (!VALID_PHASES.has(cp.phase)) {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', `invalid phase "${cp.phase}"`, 0);
  }
  if (!Array.isArray(cp.completedNodeOperationIds)) {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'completedNodeOperationIds must be string[]', 0);
  }
  if (!Array.isArray(cp.pendingNodeOperationIds)) {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'pendingNodeOperationIds must be string[]', 0);
  }
  // Size guard — serialize the row shape, not the original object.
  let bytes = 0;
  try { bytes = JSON.stringify(checkpointToRow(cp)).length; }
  catch { throw new SupabaseCheckpointStoreError('appendCheckpoint', 'INVALID_PAYLOAD', 'checkpoint not JSON-serializable', 0); }
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new SupabaseCheckpointStoreError('appendCheckpoint', 'PAYLOAD_TOO_LARGE', `checkpoint ${bytes}B exceeds ${MAX_PAYLOAD_BYTES}B`, 0);
  }
}

// ── SupabaseCheckpointStore ─────────────────────────────────────────

export interface SupabaseCheckpointStoreOptions {
  client?: SupabaseClient;
  telemetry?: CheckpointStoreTelemetrySink;
  maxRetries?: number;
  initialBackoffMs?: number;
  tableName?: string;
}

export class SupabaseCheckpointStore {
  private readonly client: SupabaseClient;
  private readonly telemetry: CheckpointStoreTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;

  constructor(options: SupabaseCheckpointStoreOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_checkpoints';
  }

  private async withRetry<T>(operation: string, payload: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await fn();
        this.telemetry.emit('checkpoint_store_write_success', { operation, attempt, ...payload });
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && isTransient(err)) {
          await new Promise((r) => setTimeout(r, this.initialBackoffMs * Math.pow(2, attempt)));
          continue;
        }
        const code = (err as { code?: string })?.code ?? 'UNKNOWN';
        const msg = (err as Error)?.message ?? 'unknown error';
        this.telemetry.emit('checkpoint_store_write_failure', { operation, attempt, code, error: msg, ...payload });
        throw new SupabaseCheckpointStoreError(operation, code, msg, attempt, err);
      }
    }
    throw new SupabaseCheckpointStoreError(operation, 'EXHAUSTED', (lastErr as Error)?.message ?? 'retries exhausted', this.maxRetries, lastErr);
  }

  /** Append a new checkpoint. Idempotent on (checkpoint_id) PK collision. */
  async appendCheckpoint(cp: ExecutionCheckpoint): Promise<ExecutionCheckpoint> {
    validateCheckpoint(cp);
    const row = checkpointToRow(cp);
    return this.withRetry('appendCheckpoint', { executionId: cp.executionId, checkpointId: cp.checkpointId, phase: cp.phase }, async () => {
      const { error } = await this.client
        .from(this.tableName)
        .upsert(row, { onConflict: 'checkpoint_id', ignoreDuplicates: true });
      if (error) throw error;
      // Read-back so callers always get the canonical persisted row.
      const { data, error: readErr } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('checkpoint_id', cp.checkpointId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!data) throw new SupabaseCheckpointStoreError('appendCheckpoint', 'POST_INSERT_LOOKUP_MISSING', `inserted row not readable: ${cp.checkpointId}`, 0);
      return rowToCheckpoint(data as CheckpointRow);
    });
  }

  /** Latest checkpoint for an execution (by taken_at DESC, checkpoint_id DESC tiebreak). */
  async getLatestCheckpoint(executionId: string): Promise<ExecutionCheckpoint | null> {
    if (!executionId) return null;
    return this.withRetry('getLatestCheckpoint', { executionId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', executionId)
        .order('taken_at', { ascending: false })
        .order('checkpoint_id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToCheckpoint(data as CheckpointRow);
    });
  }

  /** All checkpoints for an execution, deterministic order (taken_at ASC, checkpoint_id ASC). */
  async listExecutionCheckpoints(executionId: string, opts?: { limit?: number }): Promise<ExecutionCheckpoint[]> {
    if (!executionId) return [];
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    return this.withRetry('listExecutionCheckpoints', { executionId, limit }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', executionId)
        .order('taken_at', { ascending: true })
        .order('checkpoint_id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as CheckpointRow[];
      return rows.map(rowToCheckpoint);
    });
  }

  /**
   * Coalesced restore view across all checkpoints for an execution.
   * Mirrors the in-memory `ExecutionCheckpointManager.restoreView()` shape,
   * so downstream consumers can use either backend interchangeably.
   * NO orchestration replay is invoked here — this is a pure aggregation.
   */
  async restoreCheckpointState(executionId: string): Promise<{
    phase: OrchestrationPhase | null;
    completedNodeOperationIds: string[];
    pendingNodeOperationIds: string[];
    pendingTopologyMutationIds: string[];
    recoveryProgress: Record<string, unknown> | null;
    replayContinuity: Record<string, unknown> | null;
  }> {
    const all = await this.listExecutionCheckpoints(executionId, { limit: 500 });
    if (all.length === 0) {
      return {
        phase: null,
        completedNodeOperationIds: [],
        pendingNodeOperationIds: [],
        pendingTopologyMutationIds: [],
        recoveryProgress: null,
        replayContinuity: null,
      };
    }
    const latest = all[all.length - 1];
    const completed = new Set<string>();
    for (const c of all) for (const id of c.completedNodeOperationIds) completed.add(id);
    const pending = latest.pendingNodeOperationIds.filter((id) => !completed.has(id));
    return {
      phase: latest.phase,
      completedNodeOperationIds: Array.from(completed),
      pendingNodeOperationIds: pending,
      pendingTopologyMutationIds: latest.pendingTopologyMutationIds,
      recoveryProgress: latest.recoveryProgress,
      replayContinuity: latest.replayContinuity,
    };
  }

  /** Fetch a single checkpoint by its primary key. */
  async getCheckpointById(checkpointId: string): Promise<ExecutionCheckpoint | null> {
    if (!checkpointId) return null;
    return this.withRetry('getCheckpointById', { checkpointId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToCheckpoint(data as CheckpointRow);
    });
  }

  async checkpointExists(checkpointId: string): Promise<boolean> {
    if (!checkpointId) return false;
    return this.withRetry('checkpointExists', { checkpointId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('checkpoint_id')
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    });
  }
}

export { defaultTelemetrySink as defaultCheckpointTelemetrySink, MAX_PAYLOAD_BYTES };
