/**
 * Persistent operational settlement metrics (INTERNAL ONLY).
 *
 * The append-only operational metrics ledger (`settlement_operational_metrics`,
 * migration 20260720). Each increment appends one delta row.
 *
 * OPTIMIZED AGGREGATION: `aggregateSettlementMetrics` resolves closed periods
 * from the compact `settlement_metrics_rollup` tier and the active/open period
 * from the raw ledger. The result is byte-identical to a full raw aggregation
 * — a rolled period's rollup total equals that period's raw delta sum, and the
 * raw rows of rolled periods are excluded so nothing is double-counted. This
 * stays correct after rolled raw rows are pruned (migration 20260722).
 *
 * STRICTLY internal:
 *   - No public telemetry surface. The reader (aggregateSettlementMetrics) is
 *     an internal/admin-only foundation; any endpoint MUST be capability-gated.
 *   - PRICING-BLIND — only lifecycle event counts; never an amount / price.
 *
 * DEFAULT-PRESERVING: a missing table / DB error makes increment a best-effort
 * no-op and aggregate fall back to whatever tier is reachable. Never throws.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export type SettlementMetricName =
  | 'candidates_scanned'
  | 'sessions_expired'
  | 'duplicate_expiry_suppressions'
  | 'stale_webhook_rejections'
  | 'signature_verification_failures';

export const SETTLEMENT_METRIC_NAMES: readonly SettlementMetricName[] = [
  'candidates_scanned',
  'sessions_expired',
  'duplicate_expiry_suppressions',
  'stale_webhook_rejections',
  'signature_verification_failures',
];

export type SettlementMetricsAggregate = Record<SettlementMetricName, number>;

/** A zeroed aggregate — every metric key always present (deterministic shape). */
function zeroAggregate(): SettlementMetricsAggregate {
  return {
    candidates_scanned: 0,
    sessions_expired: 0,
    duplicate_expiry_suppressions: 0,
    stale_webhook_rejections: 0,
    signature_verification_failures: 0,
  };
}

const KNOWN_METRICS = new Set<string>(SETTLEMENT_METRIC_NAMES as readonly string[]);

/** A raw operational metric row (period-tagged via observed_at). */
export interface RawMetricLedgerRow {
  metric_name: string;
  delta: number;
  observed_at: string;
}

/** A rollup row — the compacted total for one closed period + metric. */
export interface RollupLedgerRow {
  period_start: string;
  period_end: string;
  metric_name: string;
  total_delta: number;
}

/** Persistence surface — injectable so the metrics layer is unit-testable
 *  without a DB. */
export interface MetricsBackend {
  appendMetric(row: { metric_name: SettlementMetricName; delta: number; source: string }): Promise<void>;
  /** Raw operational rows (the active/open period + any not-yet-rolled rows). */
  readRawRows(): Promise<RawMetricLedgerRow[]>;
  /** Rollup rows (the compacted closed-period totals). */
  readRollupRows(): Promise<RollupLedgerRow[]>;
}

function messageIncludes(error: { message?: string }, needle: string): boolean {
  return String(error.message ?? '').toLowerCase().includes(needle);
}

/** The default supabase-backed (append-only) metrics backend. */
export const DEFAULT_METRICS_BACKEND: MetricsBackend = {
  appendMetric: async (row) => {
    const { error } = await supabase.from('settlement_operational_metrics').insert(row as Record<string, unknown>);
    if (error && !messageIncludes(error, 'does not exist')) {
      logger.warn('settlement_metric_append_failed', { message: error.message });
    }
  },
  readRawRows: async () => {
    const { data, error } = await supabase
      .from('settlement_operational_metrics')
      .select('metric_name, delta, observed_at');
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      metric_name: String(r.metric_name ?? ''),
      delta: Number(r.delta ?? 0) || 0,
      observed_at: String(r.observed_at ?? ''),
    }));
  },
  readRollupRows: async () => {
    const { data, error } = await supabase
      .from('settlement_metrics_rollup')
      .select('period_start, period_end, metric_name, total_delta');
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      period_start: String(r.period_start ?? ''),
      period_end: String(r.period_end ?? ''),
      metric_name: String(r.metric_name ?? ''),
      total_delta: Number(r.total_delta ?? 0) || 0,
    }));
  },
};

/**
 * Append one settlement metric delta. A non-positive / non-finite delta is
 * ignored (counters are monotonic). Best-effort — never throws.
 */
export async function incrementSettlementMetric(
  name: SettlementMetricName,
  by = 1,
  opts: { source?: string; backend?: MetricsBackend } = {},
): Promise<void> {
  if (!Number.isFinite(by) || by <= 0) return;
  const backend = opts.backend ?? DEFAULT_METRICS_BACKEND;
  try {
    await backend.appendMetric({
      metric_name: name,
      delta: Math.round(by),
      source: opts.source ?? 'settlement_runtime',
    });
  } catch (err) {
    logger.warn('settlement_metric_increment_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * INTERNAL metrics reader foundation — OPTIMIZED.
 *
 * Closed periods are resolved from the rollup tier; the active/open period is
 * resolved from the raw ledger. Raw rows that fall inside a rolled period are
 * excluded (already represented by the rollup), so the result is byte-identical
 * to a full raw aggregation. Deterministic; every metric key always present;
 * unknown metric names are ignored. Never throws (returns zeros on any error).
 */
export async function aggregateSettlementMetrics(
  opts: { backend?: MetricsBackend } = {},
): Promise<SettlementMetricsAggregate> {
  const backend = opts.backend ?? DEFAULT_METRICS_BACKEND;
  const aggregate = zeroAggregate();
  try {
    const [rollupRows, rawRows] = await Promise.all([
      backend.readRollupRows(),
      backend.readRawRows(),
    ]);

    // Closed-period totals from the rollup tier. Each distinct period also
    // contributes a [start, end) range used to exclude its raw rows.
    const rolledRanges: Array<{ start: number; end: number }> = [];
    const seenPeriods = new Set<string>();
    for (const row of rollupRows) {
      if (KNOWN_METRICS.has(row.metric_name)) {
        aggregate[row.metric_name as SettlementMetricName] += Number(row.total_delta) || 0;
      }
      if (!seenPeriods.has(row.period_start)) {
        seenPeriods.add(row.period_start);
        const start = Date.parse(row.period_start);
        const end = Date.parse(row.period_end);
        if (Number.isFinite(start) && Number.isFinite(end)) rolledRanges.push({ start, end });
      }
    }

    // Active/open period (and any not-yet-rolled rows) from the raw ledger —
    // a raw row inside a rolled range is skipped (already counted above).
    for (const row of rawRows) {
      if (!KNOWN_METRICS.has(row.metric_name)) continue;
      const t = Date.parse(row.observed_at);
      const isRolled = Number.isFinite(t) && rolledRanges.some((r) => t >= r.start && t < r.end);
      if (isRolled) continue;
      aggregate[row.metric_name as SettlementMetricName] += Number(row.delta) || 0;
    }
  } catch (err) {
    logger.warn('settlement_metric_aggregate_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return aggregate;
}
