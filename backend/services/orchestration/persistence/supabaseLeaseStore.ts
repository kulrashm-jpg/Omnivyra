/**
 * Phase 18B — SupabaseLeaseStore
 *
 * Atomic worker-lease persistence backed by `thread_runtime_leases`
 * (migration 20260808 already in prod). The schema enforces:
 *
 *   uniq_thread_runtime_leases_active — partial unique index on
 *     (execution_id) WHERE released = FALSE
 *
 * so concurrent acquire attempts resolve at the DATABASE layer (not just
 * application code). The lease store leans on that invariant: a duplicate
 * acquire returns null and emits `lease_acquire_failure` with code
 * 'ALREADY_ACTIVE'.
 *
 * Methods (per spec):
 *   - acquireLease()
 *   - renewLease()
 *   - releaseLease()
 *   - getLease()
 *   - listActiveLeases()
 *   - detectExpiredLeases()
 *
 * Scope: PERSISTENCE ONLY. NO rebalance daemon. NO auto-stealing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type { ExecutionLease } from '@/backend/services/threadRuntime/threadRuntimeTypes';

// ── Errors ───────────────────────────────────────────────────────────

export class SupabaseLeaseStoreError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseLeaseStore.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseLeaseStoreError';
  }
}

// ── Telemetry ────────────────────────────────────────────────────────

export type LeaseStoreTelemetryEvent =
  | 'lease_acquire_success'
  | 'lease_acquire_failure'
  | 'lease_renew_success'
  | 'lease_renew_failure';

export interface LeaseStoreTelemetrySink {
  emit(event: LeaseStoreTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: LeaseStoreTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'lease_acquire_failure' || event === 'lease_renew_failure') {
        console.warn(`[lease_store] ${line}`);
      } else {
        console.log(`[lease_store] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ── Retry (matches checkpoint store / execution store) ──────────────

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

// PG unique_violation SQLSTATE is 23505. We surface that as the
// 'ALREADY_ACTIVE' lease outcome instead of an error throw.
const UNIQUE_VIOLATION_SQLSTATE = '23505';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === UNIQUE_VIOLATION_SQLSTATE;
}

// ── Row projection ───────────────────────────────────────────────────

interface LeaseRow {
  lease_id: string;
  execution_id: string;
  owner_worker_id: string;
  acquired_at: string;
  expires_at: string;
  released: boolean;
}

function rowToLease(row: LeaseRow): ExecutionLease {
  return {
    leaseId:        row.lease_id,
    executionId:    row.execution_id,
    ownerWorkerId:  row.owner_worker_id,
    acquiredAt:     row.acquired_at,
    expiresAt:      row.expires_at,
    released:       row.released,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── SupabaseLeaseStore ──────────────────────────────────────────────

export interface SupabaseLeaseStoreOptions {
  client?: SupabaseClient;
  telemetry?: LeaseStoreTelemetrySink;
  maxRetries?: number;
  initialBackoffMs?: number;
  tableName?: string;
}

export class SupabaseLeaseStore {
  private readonly client: SupabaseClient;
  private readonly telemetry: LeaseStoreTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;

  constructor(options: SupabaseLeaseStoreOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_leases';
  }

  private async withRetry<T>(
    operation: string,
    successEvent: LeaseStoreTelemetryEvent | null,
    failureEvent: LeaseStoreTelemetryEvent | null,
    payload: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await fn();
        if (successEvent) this.telemetry.emit(successEvent, { operation, attempt, ...payload });
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && isTransient(err)) {
          await new Promise((r) => setTimeout(r, this.initialBackoffMs * Math.pow(2, attempt)));
          continue;
        }
        const code = (err as { code?: string })?.code ?? 'UNKNOWN';
        const msg = (err as Error)?.message ?? 'unknown error';
        if (failureEvent) this.telemetry.emit(failureEvent, { operation, attempt, code, error: msg, ...payload });
        throw new SupabaseLeaseStoreError(operation, code, msg, attempt, err);
      }
    }
    throw new SupabaseLeaseStoreError(operation, 'EXHAUSTED', (lastErr as Error)?.message ?? 'retries exhausted', this.maxRetries, lastErr);
  }

  /**
   * Acquire an exclusive lease on an execution. Atomic via the partial
   * unique index `uniq_thread_runtime_leases_active`. Returns null if
   * another worker already holds a live lease.
   */
  async acquireLease(input: {
    executionId: string;
    workerId: string;
    durationMs: number;
    nowMs?: number;
  }): Promise<ExecutionLease | null> {
    if (!input.executionId) throw new SupabaseLeaseStoreError('acquireLease', 'INVALID_INPUT', 'executionId required', 0);
    if (!input.workerId) throw new SupabaseLeaseStoreError('acquireLease', 'INVALID_INPUT', 'workerId required', 0);
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new SupabaseLeaseStoreError('acquireLease', 'INVALID_INPUT', 'durationMs must be positive', 0);
    }
    const nowMs = input.nowMs ?? Date.now();
    const row: LeaseRow = {
      lease_id: newId('lease'),
      execution_id: input.executionId,
      owner_worker_id: input.workerId,
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + input.durationMs).toISOString(),
      released: false,
    };
    try {
      return await this.withRetry(
        'acquireLease',
        'lease_acquire_success',
        null, // don't double-emit failure for non-unique-violation throws
        { executionId: input.executionId, workerId: input.workerId, leaseId: row.lease_id },
        async () => {
          const { error } = await this.client.from(this.tableName).insert(row);
          if (error) throw error;
          return rowToLease(row);
        },
      );
    } catch (err) {
      // Map unique-violation to a soft null (already held). All other errors propagate.
      if (err instanceof SupabaseLeaseStoreError && err.code === UNIQUE_VIOLATION_SQLSTATE) {
        this.telemetry.emit('lease_acquire_failure', {
          operation: 'acquireLease',
          executionId: input.executionId,
          workerId: input.workerId,
          reason: 'ALREADY_ACTIVE',
        });
        return null;
      }
      // Non-unique failures: re-emit failure once and rethrow.
      const code = err instanceof SupabaseLeaseStoreError ? err.code : 'UNKNOWN';
      const msg = (err as Error)?.message ?? 'unknown';
      this.telemetry.emit('lease_acquire_failure', {
        operation: 'acquireLease', executionId: input.executionId, workerId: input.workerId, code, error: msg,
      });
      throw err;
    }
  }

  /** Extend an existing live lease's expiration. Returns null if released/unknown. */
  async renewLease(input: {
    leaseId: string;
    durationMs: number;
    nowMs?: number;
  }): Promise<ExecutionLease | null> {
    if (!input.leaseId) throw new SupabaseLeaseStoreError('renewLease', 'INVALID_INPUT', 'leaseId required', 0);
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new SupabaseLeaseStoreError('renewLease', 'INVALID_INPUT', 'durationMs must be positive', 0);
    }
    const nowMs = input.nowMs ?? Date.now();
    const newExpiry = new Date(nowMs + input.durationMs).toISOString();
    return this.withRetry(
      'renewLease', 'lease_renew_success', 'lease_renew_failure',
      { leaseId: input.leaseId, newExpiry },
      async () => {
        const { data, error } = await this.client
          .from(this.tableName)
          .update({ expires_at: newExpiry })
          .eq('lease_id', input.leaseId)
          .eq('released', false)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return rowToLease(data as LeaseRow);
      },
    );
  }

  async releaseLease(leaseId: string): Promise<void> {
    if (!leaseId) return;
    await this.withRetry(
      'releaseLease', 'lease_renew_success', 'lease_renew_failure',
      { leaseId },
      async () => {
        const { error } = await this.client
          .from(this.tableName)
          .update({ released: true })
          .eq('lease_id', leaseId);
        if (error) throw error;
      },
    );
  }

  async getLease(leaseId: string): Promise<ExecutionLease | null> {
    if (!leaseId) return null;
    return this.withRetry(
      'getLease', null, null,
      { leaseId },
      async () => {
        const { data, error } = await this.client
          .from(this.tableName)
          .select('*')
          .eq('lease_id', leaseId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return rowToLease(data as LeaseRow);
      },
    );
  }

  /** Active = released=false AND expires_at > now. Ordered by acquired_at DESC. */
  async listActiveLeases(input?: { nowMs?: number; limit?: number }): Promise<ExecutionLease[]> {
    const nowIso = new Date(input?.nowMs ?? Date.now()).toISOString();
    const limit = Math.max(1, Math.min(1000, input?.limit ?? 100));
    return this.withRetry(
      'listActiveLeases', null, null,
      { limit },
      async () => {
        const { data, error } = await this.client
          .from(this.tableName)
          .select('*')
          .eq('released', false)
          .gt('expires_at', nowIso)
          .order('acquired_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        const rows = (data ?? []) as LeaseRow[];
        return rows.map(rowToLease);
      },
    );
  }

  /** Leases with released=false AND expires_at <= now (i.e. abandoned). */
  async detectExpiredLeases(input?: { nowMs?: number; limit?: number }): Promise<ExecutionLease[]> {
    const nowIso = new Date(input?.nowMs ?? Date.now()).toISOString();
    const limit = Math.max(1, Math.min(1000, input?.limit ?? 100));
    return this.withRetry(
      'detectExpiredLeases', null, null,
      { limit },
      async () => {
        const { data, error } = await this.client
          .from(this.tableName)
          .select('*')
          .eq('released', false)
          .lte('expires_at', nowIso)
          .order('expires_at', { ascending: true })
          .limit(limit);
        if (error) throw error;
        const rows = (data ?? []) as LeaseRow[];
        return rows.map(rowToLease);
      },
    );
  }

  /** Look up the current active lease for an execution. */
  async currentLeaseForExecution(executionId: string, opts?: { nowMs?: number }): Promise<ExecutionLease | null> {
    if (!executionId) return null;
    const nowIso = new Date(opts?.nowMs ?? Date.now()).toISOString();
    return this.withRetry(
      'currentLeaseForExecution', null, null,
      { executionId },
      async () => {
        const { data, error } = await this.client
          .from(this.tableName)
          .select('*')
          .eq('execution_id', executionId)
          .eq('released', false)
          .gt('expires_at', nowIso)
          .order('acquired_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return rowToLease(data as LeaseRow);
      },
    );
  }
}

export { defaultTelemetrySink as defaultLeaseTelemetrySink, UNIQUE_VIOLATION_SQLSTATE };
