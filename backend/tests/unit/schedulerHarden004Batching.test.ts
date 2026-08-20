/**
 * HARDEN-004 — scheduler batching regression suite (part 1).
 *
 * Proves the optimized publish scheduler produces IDENTICAL decisions,
 * ordering, payloads and idempotency to the old per-post loop, while issuing
 * a fixed number of queries regardless of batch size (N+1 eliminated), and
 * that the concurrency primitive is bounded, ordered and error-isolating.
 */
import { mapWithConcurrency, getSchedulerConcurrency } from '../../scheduler/schedulerBatching';

// ── Silence the re-export graph of schedulerService (not under test here) ──
jest.mock('../../scheduler/schedulerIntelligenceJobs', () => ({}));
jest.mock('../../scheduler/schedulerPostQueueControl', () => ({}));

// ── Mock DB: a chainable builder with per-table scripted responses ──
type TableCall = { table: string; op: string; args: unknown[] };
const dbCalls: TableCall[] = [];
const dbResponses: Record<string, unknown> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const ctx: TableCall[] = [];
    const record = (op: string, ...args: unknown[]) => { const c = { table, op, args }; ctx.push(c); dbCalls.push(c); };
    const builder: any = {
      select: (...a: unknown[]) => { record('select', ...a); return builder; },
      insert: (...a: unknown[]) => { record('insert', ...a); return builder; },
      update: (...a: unknown[]) => { record('update', ...a); return builder; },
      upsert: (...a: unknown[]) => { record('upsert', ...a); return builder; },
      eq: (...a: unknown[]) => { record('eq', ...a); return builder; },
      in: (...a: unknown[]) => { record('in', ...a); return builder; },
      lte: (...a: unknown[]) => { record('lte', ...a); return builder; },
      gt: (...a: unknown[]) => { record('gt', ...a); return builder; },
      order: (...a: unknown[]) => { record('order', ...a); return builder; },
      limit: (...a: unknown[]) => { record('limit', ...a); return builder; },
      single: () => { record('single'); return builder; },
      maybeSingle: () => { record('maybeSingle'); return builder; },
      then: (resolve: any, reject: any) => {
        const insertCall = ctx.find((c) => c.op === 'insert');
        const key = insertCall ? `${table}:insert` : `${table}:select`;
        record('resolve'); // one DB round-trip
        const responder = dbResponses[key];
        const out = typeof responder === 'function' ? (responder as (calls: TableCall[]) => unknown)(ctx) : responder;
        return Promise.resolve(out ?? { data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
}));

// ── Mock BullMQ queue ──
type QueueAddArgs = Parameters<import('bullmq').Queue['add']>;
const queueAdd = jest.fn(async (..._a: QueueAddArgs) => ({}));
const queueAddBulk = jest.fn(async (jobs: unknown[]) => jobs);
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({ add: queueAdd, addBulk: queueAddBulk }),
  getEngagementPollingQueue: () => ({ add: queueAdd }),
}));

type CreateQueueJobArgs = Parameters<typeof import('../../db/queries')['createQueueJob']>;
const createQueueJob = jest.fn(async (..._a: CreateQueueJobArgs) => 'fallback-job-id');
jest.mock('../../db/queries', () => ({
  createQueueJob: (...args: CreateQueueJobArgs) => createQueueJob(...args),
}));

import { findDuePostsAndEnqueue } from '../../scheduler/schedulerService';

function post(id: string, campaignId: string | null, priority = 0) {
  return {
    id,
    user_id: `user-${id}`,
    social_account_id: `acct-${id}`,
    platform: 'linkedin',
    scheduled_for: '2026-01-01T09:00:00.000Z',
    status: 'scheduled',
    priority,
    campaign_id: campaignId,
  };
}

function primeDb(opts: {
  duePosts: unknown[];
  existingJobs?: Array<{ scheduled_post_id: string; status: string }>;
  campaigns?: Array<{ id: string; status: string }>;
  readiness?: Array<{ campaign_id: string; readiness_state: string }>;
  insertFails?: boolean;
}) {
  dbCalls.length = 0;
  dbResponses['scheduled_posts:select'] = { data: opts.duePosts, error: null };
  dbResponses['campaigns:select'] = { data: opts.campaigns ?? [], error: null };
  dbResponses['campaign_readiness:select'] = { data: opts.readiness ?? [], error: null };
  dbResponses['queue_jobs:select'] = { data: opts.existingJobs ?? [], error: null };
  dbResponses['queue_jobs:insert'] = opts.insertFails
    ? { data: null, error: { message: 'insert exploded' } }
    : (calls: TableCall[]) => {
        const rows = (calls.find((c) => c.op === 'insert')?.args[0] ?? []) as Array<{ scheduled_post_id: string }>;
        return { data: rows.map((r, i) => ({ id: `qj-${r.scheduled_post_id}`, scheduled_post_id: r.scheduled_post_id })), error: null };
      };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mapWithConcurrency', () => {
  it('preserves input order in results regardless of completion order', async () => {
    const delays = [50, 5, 30, 1];
    const results = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `item-${i}`;
    });
    expect(results.map((r) => r.value)).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
  });

  it('captures per-item errors without failing the batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom-2');
      return n * 10;
    });
    expect(results[0]).toMatchObject({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[1].error?.message).toBe('boom-2');
    expect(results[2]).toMatchObject({ ok: true, value: 30 });
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel
  });

  it('handles empty input and clamps a silly limit', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    const results = await mapWithConcurrency([1], 100, async (n) => n);
    expect(results[0].value).toBe(1);
  });

  it('getSchedulerConcurrency respects env and clamps', () => {
    const prev = process.env.SCHEDULER_CONCURRENCY;
    process.env.SCHEDULER_CONCURRENCY = '8';
    expect(getSchedulerConcurrency()).toBe(8);
    process.env.SCHEDULER_CONCURRENCY = '9999';
    expect(getSchedulerConcurrency()).toBe(20);
    process.env.SCHEDULER_CONCURRENCY = 'nope';
    expect(getSchedulerConcurrency()).toBe(5);
    if (prev === undefined) delete process.env.SCHEDULER_CONCURRENCY;
    else process.env.SCHEDULER_CONCURRENCY = prev;
  });
});

describe('findDuePostsAndEnqueue — identical decisions, batched queries', () => {
  it('single ready campaign post → enqueued with identical payload + DB-id jobId', async () => {
    primeDb({
      duePosts: [post('p1', 'c1')],
      campaigns: [{ id: 'c1', status: 'active' }],
      readiness: [{ campaign_id: 'c1', readiness_state: 'ready' }],
    });
    const res = await findDuePostsAndEnqueue();
    expect(res).toEqual({ found: 1, created: 1, skipped: 0 });
    expect(queueAddBulk).toHaveBeenCalledTimes(1);
    const jobs = queueAddBulk.mock.calls[0][0] as any[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      name: 'publish',
      data: { scheduled_post_id: 'p1', social_account_id: 'acct-p1', user_id: 'user-p1' },
      opts: { jobId: 'qj-p1', removeOnComplete: true, removeOnFail: false },
    });
  });

  it('mixed readiness states → identical skip decisions (not-active, not-ready, missing rows, duplicates)', async () => {
    primeDb({
      duePosts: [
        post('p1', 'c-active-ready'),
        post('p2', 'c-paused'),
        post('p3', 'c-active-notready'),
        post('p4', 'c-missing'),
        post('p5', null),          // standalone post — no campaign gate
        post('p6', 'c-active-ready'),
      ],
      existingJobs: [{ scheduled_post_id: 'p6', status: 'pending' }], // duplicate
      campaigns: [
        { id: 'c-active-ready', status: 'active' },
        { id: 'c-paused', status: 'paused' },
        { id: 'c-active-notready', status: 'active' },
      ],
      readiness: [
        { campaign_id: 'c-active-ready', readiness_state: 'ready' },
        { campaign_id: 'c-active-notready', readiness_state: 'partial' },
      ],
    });
    const res = await findDuePostsAndEnqueue();
    // p1 + p5 enqueue; p2 (not active), p3 (not ready), p4 (missing campaign), p6 (dup) skip.
    expect(res).toEqual({ found: 6, created: 2, skipped: 4 });
    const jobs = queueAddBulk.mock.calls[0][0] as any[];
    expect(jobs.map((j) => j.data.scheduled_post_id)).toEqual(['p1', 'p5']);
  });

  it('hundreds of posts → constant query count (N+1 eliminated) and preserved order', async () => {
    const posts = Array.from({ length: 100 }, (_, i) => post(`p${String(i).padStart(3, '0')}`, `c${i % 10}`));
    primeDb({
      duePosts: posts,
      campaigns: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, status: 'active' })),
      readiness: Array.from({ length: 10 }, (_, i) => ({ campaign_id: `c${i}`, readiness_state: 'ready' })),
    });
    const res = await findDuePostsAndEnqueue();
    expect(res).toEqual({ found: 100, created: 100, skipped: 0 });

    // Round-trip proof: 1 due-posts select + 1 dup-check + 1 campaigns +
    // 1 readiness + 1 bulk insert = 5 total for 100 posts across 10 campaigns
    // (was 2 + 2×100 lookups + 100 inserts = ~302 before HARDEN-004).
    const roundTrips = dbCalls.filter((c) => c.op === 'resolve').length;
    expect(roundTrips).toBe(5);
    expect(dbCalls.filter((c) => c.op === 'insert')).toHaveLength(1);
    expect(queueAddBulk).toHaveBeenCalledTimes(1);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(createQueueJob).not.toHaveBeenCalled();

    // Publish order identical to the due-post ordering.
    const jobs = queueAddBulk.mock.calls[0][0] as any[];
    expect(jobs.map((j) => j.data.scheduled_post_id)).toEqual(posts.map((p) => p.id));
    // Idempotency: every job carries its queue_jobs row id.
    expect(jobs.every((j) => j.opts.jobId === `qj-${j.data.scheduled_post_id}`)).toBe(true);
  });

  it('bulk failure → identical per-post fallback (partial failures tolerated)', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null), post('p3', null)],
      insertFails: true, // bulk insert path fails → fallback loop
    });
    createQueueJob
      .mockResolvedValueOnce('fb-1')
      .mockRejectedValueOnce(new Error('row 2 exploded'))
      .mockResolvedValueOnce('fb-3');
    const res = await findDuePostsAndEnqueue();
    // Old semantics: continue past individual failures.
    expect(res).toEqual({ found: 3, created: 2, skipped: 0 });
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd.mock.calls[0][2]).toMatchObject({ jobId: 'fb-1', removeOnComplete: true, removeOnFail: false });
  });

  it('all posts duplicate → nothing inserted or enqueued', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null)],
      existingJobs: [
        { scheduled_post_id: 'p1', status: 'pending' },
        { scheduled_post_id: 'p2', status: 'processing' },
      ],
    });
    const res = await findDuePostsAndEnqueue();
    expect(res).toEqual({ found: 2, created: 0, skipped: 2 });
    expect(queueAddBulk).not.toHaveBeenCalled();
    expect(dbCalls.filter((c) => c.op === 'insert')).toHaveLength(0);
    // No campaign/readiness queries at all when nothing is eligible.
    expect(dbCalls.filter((c) => c.table === 'campaigns')).toHaveLength(0);
    expect(dbCalls.filter((c) => c.table === 'campaign_readiness')).toHaveLength(0);
  });

  it('empty run → zero work', async () => {
    primeDb({ duePosts: [] });
    const res = await findDuePostsAndEnqueue();
    expect(res).toEqual({ found: 0, created: 0, skipped: 0 });
    expect(queueAddBulk).not.toHaveBeenCalled();
  });

  it('readiness batch error → run throws (matches old getCampaignReadiness throw)', async () => {
    primeDb({
      duePosts: [post('p1', 'c1')],
      campaigns: [{ id: 'c1', status: 'active' }],
    });
    dbResponses['campaign_readiness:select'] = { data: null, error: { message: 'readiness table on fire' } };
    await expect(findDuePostsAndEnqueue()).rejects.toThrow('Failed to load campaign readiness');
  });
});
