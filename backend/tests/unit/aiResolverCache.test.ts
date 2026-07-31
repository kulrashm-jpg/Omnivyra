/**
 * AI-ORCH 2C — ResolverCache: read-through, deterministic keys, generation
 * invalidation, single-flight, TTL + stale-while-revalidate, refresh-failure serves
 * stale, cache-unavailable fallback, warm-up, LRU eviction, metrics.
 */
import { ResolverCache, buildResolverCacheKey } from '../../services/aiOrchestration/resolverCache';
import type { ResolverInput, ResolverDeps, ResolverOutput } from '../../services/aiOrchestration/configurationResolver';

const DEPS = {} as ResolverDeps; // ignored — the resolver is injected.
const input = (o: Partial<ResolverInput> = {}): ResolverInput => ({ capabilityId: 'CONTENT_WRITER', orgId: 'org1', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini', ...o });

function out(fp = 'sha256:v1:aaa'): ResolverOutput {
  return {
    plan: { capabilityId: 'CONTENT_WRITER', model: { provider: 'openai', model: 'gpt-4o-mini' }, params: {}, reliability: {}, limits: {}, caching: {}, source: 'platform_default', configFingerprint: fp } as any,
    metadata: { resolutionSource: 'platform_default' } as any,
    trace: { steps: [] },
  };
}

describe('ResolverCache — read-through + determinism', () => {
  test('deterministic, immutable keys', () => {
    expect(buildResolverCacheKey(input(), 5)).toBe(buildResolverCacheKey(input(), 5));
    expect(buildResolverCacheKey(input(), 5)).not.toBe(buildResolverCacheKey(input(), 6));
  });

  test('miss then hit — resolver called once', async () => {
    let calls = 0;
    const cache = new ResolverCache({ resolver: async () => { calls++; return out(); } });
    const a = await cache.get(input(), DEPS, 1);
    const b = await cache.get(input(), DEPS, 1);
    expect(a.source).toBe('miss');
    expect(b.source).toBe('hit');
    expect(calls).toBe(1);
    const m = cache.getMetrics();
    expect(m.hits).toBe(1); expect(m.misses).toBe(1); expect(m.hitRate).toBe(0.5);
  });

  test('same plan returned on hit (no execution change)', async () => {
    const cache = new ResolverCache({ resolver: async () => out('sha256:v1:fixed') });
    const a = await cache.get(input(), DEPS, 1);
    const b = await cache.get(input(), DEPS, 1);
    expect(b.plan.configFingerprint).toBe(a.plan.configFingerprint);
  });
});

describe('ResolverCache — invalidation', () => {
  test('generation change invalidates prior entries (correct invalidation)', async () => {
    let calls = 0;
    const cache = new ResolverCache({ resolver: async () => { calls++; return out(); } });
    await cache.get(input(), DEPS, 'gen-1');   // miss
    await cache.get(input(), DEPS, 'gen-1');   // hit
    const c = await cache.get(input(), DEPS, 'gen-2'); // new generation → miss (invalidated)
    expect(c.source).toBe('miss');
    expect(calls).toBe(2);
    expect(cache.getMetrics().invalidations).toBeGreaterThanOrEqual(1);
  });

  test('manual invalidateAll drops everything', async () => {
    const cache = new ResolverCache({ resolver: async () => out() });
    await cache.get(input(), DEPS, 1);
    cache.invalidateAll();
    const again = await cache.get(input(), DEPS, 1);
    expect(again.source).toBe('miss');
  });
});

describe('ResolverCache — single-flight', () => {
  test('concurrent misses share one resolution', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const cache = new ResolverCache({ resolver: async () => { calls++; await gate; return out(); } });
    const p1 = cache.get(input(), DEPS, 1);
    const p2 = cache.get(input(), DEPS, 1);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect([r1.source, r2.source]).toContain('single-flight');
    expect(cache.getMetrics().singleFlightMerges).toBe(1);
  });
});

describe('ResolverCache — TTL + stale-while-revalidate', () => {
  test('fresh → stale (serve + refresh) → refresh updates entry', async () => {
    let t = 0;
    let calls = 0;
    const cache = new ResolverCache({ ttlMs: 100, maxAgeMs: 1000, now: () => t, resolver: async () => { calls++; return out(`fp-${calls}`); } });
    const miss = await cache.get(input(), DEPS, 1);   // t=0 miss (calls=1)
    expect(miss.source).toBe('miss');
    t = 50;
    expect((await cache.get(input(), DEPS, 1)).source).toBe('hit');   // fresh
    t = 200;                                                          // stale window
    const stale = await cache.get(input(), DEPS, 1);
    expect(stale.source).toBe('stale');
    await new Promise((r) => setImmediate(r)); // let background refresh run
    expect(calls).toBe(2);                     // refresh happened
    expect(cache.getMetrics().staleServes).toBe(1);
    expect(cache.getMetrics().refreshes).toBe(1);
  });

  test('refresh failure serves the existing valid entry (never fails execution)', async () => {
    let t = 0; let calls = 0;
    const cache = new ResolverCache({ ttlMs: 100, maxAgeMs: 1000, now: () => t, resolver: async () => { calls++; if (calls === 2) throw new Error('refresh boom'); return out('fp-1'); } });
    await cache.get(input(), DEPS, 1);   // store fp-1
    t = 200;
    const stale = await cache.get(input(), DEPS, 1);
    expect(stale.plan.configFingerprint).toBe('fp-1'); // still served
    await new Promise((r) => setImmediate(r));
    expect(cache.getMetrics().refreshFailures).toBe(1);
    // entry still valid + served on next lookup
    t = 250;
    expect((await cache.get(input(), DEPS, 1)).plan.configFingerprint).toBe('fp-1');
  });

  test('hard expiry → full miss', async () => {
    let t = 0; let calls = 0;
    const cache = new ResolverCache({ ttlMs: 100, maxAgeMs: 500, now: () => t, resolver: async () => { calls++; return out(); } });
    await cache.get(input(), DEPS, 1);
    t = 600; // past maxAge
    expect((await cache.get(input(), DEPS, 1)).source).toBe('miss');
    expect(calls).toBe(2);
  });
});

describe('ResolverCache — fallback + warm-up + eviction', () => {
  test('resolver error on the cached path falls back to a direct resolve', async () => {
    let calls = 0;
    const cache = new ResolverCache({ resolver: async () => { calls++; if (calls === 1) throw new Error('miss boom'); return out(); } });
    const r = await cache.get(input(), DEPS, 1);
    expect(r.source).toBe('fallback');
    expect(cache.getMetrics().fallbacks).toBe(1);
  });

  test('warm-up pre-populates → subsequent get is a hit', async () => {
    const cache = new ResolverCache({ resolver: async () => out() });
    const warmed = await cache.warm([input()], DEPS, 1);
    expect(warmed).toBe(1);
    expect((await cache.get(input(), DEPS, 1)).source).toBe('hit');
  });

  test('LRU eviction at maxSize', async () => {
    const cache = new ResolverCache({ maxSize: 2, resolver: async () => out() });
    await cache.get(input({ orgId: 'a' }), DEPS, 1);
    await cache.get(input({ orgId: 'b' }), DEPS, 1);
    await cache.get(input({ orgId: 'c' }), DEPS, 1); // evicts 'a'
    const m = cache.getMetrics();
    expect(m.size).toBe(2);
    expect(m.evictions).toBe(1);
  });
});
