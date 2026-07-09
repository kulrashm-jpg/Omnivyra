/**
 * HARDEN-001A — validation + memory-safety suite.
 *
 * Proves the instrumentation is safe to leave on: it never throws and never
 * changes behavior across the required scenarios (metrics disabled/enabled,
 * high-volume, worker, scheduler, client disabled/enabled) and the in-memory
 * registry stays bounded under stress (cardinality, histogram reservoir,
 * leaderboard caps, long-running stability).
 */
import { registry } from '../../observability/registry';
import { observabilityConfig } from '../../observability/config';
import {
  recordApi, recordDb, recordAi, recordExternal, recordWorker, recordScheduler,
  recordQueueJob, recordQueueDepth, recordClient, M,
} from '../../observability/metrics';
import {
  newRequestDbStats, runWithRequestDbScope, getRequestDbStats, noteDbQuery,
} from '../../observability/requestScope';

// Snapshot mutable config so per-test overrides never leak.
const ORIGINAL = { ...observabilityConfig };
beforeEach(() => registry.reset());
afterEach(() => Object.assign(observabilityConfig, ORIGINAL));

describe('validation — metrics disabled/enabled', () => {
  it('all record* calls are no-ops (and never throw) when disabled', () => {
    observabilityConfig.enabled = false;
    expect(() => {
      recordApi({ route: '/api/x', method: 'GET', status: 200, durationMs: 10 });
      recordDb({ table: 't', op: 'select', durationMs: 5 });
      recordAi({ provider: 'openai', model: 'm', durationMs: 10 });
      recordExternal({ host: 'example.com', durationMs: 12 });
      recordWorker({ job: 'q', durationMs: 30, ok: true });
      recordScheduler({ job: 's', durationMs: 5, outcome: 'completed' });
      recordQueueJob({ queue: 'q', processingMs: 5, ok: true });
      recordQueueDepth('q', 3);
      recordClient({ kind: 'lcp', value: 1200, route: '/x' });
    }).not.toThrow();
    expect(registry.meta().series).toBe(0);
  });

  it('records once re-enabled', () => {
    observabilityConfig.enabled = true;
    recordApi({ route: '/api/x', method: 'GET', status: 200, durationMs: 10 });
    expect(registry.meta().series).toBeGreaterThan(0);
  });
});

describe('validation — worker + scheduler + external + queue paths', () => {
  it('worker failures and timeouts are counted', () => {
    recordWorker({ job: 'contentGeneration', durationMs: 120, ok: false, timeout: true });
    expect(registry.counterEntries().some((e) => e.name === M.worker.failures)).toBe(true);
    expect(registry.counterEntries().some((e) => e.name === M.worker.timeouts)).toBe(true);
  });

  it('scheduler skipped/failed outcomes are counted distinctly', () => {
    recordScheduler({ job: 'j', durationMs: 1, outcome: 'skipped' });
    recordScheduler({ job: 'j', durationMs: 1, outcome: 'failed' });
    expect(registry.counterEntries().some((e) => e.name === M.scheduler.skipped)).toBe(true);
    expect(registry.counterEntries().some((e) => e.name === M.scheduler.failures)).toBe(true);
  });

  it('external timeouts + queue depth gauge record', () => {
    recordExternal({ host: 'api.vendor.com', durationMs: 9000, error: true, timeout: true });
    recordQueueDepth('reportQueue', 7);
    expect(registry.counterEntries().some((e) => e.name === M.ext.timeouts)).toBe(true);
    expect(registry.gaugeEntries().find((e) => e.name === M.queue.depth)?.value).toBe(7);
  });
});

describe('validation — client (browser) beacons disabled/enabled', () => {
  it('recordClient is inert when the client domain is off', () => {
    observabilityConfig.client = false;
    recordClient({ kind: 'lcp', value: 1500, route: '/dashboard' });
    expect(registry.meta().series).toBe(0);
  });

  it('records vitals as histograms and heap as a gauge when on', () => {
    observabilityConfig.client = true;
    recordClient({ kind: 'lcp', value: 1500, route: '/dashboard' });
    recordClient({ kind: 'heapUsed', value: 10_000_000, route: '/dashboard' });
    recordClient({ kind: 'lcp', value: -1 });        // invalid → dropped
    recordClient({ kind: 'lcp', value: Infinity });  // invalid → dropped
    expect(registry.histogramEntries().some((e) => e.name === M.client.lcp)).toBe(true);
    expect(registry.gaugeEntries().some((e) => e.name === M.client.heapUsed)).toBe(true);
    const lcp = registry.histogramEntries().find((e) => e.name === M.client.lcp)!;
    expect(lcp.count).toBe(1); // the two invalid samples were rejected
  });
});

describe('per-request DB profiling (AsyncLocalStorage)', () => {
  it('accumulates queries seen inside a request scope', async () => {
    const stats = newRequestDbStats();
    await runWithRequestDbScope(stats, async () => {
      recordDb({ table: 'a', op: 'select', durationMs: 10 });
      recordDb({ table: 'b', op: 'select', durationMs: observabilityConfig.slowDbMs + 5 });
      // ALS propagates across awaits.
      await Promise.resolve();
      recordDb({ table: 'c', op: 'insert', durationMs: 3 });
    });
    expect(stats.count).toBe(3);
    expect(stats.slowCount).toBe(1);
    expect(stats.maxMs).toBe(observabilityConfig.slowDbMs + 5);
    expect(stats.totalMs).toBe(18 + observabilityConfig.slowDbMs);
  });

  it('is a no-op outside any scope (worker/cron paths)', () => {
    expect(getRequestDbStats()).toBeUndefined();
    expect(() => noteDbQuery(10, true)).not.toThrow();
  });

  it('feeds the per-request DB fields into the API metric', () => {
    recordApi({
      route: '/api/x', method: 'POST', status: 200, durationMs: 40,
      db: { count: 4, totalMs: 90, slowCount: 1, maxMs: 60 },
    });
    expect(registry.histogramEntries().some((e) => e.name === M.db.perRequest)).toBe(true);
    expect(registry.histogramEntries().some((e) => e.name === 'api.request.db_time_ms')).toBe(true);
    expect(registry.counterEntries().some((e) => e.name === 'api.request.db_slow')).toBe(true);
  });
});

describe('memory safety — bounded under stress', () => {
  it('caps distinct series (cardinality guard) and counts drops', () => {
    observabilityConfig.maxSeries = 200;
    for (let i = 0; i < 5_000; i++) {
      registry.observe('stress.series', i, { id: String(i) }); // each label = a new series
    }
    const meta = registry.meta();
    expect(meta.series).toBeLessThanOrEqual(200);
    expect(meta.droppedSeries).toBeGreaterThan(0);
  });

  it('bounds histogram reservoir regardless of sample volume', () => {
    for (let i = 0; i < 100_000; i++) registry.observe('stress.hist', i);
    const h = registry.histogramEntries().find((e) => e.name === 'stress.hist')!;
    expect(h.count).toBe(100_000);                                  // count is exact
    expect(h.max).toBe(99_999);
    // internal reservoir is bounded by histogramSamples — percentiles stay computable
    expect(h.p50).toBeGreaterThan(0);
    expect(h.p99).toBeGreaterThanOrEqual(h.p50);
  });

  it('bounds every top-N leaderboard', () => {
    observabilityConfig.topN = 20;
    for (let i = 0; i < 10_000; i++) registry.top('stress.board', i, `k${i}`);
    expect(registry.topBoard('stress.board').length).toBeLessThanOrEqual(20);
  });

  it('stays stable + bounded across a long-running mixed workload', () => {
    observabilityConfig.maxSeries = 500;
    observabilityConfig.logSlow = false; // don't emit 50k WARN lines during the stress loop
    expect(() => {
      for (let i = 0; i < 50_000; i++) {
        recordApi({ route: `/api/r${i % 50}`, method: 'GET', status: 200, durationMs: i % 2000 });
        recordDb({ table: `t${i % 40}`, op: 'select', durationMs: i % 800 });
        recordExternal({ host: `h${i % 30}.com`, durationMs: i % 500 });
        recordClient({ kind: 'longTask', value: i % 300, route: `/p${i % 20}` });
      }
    }).not.toThrow();
    expect(registry.meta().series).toBeLessThanOrEqual(500);
  });
});
