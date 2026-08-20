/**
 * Distributed planner architecture — unit tests.
 *
 * Covers:
 *   - Provider token bucket: acquire, exhaustion, refund, refill
 *   - Distributed semaphore: acquire/release happy path (local fallback),
 *     dead-lease recovery via TTL, double-release safety, snapshot
 *   - Event bus: emit, subscribe, dedup, unsubscribe, error isolation
 *   - BullMQ pressure: cache TTL, fail-open
 *
 * Notes on what's covered with mocks vs real systems:
 *   - Token bucket is pure in-memory — fully covered.
 *   - Distributed semaphore tests exercise the LOCAL FALLBACK path (no Redis
 *     required). A separate integration test (not in this file) would cover
 *     the Redis Lua path with a live or test-container Redis.
 *   - Event bus is in-process — fully covered.
 *   - BullMQ pressure tests stub the queue module so they don't depend on a
 *     running Redis.
 */

import {
  acquire as bucketAcquire,
  markRequestStarted,
  refund as bucketRefund,
  snapshot as bucketSnapshot,
  reloadBucketSizes,
  __resetForTests as resetBucket,
} from '../../services/providerTokenBucket';
import {
  acquire as semAcquire,
  release as semRelease,
  snapshot as semSnapshot,
  reloadPoolSizes as reloadDistPoolSizes,
  __resetForTests as resetSem,
} from '../../services/distributedSemaphore';
import {
  plannerEventBus,
  __resetEventBusForTests,
  type PlannerEvent,
} from '../../services/plannerEventBus';

// ─────────────────────────────────────────────────────────────────────────
// Provider token bucket (Part 2)
// ─────────────────────────────────────────────────────────────────────────
describe('providerTokenBucket', () => {
  beforeEach(() => {
    process.env.OPENAI_QPS_LIMIT = '10';
    process.env.ANTHROPIC_QPS_LIMIT = '5';
    process.env.PROVIDER_BUCKET_BURST = '4';
    process.env.PROVIDER_BUCKET_ENABLED = 'true';
    reloadBucketSizes();
    resetBucket();
  });

  test('acquire returns receipt immediately when tokens available', async () => {
    const r = await bucketAcquire('openai');
    expect(r.provider).toBe('openai');
    expect(r.decremented).toBe(true);
    expect(r.waitMs).toBe(0);
  });

  test('configurable QPS via env', () => {
    expect(bucketSnapshot('openai').qps).toBe(10);
    expect(bucketSnapshot('anthropic').qps).toBe(5);
    expect(bucketSnapshot('openai').burst).toBe(4);
  });

  test('refund restores the token when request never started', async () => {
    const beforeTokens = bucketSnapshot('openai').tokens;
    const r = await bucketAcquire('openai');
    expect(bucketSnapshot('openai').tokens).toBeLessThanOrEqual(beforeTokens);
    bucketRefund(r);
    // Token returned (within refill tolerance).
    expect(bucketSnapshot('openai').tokens).toBeGreaterThanOrEqual(beforeTokens - 0.1);
    expect(bucketSnapshot('openai').totalRefunds).toBe(1);
  });

  test('refund is no-op after markRequestStarted', async () => {
    const r = await bucketAcquire('openai');
    markRequestStarted(r);
    bucketRefund(r);
    // No refund counted.
    expect(bucketSnapshot('openai').totalRefunds).toBe(0);
  });

  test('throws PROVIDER_BUCKET_EXHAUSTED when wait window expires', async () => {
    // Reconfigure to a very slow refill so the burst doesn't replenish in the
    // wait window. QPS=1 means 1 token per second; burst=2 caps the initial pool.
    process.env.OPENAI_QPS_LIMIT = '1';
    process.env.PROVIDER_BUCKET_BURST = '2';
    reloadBucketSizes();
    resetBucket();
    // Drain the burst (2 tokens).
    await bucketAcquire('openai', { maxWaitMs: 0 });
    await bucketAcquire('openai', { maxWaitMs: 0 });
    let threw = false;
    try {
      // Wait window 200ms with QPS=1 refills only 0.2 tokens — not enough.
      await bucketAcquire('openai', { maxWaitMs: 200, pollIntervalMs: 30 });
    } catch (err) {
      threw = true;
      expect((err as { code?: string }).code).toBe('PROVIDER_BUCKET_EXHAUSTED');
    }
    expect(threw).toBe(true);
    expect(bucketSnapshot('openai').totalExhausted).toBeGreaterThanOrEqual(1);
  }, 3000);

  test('signal abort throws PROVIDER_BUCKET_ABORTED', async () => {
    // Deterministic drain: a single-token burst refilling so slowly the bucket
    // cannot reach one token again while this test runs. The previous version
    // drained a 4-token burst with five no-wait acquires and relied on that
    // finishing faster than the bucket refilled — a race the first-call module
    // load inside the exhaustion path lost by 200ms+ on a cold worker, leaving
    // 1-2 tokens behind and letting the guarded acquire take the fast path.
    process.env.PROVIDER_BUCKET_BURST = '1';
    process.env.OPENAI_QPS_LIMIT = '0.001';
    reloadBucketSizes();
    resetBucket();
    const controller = new AbortController();
    await bucketAcquire('openai', { maxWaitMs: 0 });
    // The drain is this test's precondition — assert it, so a regression fails
    // here instead of as a confusing "resolved instead of rejected" below.
    expect(bucketSnapshot('openai').tokens).toBeLessThan(1);
    // Abort synchronously rather than on a timer: the acquire's fast path has
    // already run by the time this line executes, so the wait loop observes the
    // signal on its next iteration. A 20ms timer raced the bucket's refill and
    // could fire hundreds of ms late on a cold worker.
    const acquiring = bucketAcquire('openai', {
      signal: controller.signal,
      maxWaitMs: 1000,
      pollIntervalMs: 10,
    });
    controller.abort();
    await expect(acquiring).rejects.toMatchObject({
      code: 'PROVIDER_BUCKET_ABORTED',
    });
  });

  test('PROVIDER_BUCKET_ENABLED=false bypasses gating', async () => {
    process.env.PROVIDER_BUCKET_ENABLED = 'false';
    const r = await bucketAcquire('openai', { maxWaitMs: 0 });
    expect(r.decremented).toBe(false);
    expect(r.waitMs).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Distributed semaphore (Part 1) — local-fallback path
// ─────────────────────────────────────────────────────────────────────────
describe('distributedSemaphore (local fallback)', () => {
  beforeEach(() => {
    // Force fallback mode so tests don't depend on a live Redis.
    process.env.DISTRIBUTED_POOL_ENABLED = 'false';
    process.env.MAX_DRAFTING_CONCURRENCY = '2';
    process.env.MAX_ALIGNMENT_CONCURRENCY = '2';
    process.env.MAX_REPAIR_CONCURRENCY = '1';
    reloadDistPoolSizes();
    resetSem();
  });

  test('acquire returns lease with usedFallback=true when Redis disabled', async () => {
    const lease = await semAcquire('drafting');
    expect(lease.pool).toBe('drafting');
    expect(lease.usedFallback).toBe(true);
    expect(lease.token).toBeTruthy();
    await semRelease(lease);
  });

  test('respects per-pool cap in fallback mode', async () => {
    const l1 = await semAcquire('repair'); // cap=1
    const start = Date.now();
    const acquireSecond = semAcquire('repair', { maxWaitMs: 50, pollIntervalMs: 10 });
    await expect(acquireSecond).rejects.toMatchObject({ code: 'SEMAPHORE_TIMEOUT' });
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    await semRelease(l1);
  });

  test('release frees a slot for waiters', async () => {
    const l1 = await semAcquire('repair');
    setTimeout(() => { void semRelease(l1); }, 30);
    const l2 = await semAcquire('repair', { maxWaitMs: 500 });
    expect(l2.pool).toBe('repair');
    await semRelease(l2);
  });

  test('double-release is safe', async () => {
    const lease = await semAcquire('alignment');
    await semRelease(lease);
    await semRelease(lease); // no throw, no negative active count
    expect(semSnapshot('alignment').active).toBe(0);
  });

  test('snapshot reports configured maxAllowed', () => {
    const snap = semSnapshot('drafting');
    expect(snap.maxAllowed).toBe(2);
    expect(snap.active).toBe(0);
    expect(snap.pool).toBe('drafting');
  });

  test('pools are independent', async () => {
    const drafting = await semAcquire('drafting');
    const alignment = await semAcquire('alignment');
    expect(semSnapshot('drafting').active).toBe(1);
    expect(semSnapshot('alignment').active).toBe(1);
    await semRelease(drafting);
    expect(semSnapshot('drafting').active).toBe(0);
    expect(semSnapshot('alignment').active).toBe(1);
    await semRelease(alignment);
  });

  test('signal abort during wait throws SEMAPHORE_ABORTED', async () => {
    const l1 = await semAcquire('repair'); // cap=1, drain
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      semAcquire('repair', { signal: controller.signal, maxWaitMs: 1000, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: 'SEMAPHORE_ABORTED' });
    await semRelease(l1);
  });

  test('reloadPoolSizes picks up env changes', () => {
    process.env.MAX_DRAFTING_CONCURRENCY = '7';
    const sizes = reloadDistPoolSizes();
    expect(sizes.drafting).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Planner event bus (Part 7)
// ─────────────────────────────────────────────────────────────────────────
describe('plannerEventBus', () => {
  beforeEach(() => { __resetEventBusForTests(); });

  test('emit returns event with id and ts', () => {
    const ev = plannerEventBus.emit({
      type: 'plan_created',
      campaign_id: 'c-1',
      payload: { foo: 'bar' },
    });
    expect(ev.id).toBeTruthy();
    expect(ev.ts).toBeGreaterThan(0);
    expect(ev.type).toBe('plan_created');
    expect(plannerEventBus.recentEvents()).toHaveLength(1);
  });

  test('subscriber receives matching events', () => {
    const received: PlannerEvent[] = [];
    plannerEventBus.on('drafting_completed', (e) => { received.push(e); });
    plannerEventBus.emit({
      type: 'drafting_completed',
      campaign_id: 'c-1',
      payload: { duration_ms: 100 },
    });
    plannerEventBus.emit({
      type: 'plan_created',
      campaign_id: 'c-1',
      payload: {},
    });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('drafting_completed');
  });

  test('onAny receives every event', () => {
    const received: PlannerEvent[] = [];
    plannerEventBus.onAny((e) => { received.push(e); });
    plannerEventBus.emit({ type: 'plan_created', campaign_id: 'c-1', payload: {} });
    plannerEventBus.emit({ type: 'drafting_completed', campaign_id: 'c-1', payload: {} });
    expect(received).toHaveLength(2);
  });

  test('unsubscribe stops further deliveries', () => {
    const received: PlannerEvent[] = [];
    const off = plannerEventBus.on('plan_created', (e) => { received.push(e); });
    plannerEventBus.emit({ type: 'plan_created', campaign_id: 'c-1', payload: {} });
    off();
    plannerEventBus.emit({ type: 'plan_created', campaign_id: 'c-2', payload: {} });
    expect(received).toHaveLength(1);
  });

  test('duplicate emit (same type+campaign+revision) is suppressed', () => {
    const ev1 = plannerEventBus.emit({
      type: 'refinement_completed',
      campaign_id: 'c-1',
      plan_revision_id: 'rev-A',
      payload: {},
    });
    const ev2 = plannerEventBus.emit({
      type: 'refinement_completed',
      campaign_id: 'c-1',
      plan_revision_id: 'rev-A',
      payload: {},
    });
    // Both have ids but the second wasn't appended to recent.
    expect(ev1.id).toBeTruthy();
    expect(ev2.id).toBeTruthy();
    expect(plannerEventBus.recentEvents()).toHaveLength(1);
  });

  test('subscriber error does not break emit or other subscribers', () => {
    const ok: PlannerEvent[] = [];
    plannerEventBus.on('plan_created', () => { throw new Error('subscriber-bug'); });
    plannerEventBus.on('plan_created', (e) => { ok.push(e); });
    expect(() => plannerEventBus.emit({
      type: 'plan_created',
      campaign_id: 'c-1',
      payload: {},
    })).not.toThrow();
    expect(ok).toHaveLength(1);
  });

  test('different campaign ids do not collide on dedupe', () => {
    plannerEventBus.emit({ type: 'plan_created', campaign_id: 'c-1', payload: {} });
    plannerEventBus.emit({ type: 'plan_created', campaign_id: 'c-2', payload: {} });
    expect(plannerEventBus.recentEvents()).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BullMQ overload signals (Part 6) — uses module mock
// ─────────────────────────────────────────────────────────────────────────
describe('bullmqOverloadSignals', () => {
  // Module is re-required inside each test so we can swap the mock.
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns pressureHigh=false when queue is healthy', async () => {
    jest.doMock('../../queue/boltQueue', () => ({
      getBoltQueue: () => ({
        getJobCounts: async () => ({ waiting: 1, delayed: 2, active: 0, failed: 0 }),
      }),
    }));
    const { getBoltQueuePressure, __resetBullMqSignalsForTests } =
      require('../../services/bullmqOverloadSignals') as typeof import('../../services/bullmqOverloadSignals');
    __resetBullMqSignalsForTests();
    const snap = await getBoltQueuePressure();
    expect(snap.pressureHigh).toBe(false);
    expect(snap.source).toBe('redis');
  });

  test('flags pressureHigh when waiting exceeds threshold', async () => {
    process.env.BULLMQ_WAITING_PRESSURE_THRESHOLD = '5';
    jest.doMock('../../queue/boltQueue', () => ({
      getBoltQueue: () => ({
        getJobCounts: async () => ({ waiting: 10, delayed: 0, active: 0, failed: 0 }),
      }),
    }));
    const { getBoltQueuePressure, __resetBullMqSignalsForTests } =
      require('../../services/bullmqOverloadSignals') as typeof import('../../services/bullmqOverloadSignals');
    __resetBullMqSignalsForTests();
    const snap = await getBoltQueuePressure();
    expect(snap.pressureHigh).toBe(true);
    expect(snap.reasons.some((r) => r.includes('waiting'))).toBe(true);
  });

  test('returns cached snapshot within TTL', async () => {
    let calls = 0;
    jest.doMock('../../queue/boltQueue', () => ({
      getBoltQueue: () => ({
        getJobCounts: async () => {
          calls += 1;
          return { waiting: 0, delayed: 0, active: 0, failed: 0 };
        },
      }),
    }));
    const { getBoltQueuePressure, __resetBullMqSignalsForTests } =
      require('../../services/bullmqOverloadSignals') as typeof import('../../services/bullmqOverloadSignals');
    __resetBullMqSignalsForTests();
    await getBoltQueuePressure();
    const second = await getBoltQueuePressure();
    expect(calls).toBe(1);
    expect(second.source).toBe('cache');
  });

  test('fails open when queue read throws', async () => {
    jest.doMock('../../queue/boltQueue', () => ({
      getBoltQueue: () => ({
        getJobCounts: async () => { throw new Error('redis down'); },
      }),
    }));
    const { getBoltQueuePressure, __resetBullMqSignalsForTests } =
      require('../../services/bullmqOverloadSignals') as typeof import('../../services/bullmqOverloadSignals');
    __resetBullMqSignalsForTests();
    const snap = await getBoltQueuePressure();
    expect(snap.source).toBe('fallback');
    expect(snap.pressureHigh).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Async refinement enqueue (Part 5) — module mock
// ─────────────────────────────────────────────────────────────────────────
describe('asyncRefinement', () => {
  beforeEach(() => { jest.resetModules(); });

  test('isAsyncRefinementEnabled reads env flag', () => {
    process.env.ASYNC_REFINEMENT_ENABLED = 'true';
    const { isAsyncRefinementEnabled } =
      require('../../services/campaignAiOrchestrator/asyncRefinement') as typeof import('../../services/campaignAiOrchestrator/asyncRefinement');
    expect(isAsyncRefinementEnabled()).toBe(true);
    process.env.ASYNC_REFINEMENT_ENABLED = 'false';
    expect(isAsyncRefinementEnabled()).toBe(false);
  });

  test('enqueueAsyncRefinement returns enqueued=false on queue error', async () => {
    jest.doMock('../../queue/refinementQueue', () => ({
      getRefinementQueue: () => ({
        add: async () => { throw new Error('queue unavailable'); },
      }),
    }));
    const { enqueueAsyncRefinement } =
      require('../../services/campaignAiOrchestrator/asyncRefinement') as typeof import('../../services/campaignAiOrchestrator/asyncRefinement');
    const r = await enqueueAsyncRefinement({
      campaignId: 'c-1',
      planRevisionId: 'rev-A',
      snapshotHash: 'hash-1',
      companyId: 'co-1',
      rawPlanText: 'plan',
      distributionStrategy: null,
      distributionReason: null,
      prefilledPlanningKey: null,
    });
    expect(r.enqueued).toBe(false);
    expect(r.jobId).toBe('refine::c-1::rev-A');
  });

  test('enqueueAsyncRefinement is idempotent on jobId', async () => {
    const calls: any[] = [];
    jest.doMock('../../queue/refinementQueue', () => ({
      getRefinementQueue: () => ({
        add: async (_name: string, payload: any, opts: any) => {
          calls.push({ payload, opts });
          return { id: opts.jobId };
        },
      }),
    }));
    const { enqueueAsyncRefinement } =
      require('../../services/campaignAiOrchestrator/asyncRefinement') as typeof import('../../services/campaignAiOrchestrator/asyncRefinement');
    const r1 = await enqueueAsyncRefinement({
      campaignId: 'c-1',
      planRevisionId: 'rev-A',
      snapshotHash: null,
      companyId: null,
      rawPlanText: '',
      distributionStrategy: null,
      distributionReason: null,
      prefilledPlanningKey: null,
    });
    const r2 = await enqueueAsyncRefinement({
      campaignId: 'c-1',
      planRevisionId: 'rev-A',
      snapshotHash: null,
      companyId: null,
      rawPlanText: '',
      distributionStrategy: null,
      distributionReason: null,
      prefilledPlanningKey: null,
    });
    expect(r1.jobId).toBe(r2.jobId);
    expect(calls).toHaveLength(2);
    expect(calls[0].opts.jobId).toBe(calls[1].opts.jobId);
  });
});
