/**
 * settlementMetrics — persistent operational-metrics tests.
 *
 * Covers: persistent metric recording, append-only delta semantics,
 * deterministic aggregation, all-keys-present aggregate shape, unknown-metric
 * tolerance, default-preserving behavior, and hidden-pricing preservation.
 * The metrics backend is dependency-injected — NO DB.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  incrementSettlementMetric,
  aggregateSettlementMetrics,
  SETTLEMENT_METRIC_NAMES,
  type MetricsBackend,
  type SettlementMetricName,
} from '../../services/billing/payments/settlementMetrics';

/** In-memory append-only metrics backend (raw tier; no rollups in these tests). */
function memMetricsBackend() {
  const rows: Array<{ metric_name: string; delta: number; source: string; observed_at: string }> = [];
  let unavailable = false;
  const backend: MetricsBackend = {
    appendMetric: async (row) => {
      if (!unavailable) rows.push({ ...row, observed_at: new Date().toISOString() });
    },
    readRawRows: async () =>
      unavailable ? [] : rows.map((r) => ({ metric_name: r.metric_name, delta: r.delta, observed_at: r.observed_at })),
    readRollupRows: async () => [],
  };
  return { backend, rows, makeUnavailable: () => { unavailable = true; } };
}

describe('settlement metrics — persistent recording', () => {
  test('an increment appends one delta row', async () => {
    const { backend, rows } = memMetricsBackend();
    await incrementSettlementMetric('sessions_expired', 3, { backend });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metric_name: 'sessions_expired', delta: 3 });
  });

  test('the append-only ledger never mutates a prior row — each increment is a new row', async () => {
    const { backend, rows } = memMetricsBackend();
    await incrementSettlementMetric('candidates_scanned', 2, { backend });
    await incrementSettlementMetric('candidates_scanned', 5, { backend });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.delta)).toEqual([2, 5]);
  });

  test('a non-positive / non-finite delta is ignored (no row appended)', async () => {
    const { backend, rows } = memMetricsBackend();
    await incrementSettlementMetric('sessions_expired', 0, { backend });
    await incrementSettlementMetric('sessions_expired', -4, { backend });
    await incrementSettlementMetric('sessions_expired', Number.NaN, { backend });
    expect(rows).toHaveLength(0);
  });

  test('a default-source is stamped, and an explicit source is honored', async () => {
    const { backend, rows } = memMetricsBackend();
    await incrementSettlementMetric('sessions_expired', 1, { backend });
    await incrementSettlementMetric('stale_webhook_rejections', 1, { backend, source: 'settlement_webhook' });
    expect(rows[0].source).toBe('settlement_runtime');
    expect(rows[1].source).toBe('settlement_webhook');
  });
});

describe('settlement metrics — aggregation correctness', () => {
  test('aggregate sums deltas per metric', async () => {
    const { backend } = memMetricsBackend();
    await incrementSettlementMetric('candidates_scanned', 10, { backend });
    await incrementSettlementMetric('candidates_scanned', 7, { backend });
    await incrementSettlementMetric('sessions_expired', 4, { backend });
    const agg = await aggregateSettlementMetrics({ backend });
    expect(agg.candidates_scanned).toBe(17);
    expect(agg.sessions_expired).toBe(4);
  });

  test('the aggregate always carries all five metric keys (zero default)', async () => {
    const { backend } = memMetricsBackend();
    const agg = await aggregateSettlementMetrics({ backend });
    expect(Object.keys(agg).sort()).toEqual([...SETTLEMENT_METRIC_NAMES].sort());
    for (const name of SETTLEMENT_METRIC_NAMES) expect(agg[name]).toBe(0);
  });

  test('all five metrics aggregate independently', async () => {
    const { backend } = memMetricsBackend();
    for (const name of SETTLEMENT_METRIC_NAMES) {
      await incrementSettlementMetric(name as SettlementMetricName, 1, { backend });
    }
    const agg = await aggregateSettlementMetrics({ backend });
    for (const name of SETTLEMENT_METRIC_NAMES) expect(agg[name]).toBe(1);
  });

  test('an unknown metric name in the ledger is ignored by the aggregate', async () => {
    const { backend, rows } = memMetricsBackend();
    await incrementSettlementMetric('sessions_expired', 2, { backend });
    rows.push({ metric_name: 'pricing_total', delta: 9_999, source: 'rogue', observed_at: new Date().toISOString() }); // not a tracked metric
    const agg = await aggregateSettlementMetrics({ backend });
    expect(agg.sessions_expired).toBe(2);
    expect((agg as Record<string, number>).pricing_total).toBeUndefined();
  });

  test('aggregation is deterministic — the same ledger yields the same aggregate', async () => {
    const { backend } = memMetricsBackend();
    await incrementSettlementMetric('candidates_scanned', 3, { backend });
    await incrementSettlementMetric('duplicate_expiry_suppressions', 1, { backend });
    const a = await aggregateSettlementMetrics({ backend });
    const b = await aggregateSettlementMetrics({ backend });
    expect(b).toEqual(a);
  });
});

describe('settlement metrics — optimized rollup-aware aggregation', () => {
  const HOUR = 3_600_000;
  const P1 = 5 * HOUR; // a closed period
  const iso = (ms: number) => new Date(ms).toISOString();
  const backendWith = (
    raw: Array<{ metric_name: string; delta: number; observed_at: string }>,
    rollups: Array<{ period_start: string; period_end: string; metric_name: string; total_delta: number }>,
  ): MetricsBackend => ({
    appendMetric: async () => {},
    readRawRows: async () => raw,
    readRollupRows: async () => rollups,
  });

  test('closed periods resolve from the rollup tier, the active period from raw — no double-count', async () => {
    const raw = [
      // inside the rolled period P1 — MUST be excluded (already in the rollup)
      { metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) },
      { metric_name: 'candidates_scanned', delta: 3, observed_at: iso(P1 + 20) },
      // active period — counted directly from raw
      { metric_name: 'candidates_scanned', delta: 4, observed_at: iso(20 * HOUR) },
    ];
    const rollups = [
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'candidates_scanned', total_delta: 8 },
    ];
    const agg = await aggregateSettlementMetrics({ backend: backendWith(raw, rollups) });
    expect(agg.candidates_scanned).toBe(12); // rollup 8 + active 4 — P1 raw rows NOT re-counted
  });

  test('optimized aggregation is byte-identical to a full raw aggregation', async () => {
    const raw = [
      { metric_name: 'candidates_scanned', delta: 5, observed_at: iso(P1 + 10) },
      { metric_name: 'sessions_expired', delta: 2, observed_at: iso(P1 + 20) },
      { metric_name: 'candidates_scanned', delta: 9, observed_at: iso(20 * HOUR) },
      { metric_name: 'stale_webhook_rejections', delta: 1, observed_at: iso(20 * HOUR + 5) },
    ];
    // Full raw aggregation — the source of truth (no rollups).
    const fullRaw = await aggregateSettlementMetrics({ backend: backendWith(raw, []) });
    // Optimized — P1 is rolled up (faithful totals); the same raw set is supplied.
    const rollups = [
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'candidates_scanned', total_delta: 5 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'sessions_expired', total_delta: 2 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'duplicate_expiry_suppressions', total_delta: 0 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'stale_webhook_rejections', total_delta: 0 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'signature_verification_failures', total_delta: 0 },
    ];
    const optimized = await aggregateSettlementMetrics({ backend: backendWith(raw, rollups) });
    expect(optimized).toEqual(fullRaw);
  });

  test('aggregation stays correct after rolled raw rows are pruned', async () => {
    // Simulates the post-prune state — P1 raw rows are GONE, only the rollup remains.
    const rollups = [
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'candidates_scanned', total_delta: 8 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'sessions_expired', total_delta: 0 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'duplicate_expiry_suppressions', total_delta: 0 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'stale_webhook_rejections', total_delta: 0 },
      { period_start: iso(P1), period_end: iso(P1 + HOUR), metric_name: 'signature_verification_failures', total_delta: 0 },
    ];
    const activeRaw = [{ metric_name: 'candidates_scanned', delta: 4, observed_at: iso(20 * HOUR) }];
    const agg = await aggregateSettlementMetrics({ backend: backendWith(activeRaw, rollups) });
    expect(agg.candidates_scanned).toBe(12); // 8 (rollup) + 4 (active) — pruned rows still counted
  });
});

describe('settlement metrics — default-preserving behavior', () => {
  test('an unavailable backend → increment is a no-op, aggregate returns zeros', async () => {
    const { backend, makeUnavailable } = memMetricsBackend();
    makeUnavailable();
    await expect(incrementSettlementMetric('sessions_expired', 5, { backend })).resolves.toBeUndefined();
    const agg = await aggregateSettlementMetrics({ backend });
    for (const name of SETTLEMENT_METRIC_NAMES) expect(agg[name]).toBe(0);
  });

  test('a throwing backend never propagates out of increment/aggregate', async () => {
    const throwing: MetricsBackend = {
      appendMetric: async () => { throw new Error('db down'); },
      readRawRows: async () => { throw new Error('db down'); },
      readRollupRows: async () => { throw new Error('db down'); },
    };
    await expect(incrementSettlementMetric('sessions_expired', 1, { backend: throwing })).resolves.toBeUndefined();
    await expect(aggregateSettlementMetrics({ backend: throwing })).resolves.toBeDefined();
  });
});

describe('settlement metrics — hidden-pricing preservation', () => {
  test('the tracked metric set contains no pricing metric', () => {
    const serialized = JSON.stringify(SETTLEMENT_METRIC_NAMES).toLowerCase();
    for (const f of ['amount', 'price', 'pricing', 'revenue', 'invoice', 'total']) {
      expect(serialized).not.toContain(f);
    }
  });

  test('the aggregate carries no pricing field', async () => {
    const { backend } = memMetricsBackend();
    await incrementSettlementMetric('sessions_expired', 1, { backend });
    const agg = await aggregateSettlementMetrics({ backend });
    const serialized = JSON.stringify(agg).toLowerCase();
    for (const f of ['amount', 'price', 'pricing', 'revenue', 'invoice', 'subtotal']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
