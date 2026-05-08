// Historical persistence layer.
//
// Defines the immutable record types written to `report_score_history` plus
// related tables, and the canonical store interface every persistence backend
// implements. Phase 5 ships:
//
//   - SupabaseHistoryStore: production implementation against the schema below
//   - InMemoryHistoryStore:  test/dev fallback (no synthetic data; only what
//                             the running process actually writes)
//
// "No fabricated history" rule:
//   - Reads return only what was previously written. Empty stores return [].
//   - The forecast / change-intelligence services consume these records and
//     explicitly handle insufficient-history with `state: 'unavailable'`.

import type {
  CanonicalScore,
  EvidenceTrace,
  PillarKey,
  ScoreState,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';

// ── Record types ──────────────────────────────────────────────────────────────

export type ReportSnapshotRecord = {
  id: string;
  company_id: string;
  observed_at: string; // ISO timestamp (immutable; PK with company_id)
  authority_score: CanonicalScore;
  ai_visibility_score: CanonicalScore;
  maturity: SystemMaturityClass;
  maturity_stage: string; // 'foundational' | 'emerging' | ...
  scan_profile: 'lightweight' | 'standard' | 'deep' | 'manual_refresh' | 'delta_only';
  source_metadata: {
    engine_version: string;
    providers_used: string[];
    providers_unavailable: string[];
  };
};

export type PillarHistoryRecord = {
  id: string;
  company_id: string;
  observed_at: string;
  pillar: PillarKey;
  score: CanonicalScore;
  primary_signal: string | null;
};

export type ProviderHistoryRecord = {
  id: string;
  company_id: string;
  observed_at: string;
  provider_id: string;
  outcome: 'measured' | 'unavailable' | 'rate_limited' | 'timeout' | 'auth_failure' | 'quota_exceeded';
  latency_ms: number | null;
  cache_hit: boolean;
  reason: string | null;
};

export type BenchmarkHistoryRecord = {
  id: string;
  company_id: string;
  observed_at: string;
  vertical: string | null;
  size_band: string;
  peer_count: number;
  percentile: number | null;
  median_snapshot: Record<string, number>;
};

export type RecommendationHistoryRecord = {
  id: string;
  company_id: string;
  observed_at: string;
  action_id: string;
  title: string;
  pillar: PillarKey;
  severity: 'critical' | 'moderate' | 'low';
  leverage_score: number;
  status: 'first_seen' | 'persistent' | 'resolved' | 'regressed';
};

export type EvidenceHistoryRecord = {
  id: string;
  company_id: string;
  observed_at: string;
  scope:
    | { kind: 'overall' }
    | { kind: 'pillar'; pillar: PillarKey }
    | { kind: 'dimension'; dimension_key: string };
  evidence_count: number;
  evidence_sources: string[];
  signal_summary: string[]; // first 12 observation signals — not the full payload
};

// ── Range query shape ─────────────────────────────────────────────────────────

export type HistoryRange = {
  company_id: string;
  from?: string; // ISO; inclusive
  to?: string;   // ISO; inclusive
  limit?: number;
};

// ── Store interface ───────────────────────────────────────────────────────────

export interface HistoricalStore {
  /** Write a fully-immutable snapshot bundle in one transaction. */
  writeSnapshot(params: {
    snapshot: ReportSnapshotRecord;
    pillars: PillarHistoryRecord[];
    providers: ProviderHistoryRecord[];
    benchmark: BenchmarkHistoryRecord | null;
    recommendations: RecommendationHistoryRecord[];
    evidence: EvidenceHistoryRecord[];
  }): Promise<void>;

  /** Most recent snapshots, ordered descending by observed_at. */
  loadSnapshots(range: HistoryRange): Promise<ReportSnapshotRecord[]>;

  /** Per-pillar history rows in a date range. */
  loadPillarHistory(range: HistoryRange & { pillar?: PillarKey }): Promise<PillarHistoryRecord[]>;

  /** Provider call history. */
  loadProviderHistory(range: HistoryRange & { provider_id?: string }): Promise<ProviderHistoryRecord[]>;

  /** Recommendation lifecycle. */
  loadRecommendationHistory(range: HistoryRange): Promise<RecommendationHistoryRecord[]>;

  /** Evidence rows. */
  loadEvidenceHistory(range: HistoryRange): Promise<EvidenceHistoryRecord[]>;

  /** Benchmark history (one row per scan; rare changes). */
  loadBenchmarkHistory(range: HistoryRange): Promise<BenchmarkHistoryRecord[]>;

  /** True when the underlying backend is reachable and writes are durable. */
  isOperational(): Promise<boolean>;
}

// ── In-memory fallback ────────────────────────────────────────────────────────
//
// Used by tests and when no Supabase URL is configured. NOT a synthetic data
// generator — it only returns what was written within the current process.

export class InMemoryHistoryStore implements HistoricalStore {
  private snapshots: ReportSnapshotRecord[] = [];
  private pillars: PillarHistoryRecord[] = [];
  private providers: ProviderHistoryRecord[] = [];
  private benchmarks: BenchmarkHistoryRecord[] = [];
  private recommendations: RecommendationHistoryRecord[] = [];
  private evidence: EvidenceHistoryRecord[] = [];

  async isOperational(): Promise<boolean> {
    return true;
  }

  async writeSnapshot(params: Parameters<HistoricalStore['writeSnapshot']>[0]): Promise<void> {
    this.snapshots.push(params.snapshot);
    this.pillars.push(...params.pillars);
    this.providers.push(...params.providers);
    if (params.benchmark) this.benchmarks.push(params.benchmark);
    this.recommendations.push(...params.recommendations);
    this.evidence.push(...params.evidence);
  }

  async loadSnapshots(range: HistoryRange): Promise<ReportSnapshotRecord[]> {
    return this.filterByRange(this.snapshots, range).sort(byObservedAtDesc).slice(0, range.limit ?? 24);
  }

  async loadPillarHistory(range: HistoryRange & { pillar?: PillarKey }): Promise<PillarHistoryRecord[]> {
    let rows = this.filterByRange(this.pillars, range);
    if (range.pillar) rows = rows.filter((r) => r.pillar === range.pillar);
    return rows.sort(byObservedAtDesc).slice(0, range.limit ?? 200);
  }

  async loadProviderHistory(
    range: HistoryRange & { provider_id?: string },
  ): Promise<ProviderHistoryRecord[]> {
    let rows = this.filterByRange(this.providers, range);
    if (range.provider_id) rows = rows.filter((r) => r.provider_id === range.provider_id);
    return rows.sort(byObservedAtDesc).slice(0, range.limit ?? 500);
  }

  async loadRecommendationHistory(range: HistoryRange): Promise<RecommendationHistoryRecord[]> {
    return this.filterByRange(this.recommendations, range)
      .sort(byObservedAtDesc)
      .slice(0, range.limit ?? 500);
  }

  async loadEvidenceHistory(range: HistoryRange): Promise<EvidenceHistoryRecord[]> {
    return this.filterByRange(this.evidence, range)
      .sort(byObservedAtDesc)
      .slice(0, range.limit ?? 500);
  }

  async loadBenchmarkHistory(range: HistoryRange): Promise<BenchmarkHistoryRecord[]> {
    return this.filterByRange(this.benchmarks, range)
      .sort(byObservedAtDesc)
      .slice(0, range.limit ?? 100);
  }

  private filterByRange<T extends { company_id: string; observed_at: string }>(
    rows: T[],
    range: HistoryRange,
  ): T[] {
    return rows.filter((r) => {
      if (r.company_id !== range.company_id) return false;
      if (range.from && r.observed_at < range.from) return false;
      if (range.to && r.observed_at > range.to) return false;
      return true;
    });
  }

  /** Test-only: drop everything. */
  _reset(): void {
    this.snapshots = [];
    this.pillars = [];
    this.providers = [];
    this.benchmarks = [];
    this.recommendations = [];
    this.evidence = [];
  }
}

function byObservedAtDesc<T extends { observed_at: string }>(a: T, b: T): number {
  return a.observed_at < b.observed_at ? 1 : a.observed_at > b.observed_at ? -1 : 0;
}

// ── Active-store registry ─────────────────────────────────────────────────────

let activeStore: HistoricalStore = new InMemoryHistoryStore();

export function getHistoricalStore(): HistoricalStore {
  return activeStore;
}

export function registerHistoricalStore(store: HistoricalStore): void {
  activeStore = store;
}

/** Test helper. */
export function _resetHistoricalStore(): void {
  activeStore = new InMemoryHistoryStore();
}

// ── Recommendation status helper ──────────────────────────────────────────────
//
// Compares a current recommendation against the most recent prior rows for the
// same action_id and classifies its lifecycle status.

export function classifyRecommendationStatus(params: {
  current: { action_id: string; severity: 'critical' | 'moderate' | 'low' };
  prior: RecommendationHistoryRecord | null;
}): RecommendationHistoryRecord['status'] {
  if (!params.prior) return 'first_seen';
  if (params.prior.status === 'resolved') return 'regressed';
  // Severity escalation = regressed; otherwise persistent.
  const order = { low: 0, moderate: 1, critical: 2 } as const;
  if (order[params.current.severity] > order[params.prior.severity]) return 'regressed';
  return 'persistent';
}
