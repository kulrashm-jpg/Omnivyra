/**
 * Unit tests for the operational-maturity bundle.
 *
 * Covers (Redis mocked where needed):
 *   - plannerTelemetry: counter / histogram / gauge emit + snapshot reset
 *   - plannerTracing:   span recording + W3C traceparent round-trip
 *   - plannerChaosHarness: scenario lifecycle (inject/recover/assert, prod-safety)
 *   - plannerRealtimeTransport: subscribe → publish → unsubscribe + flood eviction
 */

// ─────────────────────────────────────────────────────────────────────────
// Redis mock
// ─────────────────────────────────────────────────────────────────────────
class FakeRedis {
  private kv = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private streams = new Map<string, Array<[string, string[]]>>();
  status = 'ready' as const;
  publish = async (_c: string, _m: string): Promise<number> => 1;
  psubscribe = async (_p: string): Promise<unknown> => undefined;
  punsubscribe = async (_p: string): Promise<unknown> => undefined;
  on(_e: string, _h: (...args: unknown[]) => void): void { /* noop */ }
  async get(k: string): Promise<string | null> { return this.kv.get(k) ?? null; }
  async set(k: string, v: string): Promise<'OK'> { this.kv.set(k, v); return 'OK'; }
  async hget(k: string, f: string): Promise<string | null> { return this.hashes.get(k)?.get(f) ?? null; }
  async hset(k: string, ...args: any[]): Promise<number> {
    const h = this.hashes.get(k) ?? new Map<string, string>();
    if (args.length === 1 && typeof args[0] === 'object') {
      for (const [hk, hv] of Object.entries(args[0])) h.set(hk, String(hv));
    } else {
      for (let i = 0; i + 1 < args.length; i += 2) h.set(args[i], String(args[i + 1]));
    }
    this.hashes.set(k, h);
    return 1;
  }
  async pexpire(_k: string, _t: number): Promise<number> { return 1; }
  async xadd(s: string, ..._args: string[]): Promise<string> {
    const arr = this.streams.get(s) ?? [];
    const id = `${Date.now()}-${arr.length}`;
    arr.push([id, []]); this.streams.set(s, arr);
    return id;
  }
  async xrange(_s: string, _a: string, _b: string, _kw?: string, _c?: string): Promise<Array<[string, string[]]>> { return []; }
  async xrevrange(_s: string, _a: string, _b: string, _kw?: string, _c?: string): Promise<Array<[string, string[]]>> { return []; }
  multi() {
    const ops: Array<[string, unknown[]]> = [];
    const m = {
      zadd: (k: string, score: number, member: string) => { ops.push(['zadd', [k, score, member]]); return m; },
      zremrangebyscore: (k: string, _a: string | number, _b: string | number) => { ops.push(['zremrangebyscore', [k]]); return m; },
      pexpire: (k: string, t: number) => { ops.push(['pexpire', [k, t]]); return m; },
      zcard: (k: string) => { ops.push(['zcard', [k]]); return m; },
      hset: (k: string, payload: Record<string, unknown>) => { ops.push(['hset', [k, payload]]); return m; },
      hincrby: (k: string, f: string, n: number) => { ops.push(['hincrby', [k, f, n]]); return m; },
      exec: async () => {
        // Mirror the writes into our store for follow-up reads.
        for (const [op, args] of ops) {
          if (op === 'zadd') {
            const [key, score, member] = args as [string, number, string];
            const z = this.zsets.get(key) ?? new Map<string, number>();
            z.set(member, score);
            this.zsets.set(key, z);
          }
        }
        return ops.map(() => [null, 1]);
      },
    };
    return m;
  }
}

const fakeRedis = new FakeRedis();
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => fakeRedis as any,
}));

import {
  counter, histogramMs, gauge, takeSnapshot, timed,
  __resetTelemetryForTests,
} from '../../services/plannerTelemetry';
import {
  withSpan, currentSpanContext, propagateContextToEnvelope,
  restoreContextFromEnvelope, runInContext, getRecentSpansForTests,
  __resetTracingForTests,
} from '../../services/plannerTracing';
import {
  runScenario, runScenarios, defaultScenarios, type ChaosScenario,
} from '../../services/plannerChaosHarness';
import {
  subscribe, publish, snapshot as realtimeSnapshot, __resetForTests as resetRealtime,
} from '../../services/plannerRealtimeTransport';

// ─────────────────────────────────────────────────────────────────────────
// Telemetry
// ─────────────────────────────────────────────────────────────────────────
describe('plannerTelemetry', () => {
  beforeEach(() => { __resetTelemetryForTests(); });

  test('counter emit + snapshot includes the increment', () => {
    counter('planner_sse_disconnect_rate', 1, { reason: 'client_close' });
    counter('planner_sse_disconnect_rate', 1, { reason: 'client_close' });
    const snap = takeSnapshot({ resetAfter: false });
    const row = snap.counters.find((c) => c.name === 'planner_sse_disconnect_rate');
    expect(row).toBeDefined();
    expect(row?.value).toBe(2);
  });

  test('histogram observes values + computes p50/p95/p99', () => {
    for (let i = 1; i <= 100; i++) {
      histogramMs('planner_provider_latency_ms', i, { provider: 'openai', op: 'test' });
    }
    const snap = takeSnapshot({ resetAfter: false });
    const h = snap.histograms.find((x) => x.name === 'planner_provider_latency_ms');
    expect(h).toBeDefined();
    expect(h?.count).toBe(100);
    expect(h?.p50).toBeGreaterThanOrEqual(40);
    expect(h?.p50).toBeLessThanOrEqual(60);
    expect(h?.p95).toBeGreaterThanOrEqual(90);
    expect(h?.p99).toBeGreaterThanOrEqual(95);
  });

  test('gauge replaces value (does not sum)', () => {
    gauge('planner_sse_connections_active', 5);
    gauge('planner_sse_connections_active', 12);
    const snap = takeSnapshot({ resetAfter: false });
    const g = snap.gauges.find((x) => x.name === 'planner_sse_connections_active');
    expect(g?.value).toBe(12);
  });

  test('snapshot resets counters + histograms when resetAfter=true', () => {
    counter('planner_sse_disconnect_rate', 5, { reason: 'client_close' });
    takeSnapshot({ resetAfter: true });
    const snap = takeSnapshot({ resetAfter: false });
    expect(snap.counters.length).toBe(0);
  });

  test('unknown metric name silently dropped', () => {
    counter('not_a_real_metric' as never, 1);
    const snap = takeSnapshot({ resetAfter: false });
    expect(snap.counters.find((c) => c.name === 'not_a_real_metric')).toBeUndefined();
  });

  test('unknown label keys dropped (low-cardinality enforcement)', () => {
    counter('planner_sse_disconnect_rate', 1, { reason: 'client_close', user_id: 'high-card-value' });
    const snap = takeSnapshot({ resetAfter: false });
    const row = snap.counters.find((c) => c.name === 'planner_sse_disconnect_rate');
    expect(row?.labels).not.toContain('user_id');
    expect(row?.labels).toContain('reason=client_close');
  });

  test('timed() observes async durations', async () => {
    await timed('planner_provider_latency_ms', async () => {
      await new Promise((r) => setTimeout(r, 20));
    }, { provider: 'openai', op: 'test' });
    const snap = takeSnapshot({ resetAfter: false });
    const h = snap.histograms.find((x) => x.name === 'planner_provider_latency_ms');
    expect(h?.count).toBe(1);
    expect(h?.max).toBeGreaterThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tracing
// ─────────────────────────────────────────────────────────────────────────
describe('plannerTracing', () => {
  beforeEach(() => {
    __resetTracingForTests();
    process.env.PLANNER_TRACE_SAMPLE_RATE = '1.0'; // sample everything
  });

  test('withSpan records a span when sampled', async () => {
    await withSpan('test-op', async () => undefined, { kind: 'internal', attributes: { foo: 'bar' } });
    const spans = getRecentSpansForTests();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.find((s) => s.name === 'test-op')).toBeDefined();
    expect(spans.find((s) => s.name === 'test-op')?.attributes.foo).toBe('bar');
  });

  test('child span inherits parent traceId', async () => {
    let childCtxTraceId = '';
    let parentCtxTraceId = '';
    await withSpan('parent', async () => {
      parentCtxTraceId = currentSpanContext()?.traceId ?? '';
      await withSpan('child', async () => {
        childCtxTraceId = currentSpanContext()?.traceId ?? '';
      });
    });
    expect(parentCtxTraceId).toBeTruthy();
    expect(childCtxTraceId).toBe(parentCtxTraceId);
  });

  test('propagateContextToEnvelope + restoreContextFromEnvelope round-trips W3C', async () => {
    let restoredTraceId = '';
    await withSpan('outer', async () => {
      const env = propagateContextToEnvelope({ campaign_id: 'c-1' });
      expect(env.__traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
      // Simulate cross-worker consumer side.
      const restored = restoreContextFromEnvelope(env);
      expect(restored).not.toBeNull();
      if (restored) {
        await runInContext(restored, async () => {
          await withSpan('downstream', async () => {
            restoredTraceId = currentSpanContext()?.traceId ?? '';
          });
        });
      }
    });
    expect(restoredTraceId).toBeTruthy();
  });

  test('thrown errors are recorded on the span', async () => {
    await expect(
      withSpan('fail-op', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    const spans = getRecentSpansForTests();
    const s = spans.find((x) => x.name === 'fail-op');
    expect(s?.exception_message).toBe('boom');
  });

  test('sampling rate 0 produces no recorded spans', async () => {
    process.env.PLANNER_TRACE_SAMPLE_RATE = '0';
    __resetTracingForTests();
    await withSpan('not-sampled', async () => undefined);
    expect(getRecentSpansForTests().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chaos harness
// ─────────────────────────────────────────────────────────────────────────
describe('plannerChaosHarness', () => {
  beforeEach(() => {
    process.env.PLANNER_CHAOS_ENABLED = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('runScenario calls inject → assert(s) → recover', async () => {
    const log: string[] = [];
    const scenario: ChaosScenario = {
      name: 's', category: 'redis_outage',
      description: '', prodSafe: false,
      inject:  async () => { log.push('inject'); },
      recover: async () => { log.push('recover'); },
      assertRecovered: async () => { log.push('assert'); return { ok: true, observations: [] }; },
      assertConvergenceMs: 10, assertTimeoutMs: 200, assertPollMs: 10,
    };
    const r = await runScenario(scenario);
    expect(r.passed).toBe(true);
    // Inject runs first, recover runs last. Assert runs at least once but
    // can run multiple times during convergence polling — don't assert
    // exact count.
    expect(log[0]).toBe('inject');
    expect(log[log.length - 1]).toBe('recover');
    expect(log).toContain('assert');
  });

  test('recover always runs even when assert fails', async () => {
    let recovered = false;
    const scenario: ChaosScenario = {
      name: 's2', category: 'redis_outage',
      description: '', prodSafe: false,
      inject: async () => undefined,
      recover: async () => { recovered = true; },
      assertRecovered: async () => ({ ok: false, observations: ['never'] }),
      assertTimeoutMs: 50, assertPollMs: 10, assertConvergenceMs: 10,
    };
    const r = await runScenario(scenario);
    expect(r.passed).toBe(false);
    expect(recovered).toBe(true);
  });

  test('refuses to run when PLANNER_CHAOS_ENABLED is false', async () => {
    process.env.PLANNER_CHAOS_ENABLED = 'false';
    const r = await runScenario({
      name: 's3', category: 'redis_outage', description: '',
      inject: async () => undefined, recover: async () => undefined,
      assertRecovered: async () => ({ ok: true, observations: [] }),
    });
    expect(r.passed).toBe(false);
    expect(r.error).toBe('chaos_disabled');
  });

  test('refuses non-prod-safe scenarios in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PLANNER_CHAOS_ENABLED = 'true';
    process.env.PLANNER_CHAOS_ALLOW_PRODUCTION = 'true';
    const r = await runScenario({
      name: 's4', category: 'redis_outage', description: '',
      prodSafe: false,
      inject: async () => undefined, recover: async () => undefined,
      assertRecovered: async () => ({ ok: true, observations: [] }),
    });
    expect(r.passed).toBe(false);
    expect(r.error).toBe('scenario_not_prod_safe');
    process.env.NODE_ENV = 'test';
    delete process.env.PLANNER_CHAOS_ALLOW_PRODUCTION;
  });

  test('runScenarios returns stability_score', async () => {
    const all = [
      { name: 'pass', category: 'redis_outage' as const, description: '',
        inject: async () => undefined, recover: async () => undefined,
        assertRecovered: async () => ({ ok: true, observations: [] }),
        assertConvergenceMs: 10, assertTimeoutMs: 50, assertPollMs: 10 },
      { name: 'fail', category: 'redis_outage' as const, description: '',
        inject: async () => undefined, recover: async () => undefined,
        assertRecovered: async () => ({ ok: false, observations: [] }),
        assertConvergenceMs: 10, assertTimeoutMs: 30, assertPollMs: 10 },
    ];
    const report = await runScenarios(all);
    expect(report.scenarios.length).toBe(2);
    expect(report.stability_score).toBe(0.5);
    expect(report.remaining_instability_windows.length).toBe(1);
    expect(report.remaining_instability_windows[0].name).toBe('fail');
  });

  test('defaultScenarios is non-empty + every entry has a name', () => {
    expect(defaultScenarios.length).toBeGreaterThan(0);
    for (const s of defaultScenarios) expect(s.name).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Realtime transport
// ─────────────────────────────────────────────────────────────────────────
describe('plannerRealtimeTransport', () => {
  beforeEach(() => {
    process.env.PLANNER_REALTIME_TRANSPORT_ENABLED = 'true';
    process.env.PLANNER_REALTIME_MAX_PER_CAMPAIGN = '3';
    process.env.PLANNER_REALTIME_MAX_PER_INSTANCE = '5';
    resetRealtime();
  });

  test('subscribe → publish dispatches to local connection', async () => {
    const received: unknown[] = [];
    const { unsubscribe, fellBackToPolling } = subscribe({
      campaignId: 'c-1',
      send: (e) => received.push(e),
      close: () => undefined,
    });
    expect(fellBackToPolling).toBe(false);
    await publish({
      id: 'e-1', type: 'plan_created', campaign_id: 'c-1', ts: Date.now(), payload: {},
    });
    expect(received.length).toBe(1);
    unsubscribe();
  });

  test('per-campaign cap rejects connections beyond limit', () => {
    const closes: string[] = [];
    const conns = [] as ReturnType<typeof subscribe>[];
    for (let i = 0; i < 5; i++) {
      conns.push(subscribe({
        campaignId: 'c-cap',
        send: () => undefined,
        close: (r) => closes.push(r),
      }));
    }
    // The 4th and 5th should be marked as falling back to polling.
    const beyondCap = conns.slice(3).filter((c) => c.fellBackToPolling);
    expect(beyondCap.length).toBe(2);
    for (const c of conns) c.unsubscribe();
  });

  test('snapshot exposes per-campaign connection counts', () => {
    const a = subscribe({ campaignId: 'c-x', send: () => undefined, close: () => undefined });
    const b = subscribe({ campaignId: 'c-y', send: () => undefined, close: () => undefined });
    const snap = realtimeSnapshot();
    expect(snap.total_connections).toBe(2);
    expect(snap.per_campaign.find((p) => p.campaign_id === 'c-x')?.connections).toBe(1);
    a.unsubscribe();
    b.unsubscribe();
  });

  test('unsubscribe removes connection from the registry', () => {
    const { unsubscribe } = subscribe({
      campaignId: 'c-rm', send: () => undefined, close: () => undefined,
    });
    expect(realtimeSnapshot().total_connections).toBe(1);
    unsubscribe();
    expect(realtimeSnapshot().total_connections).toBe(0);
  });
});
