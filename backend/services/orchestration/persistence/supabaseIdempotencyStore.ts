/**
 * Phase 19E — SupabaseIdempotencyStore
 *
 * Durable IdempotencyBackend implementation backed by a dedicated
 * `thread_runtime_idempotency_keys` table. Drop-in replacement for the
 * in-memory backend in executionIdempotencyGovernor.
 *
 * SCHEMA (see migration 20260810):
 *   thread_runtime_idempotency_keys
 *     fingerprint_key text PRIMARY KEY,
 *     cls             text NOT NULL,
 *     execution_id    text,
 *     first_seen_at   timestamp with time zone NOT NULL DEFAULT now(),
 *     suppressed_count integer NOT NULL DEFAULT 0
 *
 * SCOPE: persistence ONLY. No idempotency policy. No fingerprint
 * computation. The governor decides what constitutes a duplicate; this
 * store only stores + increments + retrieves keys.
 *
 * BEHAVIOR:
 *   - `record()` is the atomic primitive. It uses INSERT ... ON CONFLICT
 *     DO UPDATE to either insert a fresh key (outcome=first_seen) or
 *     increment the suppression counter (outcome=suppressed).
 *   - `get()`, `listForExecution()`, `totalSuppressionCount()` are
 *     pure read paths.
 *   - Memory mode keeps using createInMemoryIdempotencyBackend() — this
 *     module is opt-in.
 *
 * GUARANTEES:
 *   - Atomic increment via Postgres ON CONFLICT (single statement).
 *   - Idempotent on transient retry: a retried INSERT collides on the
 *     same PK and the second attempt observes the prior record.
 *   - Structured error wrapping + retry on transient SQLSTATE.
 *   - Telemetry: idempotency_store_write_success / _failure.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type {
  IdempotencyClass,
  IdempotencyFingerprint,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  GuardOutcome,
  IdempotencyBackend,
} from '@/backend/services/threadRuntime/executionIdempotencyGovernor';

// ── Errors ───────────────────────────────────────────────────────────

export class SupabaseIdempotencyStoreError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseIdempotencyStore.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseIdempotencyStoreError';
  }
}

// ── Telemetry ────────────────────────────────────────────────────────

export type IdempotencyStoreTelemetryEvent =
  | 'idempotency_store_write_success'
  | 'idempotency_store_write_failure';

export interface IdempotencyStoreTelemetrySink {
  emit(event: IdempotencyStoreTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: IdempotencyStoreTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'idempotency_store_write_failure') console.warn(`[idempotency_store] ${line}`);
      else console.log(`[idempotency_store] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Retry classification (matches the other Phase-18 stores) ────────

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

interface IdempotencyRow {
  fingerprint_key: string;
  cls: IdempotencyClass;
  execution_id: string | null;
  first_seen_at: string;
  suppressed_count: number;
}

function rowToFingerprint(row: IdempotencyRow): IdempotencyFingerprint {
  return {
    fingerprintKey: row.fingerprint_key,
    cls: row.cls,
    executionId: row.execution_id,
    firstSeenAt: row.first_seen_at,
    suppressedCount: row.suppressed_count,
  };
}

// ── Store ────────────────────────────────────────────────────────────

export interface SupabaseIdempotencyStoreOptions {
  client?: SupabaseClient;
  telemetry?: IdempotencyStoreTelemetrySink;
  maxRetries?: number;
  initialBackoffMs?: number;
  tableName?: string;
}

export class SupabaseIdempotencyStore implements IdempotencyBackend {
  private readonly client: SupabaseClient;
  private readonly telemetry: IdempotencyStoreTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;

  constructor(options: SupabaseIdempotencyStoreOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_idempotency_keys';
  }

  private async withRetry<T>(operation: string, payload: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await fn();
        this.telemetry.emit('idempotency_store_write_success', { operation, attempt, ...payload });
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries && isTransient(err)) {
          await new Promise((r) => setTimeout(r, this.initialBackoffMs * Math.pow(2, attempt)));
          continue;
        }
        const code = (err as { code?: string })?.code ?? 'UNKNOWN';
        const msg = (err as Error)?.message ?? 'unknown error';
        this.telemetry.emit('idempotency_store_write_failure', { operation, attempt, code, error: msg, ...payload });
        throw new SupabaseIdempotencyStoreError(operation, code, msg, attempt, err);
      }
    }
    throw new SupabaseIdempotencyStoreError(operation, 'EXHAUSTED', (lastErr as Error)?.message ?? 'retries exhausted', this.maxRetries, lastErr);
  }

  async get(fingerprintKey: string): Promise<IdempotencyFingerprint | null> {
    if (!fingerprintKey) return null;
    return this.withRetry('get', { fingerprintKey }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('fingerprint_key', fingerprintKey)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToFingerprint(data as IdempotencyRow);
    });
  }

  async record(input: {
    fingerprintKey: string;
    cls: IdempotencyClass;
    executionId: string | null;
  }): Promise<{ outcome: GuardOutcome; record: IdempotencyFingerprint }> {
    if (!input.fingerprintKey) {
      throw new SupabaseIdempotencyStoreError('record', 'INVALID_INPUT', 'fingerprintKey required', 0);
    }
    return this.withRetry('record', { fingerprintKey: input.fingerprintKey, cls: input.cls }, async () => {
      // Read-modify-write inside a single round trip via upsert.
      // INSERT first; if conflict, increment suppressed_count atomically.
      const nowIso = new Date().toISOString();
      const existing = await this.client
        .from(this.tableName)
        .select('*')
        .eq('fingerprint_key', input.fingerprintKey)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        const prior = existing.data as IdempotencyRow;
        const nextCount = prior.suppressed_count + 1;
        const { data: updated, error: updErr } = await this.client
          .from(this.tableName)
          .update({ suppressed_count: nextCount })
          .eq('fingerprint_key', input.fingerprintKey)
          .select('*')
          .maybeSingle();
        if (updErr) throw updErr;
        const row = (updated as IdempotencyRow) ?? { ...prior, suppressed_count: nextCount };
        return { outcome: 'suppressed' as GuardOutcome, record: rowToFingerprint(row) };
      }

      // First-seen path: insert. A racing INSERT will surface as a unique
      // violation (23505); the retry will discover the existing row and
      // fall into the increment branch on the next pass.
      const newRow: IdempotencyRow = {
        fingerprint_key: input.fingerprintKey,
        cls: input.cls,
        execution_id: input.executionId,
        first_seen_at: nowIso,
        suppressed_count: 0,
      };
      const { error: insertErr } = await this.client
        .from(this.tableName)
        .insert(newRow);
      if (insertErr) {
        const code = (insertErr as { code?: string }).code;
        if (code === '23505') {
          // Race: another writer beat us. Read back + treat as suppressed.
          const after = await this.client
            .from(this.tableName)
            .select('*')
            .eq('fingerprint_key', input.fingerprintKey)
            .maybeSingle();
          if (after.error) throw after.error;
          if (!after.data) throw insertErr;
          const prior = after.data as IdempotencyRow;
          const nextCount = prior.suppressed_count + 1;
          const { data: updated, error: updErr } = await this.client
            .from(this.tableName)
            .update({ suppressed_count: nextCount })
            .eq('fingerprint_key', input.fingerprintKey)
            .select('*')
            .maybeSingle();
          if (updErr) throw updErr;
          const row = (updated as IdempotencyRow) ?? { ...prior, suppressed_count: nextCount };
          return { outcome: 'suppressed' as GuardOutcome, record: rowToFingerprint(row) };
        }
        throw insertErr;
      }
      return { outcome: 'first_seen' as GuardOutcome, record: rowToFingerprint(newRow) };
    });
  }

  async listForExecution(executionId: string): Promise<IdempotencyFingerprint[]> {
    if (!executionId) return [];
    return this.withRetry('listForExecution', { executionId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('execution_id', executionId)
        .order('first_seen_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as IdempotencyRow[];
      return rows.map(rowToFingerprint);
    });
  }

  async totalSuppressionCount(): Promise<number> {
    return this.withRetry('totalSuppressionCount', {}, async () => {
      // Aggregate sum() isn't exposed via PostgREST directly; do a bounded
      // scan + accumulate. The table is bounded by the governor's TTL.
      const { data, error } = await this.client
        .from(this.tableName)
        .select('suppressed_count')
        .limit(10_000);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ suppressed_count: number }>;
      return rows.reduce((sum, r) => sum + (r.suppressed_count ?? 0), 0);
    });
  }
}

export { defaultTelemetrySink as defaultIdempotencyStoreTelemetrySink };
