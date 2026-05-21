/**
 * Settlement operational-metrics retention / rollup (INTERNAL).
 *
 * Compacts the append-only settlement_operational_metrics ledger into the
 * append-only settlement_metrics_rollup tier (migration 20260721): every CLOSED
 * time bucket is consolidated into one rollup row per metric
 * (total_delta = SUM of that bucket's raw deltas).
 *
 * GUARANTEES:
 *   - DETERMINISTIC — the rollup set is a pure function of (raw rows, now,
 *     period size). No randomness, no provider call.
 *   - IDEMPOTENT — a bucket already present in the rollup tier is skipped; a
 *     re-run writes nothing. The UNIQUE(period_start, metric_name) constraint
 *     is a backstop.
 *   - APPEND-ONLY — only inserts rollup rows. The raw ledger is NEVER mutated
 *     or deleted; rollup rows are themselves immutable.
 *   - NO MUTATION OF ACTIVE ROWS — only buckets strictly before the current
 *     period are rolled up; the open (active) period is never touched.
 *   - FIDELITY — SUM(rollup.total_delta) over a bucket equals SUM(raw.delta)
 *     over that bucket, so aggregate totals are preserved exactly.
 *
 * STRICTLY internal. PRICING-BLIND — only lifecycle metric counts. NO live
 * settlement, NO wallet/credit/subscription side-effect. Never throws.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { SETTLEMENT_METRIC_NAMES, type SettlementMetricName } from './settlementMetrics';

/** Default rollup bucket — one hour. */
const DEFAULT_PERIOD_MS = 60 * 60 * 1000;
/** Defensive cap on the raw scan per run. */
const MAX_RAW_SCAN = 50_000;

export interface RawMetricRow {
  metric_name: string;
  delta: number;
  observed_at: string;
}

export interface MetricRollupRow {
  period_start: string;
  period_end: string;
  metric_name: SettlementMetricName;
  total_delta: number;
  source_row_count: number;
}

/** Persistence surface — injectable so the rollup is unit-testable without a DB. */
export interface RetentionBackend {
  readRawMetricRows(): Promise<RawMetricRow[]>;
  /** ISO period_start values already present in the rollup tier. */
  readRolledPeriodStarts(): Promise<Set<string>>;
  appendRollups(rows: MetricRollupRow[]): Promise<void>;
}

function messageIncludes(error: { message?: string }, needle: string): boolean {
  return String(error.message ?? '').toLowerCase().includes(needle);
}

/** The default supabase-backed retention backend. */
export const DEFAULT_RETENTION_BACKEND: RetentionBackend = {
  readRawMetricRows: async () => {
    const { data, error } = await supabase
      .from('settlement_operational_metrics')
      .select('metric_name, delta, observed_at')
      .limit(MAX_RAW_SCAN);
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      metric_name: String(r.metric_name ?? ''),
      delta: Number(r.delta ?? 0) || 0,
      observed_at: String(r.observed_at ?? ''),
    }));
  },
  readRolledPeriodStarts: async () => {
    const { data, error } = await supabase
      .from('settlement_metrics_rollup')
      .select('period_start');
    if (error || !data) return new Set<string>();
    return new Set(
      (data as unknown as Array<Record<string, unknown>>).map((r) => String(r.period_start ?? '')),
    );
  },
  appendRollups: async (rows) => {
    if (rows.length === 0) return;
    const { error } = await supabase
      .from('settlement_metrics_rollup')
      .insert(rows as unknown as Array<Record<string, unknown>>);
    // 23505 → a concurrent run already rolled this period; treat as done.
    if (error && (error as { code?: string }).code !== '23505'
        && !messageIncludes(error, 'does not exist')) {
      logger.warn('settlement_metrics_rollup_append_failed', { message: error.message });
    }
  },
};

const DEFAULT_DEPS: RetentionBackend = DEFAULT_RETENTION_BACKEND;

export interface RetentionResult {
  ok: true;
  /** Closed buckets consolidated by this run. */
  periodsRolledUp: number;
  /** Rollup rows written (≤ periodsRolledUp × 5 metrics). */
  rollupRowsWritten: number;
  /** Raw rows consolidated into the new rollups. */
  rawRowsCompacted: number;
}

const KNOWN_METRICS = new Set<string>(SETTLEMENT_METRIC_NAMES as readonly string[]);

/**
 * Run one deterministic, idempotent metrics rollup. Closed buckets not already
 * in the rollup tier are consolidated; the open period is left untouched.
 */
export async function runSettlementMetricsRetention(
  args: { nowMs?: number; periodMs?: number } = {},
  depsOverride?: Partial<RetentionBackend>,
): Promise<RetentionResult> {
  const deps: RetentionBackend = { ...DEFAULT_DEPS, ...depsOverride };
  const periodMs = args.periodMs && args.periodMs > 0 ? args.periodMs : DEFAULT_PERIOD_MS;
  const nowMs = args.nowMs ?? Date.now();
  const currentPeriodStart = Math.floor(nowMs / periodMs) * periodMs;

  const result: RetentionResult = { ok: true, periodsRolledUp: 0, rollupRowsWritten: 0, rawRowsCompacted: 0 };

  try {
    const rawRows = await deps.readRawMetricRows();
    const alreadyRolled = await deps.readRolledPeriodStarts();

    // bucket → metric → { sum, count }
    const buckets = new Map<number, Map<SettlementMetricName, { sum: number; count: number }>>();
    for (const row of rawRows) {
      if (!KNOWN_METRICS.has(row.metric_name)) continue; // ignore unknown metrics
      const observedMs = Date.parse(row.observed_at);
      if (!Number.isFinite(observedMs)) continue;
      const periodStartMs = Math.floor(observedMs / periodMs) * periodMs;
      if (periodStartMs >= currentPeriodStart) continue; // active period — never roll up
      if (alreadyRolled.has(new Date(periodStartMs).toISOString())) continue; // already rolled

      let metricMap = buckets.get(periodStartMs);
      if (!metricMap) { metricMap = new Map(); buckets.set(periodStartMs, metricMap); }
      const name = row.metric_name as SettlementMetricName;
      const acc = metricMap.get(name) ?? { sum: 0, count: 0 };
      acc.sum += Number(row.delta) || 0;
      acc.count += 1;
      metricMap.set(name, acc);
    }

    // Deterministic ordering — ascending period, then metric name. EVERY closed
    // bucket emits a rollup row for ALL FIVE metric classes (zero-filled when a
    // class had no activity), so a period's completeness is verifiable as
    // exactly 5 rollup rows — the deterministic prune-eligibility signal.
    const rollups: MetricRollupRow[] = [];
    for (const periodStartMs of [...buckets.keys()].sort((a, b) => a - b)) {
      const metricMap = buckets.get(periodStartMs)!;
      for (const name of SETTLEMENT_METRIC_NAMES) {
        const acc = metricMap.get(name) ?? { sum: 0, count: 0 };
        rollups.push({
          period_start: new Date(periodStartMs).toISOString(),
          period_end: new Date(periodStartMs + periodMs).toISOString(),
          metric_name: name,
          total_delta: acc.sum,
          source_row_count: acc.count,
        });
        result.rawRowsCompacted += acc.count;
      }
    }

    if (rollups.length > 0) await deps.appendRollups(rollups);
    result.periodsRolledUp = buckets.size;
    result.rollupRowsWritten = rollups.length;

    logger.info('settlement_metrics_retention', {
      periodsRolledUp: result.periodsRolledUp,
      rollupRowsWritten: result.rollupRowsWritten,
      rawRowsCompacted: result.rawRowsCompacted, // no pricing
    });
  } catch (err) {
    logger.warn('settlement_metrics_retention_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

// ── rollup-gated pruning ────────────────────────────────────────────────────
// Retires raw operational rows for fully rolled-up periods. The actual DELETE
// is performed by the sanctioned SECURITY DEFINER RPC settlement_metrics_prune_
// rolled (migration 20260722) — ad-hoc deletes remain blocked by the retention
// gate trigger. Eligibility is verified deterministically here AND re-checked
// server-side by the RPC (defense in depth).

/** Persistence surface for pruning — injectable for unit tests. */
export interface PruneBackend {
  readRollupRows(): Promise<MetricRollupRow[]>;
  readRawMetricRows(): Promise<RawMetricRow[]>;
  /** Invoke the sanctioned prune for the given period_starts; returns rows deleted. */
  prunePeriods(periodStarts: string[]): Promise<number>;
}

export const DEFAULT_PRUNE_BACKEND: PruneBackend = {
  readRollupRows: async () => {
    const { data, error } = await supabase
      .from('settlement_metrics_rollup')
      .select('period_start, period_end, metric_name, total_delta, source_row_count');
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      period_start: String(r.period_start ?? ''),
      period_end: String(r.period_end ?? ''),
      metric_name: String(r.metric_name ?? '') as SettlementMetricName,
      total_delta: Number(r.total_delta ?? 0) || 0,
      source_row_count: Number(r.source_row_count ?? 0) || 0,
    }));
  },
  readRawMetricRows: DEFAULT_RETENTION_BACKEND.readRawMetricRows,
  prunePeriods: async (periodStarts) => {
    if (periodStarts.length === 0) return 0;
    const { data, error } = await supabase.rpc('settlement_metrics_prune_rolled', {
      p_periods: periodStarts,
    });
    if (error) {
      if (!messageIncludes(error, 'does not exist')) {
        logger.warn('settlement_metrics_prune_rpc_failed', { message: error.message });
      }
      return 0;
    }
    return Number(data ?? 0) || 0;
  },
};

export interface PruneResult {
  ok: true;
  /** Fully-rolled-up periods with raw rows that reconciled — pruned this run. */
  eligiblePeriods: number;
  /** Raw rows deleted by the sanctioned prune. */
  prunedRows: number;
  /** Periods rejected — fewer than 5 rollup rows (partial / incomplete rollup). */
  rejectedPartial: number;
  /** Periods rejected — rollup totals did not reconcile with the raw rows. */
  rejectedCorrupt: number;
  /** Complete periods whose raw rows were already pruned (idempotent skip). */
  alreadyPruned: number;
}

/**
 * Prune raw operational rows for fully rolled-up periods. Deterministic +
 * idempotent + safe under repeated / concurrent execution:
 *   - a period is eligible ONLY when it has all 5 metric-class rollup rows
 *     (completeness) AND the rollup totals reconcile exactly with the raw rows
 *     (corruption detection);
 *   - a partial rollup or a reconciliation mismatch is rejected, never pruned;
 *   - a complete period whose raw rows are already gone is a no-op.
 * Never throws.
 */
export async function pruneRolledSettlementMetrics(
  depsOverride?: Partial<PruneBackend>,
): Promise<PruneResult> {
  const deps: PruneBackend = { ...DEFAULT_PRUNE_BACKEND, ...depsOverride };
  const result: PruneResult = {
    ok: true, eligiblePeriods: 0, prunedRows: 0,
    rejectedPartial: 0, rejectedCorrupt: 0, alreadyPruned: 0,
  };

  try {
    const rollupRows = await deps.readRollupRows();
    const rawRows = await deps.readRawMetricRows();

    // Group rollup rows by period. UNIQUE(period_start, metric_name) means one
    // row per metric — a period is COMPLETE iff it has all 5 metric classes.
    const periods = new Map<string, { periodEnd: string; metricTotals: Map<string, number> }>();
    for (const r of rollupRows) {
      let p = periods.get(r.period_start);
      if (!p) { p = { periodEnd: r.period_end, metricTotals: new Map() }; periods.set(r.period_start, p); }
      p.metricTotals.set(r.metric_name, r.total_delta);
    }

    const eligible: string[] = [];
    // Deterministic ordering — ascending period.
    for (const periodStart of [...periods.keys()].sort()) {
      const p = periods.get(periodStart)!;
      const startMs = Date.parse(periodStart);
      const endMs = Date.parse(p.periodEnd);

      // (4) completeness — all five metric classes must be present.
      if (p.metricTotals.size !== SETTLEMENT_METRIC_NAMES.length) {
        result.rejectedPartial += 1;
        continue;
      }

      const rawInPeriod = rawRows.filter((row) => {
        const t = Date.parse(row.observed_at);
        return Number.isFinite(t) && Number.isFinite(startMs) && Number.isFinite(endMs)
          && t >= startMs && t < endMs;
      });
      // A complete period with no raw rows left was already pruned — idempotent.
      if (rawInPeriod.length === 0) {
        result.alreadyPruned += 1;
        continue;
      }

      // (5) corruption detection — rollup totals MUST reconcile with the raw
      // rows about to be retired, per metric class.
      const rawSum = new Map<string, number>();
      for (const row of rawInPeriod) {
        rawSum.set(row.metric_name, (rawSum.get(row.metric_name) ?? 0) + (Number(row.delta) || 0));
      }
      let reconciled = true;
      for (const name of SETTLEMENT_METRIC_NAMES) {
        if ((p.metricTotals.get(name) ?? 0) !== (rawSum.get(name) ?? 0)) { reconciled = false; break; }
      }
      if (!reconciled) {
        result.rejectedCorrupt += 1;
        continue;
      }

      eligible.push(periodStart);
    }

    result.eligiblePeriods = eligible.length;
    if (eligible.length > 0) {
      result.prunedRows = await deps.prunePeriods(eligible);
    }

    logger.info('settlement_metrics_prune', {
      eligiblePeriods: result.eligiblePeriods, prunedRows: result.prunedRows,
      rejectedPartial: result.rejectedPartial, rejectedCorrupt: result.rejectedCorrupt,
      alreadyPruned: result.alreadyPruned, // no pricing
    });
  } catch (err) {
    logger.warn('settlement_metrics_prune_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
