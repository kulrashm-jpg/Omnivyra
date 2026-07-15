/**
 * Foundation Batch C — F-08 concurrency, F-09 retry budget, F-10 outbound
 * policy seam, F-11 DB conventions. Behavior-preservation contracts.
 */
import { mapWithConcurrency, definePool, listPools } from '../../../lib/platform/concurrency';
import { mapWithConcurrency as schedulerReexport } from '../../scheduler/schedulerBatching';
import {
  classifyForRetry, isRetryable, createOperationBudget, retryWithBudget, withTimeout, BudgetTimeoutError,
} from '../../../lib/platform/retryBudget';
import { configureOutboundAgents, outboundAgentPolicy } from '../../../lib/platform/outboundHttp';
import { cols, ESTIMATED_COUNT, encodeCursor, decodeCursor, keysetFilter, chunk } from '../../../lib/platform/dbConventions';
import { buildBaselineSnapshot, compareBaselines, type BaselineSnapshot } from '../../observability/baseline';
import { registry } from '../../observability/registry';

describe('F-08 concurrency kit', () => {
  test('schedulerBatching re-export IS the platform implementation (one impl)', () => {
    expect(schedulerReexport).toBe(mapWithConcurrency);
  });

  test('mapWithConcurrency preserves input order and captures per-item errors', async () => {
    const results = await mapWithConcurrency([30, 1, 20], 2, async (ms, i) => {
      if (i === 1) throw new Error('boom-1');
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(results[0]).toEqual({ ok: true, value: 60 });
    expect(results[1].ok).toBe(false);
    expect(results[1].error?.message).toBe('boom-1');
    expect(results[2]).toEqual({ ok: true, value: 40 });
  });

  test('pool enforces the limit; env override respected within bounds', async () => {
    const pool = definePool({ name: 'batchc-test', defaultLimit: 2, maxLimit: 8 });
    expect(pool.limit()).toBe(2);
    process.env.CONCURRENCY_BATCHC_TEST = '3';
    expect(pool.limit()).toBe(3);
    process.env.CONCURRENCY_BATCHC_TEST = '999'; // out of bounds → default
    expect(pool.limit()).toBe(2);
    delete process.env.CONCURRENCY_BATCHC_TEST;

    let inFlight = 0; let peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => pool.run(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    })));
    expect(peak).toBeLessThanOrEqual(2);
    expect(pool.stats().inFlight).toBe(0);
    expect(listPools().some((p) => p.name === 'batchc-test')).toBe(true);
  });

  test('pool releases slots on failure', async () => {
    const pool = definePool({ name: 'batchc-fail', defaultLimit: 1 });
    await expect(pool.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(pool.stats().inFlight).toBe(0);
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok'); // not deadlocked
  });
});

describe('F-09 retry budget', () => {
  test('classification is conservative (timeouts are NOT retryable)', () => {
    expect(classifyForRetry(Object.assign(new Error('x'), { status: 429 }))).toBe('retryable_transient');
    expect(classifyForRetry(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('retryable_transient');
    expect(classifyForRetry(Object.assign(new Error('x'), { status: 503 }))).toBe('retryable_transient');
    expect(classifyForRetry(new Error('request timed out'))).toBe('timeout');
    expect(classifyForRetry(Object.assign(new Error('x'), { status: 400 }))).toBe('non_retryable');
    expect(isRetryable(new Error('request timed out'))).toBe(false);
    expect(isRetryable(new Error('unexplained'))).toBe(false);
  });

  test('budget denies attempts past the ceilings and keeps a ledger', () => {
    const budget = createOperationBudget({ name: 'unit-op', maxAttempts: 2 });
    expect(budget.tryConsumeAttempt('layerA').allowed).toBe(true);
    expect(budget.tryConsumeAttempt('layerB').allowed).toBe(true);
    const third = budget.tryConsumeAttempt('layerA');
    expect(third).toMatchObject({ allowed: false, reason: 'budget_attempts_exhausted' });
    expect(budget.ledger().map((l) => l.layer)).toEqual(['layerA', 'layerB']);
  });

  test('retryWithBudget: transient errors retry, budget caps total attempts across layers', async () => {
    const budget = createOperationBudget({ name: 'unit-op-2', maxAttempts: 3 });
    let calls = 0;
    const result = await retryWithBudget(async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error('flaky'), { status: 503 });
      return 'ok';
    }, { budget, layer: 'L1', initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    // Only 1 attempt left in the shared budget — a second layer gets exactly one try.
    let l2calls = 0;
    await expect(retryWithBudget(async () => {
      l2calls++;
      throw Object.assign(new Error('still flaky'), { status: 503 });
    }, { budget, layer: 'L2', maxRetries: 5, initialDelayMs: 1 })).rejects.toThrow('still flaky');
    expect(l2calls).toBe(1);
  });

  test('non-retryable errors fail immediately; withTimeout bounds the await', async () => {
    const budget = createOperationBudget({ name: 'unit-op-3', maxAttempts: 10 });
    let calls = 0;
    await expect(retryWithBudget(async () => {
      calls++;
      throw Object.assign(new Error('bad input'), { status: 400 });
    }, { budget, layer: 'L', maxRetries: 5, initialDelayMs: 1 })).rejects.toThrow('bad input');
    expect(calls).toBe(1);

    await expect(withTimeout(() => new Promise((r) => setTimeout(r, 200)), 20, 'unit'))
      .rejects.toBeInstanceOf(BudgetTimeoutError);
    await expect(withTimeout(async () => 'fast', 100, 'unit')).resolves.toBe('fast');
  });
});

describe('F-10 outbound agent policy seam', () => {
  test('keep-alive is OFF by default (Batch C contract) and configurable', () => {
    expect(outboundAgentPolicy()).toEqual({ keepAlive: false });
    configureOutboundAgents({ keepAlive: true });
    expect(outboundAgentPolicy()).toEqual({ keepAlive: true });
    configureOutboundAgents({ keepAlive: false }); // restore the Batch C default
    expect(outboundAgentPolicy().keepAlive).toBe(false);
  });
});

describe('F-11 DB conventions', () => {
  test('cols() builds projections and rejects star', () => {
    expect(cols('id', 'status', 'created_at')).toBe('id,status,created_at');
    expect(() => cols('*')).toThrow();
    expect(() => cols()).toThrow();
  });

  test('ESTIMATED_COUNT is the supabase estimated head shape', () => {
    expect(ESTIMATED_COUNT).toEqual({ count: 'estimated', head: true });
  });

  test('cursor round-trips; malformed input → null (first page)', () => {
    const cursor = { value: '2026-07-15T00:00:00Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('garbage!!')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  test('keysetFilter emits the (col,id) tuple ordering for PostgREST', () => {
    const f = keysetFilter({ value: 'T1', id: 'X' }, 'created_at');
    expect(f).toBe('created_at.lt.T1,and(created_at.eq.T1,id.lt.X)');
    expect(keysetFilter({ value: 'T1', id: 'X' }, 'created_at', true)).toContain('created_at.gt.T1');
  });

  test('chunk() bounds .in() filters', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('W0-7 baseline framework (pure parts)', () => {
  test('buildBaselineSnapshot reflects live registry series', () => {
    registry.observe('baseline.test.duration_ms', 100, { route: '/x' });
    const snap = buildBaselineSnapshot('unit');
    expect(snap.v).toBe(1);
    expect(snap.label).toBe('unit');
    expect(snap.histograms.some((h) => h.name === 'baseline.test.duration_ms')).toBe(true);
  });

  test('compareBaselines flags regressions/improvements past threshold with min samples', () => {
    const mk = (p95: number, count = 100): BaselineSnapshot => ({
      v: 1, key: `k${p95}`, label: 'x', capturedAt: new Date().toISOString(),
      process: { kind: 'test', pid: 1, uptimeSec: 1 },
      meta: { series: 1, droppedSeries: 0, registryStartedAt: 0 },
      counters: [], gauges: [],
      histograms: [{ series: 's', name: 's', count, avg: p95, p50: p95, p95, p99: p95, max: p95 }],
    });
    const cmp = compareBaselines(mk(100), mk(150));
    expect(cmp.regressed.some((d) => d.metric === 'p95' && d.deltaPct === 50)).toBe(true);
    const cmp2 = compareBaselines(mk(100), mk(80));
    expect(cmp2.improved.length).toBeGreaterThan(0);
    // Below min sample count → judged as noise, not signal.
    const cmp3 = compareBaselines(mk(100, 5), mk(200, 5));
    expect(cmp3.regressed).toHaveLength(0);
  });
});
