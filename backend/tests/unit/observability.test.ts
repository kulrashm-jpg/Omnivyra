/**
 * HARDEN-001 — observability foundation unit tests.
 *
 * Verifies the registry math, the public record* API, the FAIL-SAFE contract
 * (recording never throws, never breaks the caller), the transparent DB timing
 * proxy (preserves chaining + results), route normalization, and the snapshot
 * shape.
 */
import { registry } from '../../observability/registry';
import {
  recordApi, recordDb, recordAi, recordCache, recordScheduler, time, startTimer, M, BOARD,
} from '../../observability/metrics';
import { observeTable, timedQuery } from '../../observability/dbObservability';
import { getObservabilitySnapshot } from '../../observability/snapshot';
import { normalizeRoute } from '../../observability/apiObservability';

beforeEach(() => registry.reset());

describe('registry', () => {
  it('accumulates counters, gauges, and histogram percentiles', () => {
    registry.incr('c', 1, { a: '1' });
    registry.incr('c', 2, { a: '1' });
    registry.gauge('g', 42);
    for (let i = 1; i <= 100; i++) registry.observe('h', i);

    expect(registry.counterEntries().find((e) => e.series.startsWith('c'))?.value).toBe(3);
    expect(registry.gaugeEntries().find((e) => e.name === 'g')?.value).toBe(42);
    const h = registry.histogramEntries().find((e) => e.name === 'h')!;
    expect(h.count).toBe(100);
    expect(h.min).toBe(1);
    expect(h.max).toBe(100);
    expect(h.avg).toBeCloseTo(50.5, 0);
    expect(h.p95).toBeGreaterThanOrEqual(h.p50);
  });

  it('keeps top-N leaderboards bounded and sorted desc', () => {
    for (let i = 0; i < 50; i++) registry.top('board', i, `k${i}`);
    const board = registry.topBoard('board');
    expect(board.length).toBeLessThanOrEqual(20);
    expect(board[0].value).toBeGreaterThanOrEqual(board[board.length - 1].value);
    expect(board[0].value).toBe(49);
  });

  it('never throws on bad input (fail-safe)', () => {
    expect(() => registry.observe('h', NaN)).not.toThrow();
    expect(() => registry.observe('h', Infinity)).not.toThrow();
    expect(() => registry.incr('c', 1, { x: undefined, y: null })).not.toThrow();
  });
});

describe('public record API', () => {
  it('records API request metrics + flags server errors', () => {
    recordApi({ route: '/api/x', method: 'GET', status: 200, durationMs: 10, resBytes: 500 });
    recordApi({ route: '/api/x', method: 'GET', status: 500, durationMs: 20 });
    expect(registry.counterEntries().some((e) => e.name === M.api.requests)).toBe(true);
    expect(registry.counterEntries().some((e) => e.name === M.api.errors)).toBe(true);
    expect(registry.topBoard(BOARD.largestPayload).length).toBeGreaterThan(0);
  });

  it('records DB + AI + cache metrics', () => {
    recordDb({ table: 'scheduled_posts', op: 'select', durationMs: 5, rows: 3 });
    recordAi({ provider: 'openai', model: 'gpt-4o-mini', durationMs: 120, tokensIn: 10, tokensOut: 20 });
    recordCache({ cache: 'ai_response', hit: true });
    recordCache({ cache: 'ai_response', hit: false });
    recordScheduler({ job: 'signal_clustering', durationMs: 33, outcome: 'completed' });
    expect(registry.histogramEntries().some((e) => e.name === M.db.duration)).toBe(true);
    expect(registry.histogramEntries().some((e) => e.name === M.ai.duration)).toBe(true);
    expect(registry.counterEntries().some((e) => e.name === M.cache.hit)).toBe(true);
    expect(registry.histogramEntries().some((e) => e.name === M.scheduler.duration)).toBe(true);
  });
});

describe('timing helpers', () => {
  it('startTimer measures elapsed', () => {
    const done = startTimer();
    expect(done()).toBeGreaterThanOrEqual(0);
  });

  it('time() observes and re-throws underlying errors', async () => {
    await expect(time('op', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(registry.histogramEntries().some((e) => e.name === 'op')).toBe(true);
  });
});

describe('DB timing proxy (observeTable)', () => {
  function mockBuilder(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF);
    return b;
  }

  it('preserves chaining + result and records rows', async () => {
    const proxied = observeTable('daily_content_plans', mockBuilder([{ a: 1 }, { a: 2 }]) as any) as any;
    const result = await proxied.select().eq('x', 1);
    expect(result.data).toHaveLength(2);
    const dbHist = registry.histogramEntries().find((e) => e.name === M.db.duration);
    expect(dbHist?.count).toBe(1);
  });

  it('records error flag when PostgREST returns an error', async () => {
    const b: Record<string, unknown> = {};
    b.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'x' } }).then(onF);
    await (observeTable('t', b as any) as any);
    expect(registry.counterEntries().some((e) => e.name === M.db.errors)).toBe(true);
  });

  it('timedQuery times a promise and forwards its value', async () => {
    const out = await timedQuery('t', 'select', Promise.resolve({ data: [1, 2, 3], error: null }));
    expect((out as { data: number[] }).data).toHaveLength(3);
  });
});

describe('route normalization', () => {
  it('collapses ids to :id', () => {
    expect(normalizeRoute('/api/reports/3f9c1e2a-1111-2222-3333-444455556666?x=1')).toBe('/api/reports/:id');
    expect(normalizeRoute('/api/campaigns/12345')).toBe('/api/campaigns/:id');
    expect(normalizeRoute('/api/calendar/activity-events')).toBe('/api/calendar/activity-events');
  });
});

describe('snapshot', () => {
  it('produces a dashboard-ready shape with computed averages', () => {
    recordApi({ route: '/api/x', method: 'GET', status: 200, durationMs: 100 });
    recordApi({ route: '/api/x', method: 'GET', status: 200, durationMs: 300 });
    recordDb({ table: 't', op: 'select', durationMs: 50, rows: 1 });
    const snap = getObservabilitySnapshot();
    expect(snap.averages.apiLatencyMs).toBeCloseTo(200, 0);
    expect(snap.averages.apiRequests).toBe(2);
    expect(snap.averages.dbQueries).toBe(1);
    expect(snap.config.enabled).toBe(true);
    expect(Array.isArray(snap.histograms)).toBe(true);
    expect(snap.leaderboards).toBeDefined();
  });
});
