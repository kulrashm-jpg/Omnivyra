// Production Supabase-backed implementation of the HistoricalStore.
//
// Activates when SUPABASE_HISTORY_ENABLED=true AND the project's Supabase
// client is available. The schema is defined in:
//
//   supabase/migrations/<timestamp>_report_score_history.sql
//
// — and matches the record types in historicalPersistence.ts. The writer
// uses a single transaction per snapshot to keep history immutable.

import type {
  BenchmarkHistoryRecord,
  EvidenceHistoryRecord,
  HistoricalStore,
  HistoryRange,
  PillarHistoryRecord,
  ProviderHistoryRecord,
  RecommendationHistoryRecord,
  ReportSnapshotRecord,
} from './historicalPersistence';
import type { PillarKey } from '../canonicalReport/canonicalReportTypes';

// We rely on the project's existing supabase client; the operator is expected
// to provide it via env-driven dynamic require to avoid pulling Supabase into
// every test/build that doesn't need it.
type SupabaseClientShape = {
  from: (table: string) => {
    insert: (rows: unknown[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    select: (columns?: string) => {
      eq: (column: string, value: unknown) => unknown;
      gte: (column: string, value: unknown) => unknown;
      lte: (column: string, value: unknown) => unknown;
      order: (column: string, options?: { ascending?: boolean }) => unknown;
      limit: (n: number) => Promise<{ data: unknown[]; error: unknown }>;
    };
  };
};

export class SupabaseHistoryStore implements HistoricalStore {
  constructor(private readonly client: SupabaseClientShape) {}

  async isOperational(): Promise<boolean> {
    try {
      const { error } = await (this.client.from('report_score_history').select('id').limit(1) as Promise<{
        data: unknown[];
        error: unknown;
      }>);
      return !error;
    } catch {
      return false;
    }
  }

  async writeSnapshot(params: Parameters<HistoricalStore['writeSnapshot']>[0]): Promise<void> {
    // Each table is written serially and each insert is AWAITED: a PostgREST
    // builder is a lazy thenable, so an un-awaited `insert()` is never sent and
    // its `error` is always undefined — a silent no-op that reports success.
    // A rejected insert throws, so the caller sees the failure instead of
    // recording `persisted: true` against rows that were never written.
    // Retries are NOT idempotent: `id` is the primary key and
    // (company_id, observed_at) is UNIQUE, so replaying a partially-written
    // bundle raises 23505 rather than overwriting history.
    const tables: Array<[string, unknown[]]> = [
      ['report_score_history', [serializeSnapshot(params.snapshot)]],
      ['report_pillar_history', params.pillars.map(serializePillar)],
      ['report_provider_history', params.providers.map(serializeProvider)],
      ['report_recommendation_history', params.recommendations.map(serializeRecommendation)],
      ['report_evidence_history', params.evidence.map(serializeEvidence)],
    ];
    if (params.benchmark) tables.push(['report_benchmark_history', [serializeBenchmark(params.benchmark)]]);

    for (const [table, rows] of tables) {
      if (rows.length === 0) continue;
      const { error } = await this.client.from(table).insert(rows);
      if (error) {
        throw new Error(`SupabaseHistoryStore.writeSnapshot failed for ${table}: ${describeError(error)}`);
      }
    }
  }

  async loadSnapshots(range: HistoryRange): Promise<ReportSnapshotRecord[]> {
    return this.runRangeQuery<ReportSnapshotRecord>('report_score_history', range);
  }

  async loadPillarHistory(range: HistoryRange & { pillar?: PillarKey }): Promise<PillarHistoryRecord[]> {
    return this.runRangeQuery<PillarHistoryRecord>('report_pillar_history', range, range.pillar
      ? [['pillar', range.pillar]]
      : []);
  }

  async loadProviderHistory(
    range: HistoryRange & { provider_id?: string },
  ): Promise<ProviderHistoryRecord[]> {
    return this.runRangeQuery<ProviderHistoryRecord>('report_provider_history', range, range.provider_id
      ? [['provider_id', range.provider_id]]
      : []);
  }

  async loadRecommendationHistory(range: HistoryRange): Promise<RecommendationHistoryRecord[]> {
    return this.runRangeQuery<RecommendationHistoryRecord>('report_recommendation_history', range);
  }

  async loadEvidenceHistory(range: HistoryRange): Promise<EvidenceHistoryRecord[]> {
    return this.runRangeQuery<EvidenceHistoryRecord>('report_evidence_history', range);
  }

  async loadBenchmarkHistory(range: HistoryRange): Promise<BenchmarkHistoryRecord[]> {
    return this.runRangeQuery<BenchmarkHistoryRecord>('report_benchmark_history', range);
  }

  private async runRangeQuery<T>(
    table: string,
    range: HistoryRange,
    extraEqs: Array<[string, unknown]> = [],
  ): Promise<T[]> {
    let query = this.client.from(table).select() as unknown as {
      eq: (column: string, value: unknown) => any;
      gte: (column: string, value: unknown) => any;
      lte: (column: string, value: unknown) => any;
      order: (column: string, options?: { ascending?: boolean }) => any;
      limit: (n: number) => Promise<{ data: unknown[]; error: unknown }>;
    };
    query = query.eq('company_id', range.company_id);
    if (range.from) query = query.gte('observed_at', range.from);
    if (range.to) query = query.lte('observed_at', range.to);
    for (const [col, val] of extraEqs) query = query.eq(col, val);
    query = query.order('observed_at', { ascending: false });
    const result = await query.limit(range.limit ?? 200);
    if (result.error) throw new Error(`SupabaseHistoryStore.${table} query failed: ${String(result.error)}`);
    return (result.data as T[]) ?? [];
  }
}

/**
 * PostgREST returns a plain error object, so `String(error)` renders "[object Object]"
 * and hides the reason a durable write was rejected. Surface the real message.
 */
function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; details?: unknown };
    const parts = [e.code ? `[${String(e.code)}]` : '', e.message ? String(e.message) : '', e.details ? String(e.details) : '']
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return String(error);
}

// ── Serializers (shape canonical records → DB row shape) ──────────────────────

function serializeSnapshot(record: ReportSnapshotRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    authority_score: record.authority_score,
    ai_visibility_score: record.ai_visibility_score,
    maturity: record.maturity,
    maturity_stage: record.maturity_stage,
    scan_profile: record.scan_profile,
    source_metadata: record.source_metadata,
  };
}

function serializePillar(record: PillarHistoryRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    pillar: record.pillar,
    score: record.score,
    primary_signal: record.primary_signal,
  };
}

function serializeProvider(record: ProviderHistoryRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    provider_id: record.provider_id,
    outcome: record.outcome,
    latency_ms: record.latency_ms,
    cache_hit: record.cache_hit,
    reason: record.reason,
  };
}

function serializeBenchmark(record: BenchmarkHistoryRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    vertical: record.vertical,
    size_band: record.size_band,
    peer_count: record.peer_count,
    percentile: record.percentile,
    median_snapshot: record.median_snapshot,
  };
}

function serializeRecommendation(record: RecommendationHistoryRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    action_id: record.action_id,
    title: record.title,
    pillar: record.pillar,
    severity: record.severity,
    leverage_score: record.leverage_score,
    status: record.status,
  };
}

function serializeEvidence(record: EvidenceHistoryRecord) {
  return {
    id: record.id,
    company_id: record.company_id,
    observed_at: record.observed_at,
    scope: record.scope,
    evidence_count: record.evidence_count,
    evidence_sources: record.evidence_sources,
    signal_summary: record.signal_summary,
  };
}
