/**
 * supabaseBenchmarkPersistence.ts
 *
 * Phase 7.8 — Concrete `BenchmarkPersistenceProvider` implementation
 * backed by Supabase.
 *
 * Persistence is fire-and-forget from the orchestrator's perspective —
 * write failures emit `LONGFORM_PERSISTENCE_FAILURE` telemetry and the
 * generation NEVER blocks.
 *
 * The provider accepts an injected `SupabaseClient` + an optional
 * `tablePrefix` so the caller can isolate per-environment tables
 * (e.g. `longform_benchmarks_staging`).
 *
 * Expected tables (caller's migration responsibility — provider does
 * NOT attempt to create them):
 *
 *   {prefix}_benchmarks (
 *     record_id text primary key,
 *     recorded_at timestamptz not null,
 *     engine text not null,
 *     content_type text not null,
 *     topic text not null,
 *     company_id text,
 *     benchmark jsonb not null
 *   )
 *   {prefix}_convergence (same shape with `result` jsonb)
 *   {prefix}_recovery_costs (same shape with `report` jsonb)
 *   {prefix}_retirement_simulations (record_id, recorded_at, report, observed_total_attempts)
 *
 * When tables are absent OR the client is unauthorized, writes fail and
 * telemetry surfaces it — but generation continues unaffected.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BenchmarkPersistenceProvider,
  LongFormBenchmarkRecord,
  RetirementSimulationRecord,
  RecoveryCostRecord,
  ConvergenceRecord,
} from './benchmarkPersistence';

// ── Telemetry ────────────────────────────────────────────────────────────────

export interface PersistenceFailurePayload {
  event: 'LONGFORM_PERSISTENCE_FAILURE';
  surface: 'benchmark' | 'convergence' | 'recovery_cost' | 'retirement_simulation';
  table: string;
  record_id?: string;
  error_message: string;
  error_code?: string;
  timestamp: string;
}

let failureCount = 0;
let lastFailureAt: string | null = null;
const failuresBySurface = new Map<string, number>();

function emitPersistenceFailure(payload: Omit<PersistenceFailurePayload, 'event' | 'timestamp'>): void {
  const full: PersistenceFailurePayload = {
    event: 'LONGFORM_PERSISTENCE_FAILURE',
    ...payload,
    timestamp: new Date().toISOString(),
  };
  failureCount += 1;
  lastFailureAt = full.timestamp;
  failuresBySurface.set(payload.surface, (failuresBySurface.get(payload.surface) ?? 0) + 1);
  console.warn(`[longform-persist-failure] ${JSON.stringify(full)}`);
}

export interface PersistenceFailureReport {
  total_failures: number;
  last_failure_at: string | null;
  failures_by_surface: Record<string, number>;
}

export function getPersistenceFailureReport(): PersistenceFailureReport {
  return {
    total_failures: failureCount,
    last_failure_at: lastFailureAt,
    failures_by_surface: Object.fromEntries(failuresBySurface),
  };
}

export function __resetPersistenceFailureCountersForTests(): void {
  failureCount = 0;
  lastFailureAt = null;
  failuresBySurface.clear();
}

// ── Provider implementation ──────────────────────────────────────────────────

export interface SupabaseBenchmarkPersistenceOptions {
  /** Table-name prefix. Default: `longform`. Yields `{prefix}_benchmarks` etc. */
  tablePrefix?: string;
  /** Set to true to fail loudly on every write error (used in tests). */
  rethrow?: boolean;
}

export class SupabaseBenchmarkPersistence implements BenchmarkPersistenceProvider {
  private readonly client: SupabaseClient;
  private readonly prefix: string;
  private readonly rethrow: boolean;

  constructor(client: SupabaseClient, options: SupabaseBenchmarkPersistenceOptions = {}) {
    this.client = client;
    this.prefix = options.tablePrefix ?? 'longform';
    this.rethrow = options.rethrow ?? false;
  }

  // ── Tables ────────────────────────────────────────────────────────────
  private tBench():     string { return `${this.prefix}_benchmarks`; }
  private tConv():      string { return `${this.prefix}_convergence`; }
  private tCost():      string { return `${this.prefix}_recovery_costs`; }
  private tRetSim():    string { return `${this.prefix}_retirement_simulations`; }

  // ── Writes ────────────────────────────────────────────────────────────

  async saveBenchmark(record: LongFormBenchmarkRecord): Promise<void> {
    try {
      const { error } = await this.client.from(this.tBench()).insert({
        record_id: record.record_id,
        recorded_at: record.recorded_at,
        engine: record.engine,
        content_type: record.content_type,
        topic: record.topic,
        company_id: record.benchmark.engine === 'previous-stable' ? null : (record as { company_id?: string }).company_id ?? null,
        benchmark: record.benchmark,
      });
      if (error) throw error;
    } catch (err) {
      emitPersistenceFailure({
        surface: 'benchmark',
        table: this.tBench(),
        record_id: record.record_id,
        error_message: err instanceof Error ? err.message : String(err),
        error_code: (err as { code?: string } | undefined)?.code,
      });
      if (this.rethrow) throw err;
    }
  }

  async saveConvergence(record: ConvergenceRecord): Promise<void> {
    try {
      const { error } = await this.client.from(this.tConv()).insert({
        record_id: record.record_id,
        recorded_at: record.recorded_at,
        engine: record.engine,
        content_type: record.content_type,
        topic: record.topic,
        company_id: record.company_id,
        result: record.result,
      });
      if (error) throw error;
    } catch (err) {
      emitPersistenceFailure({
        surface: 'convergence',
        table: this.tConv(),
        record_id: record.record_id,
        error_message: err instanceof Error ? err.message : String(err),
        error_code: (err as { code?: string } | undefined)?.code,
      });
      if (this.rethrow) throw err;
    }
  }

  async saveRecoveryCost(record: RecoveryCostRecord): Promise<void> {
    try {
      const { error } = await this.client.from(this.tCost()).insert({
        record_id: record.record_id,
        recorded_at: record.recorded_at,
        engine: record.engine,
        content_type: record.content_type,
        topic: record.topic,
        company_id: record.company_id,
        report: record.report,
      });
      if (error) throw error;
    } catch (err) {
      emitPersistenceFailure({
        surface: 'recovery_cost',
        table: this.tCost(),
        record_id: record.record_id,
        error_message: err instanceof Error ? err.message : String(err),
        error_code: (err as { code?: string } | undefined)?.code,
      });
      if (this.rethrow) throw err;
    }
  }

  async saveRetirementSimulation(record: RetirementSimulationRecord): Promise<void> {
    try {
      const { error } = await this.client.from(this.tRetSim()).insert({
        record_id: record.record_id,
        recorded_at: record.recorded_at,
        report: record.report,
        observed_total_attempts: record.observed_total_attempts,
      });
      if (error) throw error;
    } catch (err) {
      emitPersistenceFailure({
        surface: 'retirement_simulation',
        table: this.tRetSim(),
        record_id: record.record_id,
        error_message: err instanceof Error ? err.message : String(err),
        error_code: (err as { code?: string } | undefined)?.code,
      });
      if (this.rethrow) throw err;
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async recentBenchmarks(opts: { engine?: string; content_type?: string; limit?: number } = {}): Promise<LongFormBenchmarkRecord[]> {
    try {
      let q = this.client.from(this.tBench()).select('*').order('recorded_at', { ascending: false }).limit(opts.limit ?? 50);
      if (opts.engine) q = q.eq('engine', opts.engine);
      if (opts.content_type) q = q.eq('content_type', opts.content_type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LongFormBenchmarkRecord[];
    } catch (err) {
      emitPersistenceFailure({
        surface: 'benchmark',
        table: this.tBench(),
        error_message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return [];
    }
  }

  async recentConvergence(opts: { content_type?: string; limit?: number } = {}): Promise<ConvergenceRecord[]> {
    try {
      let q = this.client.from(this.tConv()).select('*').order('recorded_at', { ascending: false }).limit(opts.limit ?? 50);
      if (opts.content_type) q = q.eq('content_type', opts.content_type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ConvergenceRecord[];
    } catch (err) {
      emitPersistenceFailure({
        surface: 'convergence',
        table: this.tConv(),
        error_message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return [];
    }
  }

  async recentRecoveryCosts(opts: { content_type?: string; limit?: number } = {}): Promise<RecoveryCostRecord[]> {
    try {
      let q = this.client.from(this.tCost()).select('*').order('recorded_at', { ascending: false }).limit(opts.limit ?? 50);
      if (opts.content_type) q = q.eq('content_type', opts.content_type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RecoveryCostRecord[];
    } catch (err) {
      emitPersistenceFailure({
        surface: 'recovery_cost',
        table: this.tCost(),
        error_message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return [];
    }
  }
}
