/**
 * Phase 21B — SupabaseWorkerRegistry
 *
 * Durable worker registry backed by `thread_runtime_workers`. Drop-in
 * implementation of the Phase 20B `DistributedWorkerCoordinator` interface
 * so the claim engine + runner + diagnostics see no API change.
 *
 * SCOPE: durable worker persistence ONLY. No work selection logic. No
 * autonomous loops. No process forking.
 *
 * GUARANTEES:
 *   - Cross-instance visibility: every register/heartbeat/drain/offline
 *     hits the DB, so any instance can `list()` workers across the fleet.
 *   - Stale detection in SQL: sweepStale runs as a single UPDATE WHERE
 *     heartbeat_at < cutoff (deterministic).
 *   - Idempotent register: a second register() with the same workerId
 *     refreshes capabilities + heartbeat (matches in-memory semantics).
 *   - Atomic counter updates via Postgres' arithmetic in update patches.
 *   - Telemetry: same events as the in-memory coordinator.
 *
 * NOTE: OPT-IN. The migration 20260812 is not auto-applied; the in-memory
 * coordinator from Phase 20B remains the default until operators apply
 * the migration AND set ENABLE_DURABLE_DISTRIBUTED_RUNTIME=1.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/backend/db/supabaseClient';
import type {
  WorkerCapability,
  WorkerKind,
  WorkerRecord,
  WorkerStatus,
} from './distributedTypes';
import type {
  DistributedWorkerCoordinator,
  HeartbeatInput,
  RegisterWorkerInput,
  WorkerCoordinatorTelemetryEvent,
  WorkerCoordinatorTelemetrySink,
} from './distributedWorkerCoordinator';

// ────────────────────────────────────────────────────────────────────
// Errors / telemetry / retry — shared semantics with Phase 18 stores
// ────────────────────────────────────────────────────────────────────

export class SupabaseWorkerRegistryError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly retried: number,
    public readonly cause?: unknown,
  ) {
    super(`[SupabaseWorkerRegistry.${operation}] ${code}: ${message}`);
    this.name = 'SupabaseWorkerRegistryError';
  }
}

const defaultTelemetrySink: WorkerCoordinatorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'worker_marked_stale' || event === 'worker_offline') console.warn(`[supabase_worker_registry] ${line}`);
      else console.log(`[supabase_worker_registry] ${line}`);
    } catch { /* ignore */ }
  },
};

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

interface WorkerRow {
  worker_id: string;
  worker_kind: WorkerKind;
  worker_status: WorkerStatus;
  capabilities_json: WorkerCapability[];
  active_execution_count: number;
  recovery_load: number;
  hostname: string | null;
  process_identity: string | null;
  registered_at: string;
  heartbeat_at: string | null;
  drain_started_at: string | null;
  offline_at: string | null;
  process_metadata: Record<string, unknown>;
  updated_at: string;
}

function rowToRecord(row: WorkerRow): WorkerRecord {
  return {
    workerId: row.worker_id,
    workerKind: row.worker_kind,
    status: row.worker_status,
    capabilities: row.capabilities_json ?? [],
    activeExecutionCount: row.active_execution_count,
    recoveryLoad: row.recovery_load,
    hostname: row.hostname,
    processIdentity: row.process_identity,
    registeredAtIso: row.registered_at,
    heartbeatAtIso: row.heartbeat_at,
    drainStartedAtIso: row.drain_started_at,
    offlineAtIso: row.offline_at,
    meta: row.process_metadata ?? {},
  };
}

// ────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────

export interface SupabaseWorkerRegistryOptions {
  client?: SupabaseClient;
  telemetry?: WorkerCoordinatorTelemetrySink;
  maxRetries?: number;
  initialBackoffMs?: number;
  tableName?: string;
  /** Stale threshold in ms used by sweepStale. Default 90_000. */
  defaultStaleThresholdMs?: number;
}

export class SupabaseWorkerRegistry implements DistributedWorkerCoordinator {
  private readonly client: SupabaseClient;
  private readonly telemetry: WorkerCoordinatorTelemetrySink;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly tableName: string;
  private readonly defaultStaleThresholdMs: number;

  constructor(options: SupabaseWorkerRegistryOptions = {}) {
    this.client = options.client ?? defaultSupabase;
    this.telemetry = options.telemetry ?? defaultTelemetrySink;
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.initialBackoffMs = Math.max(10, options.initialBackoffMs ?? 100);
    this.tableName = options.tableName ?? 'thread_runtime_workers';
    this.defaultStaleThresholdMs = options.defaultStaleThresholdMs ?? 90_000;
  }

  private emit(event: WorkerCoordinatorTelemetryEvent, payload: Record<string, unknown>): void {
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
        throw new SupabaseWorkerRegistryError(operation, code, msg, attempt, err);
      }
    }
    throw new SupabaseWorkerRegistryError(operation, 'EXHAUSTED', (lastErr as Error)?.message ?? 'retries exhausted', this.maxRetries, lastErr);
  }

  // ── DistributedWorkerCoordinator interface ─────────────────────────

  async register(input: RegisterWorkerInput): Promise<WorkerRecord> {
    if (!input.workerId) throw new Error('workerId required');
    const nowIso = new Date().toISOString();
    const row: WorkerRow = {
      worker_id: input.workerId,
      worker_kind: input.workerKind,
      worker_status: 'active',
      capabilities_json: input.capabilities,
      active_execution_count: 0,
      recovery_load: 0,
      hostname: input.hostname ?? null,
      process_identity: input.processIdentity ?? null,
      registered_at: nowIso,
      heartbeat_at: nowIso,
      drain_started_at: null,
      offline_at: null,
      process_metadata: input.meta ?? {},
      updated_at: nowIso,
    };
    return this.withRetry('register', { workerId: input.workerId, workerKind: input.workerKind }, async () => {
      const { error } = await this.client.from(this.tableName).insert(row);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === UNIQUE_VIOLATION_SQLSTATE) {
          // Idempotent: refresh capabilities + heartbeat.
          const patch: Partial<WorkerRow> = {
            capabilities_json: input.capabilities,
            heartbeat_at: nowIso,
            updated_at: nowIso,
          };
          if (input.meta) patch.process_metadata = input.meta;
          const { data: updated, error: updErr } = await this.client
            .from(this.tableName)
            .update(patch)
            .eq('worker_id', input.workerId)
            .not('worker_status', 'eq', 'offline')
            .select('*')
            .maybeSingle();
          if (updErr) throw updErr;
          if (updated) return rowToRecord(updated as WorkerRow);
          // Status was 'offline' — re-insert by upserting fresh row (delete then insert).
          await this.client.from(this.tableName).delete().eq('worker_id', input.workerId);
          const { error: reInsertErr } = await this.client.from(this.tableName).insert(row);
          if (reInsertErr) throw reInsertErr;
          this.emit('worker_registered', {
            workerId: row.worker_id, workerKind: row.worker_kind,
            capabilities: row.capabilities_json.map((c) => c.name),
          });
          return rowToRecord(row);
        }
        throw error;
      }
      this.emit('worker_registered', {
        workerId: row.worker_id, workerKind: row.worker_kind,
        capabilities: row.capabilities_json.map((c) => c.name),
      });
      return rowToRecord(row);
    });
  }

  async heartbeat(input: HeartbeatInput): Promise<WorkerRecord | null> {
    const nowMs = input.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    return this.withRetry('heartbeat', { workerId: input.workerId }, async () => {
      const patch: Partial<WorkerRow> = {
        heartbeat_at: nowIso, updated_at: nowIso,
      };
      if (typeof input.activeExecutionCount === 'number') {
        patch.active_execution_count = Math.max(0, input.activeExecutionCount);
      }
      if (typeof input.recoveryLoad === 'number') {
        patch.recovery_load = Math.max(0, input.recoveryLoad);
      }
      // First — check current status. If 'stale', flip to 'active' (resurrection).
      const cur = await this.client
        .from(this.tableName)
        .select('worker_status')
        .eq('worker_id', input.workerId)
        .maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) return null;
      if ((cur.data as { worker_status: WorkerStatus }).worker_status === 'offline') {
        // Don't bump offline workers; ack via read-back.
        const { data: existing, error } = await this.client
          .from(this.tableName)
          .select('*')
          .eq('worker_id', input.workerId)
          .maybeSingle();
        if (error) throw error;
        return existing ? rowToRecord(existing as WorkerRow) : null;
      }
      if ((cur.data as { worker_status: WorkerStatus }).worker_status === 'stale') {
        patch.worker_status = 'active';
        this.emit('worker_status_changed', {
          workerId: input.workerId, previous: 'stale', current: 'active',
          reason: 'heartbeat_resumed',
        });
      }
      const { data, error } = await this.client
        .from(this.tableName)
        .update(patch)
        .eq('worker_id', input.workerId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const rec = rowToRecord(data as WorkerRow);
      this.emit('worker_heartbeat', {
        workerId: rec.workerId, active: rec.activeExecutionCount,
        recovery: rec.recoveryLoad, atIso: rec.heartbeatAtIso,
      });
      return rec;
    });
  }

  async drain(workerId: string): Promise<WorkerRecord | null> {
    const nowIso = new Date().toISOString();
    return this.withRetry('drain', { workerId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .update({
          worker_status: 'draining',
          drain_started_at: nowIso,
          updated_at: nowIso,
        })
        .eq('worker_id', workerId)
        .not('worker_status', 'eq', 'offline')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      this.emit('worker_status_changed', {
        workerId, previous: 'active', current: 'draining', reason: 'explicit_drain',
      });
      this.emit('worker_drain_started', {
        workerId, atIso: nowIso,
        activeExecutions: (data as WorkerRow).active_execution_count,
      });
      return rowToRecord(data as WorkerRow);
    });
  }

  async enterRecovery(workerId: string): Promise<WorkerRecord | null> {
    const nowIso = new Date().toISOString();
    return this.withRetry('enterRecovery', { workerId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .update({ worker_status: 'recovering', updated_at: nowIso })
        .eq('worker_id', workerId)
        .not('worker_status', 'eq', 'offline')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? rowToRecord(data as WorkerRow) : null;
    });
  }

  async offline(workerId: string): Promise<WorkerRecord | null> {
    const nowIso = new Date().toISOString();
    return this.withRetry('offline', { workerId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .update({
          worker_status: 'offline',
          offline_at: nowIso,
          updated_at: nowIso,
        })
        .eq('worker_id', workerId)
        .not('worker_status', 'eq', 'offline')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      this.emit('worker_status_changed', {
        workerId, previous: 'active', current: 'offline', reason: 'explicit_offline',
      });
      this.emit('worker_offline', {
        workerId, atIso: nowIso,
        leftoverActive: (data as WorkerRow).active_execution_count,
      });
      return rowToRecord(data as WorkerRow);
    });
  }

  async noteExecutionStarted(workerId: string): Promise<WorkerRecord | null> {
    return this.withRetry('noteExecutionStarted', { workerId }, async () => {
      const cur = await this.client
        .from(this.tableName)
        .select('active_execution_count')
        .eq('worker_id', workerId)
        .maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) return null;
      const next = ((cur.data as { active_execution_count: number }).active_execution_count ?? 0) + 1;
      const { data, error } = await this.client
        .from(this.tableName)
        .update({ active_execution_count: next, updated_at: new Date().toISOString() })
        .eq('worker_id', workerId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? rowToRecord(data as WorkerRow) : null;
    });
  }

  async noteExecutionFinished(workerId: string): Promise<WorkerRecord | null> {
    return this.withRetry('noteExecutionFinished', { workerId }, async () => {
      const cur = await this.client
        .from(this.tableName)
        .select('active_execution_count')
        .eq('worker_id', workerId)
        .maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) return null;
      const next = Math.max(0, ((cur.data as { active_execution_count: number }).active_execution_count ?? 0) - 1);
      const { data, error } = await this.client
        .from(this.tableName)
        .update({ active_execution_count: next, updated_at: new Date().toISOString() })
        .eq('worker_id', workerId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? rowToRecord(data as WorkerRow) : null;
    });
  }

  async get(workerId: string): Promise<WorkerRecord | null> {
    return this.withRetry('get', { workerId }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('worker_id', workerId)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToRecord(data as WorkerRow) : null;
    });
  }

  async list(opts?: { status?: WorkerStatus | WorkerStatus[]; kind?: WorkerKind }): Promise<WorkerRecord[]> {
    return this.withRetry('list', { status: opts?.status, kind: opts?.kind }, async () => {
      let q: any = this.client.from(this.tableName)
        .select('*')
        .order('registered_at', { ascending: true })
        .limit(2_000);
      if (opts?.status) {
        const list = Array.isArray(opts.status) ? opts.status : [opts.status];
        q = list.length === 1
          ? q.eq('worker_status', list[0])
          : q.in('worker_status', list);
      }
      if (opts?.kind) q = q.eq('worker_kind', opts.kind);
      const { data, error } = await q as unknown as { data: WorkerRow[] | null; error: unknown };
      if (error) throw error;
      const rows = (data ?? []) as WorkerRow[];
      return rows.map(rowToRecord);
    });
  }

  async sweepStale(input?: { nowMs?: number; staleThresholdMs?: number }): Promise<{ markedStale: string[] }> {
    const nowMs = input?.nowMs ?? Date.now();
    const threshold = input?.staleThresholdMs ?? this.defaultStaleThresholdMs;
    const cutoffIso = new Date(nowMs - threshold).toISOString();
    return this.withRetry('sweepStale', { cutoffIso }, async () => {
      const { data, error } = await this.client
        .from(this.tableName)
        .update({ worker_status: 'stale', updated_at: new Date(nowMs).toISOString() })
        .not('worker_status', 'in', '(offline,stale)')
        .lte('heartbeat_at', cutoffIso)
        .select('worker_id, heartbeat_at');
      if (error) throw error;
      const markedStale: string[] = [];
      for (const row of (data ?? []) as Array<{ worker_id: string; heartbeat_at: string }>) {
        markedStale.push(row.worker_id);
        this.emit('worker_marked_stale', {
          workerId: row.worker_id,
          lastHeartbeatIso: row.heartbeat_at,
          staleAgeMs: nowMs - Date.parse(row.heartbeat_at),
        });
      }
      return { markedStale };
    });
  }

  // ── Phase 21F: compaction helper ─────────────────────────────────

  /**
   * Hard-delete offline worker rows older than `cutoffIso`. Used by the
   * RuntimePersistenceCompactor to keep the registry bounded.
   */
  async deleteOfflineOlderThan(cutoffIso: string, opts?: { limit?: number }): Promise<number> {
    const limit = Math.max(1, Math.min(10_000, opts?.limit ?? 1_000));
    return this.withRetry('deleteOfflineOlderThan', { cutoffIso }, async () => {
      const { data: ids, error: idErr } = await this.client
        .from(this.tableName)
        .select('worker_id')
        .eq('worker_status', 'offline')
        .lt('updated_at', cutoffIso)
        .limit(limit);
      if (idErr) throw idErr;
      const idList = ((ids ?? []) as Array<{ worker_id: string }>).map((r) => r.worker_id);
      if (idList.length === 0) return 0;
      const { error: delErr } = await this.client
        .from(this.tableName)
        .delete()
        .in('worker_id', idList);
      if (delErr) throw delErr;
      return idList.length;
    });
  }
}

export { defaultTelemetrySink as defaultSupabaseWorkerTelemetrySink };
