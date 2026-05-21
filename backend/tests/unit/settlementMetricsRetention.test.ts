/**
 * settlementMetricsRetention — rollup / retention tests.
 *
 * Covers: rollup correctness, idempotent (replay-safe) retention, no mutation
 * of the active period, deterministic rollup behavior, aggregation fidelity
 * (rollups preserve exact totals), and hidden-pricing preservation. The
 * retention backend is dependency-injected — NO DB.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  runSettlementMetricsRetention,
  type RetentionBackend,
  type RawMetricRow,
  type MetricRollupRow,
} from '../../services/billing/payments/settlementMetricsRetention';
import {
  aggregateSettlementMetrics,
  SETTLEMENT_METRIC_NAMES,
  type MetricsBackend,
} from '../../services/billing/payments/settlementMetrics';

// Hourly buckets on a clean boundary. now = bucket #10 start → the active
// period is [P0, P0+1h); P1 and P2 are closed.
const HOUR = 60 * 60 * 1000;
const NOW = 10 * HOUR;
const P_ACTIVE = 10 * HOUR; // current period start
const P1 = 9 * HOUR;        // closed
const P2 = 8 * HOUR;        // closed
const at = (periodStart: number, offset: number) => new Date(periodStart + offset).toISOString();

/** Raw metric ledger used by every test. */
function rawLedger(): RawMetricRow[] {
  return [
    // P2 (closed)
    { metric_name: 'candidates_scanned', delta: 5, observed_at: at(P2, 10) },
    { metric_name: 'candidates_scanned', delta: 3, observed_at: at(P2, 20) },
    { metric_name: 'sessions_expired', delta: 2, observed_at: at(P2, 30) },
    // P1 (closed)
    { metric_name: 'candidates_scanned', delta: 7, observed_at: at(P1, 10) },
    { metric_name: 'stale_webhook_rejections', delta: 1, observed_at: at(P1, 20) },
    // active period — must NOT be rolled up
    { metric_name: 'sessions_expired', delta: 100, observed_at: at(P_ACTIVE, 5) },
  ];
}

function memRetention(raw: RawMetricRow[]) {
  const rollups: MetricRollupRow[] = [];
  const backend: RetentionBackend = {
    readRawMetricRows: async () => raw.map((r) => ({ ...r })),
    readRolledPeriodStarts: async () => new Set(rollups.map((r) => r.period_start)),
    appendRollups: async (rows) => { rollups.push(...rows.map((r) => ({ ...r }))); },
  };
  return { backend, rollups };
}

/** A MetricsBackend over the same raw rows — for the fidelity cross-check. */
function memMetrics(raw: RawMetricRow[]): MetricsBackend {
  return {
    appendMetric: async () => {},
    readRawRows: async () => raw.map((r) => ({ ...r })),
    readRollupRows: async () => [],
  };
}

const ARGS = { nowMs: NOW, periodMs: HOUR };

describe('metrics retention — rollup correctness', () => {
  test('closed periods are consolidated into one rollup row per metric', async () => {
    const { backend, rollups } = memRetention(rawLedger());
    const r = await runSettlementMetricsRetention(ARGS, backend);
    expect(r.periodsRolledUp).toBe(2);          // P1 + P2
    expect(r.rollupRowsWritten).toBe(10);       // 2 periods × 5 metric classes (zero-filled)
    expect(r.rawRowsCompacted).toBe(5);         // 5 closed-period raw rows
    // P2 candidates_scanned: 5 + 3 = 8 over 2 rows.
    const p2cand = rollups.find((x) => x.period_start === new Date(P2).toISOString() && x.metric_name === 'candidates_scanned');
    expect(p2cand).toMatchObject({ total_delta: 8, source_row_count: 2 });
    // P1 candidates_scanned: 7 over 1 row.
    const p1cand = rollups.find((x) => x.period_start === new Date(P1).toISOString() && x.metric_name === 'candidates_scanned');
    expect(p1cand).toMatchObject({ total_delta: 7, source_row_count: 1 });
  });

  test('the active (open) period is never rolled up', async () => {
    const { backend, rollups } = memRetention(rawLedger());
    await runSettlementMetricsRetention(ARGS, backend);
    // The active sessions_expired delta of 100 must not appear in any rollup.
    const sessTotal = rollups
      .filter((x) => x.metric_name === 'sessions_expired')
      .reduce((s, x) => s + x.total_delta, 0);
    expect(sessTotal).toBe(2); // only P2's closed delta
  });

  test('an unknown metric name in the ledger is ignored by the rollup', async () => {
    const raw = [
      ...rawLedger(),
      { metric_name: 'pricing_total', delta: 9_999, observed_at: at(P2, 40) },
    ];
    const { backend, rollups } = memRetention(raw);
    await runSettlementMetricsRetention(ARGS, backend);
    expect(rollups.some((x) => x.metric_name === ('pricing_total' as never))).toBe(false);
  });
});

describe('metrics retention — idempotent / replay-safe execution', () => {
  test('a second run rolls up nothing (already-rolled periods skipped)', async () => {
    const { backend } = memRetention(rawLedger());
    const first = await runSettlementMetricsRetention(ARGS, backend);
    const second = await runSettlementMetricsRetention(ARGS, backend);
    expect(first.rollupRowsWritten).toBe(10);
    expect(second.rollupRowsWritten).toBe(0);
    expect(second.periodsRolledUp).toBe(0);
  });

  test('running N times yields the same rollup set exactly once', async () => {
    const { backend, rollups } = memRetention(rawLedger());
    for (let i = 0; i < 4; i++) await runSettlementMetricsRetention(ARGS, backend);
    expect(rollups).toHaveLength(10); // 2 periods × 5 — appended once, not on every run
  });
});

describe('metrics retention — deterministic behavior', () => {
  test('two independent runs over the same ledger produce identical rollups', async () => {
    const a = memRetention(rawLedger());
    const b = memRetention(rawLedger());
    const ra = await runSettlementMetricsRetention(ARGS, a.backend);
    const rb = await runSettlementMetricsRetention(ARGS, b.backend);
    expect(rb).toEqual(ra);
    expect(b.rollups).toEqual(a.rollups);
  });
});

describe('metrics retention — aggregation fidelity', () => {
  test('rollup totals + the active period equal the full raw aggregate (exact)', async () => {
    const raw = rawLedger();
    const { backend, rollups } = memRetention(raw);
    await runSettlementMetricsRetention(ARGS, backend);

    // Full raw aggregate — the source of truth.
    const fullAggregate = await aggregateSettlementMetrics({ backend: memMetrics(raw) });

    // Reconstruct from rollups (closed periods) + raw rows of the active period.
    const reconstructed = Object.fromEntries(
      SETTLEMENT_METRIC_NAMES.map((n) => [n, 0]),
    ) as Record<string, number>;
    for (const r of rollups) reconstructed[r.metric_name] += r.total_delta;
    for (const row of raw) {
      const periodStart = Math.floor(Date.parse(row.observed_at) / HOUR) * HOUR;
      if (periodStart >= P_ACTIVE) reconstructed[row.metric_name] += row.delta;
    }
    // Retention loses NO fidelity — every metric total matches exactly.
    expect(reconstructed).toEqual(fullAggregate);
  });

  test('aggregateSettlementMetrics is deterministic — same ledger, same result', async () => {
    const raw = rawLedger();
    const a = await aggregateSettlementMetrics({ backend: memMetrics(raw) });
    const b = await aggregateSettlementMetrics({ backend: memMetrics(raw) });
    expect(b).toEqual(a);
  });
});

describe('metrics retention — hidden-pricing preservation', () => {
  test('the retention result and rollup rows carry no pricing fields', async () => {
    const { backend, rollups } = memRetention(rawLedger());
    const r = await runSettlementMetricsRetention(ARGS, backend);
    const serialized = JSON.stringify({ r, rollups }).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'revenue', 'subtotal', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
