/**
 * Scheduler duplicate-guard integrity.
 *
 * `findDuePostsAndEnqueueInner` asks `queue_jobs` which of the due posts already
 * have a live ('pending' | 'processing') job, so it can refuse to enqueue them a
 * second time. That lookup has THREE outcomes and they must never collapse:
 *
 *   A. lookup succeeded + no queued record  → post is eligible
 *   B. lookup succeeded + queued record     → post is protected from re-enqueue
 *   C. lookup FAILED                        → queue state UNKNOWN, must NOT become A
 *
 * The regression this suite locks: the lookup's `error` used to be discarded, so
 * on a failed round-trip `data` was null, the "already queued" set was EMPTY, and
 * EVERY due post in the cycle was treated as un-enqueued — a whole-cycle
 * duplicate enqueue that double-publishes to public social platforms.
 *
 * Every test drives the REAL exported `findDuePostsAndEnqueue()`.
 */

// ── Silence the re-export graph of schedulerService (not under test here) ──
jest.mock('../../scheduler/schedulerIntelligenceJobs', () => ({}));
jest.mock('../../scheduler/schedulerPostQueueControl', () => ({}));

// ── Observability seam kept real except for the one counter we assert on ──
const recordScheduler = jest.fn();
jest.mock('../../observability/metrics', () => ({
  ...jest.requireActual('../../observability/metrics'),
  recordScheduler: (...args: unknown[]) => recordScheduler(...args),
}));

// ── Mock DB: chainable builder with per-table scripted responses ──
type TableCall = { table: string; op: string; args: unknown[] };
type DbResult = { data: unknown; error: { message: string } | null };
const dbCalls: TableCall[] = [];
const dbResponses: Record<string, unknown> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const ctx: TableCall[] = [];
    const record = (op: string, ...args: unknown[]) => {
      const c = { table, op, args };
      ctx.push(c);
      dbCalls.push(c);
    };
    const builder: any = {
      select: (...a: unknown[]) => { record('select', ...a); return builder; },
      insert: (...a: unknown[]) => { record('insert', ...a); return builder; },
      update: (...a: unknown[]) => { record('update', ...a); return builder; },
      eq: (...a: unknown[]) => { record('eq', ...a); return builder; },
      in: (...a: unknown[]) => { record('in', ...a); return builder; },
      lte: (...a: unknown[]) => { record('lte', ...a); return builder; },
      order: (...a: unknown[]) => { record('order', ...a); return builder; },
      limit: (...a: unknown[]) => { record('limit', ...a); return builder; },
      single: () => { record('single'); return builder; },
      maybeSingle: () => { record('maybeSingle'); return builder; },
      then: (resolve: any, reject: any) => {
        const insertCall = ctx.find((c) => c.op === 'insert');
        const key = insertCall ? `${table}:insert` : `${table}:select`;
        record('resolve'); // one DB round-trip
        const responder = dbResponses[key];
        const out = typeof responder === 'function'
          ? (responder as (calls: TableCall[]) => unknown)(ctx)
          : responder;
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

/** Successful bulk insert: echo back one queue_jobs row per submitted row. */
const okInsert = (calls: TableCall[]) => {
  const rows = (calls.find((c) => c.op === 'insert')?.args[0] ?? []) as Array<{ scheduled_post_id: string }>;
  return { data: rows.map((r) => ({ id: `qj-${r.scheduled_post_id}`, scheduled_post_id: r.scheduled_post_id })), error: null };
};

function primeDb(opts: {
  duePosts: unknown[];
  /** Response for the duplicate-guard SELECT on queue_jobs. */
  guard?: DbResult | (() => DbResult);
  campaigns?: Array<{ id: string; status: string }>;
}) {
  dbCalls.length = 0;
  dbResponses['scheduled_posts:select'] = { data: opts.duePosts, error: null };
  dbResponses['campaigns:select'] = { data: opts.campaigns ?? [], error: null };
  dbResponses['queue_jobs:select'] = opts.guard ?? { data: [], error: null };
  dbResponses['queue_jobs:insert'] = okInsert;
}

/** Every write/enqueue surface the scheduler owns. */
function writeSurfaces() {
  return {
    queueJobInserts: dbCalls.filter((c) => c.table === 'queue_jobs' && c.op === 'insert').length,
    addBulkCalls: queueAddBulk.mock.calls.length,
    addCalls: queueAdd.mock.calls.length,
    createQueueJobCalls: createQueueJob.mock.calls.length,
  };
}

function enqueuedIds(): string[] {
  return queueAddBulk.mock.calls.flatMap((c) =>
    (c[0] as Array<{ data: { scheduled_post_id: string } }>).map((j) => j.data.scheduled_post_id)
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('scheduler duplicate guard — state B: a queued post is protected', () => {
  it('an already-queued post is never enqueued a second time', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null), post('p3', null)],
      guard: { data: [{ scheduled_post_id: 'p2', status: 'pending' }], error: null },
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 3, created: 2, skipped: 1 });
    // p2 must be absent from the enqueue batch — this is the duplicate-publish guard.
    expect(enqueuedIds()).toEqual(['p1', 'p3']);
    expect(enqueuedIds()).not.toContain('p2');
  });

  it('both live job statuses protect a post, and an all-queued cycle does zero work', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null)],
      guard: {
        data: [
          { scheduled_post_id: 'p1', status: 'pending' },
          { scheduled_post_id: 'p2', status: 'processing' },
        ],
        error: null,
      },
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 2, created: 0, skipped: 2 });
    expect(writeSurfaces()).toEqual({ queueJobInserts: 0, addBulkCalls: 0, addCalls: 0, createQueueJobCalls: 0 });
  });
});

describe('scheduler duplicate guard — state A: an unqueued post stays eligible', () => {
  it('a successful lookup that returns no rows leaves every due post eligible', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null), post('p3', null)],
      guard: { data: [], error: null }, // succeeded; genuinely nothing queued
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 3, created: 3, skipped: 0 });
    expect(enqueuedIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('does not over-suppress: only the posts the lookup actually names are held back', async () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(`p${i}`, null));
    primeDb({
      duePosts: posts,
      guard: { data: [{ scheduled_post_id: 'p4', status: 'processing' }], error: null },
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 10, created: 9, skipped: 1 });
    expect(enqueuedIds()).toEqual(['p0', 'p1', 'p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9']);
  });
});

describe('scheduler duplicate guard — state C: a failed lookup must NOT read as "nothing queued"', () => {
  it('a lookup error does not make all due posts appear unqueued', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null), post('p3', null)],
      guard: { data: null, error: { message: 'queue_jobs read timeout' } },
    });

    // Collapsing C into A would have produced { found: 3, created: 3 } and three
    // duplicate publishes. The cycle must refuse instead.
    await expect(findDuePostsAndEnqueue()).rejects.toThrow(/Failed to query queue_jobs/);

    expect(writeSurfaces()).toEqual({ queueJobInserts: 0, addBulkCalls: 0, addCalls: 0, createQueueJobCalls: 0 });
    expect(enqueuedIds()).toEqual([]);
  });

  it('aborts BEFORE the campaigns batch — no downstream work is attempted on unknown state', async () => {
    primeDb({
      duePosts: [post('p1', 'c1')],
      guard: { data: null, error: { message: 'connection reset' } },
      campaigns: [{ id: 'c1', status: 'active' }],
    });

    await expect(findDuePostsAndEnqueue()).rejects.toThrow(/Failed to query queue_jobs/);

    expect(dbCalls.filter((c) => c.table === 'campaigns')).toHaveLength(0);
  });

  it('a null payload with no error object is still treated as UNKNOWN, not as "nothing queued"', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null)],
      guard: { data: null, error: null },
    });

    await expect(findDuePostsAndEnqueue()).rejects.toThrow(/Failed to query queue_jobs/);
    expect(writeSurfaces()).toEqual({ queueJobInserts: 0, addBulkCalls: 0, addCalls: 0, createQueueJobCalls: 0 });
  });
});

describe('scheduler duplicate guard — the failure is observable', () => {
  it('surfaces the underlying database reason in the thrown error', async () => {
    primeDb({
      duePosts: [post('p1', null)],
      guard: { data: null, error: { message: 'queue_jobs read timeout' } },
    });

    await expect(findDuePostsAndEnqueue()).rejects.toThrow('Failed to query queue_jobs: queue_jobs read timeout');
  });

  it('logs the failure and records the scheduler run as failed', async () => {
    primeDb({
      duePosts: [post('p1', null), post('p2', null)],
      guard: { data: null, error: { message: 'queue_jobs read timeout' } },
    });

    await expect(findDuePostsAndEnqueue()).rejects.toThrow();

    const logged = (console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/Duplicate-guard lookup failed/);
    expect(logged).toMatch(/queue_jobs read timeout/);

    // The cycle is reported as a FAILURE, not as a quiet zero-result run.
    expect(recordScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'publish_scheduler', outcome: 'failed' })
    );
    expect(recordScheduler).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed' })
    );
  });

  it('a healthy cycle is still recorded as completed (the failure signal is specific)', async () => {
    primeDb({ duePosts: [post('p1', null)] });

    await findDuePostsAndEnqueue();

    expect(recordScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'publish_scheduler', outcome: 'completed' })
    );
  });
});

describe('scheduler duplicate guard — recovery', () => {
  it('a later healthy cycle enqueues the posts the failed cycle refused — exactly once', async () => {
    const posts = [post('p1', null), post('p2', null)];

    // Cycle 1: guard lookup fails → refuse, enqueue nothing.
    primeDb({ duePosts: posts, guard: { data: null, error: { message: 'transient outage' } } });
    await expect(findDuePostsAndEnqueue()).rejects.toThrow(/Failed to query queue_jobs/);
    expect(writeSurfaces().addBulkCalls).toBe(0);

    // Cycle 2: the posts are untouched (still status='scheduled', still due) and
    // the lookup is healthy again → normal enqueue, no manual intervention.
    primeDb({ duePosts: posts, guard: { data: [], error: null } });
    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 2, created: 2, skipped: 0 });
    expect(enqueuedIds()).toEqual(['p1', 'p2']);
    // One enqueue total across both cycles — the outage cost a delay, not a duplicate.
    expect(queueAddBulk).toHaveBeenCalledTimes(1);
  });

  it('recovery still honours state B: posts queued in the meantime stay protected', async () => {
    const posts = [post('p1', null), post('p2', null)];

    primeDb({ duePosts: posts, guard: { data: null, error: { message: 'transient outage' } } });
    await expect(findDuePostsAndEnqueue()).rejects.toThrow();

    primeDb({
      duePosts: posts,
      guard: { data: [{ scheduled_post_id: 'p1', status: 'pending' }], error: null },
    });
    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 2, created: 1, skipped: 1 });
    expect(enqueuedIds()).toEqual(['p2']);
  });
});

describe('scheduler duplicate guard — existing scheduling semantics unchanged', () => {
  it('payload, DB-id jobId and due-post ordering are preserved', async () => {
    primeDb({
      duePosts: [post('p1', 'c1'), post('p2', 'c1')],
      campaigns: [{ id: 'c1', status: 'active' }],
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 2, created: 2, skipped: 0 });
    const jobs = queueAddBulk.mock.calls[0][0] as any[];
    expect(jobs[0]).toEqual({
      name: 'publish',
      data: { scheduled_post_id: 'p1', social_account_id: 'acct-p1', user_id: 'user-p1' },
      opts: { jobId: 'qj-p1', removeOnComplete: true, removeOnFail: false },
    });
    expect(jobs.map((j) => j.data.scheduled_post_id)).toEqual(['p1', 'p2']);
  });

  it('the campaign and release gates still decide skips exactly as before', async () => {
    primeDb({
      duePosts: [
        post('p1', 'c-active'),
        post('p2', 'c-paused'),                            // campaign not active
        post('p3', 'c-missing'),                           // campaign row absent
        { ...post('p4', 'c-active'), status: 'draft' },     // never released
        post('p5', null),                                  // standalone
        post('p6', 'c-active'),
      ],
      guard: { data: [{ scheduled_post_id: 'p6', status: 'pending' }], error: null },
      campaigns: [
        { id: 'c-active', status: 'active' },
        { id: 'c-paused', status: 'paused' },
      ],
    });

    const res = await findDuePostsAndEnqueue();

    // p1 (active + released) and p5 (standalone) enqueue; p2 (campaign paused),
    // p3 (campaign row absent), p4 (never released) and p6 (already queued) skip.
    expect(res).toEqual({ found: 6, created: 2, skipped: 4 });
    expect(enqueuedIds()).toEqual(['p1', 'p5']);
  });

  it('an empty run does zero work and never consults the duplicate guard', async () => {
    primeDb({ duePosts: [] });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 0, created: 0, skipped: 0 });
    expect(dbCalls.filter((c) => c.table === 'queue_jobs')).toHaveLength(0);
    expect(writeSurfaces()).toEqual({ queueJobInserts: 0, addBulkCalls: 0, addCalls: 0, createQueueJobCalls: 0 });
  });

  it('the batched round-trip budget is unchanged (N+1 still eliminated)', async () => {
    const posts = Array.from({ length: 50 }, (_, i) => post(`p${String(i).padStart(3, '0')}`, `c${i % 5}`));
    primeDb({
      duePosts: posts,
      campaigns: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, status: 'active' })),
    });

    const res = await findDuePostsAndEnqueue();

    expect(res).toEqual({ found: 50, created: 50, skipped: 0 });
    // due-posts select + duplicate guard + campaigns + bulk insert = 4.
    expect(dbCalls.filter((c) => c.op === 'resolve')).toHaveLength(4);
    expect(enqueuedIds()).toEqual(posts.map((p) => p.id));
  });

  it('the campaigns lookup still throws, and a bulk-insert failure still falls back per post', async () => {
    primeDb({ duePosts: [post('p1', 'c1')] });
    dbResponses['campaigns:select'] = { data: null, error: { message: 'campaigns table on fire' } };
    await expect(findDuePostsAndEnqueue()).rejects.toThrow('Failed to query campaigns');

    primeDb({ duePosts: [post('p1', null), post('p2', null)] });
    dbResponses['queue_jobs:insert'] = { data: null, error: { message: 'insert exploded' } };
    createQueueJob.mockResolvedValueOnce('fb-1').mockResolvedValueOnce('fb-2');
    const res = await findDuePostsAndEnqueue();
    expect(res).toEqual({ found: 2, created: 2, skipped: 0 });
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });
});
