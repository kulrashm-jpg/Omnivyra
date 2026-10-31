/**
 * OPS-C — safeEnqueue / enqueueWithOutcome / enqueueOrThrow contract, driven
 * through the REAL usage guard (applyQueueProtection) and the REAL overflow
 * buffer (lib/redis/usageProtection). Only the BullMQ queue is a fake.
 *
 * Production 2026-10-30 (worker b20278de): under `critical_redis_usage` the
 * guard parked the safety-net job and returned null from `queue.add`, and
 * safeEnqueue threw `TypeError: Cannot read properties of null (reading 'id')`.
 * The first test reproduces exactly that. It FAILS on the pre-OPS-C
 * implementation: run with OPS_C_BACKPRESSURE_IMPL pointing at a copy of the
 * old file to see it fail.
 *
 * No network, no Redis, no database.
 */
import type { Queue } from 'bullmq';
import { applyQueueProtection } from '../../queue/bullmqClient';
import {
  __resetOverflowForTests,
  __setUsageLevelForTests,
  drainOverflowIfBelowThrottle,
  overflowByQueue,
  getOverflowCounters,
} from '../../../lib/redis/usageProtection';
import { triggerSafetyNetDrain } from '../../queue/safetyNetTrigger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = require(process.env.OPS_C_BACKPRESSURE_IMPL || '../../middleware/queueBackpressure') as typeof import('../../middleware/queueBackpressure');
const { safeEnqueue, enqueueWithOutcome, enqueueOrThrow, QueueFullError } = impl;

type Added = { name: string; data: Record<string, unknown>; opts?: Record<string, unknown> };

function fakeQueue(name: string, opts: { depth?: number; addError?: Error; addReturnsNull?: boolean } = {}) {
  const added: Added[] = [];
  const bulk: Added[][] = [];
  let seq = 0;
  const q = {
    name,
    add: jest.fn(async (n: string, d: Record<string, unknown>, o?: Record<string, unknown>) => {
      if (opts.addError) throw opts.addError;
      if (opts.addReturnsNull) return null;
      added.push({ name: n, data: d, opts: o });
      seq += 1;
      return { id: (o?.jobId as string) ?? `gen-${seq}` };
    }),
    addBulk: jest.fn(async (jobs: Added[]) => { bulk.push(jobs); return jobs; }),
    getJobCounts: jest.fn(async () => ({ waiting: opts.depth ?? 0, active: 0, delayed: 0 })),
  };
  // The guard replaces q.add/q.addBulk; keep the originals (the drain path
  // calls the original addBulk).
  return { q, added, bulk, addBulkMock: q.addBulk };
}

function protectedQueue(name: string, o?: Parameters<typeof fakeQueue>[1]) {
  const f = fakeQueue(name, o);
  applyQueueProtection(f.q as unknown as Queue);
  return f;
}

let errSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  __resetOverflowForTests();
  __setUsageLevelForTests('normal');
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
  __setUsageLevelForTests('normal');
});

describe('production crash reproduction (critical_redis_usage)', () => {
  it('safeEnqueue on a parked job resolves null instead of throwing TypeError', async () => {
    const { q } = protectedQueue('lead-thread-recompute');
    __setUsageLevelForTests('critical');
    await expect(
      safeEnqueue(q as unknown as Queue, 'lead-thread-recompute', 'recompute', {}, { jobId: 'drain', delay: 200 }),
    ).resolves.toBeNull();
    // null = "not accepted, nothing pending": the parked job was retracted, so
    // a caller that answers 429 / retries is not ALSO replayed later.
    expect(overflowByQueue()['lead-thread-recompute'] ?? 0).toBe(0);
  });
});

describe('enqueueWithOutcome — every status', () => {
  it('enqueued', async () => {
    const { q, added } = protectedQueue('conversation-memory-rebuild');
    const o = await enqueueWithOutcome(q as unknown as Queue, 'conversation-memory-rebuild', 'rebuild', {}, { jobId: 'j1' });
    expect(o).toEqual({ status: 'enqueued', id: 'j1' });
    expect(added).toHaveLength(1);
    await expect(safeEnqueue(q as unknown as Queue, 'conversation-memory-rebuild', 'rebuild', {}, { jobId: 'j2' })).resolves.toEqual({ id: 'j2' });
  });

  it('deferred_overflow_stored (keep) then deduplicated for the same jobId', async () => {
    const { q, added } = protectedQueue('lead-thread-recompute');
    __setUsageLevelForTests('critical');
    const a = await enqueueWithOutcome(q as unknown as Queue, 'lead-thread-recompute', 'recompute', {}, { jobId: 'drain', onDeferred: 'keep' });
    const b = await enqueueWithOutcome(q as unknown as Queue, 'lead-thread-recompute', 'recompute', {}, { jobId: 'drain', onDeferred: 'keep' });
    expect(a).toEqual({ status: 'deferred_overflow_stored', id: 'drain' });
    expect(b).toEqual({ status: 'deduplicated', id: 'drain' });
    expect(overflowByQueue()['lead-thread-recompute']).toBe(1);
    expect(added).toHaveLength(0);
    expect(getOverflowCounters().coalesced).toBe(1);
  });

  it('rejected_redis_critical (default retract) leaves nothing parked', async () => {
    const { q } = protectedQueue('ai-heavy');
    __setUsageLevelForTests('critical');
    const o = await enqueueWithOutcome(q as unknown as Queue, 'ai-heavy', 'campaign-planning', {}, { jobId: 'p1' });
    expect(o).toEqual({ status: 'rejected_redis_critical' });
    expect(overflowByQueue()['ai-heavy'] ?? 0).toBe(0);
    expect(getOverflowCounters().retracted).toBe(1);
  });

  it('dropped_overflow_full once the per-queue buffer cap is reached', async () => {
    const { q } = protectedQueue('engine-x');
    __setUsageLevelForTests('critical');
    let last: unknown = null;
    let stored = 0;
    for (let i = 0; i < 500; i++) {
      const o = await enqueueWithOutcome(q as unknown as Queue, 'engine-x', 'job', {}, { jobId: `id-${i}`, onDeferred: 'keep' });
      if (o.status === 'deferred_overflow_stored') stored += 1;
      last = o;
      if (o.status === 'dropped_overflow_full') break;
    }
    expect(last).toEqual({ status: 'dropped_overflow_full' });
    expect(stored).toBeGreaterThan(0);
    expect(overflowByQueue()['engine-x']).toBe(stored);
    // A permanent failure is logged at error level.
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"event":"queue_enqueue_not_accepted"') && l.includes('"status":"dropped_overflow_full"') && l.includes('"level":"ERROR"'))).toBe(true);
  });

  it('rejected_backpressure at the hard depth limit', async () => {
    const { q, added } = protectedQueue('engine-jobs', { depth: 2_000 });
    const o = await enqueueWithOutcome(q as unknown as Queue, 'engine-jobs', 'lead-job', {}, { jobId: 'l1' });
    expect(o).toEqual({ status: 'rejected_backpressure', depth: 2_000, limit: 2_000 });
    expect(added).toHaveLength(0);
    await expect(safeEnqueue(q as unknown as Queue, 'engine-jobs', 'lead-job', {}, { jobId: 'l1' })).resolves.toBeNull();
    await expect(enqueueOrThrow(q as unknown as Queue, 'engine-jobs', 'lead-job', {}, { jobId: 'l1' })).rejects.toBeInstanceOf(QueueFullError);
  });

  it('unavailable: a Redis connection error is reported, and safeEnqueue rethrows the ORIGINAL error', async () => {
    const boom = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const { q } = protectedQueue('analytics-ingestion', { addError: boom });
    const o = await enqueueWithOutcome(q as unknown as Queue, 'analytics-ingestion', 'daily-growth', {});
    expect(o).toEqual({ status: 'unavailable', errorName: 'Error' });
    await expect(safeEnqueue(q as unknown as Queue, 'analytics-ingestion', 'daily-growth', {})).rejects.toBe(boom);
  });

  it('failed: any other error is reported at error level, never thrown by enqueueWithOutcome', async () => {
    const boom = new RangeError('bad options');
    const { q } = protectedQueue('analytics-ingestion', { addError: boom });
    const o = await enqueueWithOutcome(q as unknown as Queue, 'analytics-ingestion', 'daily-growth', {});
    expect(o).toEqual({ status: 'failed', errorName: 'RangeError' });
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"status":"failed"') && l.includes('"error_name":"RangeError"'))).toBe(true);
    // No payload, jobId or tenant id ever reaches the log line.
    expect(lines.join('\n')).not.toMatch(/bad options/);
  });

  it('an UNPROTECTED queue whose add returns null is "not accepted", not a TypeError', async () => {
    const { q } = fakeQueue('raw', { addReturnsNull: true });
    await expect(safeEnqueue(q as unknown as Queue, 'raw', 'x', {})).resolves.toBeNull();
    await expect(enqueueWithOutcome(q as unknown as Queue, 'raw', 'x', {})).resolves.toEqual({ status: 'failed', errorName: 'AddReturnedNull' });
  });
});

describe('enqueueOrThrow under critical', () => {
  it('throws a QueueFullError subclass AND retracts, so the reported failure is never replayed', async () => {
    const { q, added, bulk } = protectedQueue('content-blog');
    __setUsageLevelForTests('critical');
    const err = await enqueueOrThrow(q as unknown as Queue, 'content-blog', 'content-blog', {}, { jobId: 'b1' }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueFullError);
    expect((err as { status?: string }).status).toBe('rejected_redis_critical');
    __setUsageLevelForTests('normal');
    await drainOverflowIfBelowThrottle();
    expect(added).toHaveLength(0);
    expect(bulk).toHaveLength(0);
  });
});

describe('overflow replay', () => {
  it('replays parked jobs once usage is below throttle, under their original jobIds, exactly once', async () => {
    const { q, bulk } = protectedQueue('lead-thread-recompute');
    __setUsageLevelForTests('critical');
    await enqueueWithOutcome(q as unknown as Queue, 'lead-thread-recompute', 'recompute', {}, { jobId: 'drain', onDeferred: 'keep' });
    await drainOverflowIfBelowThrottle(); // still critical: nothing
    expect(bulk).toHaveLength(0);
    __setUsageLevelForTests('warning');   // critical → warning (no 'normal' transition)
    await drainOverflowIfBelowThrottle();
    expect(bulk).toHaveLength(1);
    expect(bulk[0].map((j) => j.opts?.jobId)).toEqual(['drain']);
    await drainOverflowIfBelowThrottle();
    expect(bulk).toHaveLength(1);
  });

  it('a failed drain is re-buffered and retried on the next poll', async () => {
    const { q, bulk, addBulkMock } = protectedQueue('conversation-memory-rebuild');
    __setUsageLevelForTests('critical');
    await enqueueWithOutcome(q as unknown as Queue, 'conversation-memory-rebuild', 'rebuild', {}, { jobId: 'drain', onDeferred: 'keep' });
    __setUsageLevelForTests('normal');
    addBulkMock.mockImplementationOnce(async () => { throw new Error('transient'); });
    await drainOverflowIfBelowThrottle();
    expect(overflowByQueue()['conversation-memory-rebuild']).toBe(1);
    await drainOverflowIfBelowThrottle();
    expect(overflowByQueue()['conversation-memory-rebuild'] ?? 0).toBe(0);
    expect(bulk).toHaveLength(1);
  });
});

describe('cron safety-net trigger', () => {
  it('repeated ticks under critical never throw and park ONE coalesced trigger', async () => {
    const { q, added } = protectedQueue('lead-thread-recompute');
    __setUsageLevelForTests('critical');
    const results = [];
    for (let i = 0; i < 15; i++) {
      results.push(await triggerSafetyNetDrain({
        label: 'leadThreadRecompute-safetynet',
        getQueue: () => q as unknown as Queue,
        queueName: 'lead-thread-recompute',
        jobName: 'recompute',
      }));
    }
    expect(results[0]).toEqual({ status: 'deferred_overflow_stored', triggered: 1, retry_next_tick: 0, failed: 0 });
    expect(results.slice(1).every((r) => r.status === 'deduplicated' && r.triggered === 1)).toBe(true);
    expect(overflowByQueue()['lead-thread-recompute']).toBe(1);
    expect(added).toHaveLength(0);
  });

  it('enqueues normally when usage is normal', async () => {
    const { q, added } = protectedQueue('conversation-memory-rebuild');
    const r = await triggerSafetyNetDrain({
      label: 'conversationMemory-safetynet',
      getQueue: () => q as unknown as Queue,
      queueName: 'conversation-memory-rebuild',
      jobName: 'rebuild',
    });
    expect(r).toEqual({ status: 'enqueued', triggered: 1, retry_next_tick: 0, failed: 0 });
    expect(added.map((a) => a.opts)).toEqual([{ jobId: 'drain', delay: 200 }]);
  });

  it('a queue that cannot be built is a logged, counted permanent failure — not a throw', async () => {
    const logs: Array<[string, string]> = [];
    const counters: Array<[string, Record<string, string>]> = [];
    const r = await triggerSafetyNetDrain({
      label: 'leadThreadRecompute-safetynet',
      getQueue: () => { throw new Error('REDIS_URL missing'); },
      queueName: 'lead-thread-recompute',
      jobName: 'recompute',
      log: (lvl, line) => logs.push([lvl, line]),
      recordCounter: (name, _v, labels) => counters.push([name, labels]),
    });
    expect(r).toEqual({ status: 'failed', triggered: 0, retry_next_tick: 1, failed: 1 });
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe('error');
    expect(JSON.parse(logs[0][1])).toMatchObject({ event: 'cron_safetynet_not_enqueued', status: 'failed', retry: 'next_tick' });
    expect(counters).toEqual([['cron.safetynet.outcome', { label: 'leadThreadRecompute-safetynet', status: 'failed' }]]);
  });

  it('backpressure on the trigger queue is retried by the next tick', async () => {
    const { q } = protectedQueue('lead-thread-recompute', { depth: 5_000 });
    const r = await triggerSafetyNetDrain({
      label: 'leadThreadRecompute-safetynet',
      getQueue: () => q as unknown as Queue,
      queueName: 'lead-thread-recompute',
      jobName: 'recompute',
    });
    expect(r).toEqual({ status: 'rejected_backpressure', triggered: 0, retry_next_tick: 1, failed: 0 });
  });
});
