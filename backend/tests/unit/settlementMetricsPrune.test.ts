/**
 * settlementMetricsPrune — rollup-gated pruning tests.
 *
 * Covers: sanctioned prune correctness, prune-eligibility enforcement (partial
 * rollups rejected), repeated-prune idempotency, rollup-corruption rejection,
 * concurrent-prune safety, and hidden-pricing preservation. The prune backend
 * is dependency-injected — NO DB; the in-memory backend mirrors the sanctioned
 * RPC's server-side completeness re-check.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  pruneRolledSettlementMetrics,
  type PruneBackend,
  type RawMetricRow,
  type MetricRollupRow,
} from '../../services/billing/payments/settlementMetricsRetention';
import { SETTLEMENT_METRIC_NAMES } from '../../services/billing/payments/settlementMetrics';

const HOUR = 60 * 60 * 1000;
const P1 = 5 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** Build a COMPLETE rollup (all 5 metric classes) for a period. */
function completeRollup(periodStartMs: number, totals: Partial<Record<string, number>>): MetricRollupRow[] {
  return SETTLEMENT_METRIC_NAMES.map((name) => ({
    period_start: iso(periodStartMs),
    period_end: iso(periodStartMs + HOUR),
    metric_name: name,
    total_delta: totals[name] ?? 0,
    source_row_count: 0,
  }));
}

/** In-memory prune backend — prunePeriods mirrors the RPC: it deletes raw rows
 *  ONLY for periods that are complete (5 rollup rows) server-side. */
function memPrune(rawRows: RawMetricRow[], rollupRows: MetricRollupRow[]) {
  const raw = rawRows.map((r) => ({ ...r }));
  const rollups = rollupRows.map((r) => ({ ...r }));
  const backend: PruneBackend = {
    readRollupRows: async () => rollups.map((r) => ({ ...r })),
    readRawMetricRows: async () => raw.map((r) => ({ ...r })),
    prunePeriods: async (periodStarts) => {
      const completeStarts = new Set(
        [...new Set(rollups.map((r) => r.period_start))].filter(
          (ps) => rollups.filter((r) => r.period_start === ps).length === 5,
        ),
      );
      let deleted = 0;
      for (let i = raw.length - 1; i >= 0; i--) {
        const t = Date.parse(raw[i].observed_at);
        for (const ps of periodStarts) {
          if (!completeStarts.has(ps)) continue;
          const rr = rollups.find((r) => r.period_start === ps);
          if (!rr) continue;
          if (t >= Date.parse(rr.period_start) && t < Date.parse(rr.period_end)) {
            raw.splice(i, 1); deleted += 1; break;
          }
        }
      }
      return deleted;
    },
  };
  return { backend, raw, rollups };
}

describe('metrics prune — sanctioned prune correctness', () => {
  test('a fully rolled-up, reconciled period is pruned', async () => {
    const raw: RawMetricRow[] = [
      { metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) },
      { metric_name: 'candidates_scanned', delta: 3, observed_at: iso(P1 + 20) },
      { metric_name: 'sessions_expired', delta: 2, observed_at: iso(P1 + 30) },
    ];
    const rollups = completeRollup(P1, { candidates_scanned: 8, sessions_expired: 2 });
    const { backend, raw: store } = memPrune(raw, rollups);
    const r = await pruneRolledSettlementMetrics(backend);
    expect(r.eligiblePeriods).toBe(1);
    expect(r.prunedRows).toBe(3);
    expect(r.rejectedPartial).toBe(0);
    expect(r.rejectedCorrupt).toBe(0);
    expect(store).toHaveLength(0); // the period's raw rows were retired
  });

  test('only complete + reconciled periods are pruned; the rollup tier is never touched', async () => {
    const raw: RawMetricRow[] = [{ metric_name: 'sessions_expired', delta: 1, observed_at: iso(P1 + 5) }];
    const rollups = completeRollup(P1, { sessions_expired: 1 });
    const { backend, rollups: rollupStore } = memPrune(raw, rollups);
    await pruneRolledSettlementMetrics(backend);
    expect(rollupStore).toHaveLength(5); // rollup rows are immutable — never pruned
  });
});

describe('metrics prune — eligibility enforcement', () => {
  test('a partial rollup (fewer than 5 metric classes) is rejected, never pruned', async () => {
    const raw: RawMetricRow[] = [{ metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) }];
    // Only 3 of the 5 metric classes present → partial / incomplete rollup.
    const partial: MetricRollupRow[] = SETTLEMENT_METRIC_NAMES.slice(0, 3).map((name) => ({
      period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: name, total_delta: 0, source_row_count: 0,
    }));
    const { backend, raw: store } = memPrune(raw, partial);
    const r = await pruneRolledSettlementMetrics(backend);
    expect(r.rejectedPartial).toBe(1);
    expect(r.eligiblePeriods).toBe(0);
    expect(r.prunedRows).toBe(0);
    expect(store).toHaveLength(1); // raw rows preserved — period not eligible
  });

  test('a period with no rollup at all is never pruned', async () => {
    const raw: RawMetricRow[] = [{ metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) }];
    const { backend, raw: store } = memPrune(raw, []); // no rollups
    const r = await pruneRolledSettlementMetrics(backend);
    expect(r.eligiblePeriods).toBe(0);
    expect(store).toHaveLength(1);
  });
});

describe('metrics prune — repeated-prune idempotency', () => {
  test('a second prune retires nothing (raw rows already gone)', async () => {
    const raw: RawMetricRow[] = [
      { metric_name: 'candidates_scanned', delta: 8, observed_at: iso(P1 + 10) },
      { metric_name: 'sessions_expired', delta: 2, observed_at: iso(P1 + 20) },
    ];
    const rollups = completeRollup(P1, { candidates_scanned: 8, sessions_expired: 2 });
    const { backend } = memPrune(raw, rollups);
    const first = await pruneRolledSettlementMetrics(backend);
    const second = await pruneRolledSettlementMetrics(backend);
    expect(first.prunedRows).toBe(2);
    expect(second.prunedRows).toBe(0);
    expect(second.eligiblePeriods).toBe(0);
    expect(second.alreadyPruned).toBe(1); // complete period, raw rows already retired
  });
});

describe('metrics prune — rollup-corruption rejection', () => {
  test('a period whose rollup totals do not reconcile with the raw rows is rejected', async () => {
    const raw: RawMetricRow[] = [{ metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) }];
    // Rollup claims 999 but the raw rows sum to 5 → corruption.
    const corrupt = completeRollup(P1, { candidates_scanned: 999 });
    const { backend, raw: store } = memPrune(raw, corrupt);
    const r = await pruneRolledSettlementMetrics(backend);
    expect(r.rejectedCorrupt).toBe(1);
    expect(r.eligiblePeriods).toBe(0);
    expect(r.prunedRows).toBe(0);
    expect(store).toHaveLength(1); // corrupt period is NOT pruned — discrepancy preserved
  });
});

describe('metrics prune — concurrent-prune safety', () => {
  test('two overlapping prunes retire each raw row exactly once', async () => {
    const raw: RawMetricRow[] = [
      { metric_name: 'candidates_scanned', delta: 4, observed_at: iso(P1 + 10) },
      { metric_name: 'candidates_scanned', delta: 4, observed_at: iso(P1 + 20) },
      { metric_name: 'sessions_expired', delta: 1, observed_at: iso(P1 + 30) },
    ];
    const rollups = completeRollup(P1, { candidates_scanned: 8, sessions_expired: 1 });
    const { backend, raw: store } = memPrune(raw, rollups);
    const [a, b] = await Promise.all([
      pruneRolledSettlementMetrics(backend),
      pruneRolledSettlementMetrics(backend),
    ]);
    // Exactly 3 rows retired in total — never double-pruned.
    expect(a.prunedRows + b.prunedRows).toBe(3);
    expect(store).toHaveLength(0);
    expect(a.ok && b.ok).toBe(true);
  });
});

describe('metrics prune — hidden-pricing preservation', () => {
  test('the prune result carries no pricing fields', async () => {
    const raw: RawMetricRow[] = [{ metric_name: 'sessions_expired', delta: 1, observed_at: iso(P1 + 5) }];
    const { backend } = memPrune(raw, completeRollup(P1, { sessions_expired: 1 }));
    const r = await pruneRolledSettlementMetrics(backend);
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'revenue', 'subtotal', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
