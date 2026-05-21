/**
 * Live settlement retention/prune soak — runs the REAL retention / prune /
 * aggregate / lock logic against the LOCAL Supabase Postgres (127.0.0.1:54322).
 *
 * Every dependency is an injected pg-backed implementation, so the default
 * supabase client (and .env.local / production) is NEVER touched. SANDBOX /
 * local only. No live settlement, no wallet funding, no pricing.
 *
 * Run: npx tsx scripts/run-settlement-retention-soak.ts
 */

import { Client } from 'pg';
import {
  runSettlementMetricsRetention,
  pruneRolledSettlementMetrics,
  type RetentionBackend,
  type PruneBackend,
} from '../backend/services/billing/payments/settlementMetricsRetention';
import { aggregateSettlementMetrics, type MetricsBackend } from '../backend/services/billing/payments/settlementMetrics';
import {
  acquireSettlementLock,
  releaseSettlementLock,
  listSettlementLocks,
  type LockBackend,
  type LockVisibilityBackend,
} from '../backend/services/billing/payments/settlementRuntimeLock';

const H = 60 * 60 * 1000;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const noPricing = (label: string, obj: unknown): void => {
  const s = JSON.stringify(obj).toLowerCase();
  const leak = ['amount', 'price', 'pricing', 'revenue', 'invoice', 'subtotal'].find((f) => s.includes(`"${f}"`));
  check(`hidden-pricing: ${label}`, !leak, leak ? `LEAKED field "${leak}"` : 'no pricing fields');
};

async function main(): Promise<void> {
  const client = new Client({
    host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres',
  });
  await client.connect();

  // ── pg-backed dependency implementations ──────────────────────────────────
  const readRaw = async () => {
    const r = await client.query('select metric_name, delta, observed_at from settlement_operational_metrics');
    return r.rows.map((x) => ({ metric_name: x.metric_name, delta: Number(x.delta), observed_at: iso(x.observed_at) }));
  };
  const readRollups = async () => {
    const r = await client.query('select period_start, period_end, metric_name, total_delta, source_row_count from settlement_metrics_rollup');
    return r.rows.map((x) => ({
      period_start: iso(x.period_start), period_end: iso(x.period_end), metric_name: x.metric_name,
      total_delta: Number(x.total_delta), source_row_count: Number(x.source_row_count),
    }));
  };
  const retentionBackend: RetentionBackend = {
    readRawMetricRows: readRaw,
    readRolledPeriodStarts: async () => {
      const r = await client.query('select period_start from settlement_metrics_rollup');
      return new Set(r.rows.map((x) => iso(x.period_start)));
    },
    appendRollups: async (rows) => {
      for (const x of rows) {
        await client.query(
          `insert into settlement_metrics_rollup(period_start,period_end,metric_name,total_delta,source_row_count)
           values($1,$2,$3,$4,$5) on conflict (period_start,metric_name) do nothing`,
          [x.period_start, x.period_end, x.metric_name, x.total_delta, x.source_row_count],
        );
      }
    },
  };
  const pruneBackend: PruneBackend = {
    readRollupRows: readRollups,
    readRawMetricRows: readRaw,
    prunePeriods: async (periodStarts) => {
      const r = await client.query('select settlement_metrics_prune_rolled($1::timestamptz[]) as deleted', [periodStarts]);
      return Number(r.rows[0].deleted) || 0;
    },
  };
  const metricsBackend: MetricsBackend = {
    appendMetric: async (row) => {
      await client.query('insert into settlement_operational_metrics(metric_name,delta,source) values($1,$2,$3)',
        [row.metric_name, row.delta, row.source]);
    },
    readRawRows: readRaw,
    readRollupRows: async () => (await readRollups()).map((r) => ({
      period_start: r.period_start, period_end: r.period_end, metric_name: r.metric_name, total_delta: r.total_delta,
    })),
  };
  const lockBackend: LockBackend = {
    tryInsert: async (row) => {
      try {
        await client.query('insert into settlement_runtime_locks(lock_key,owner_token,acquired_at,expires_at) values($1,$2,$3,$4)',
          [row.lock_key, row.owner_token, row.acquired_at, row.expires_at]);
        return 'inserted';
      } catch (e: any) {
        if (e?.code === '23505') return 'conflict';
        throw e;
      }
    },
    tryClaimExpired: async (row, nowIso) => {
      const r = await client.query(
        'update settlement_runtime_locks set owner_token=$1,acquired_at=$2,expires_at=$3 where lock_key=$4 and expires_at<$5 returning lock_key',
        [row.owner_token, row.acquired_at, row.expires_at, row.lock_key, nowIso]);
      return (r.rowCount ?? 0) > 0;
    },
    remove: async (lockKey, ownerToken) => {
      await client.query('delete from settlement_runtime_locks where lock_key=$1 and owner_token=$2', [lockKey, ownerToken]);
    },
  };
  const lockVisibilityBackend: LockVisibilityBackend = {
    readLocks: async () => {
      const r = await client.query('select lock_key,owner_token,acquired_at,expires_at from settlement_runtime_locks');
      return { available: true, rows: r.rows.map((x) => ({
        lock_key: x.lock_key, owner_token: x.owner_token, acquired_at: iso(x.acquired_at), expires_at: iso(x.expires_at),
      })) };
    },
  };

  // ── clean slate ───────────────────────────────────────────────────────────
  await client.query('truncate settlement_operational_metrics, settlement_metrics_rollup, settlement_runtime_locks');

  // ── emit operational metrics across multiple time buckets ─────────────────
  const now = Date.now();
  const cur = Math.floor(now / H) * H;
  const B1 = cur - H;       // closed
  const B2 = cur - 2 * H;   // closed
  const emit = async (name: string, delta: number, ts: number) => {
    await client.query('insert into settlement_operational_metrics(metric_name,delta,source,observed_at) values($1,$2,$3,$4)',
      [name, delta, 'soak', new Date(ts).toISOString()]);
  };
  await emit('candidates_scanned', 5, B2 + 60_000);
  await emit('candidates_scanned', 3, B2 + 120_000);
  await emit('sessions_expired', 2, B2 + 180_000);
  await emit('candidates_scanned', 7, B1 + 60_000);
  await emit('stale_webhook_rejections', 1, B1 + 120_000);
  await emit('sessions_expired', 100, cur + 60_000); // active period

  // ── pre-prune aggregate (source of truth) ─────────────────────────────────
  const preAggregate = await aggregateSettlementMetrics({ backend: metricsBackend });
  check('pre-aggregate candidates_scanned=15', preAggregate.candidates_scanned === 15, JSON.stringify(preAggregate));
  check('pre-aggregate sessions_expired=102', preAggregate.sessions_expired === 102);

  // ── retention → prune → retention → prune ─────────────────────────────────
  const ret1 = await runSettlementMetricsRetention({ nowMs: now, periodMs: H }, retentionBackend);
  check('retention #1 rolled 2 closed periods', ret1.periodsRolledUp === 2, JSON.stringify(ret1));
  check('retention #1 wrote 10 rollup rows (2×5 zero-filled)', ret1.rollupRowsWritten === 10);

  const prune1 = await pruneRolledSettlementMetrics(pruneBackend);
  check('prune #1 eligible=2', prune1.eligiblePeriods === 2, JSON.stringify(prune1));
  check('prune #1 retired 5 raw rows', prune1.prunedRows === 5);
  check('prune #1 no partial/corrupt rejections', prune1.rejectedPartial === 0 && prune1.rejectedCorrupt === 0);

  const ret2 = await runSettlementMetricsRetention({ nowMs: now, periodMs: H }, retentionBackend);
  check('retention #2 rolled nothing (idempotent)', ret2.periodsRolledUp === 0 && ret2.rollupRowsWritten === 0, JSON.stringify(ret2));

  const prune2 = await pruneRolledSettlementMetrics(pruneBackend);
  check('prune #2 retired 0 rows (idempotent)', prune2.prunedRows === 0, JSON.stringify(prune2));
  check('prune #2 alreadyPruned=2', prune2.alreadyPruned === 2);

  // raw rows retired exactly once: 5 by prune1, 0 by prune2.
  check('fully-rolled raw rows retired exactly once', prune1.prunedRows + prune2.prunedRows === 5);

  // ── rollup totals preserved exactly ───────────────────────────────────────
  const rt = await client.query('select metric_name, sum(total_delta)::int as t from settlement_metrics_rollup group by metric_name');
  const rollupTotals: Record<string, number> = {};
  for (const r of rt.rows) rollupTotals[r.metric_name] = Number(r.t);
  check('rollup totals exact (candidates=15, sessions=2, stale=1)',
    rollupTotals.candidates_scanned === 15 && rollupTotals.sessions_expired === 2 && rollupTotals.stale_webhook_rejections === 1,
    JSON.stringify(rollupTotals));

  // ── optimized aggregate byte-identical pre/post prune ─────────────────────
  const postAggregate = await aggregateSettlementMetrics({ backend: metricsBackend });
  check('optimized aggregate byte-identical pre/post prune',
    JSON.stringify(postAggregate) === JSON.stringify(preAggregate),
    `pre=${JSON.stringify(preAggregate)} post=${JSON.stringify(postAggregate)}`);

  // ── append-only immutability ──────────────────────────────────────────────
  const expectFail = async (label: string, sql: string) => {
    try { await client.query(sql); check(label, false, 'NO error raised — immutability NOT enforced'); }
    catch (e: any) { check(label, true, `blocked: ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  await expectFail('UPDATE settlement_operational_metrics blocked',
    'update settlement_operational_metrics set delta = delta');
  await expectFail('UPDATE settlement_metrics_rollup blocked',
    'update settlement_metrics_rollup set total_delta = total_delta');
  await expectFail('ad-hoc DELETE settlement_operational_metrics blocked',
    'delete from settlement_operational_metrics where true');
  // sanctioned DELETE works — already proven: prune #1 retired 5 rows via the RPC.
  check('sanctioned DELETE via prune RPC works', prune1.prunedRows === 5, 'prune RPC retired 5 rows');

  // ── distributed lock ──────────────────────────────────────────────────────
  const tLock = Date.parse('2026-05-22T10:00:00.000Z');
  const a1 = await acquireSettlementLock('soak_sweep', { ttlMs: 60_000, nowMs: tLock, backend: lockBackend });
  const a2 = await acquireSettlementLock('soak_sweep', { ttlMs: 60_000, nowMs: tLock + 1_000, backend: lockBackend });
  check('overlapping acquire — only one wins', a1.acquired === true && a2.acquired === false);
  await releaseSettlementLock('soak_sweep', a1.ownerToken, { backend: lockBackend });
  const a3 = await acquireSettlementLock('soak_sweep', { ttlMs: 1_000, nowMs: tLock + 2_000, backend: lockBackend });
  const a4 = await acquireSettlementLock('soak_sweep', { ttlMs: 1_000, nowMs: tLock + 10_000, backend: lockBackend });
  check('stale lease reclaimed after TTL', a3.acquired === true && a4.acquired === true);
  const degraded = await acquireSettlementLock('soak_sweep', {
    backend: { tryInsert: async () => { throw new Error('table unreachable'); }, tryClaimExpired: async () => false, remove: async () => {} },
  });
  check('degraded/fail-open mode on lock-table failure', degraded.acquired === true && degraded.degraded === true);
  const vis = await listSettlementLocks({ nowMs: tLock + 10_500, backend: lockVisibilityBackend });
  check('lock visibility live (not degraded, holder surfaced)', vis.degraded === false && vis.locks.length >= 1,
    JSON.stringify(vis.locks[0] ?? {}));
  const visDegraded = await listSettlementLocks({ backend: { readLocks: async () => ({ available: false, rows: [] }) } });
  check('lock visibility degraded flag surfaces correctly', visDegraded.degraded === true);

  // ── hidden-pricing across every output ────────────────────────────────────
  noPricing('metrics aggregate', postAggregate);
  noPricing('retention output', ret1);
  noPricing('prune output', prune1);
  noPricing('lock visibility', vis);

  await client.query('truncate settlement_runtime_locks'); // tidy soak lock rows
  await client.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== SOAK SUMMARY: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) { console.error('FAILURES:', failed.map((f) => f.name)); process.exit(1); }
  console.log('ALL SOAK CHECKS PASSED');
}

main().catch((e) => { console.error('SOAK ERROR:', e); process.exit(1); });
