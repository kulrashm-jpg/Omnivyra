/**
 * benchmarkPersistence.ts
 *
 * Phase 6.5 — Durable persistence for benchmarks / retirement
 * simulations / recovery costs / convergence records.
 *
 * The interface is the contract; the default implementation is the
 * in-memory ring buffer (matches Phase 5.7's behavior). A real Supabase
 * implementation can be supplied via `setBenchmarkPersistenceProvider()`
 * without touching call sites.
 *
 * Per Phase 6 spec — "Persist into: Supabase, existing analytics DB, or
 * operational telemetry store." We provide:
 *   - the schema-as-types (records the provider must write)
 *   - the persistence interface
 *   - an in-memory default that mirrors Phase 5.7 semantics
 *   - hooks to wire Supabase or a telemetry store later without changes
 *     to the orchestrator / planner / facade
 */

import type {
  LongFormQualityBenchmark,
  BenchmarkEngine,
} from './qualityBenchmarkSuite';
import type { RetirementSimulationReport } from './retirementSimulation';
import type { RecoveryCostReport } from './recoveryCostTelemetry';
import type { ArticleConvergenceResult } from './articleConvergence';

// ── Record schemas (durable shapes) ──────────────────────────────────────────

export interface LongFormBenchmarkRecord {
  record_id: string;
  recorded_at: string;            // ISO timestamp
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  benchmark: LongFormQualityBenchmark;
}

export interface RetirementSimulationRecord {
  record_id: string;
  recorded_at: string;
  report: RetirementSimulationReport;
  observed_total_attempts: number;
}

export interface RecoveryCostRecord {
  record_id: string;
  recorded_at: string;
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  report: RecoveryCostReport;
}

export interface ConvergenceRecord {
  record_id: string;
  recorded_at: string;
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  result: ArticleConvergenceResult;
}

// ── Provider interface ───────────────────────────────────────────────────────

export interface BenchmarkPersistenceProvider {
  saveBenchmark(record: LongFormBenchmarkRecord): Promise<void>;
  saveRetirementSimulation(record: RetirementSimulationRecord): Promise<void>;
  saveRecoveryCost(record: RecoveryCostRecord): Promise<void>;
  saveConvergence(record: ConvergenceRecord): Promise<void>;

  /** Optional read paths — used by admin endpoints. */
  recentBenchmarks?(opts: {
    engine?: BenchmarkEngine;
    content_type?: string;
    limit?: number;
  }): Promise<LongFormBenchmarkRecord[]>;
  recentConvergence?(opts: { content_type?: string; limit?: number }): Promise<ConvergenceRecord[]>;
  recentRecoveryCosts?(opts: { content_type?: string; limit?: number }): Promise<RecoveryCostRecord[]>;
}

// ── In-memory default ────────────────────────────────────────────────────────

class InMemoryBenchmarkPersistence implements BenchmarkPersistenceProvider {
  private benchmarks: LongFormBenchmarkRecord[] = [];
  private retirementSimulations: RetirementSimulationRecord[] = [];
  private recoveryCosts: RecoveryCostRecord[] = [];
  private convergence: ConvergenceRecord[] = [];

  async saveBenchmark(record: LongFormBenchmarkRecord): Promise<void> {
    this.benchmarks.push(record);
    if (this.benchmarks.length > 500) this.benchmarks.shift();
  }
  async saveRetirementSimulation(record: RetirementSimulationRecord): Promise<void> {
    this.retirementSimulations.push(record);
    if (this.retirementSimulations.length > 100) this.retirementSimulations.shift();
  }
  async saveRecoveryCost(record: RecoveryCostRecord): Promise<void> {
    this.recoveryCosts.push(record);
    if (this.recoveryCosts.length > 500) this.recoveryCosts.shift();
  }
  async saveConvergence(record: ConvergenceRecord): Promise<void> {
    this.convergence.push(record);
    if (this.convergence.length > 500) this.convergence.shift();
  }

  async recentBenchmarks(opts: { engine?: BenchmarkEngine; content_type?: string; limit?: number } = {}): Promise<LongFormBenchmarkRecord[]> {
    let out = this.benchmarks.slice();
    if (opts.engine) out = out.filter((r) => r.engine === opts.engine);
    if (opts.content_type) out = out.filter((r) => r.content_type === opts.content_type);
    out.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
    return out.slice(0, opts.limit ?? 50);
  }
  async recentConvergence(opts: { content_type?: string; limit?: number } = {}): Promise<ConvergenceRecord[]> {
    let out = this.convergence.slice();
    if (opts.content_type) out = out.filter((r) => r.content_type === opts.content_type);
    out.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
    return out.slice(0, opts.limit ?? 50);
  }
  async recentRecoveryCosts(opts: { content_type?: string; limit?: number } = {}): Promise<RecoveryCostRecord[]> {
    let out = this.recoveryCosts.slice();
    if (opts.content_type) out = out.filter((r) => r.content_type === opts.content_type);
    out.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
    return out.slice(0, opts.limit ?? 50);
  }

  __resetForTests(): void {
    this.benchmarks = [];
    this.retirementSimulations = [];
    this.recoveryCosts = [];
    this.convergence = [];
  }
}

// ── Singleton provider registry ──────────────────────────────────────────────

let activeProvider: BenchmarkPersistenceProvider = new InMemoryBenchmarkPersistence();

export function getBenchmarkPersistenceProvider(): BenchmarkPersistenceProvider {
  return activeProvider;
}

/**
 * Wire a durable backend in (Supabase, telemetry store, etc.) without
 * touching any call site. The orchestrator + planner + facade ONLY
 * import this module to persist; the provider impl can be swapped at
 * boot.
 */
export function setBenchmarkPersistenceProvider(provider: BenchmarkPersistenceProvider): void {
  activeProvider = provider;
}

// ── Fire-and-forget helpers ──────────────────────────────────────────────────
//
// Hot-path persistence MUST not block generation. These helpers swallow
// errors and log them — durable persistence is observability, not a
// hard dependency.

function stableId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function persistBenchmark(input: {
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  benchmark: LongFormQualityBenchmark;
}): void {
  const record: LongFormBenchmarkRecord = {
    record_id: stableId('bench'),
    recorded_at: new Date().toISOString(),
    ...input,
  };
  activeProvider.saveBenchmark(record).catch((err) => {
    console.warn(`[longform-persist] saveBenchmark failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function persistRetirementSimulation(input: {
  report: RetirementSimulationReport;
  observed_total_attempts: number;
}): void {
  const record: RetirementSimulationRecord = {
    record_id: stableId('retsim'),
    recorded_at: new Date().toISOString(),
    ...input,
  };
  activeProvider.saveRetirementSimulation(record).catch((err) => {
    console.warn(`[longform-persist] saveRetirementSimulation failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function persistRecoveryCost(input: {
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  report: RecoveryCostReport;
}): void {
  const record: RecoveryCostRecord = {
    record_id: stableId('cost'),
    recorded_at: new Date().toISOString(),
    ...input,
  };
  activeProvider.saveRecoveryCost(record).catch((err) => {
    console.warn(`[longform-persist] saveRecoveryCost failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function persistConvergence(input: {
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  company_id: string | null;
  result: ArticleConvergenceResult;
}): void {
  const record: ConvergenceRecord = {
    record_id: stableId('conv'),
    recorded_at: new Date().toISOString(),
    ...input,
  };
  activeProvider.saveConvergence(record).catch((err) => {
    console.warn(`[longform-persist] saveConvergence failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// Test-only helper.
export function __resetBenchmarkPersistenceForTests(): void {
  if (activeProvider instanceof InMemoryBenchmarkPersistence) {
    (activeProvider as InMemoryBenchmarkPersistence).__resetForTests();
  }
}
