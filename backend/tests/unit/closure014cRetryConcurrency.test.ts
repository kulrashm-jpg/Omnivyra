/**
 * Closure-014C (Finding A) — concurrent POST /api/scheduler/retry must never
 * strand a post. Closure-014B reproduced it on the real stack (60 parallel
 * retries): a LOSING retry cancelled the job the WINNING retry had just queued,
 * leaving the post 'scheduled' with no live job.
 *
 * Real route; database = the routeAuthHarness fake (compare-and-set predicates
 * are evaluated against the current row at write time); the queue is a small
 * STATEFUL model (cancel retires every live job, enqueue creates one), so a
 * cancel that lands on the winner's job is observable. Interleavings are forced
 * with explicit barriers, never timing. In-memory: proves the route's ordering
 * and decisions — not Postgres or BullMQ concurrency (see the 014C report for
 * the real-stack run).
 */
import { seed, invoke, rows, USER_A, CAMPAIGN_A } from '../helpers/routeAuthHarness';

type Job = { id: string; status: 'pending' | 'cancelled' };
const mockJobs: Job[] = [];
const mockLog: string[] = [];
let mockCancelHook: ((n: number) => Promise<void> | void) | null = null;
let mockCancelErrors: string[] = [];
let mockEnqueueImpl: (() => Promise<'enqueued' | 'duplicate' | 'past'>) | null = null;
let mockCancelCalls = 0;

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async () => {
    const n = ++mockCancelCalls;
    if (mockCancelHook) await mockCancelHook(n);
    if (mockCancelErrors.length) { mockLog.push(`cancel#${n}:error`); return { db_cancelled: 0, queue_removed: 0, errors: mockCancelErrors }; }
    let k = 0;
    for (const j of mockJobs) if (j.status === 'pending') { j.status = 'cancelled'; k++; }
    mockLog.push(`cancel#${n}:retired=${k}`);
    return { db_cancelled: k, queue_removed: k, errors: [] };
  }),
  enqueueScheduledPostAt: jest.fn(async () => {
    if (mockEnqueueImpl) return mockEnqueueImpl();
    if (mockJobs.some((j) => j.status === 'pending')) { mockLog.push('enqueue:duplicate'); return 'duplicate'; }
    const id = `job-${mockJobs.length + 1}`;
    mockJobs.push({ id, status: 'pending' });
    mockLog.push(`enqueue:${id}`);
    return 'enqueued';
  }),
}));

import retryRoute from '../../../pages/api/scheduler/retry';
import { RETRY_CLAIM_STALE_MS, retryPreparingCode } from '../../queue/publishOutcome';

type Row = Record<string, unknown>;
const POST = '0a000000-0000-4000-8000-0000000000c1';
const ORIGINAL = { error_code: 'LINKEDIN_RATE_LIMIT', error_message: 'rate limited', scheduled_for: '2027-01-01T00:00:00.000Z' };

function world(over: Row = {}, priorJob = true) {
  seed({
    scheduled_posts: [{
      id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'failed',
      platform: 'linkedin', platform_post_id: null, parent_post_id: null, ...ORIGINAL, ...over,
    }],
  });
  mockJobs.length = 0;
  if (priorJob) mockJobs.push({ id: 'job-prior', status: 'pending' }); // e.g. a job in BullMQ backoff
}
const retry = () => invoke(retryRoute as never, { method: 'POST', body: { scheduled_post_id: POST }, as: 'A' });
const post = () => rows('scheduled_posts').find((p) => p.id === POST) as Row;
const liveJobs = () => mockJobs.filter((j) => j.status === 'pending');
const deferred = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

beforeEach(() => {
  mockLog.length = 0;
  mockCancelHook = null;
  mockCancelErrors = [];
  mockEnqueueImpl = null;
  mockCancelCalls = 0;
});

describe('the reported race (Closure-014B, D-14B-1)', () => {
  it('a losing retry held at its cancel until the winner has queued cannot retire the winner\'s job', async () => {
    world();
    // Barrier: whichever request reaches the cancel SECOND waits there until the
    // first request has completely finished (queued its job and answered).
    const gate = deferred();
    mockCancelHook = async (n) => { if (n === 2) await gate.p; };
    const p1 = retry();
    const p2 = retry();
    await Promise.race([p1, p2]);
    gate.open();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(post()).toMatchObject({ status: 'scheduled', error_code: null });
    expect(liveJobs()).toHaveLength(1); // before the fix: 0 — the post was stranded
    expect(mockCancelCalls).toBe(1); // only the claim holder cancels
  });

  it.each([2, 5, 20])('%i concurrent retries: exactly one 200, exactly one live job, one cancel', async (n) => {
    world();
    const gate = deferred();
    mockCancelHook = async (k) => { if (k > 1) await gate.p; };
    const all = Array.from({ length: n }, () => retry());
    await Promise.race(all);
    gate.open();
    const rs = await Promise.all(all);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status !== 200).every((r) => r.status === 409)).toBe(true);
    expect(liveJobs()).toHaveLength(1);
    expect(mockCancelCalls).toBe(1);
    expect(post()).toMatchObject({ status: 'scheduled' });
  });
});

describe('only the claim holder may act; a live claim is never stolen', () => {
  it('a second retry while the first holds its claim (paused inside its cancel) → 409 RETRY_IN_PROGRESS, touches nothing', async () => {
    world();
    const inCancel = deferred();
    const resume = deferred();
    mockCancelHook = async (n) => { if (n === 1) { inCancel.open(); await resume.p; } };
    const p1 = retry();
    await inCancel.p; // first retry holds the claim and is mid-cancel
    expect(String(post().error_code)).toMatch(/^RETRY_PREPARING:\d+:/);
    const r2 = await retry();
    expect(r2.status).toBe(409);
    expect(r2.body).toMatchObject({ code: 'RETRY_IN_PROGRESS' });
    expect(mockCancelCalls).toBe(1);
    resume.open();
    const r1 = await p1;
    expect(r1.status).toBe(200);
    expect(liveJobs()).toHaveLength(1);
  });

  it('a claim older than the stale window (a request that died) is taken over', async () => {
    world({ error_code: retryPreparingCode(Date.now() - RETRY_CLAIM_STALE_MS - 1000, 'dead') });
    const r = await retry();
    expect(r.status).toBe(200);
    expect(post()).toMatchObject({ status: 'scheduled', error_code: null });
    expect(liveJobs()).toHaveLength(1);
  });

  it('a claim that is not stale yet is NOT taken over', async () => {
    world({ error_code: retryPreparingCode(Date.now() - RETRY_CLAIM_STALE_MS + 60_000, 'alive') });
    const r = await retry();
    expect(r.status).toBe(409);
    expect(mockCancelCalls).toBe(0);
    expect(liveJobs().map((j) => j.id)).toEqual(['job-prior']);
  });
});

describe('interleavings around the claim and the reset', () => {
  it('an uncertain outcome recorded after the claim: the reset refuses, the marker is kept, nothing queued', async () => {
    world();
    mockCancelHook = () => { const t = rows('scheduled_posts'); const i = t.findIndex((p) => p.id === POST); t[i] = { ...t[i], error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }; };
    const r = await retry();
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(mockLog.some((e) => e.startsWith('enqueue'))).toBe(false);
  });

  it('a published identity recorded after the claim: the reset refuses, nothing queued', async () => {
    world();
    mockCancelHook = () => { const t = rows('scheduled_posts'); const i = t.findIndex((p) => p.id === POST); t[i] = { ...t[i], platform_post_id: 'li-late' }; };
    const r = await retry();
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ platform_post_id: 'li-late', status: 'failed' });
    expect(mockLog.some((e) => e.startsWith('enqueue'))).toBe(false);
  });
});

describe('failure after the claim never leaves a scheduled post without a job', () => {
  it('cancel fails (queue_jobs error) → 503, claim released to the exact prior state, prior job untouched, nothing queued', async () => {
    world();
    mockCancelErrors = ['queue_jobs cancel update: boom'];
    const r = await retry();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'PRIOR_JOB_CANCEL_FAILED', retryable: true });
    expect(post()).toMatchObject({ status: 'failed', ...ORIGINAL });
    expect(liveJobs().map((j) => j.id)).toEqual(['job-prior']);
    mockCancelErrors = [];
    expect((await retry()).status).toBe(200); // repeatable
  });

  it('enqueue throws → 502 ENQUEUE_FAILED, post restored to its exact failed state, retry repeatable', async () => {
    world(undefined, false);
    mockEnqueueImpl = async () => { throw new Error('redis down'); };
    const r = await retry();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: 'ENQUEUE_FAILED', retryable: true, post_restored: true });
    expect(post()).toMatchObject({ status: 'failed', ...ORIGINAL });
    mockEnqueueImpl = null;
    const again = await retry();
    expect(again.status).toBe(200);
    expect(liveJobs()).toHaveLength(1);
  });

  it("enqueue answers 'past' (nothing queued) → 503 RETRY_NOT_QUEUED, post restored — never a 200 with no job", async () => {
    world(undefined, false);
    mockEnqueueImpl = async () => 'past';
    const r = await retry();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'RETRY_NOT_QUEUED', post_restored: true });
    expect(post()).toMatchObject({ status: 'failed', ...ORIGINAL });
  });

  it('the restore never clobbers a post someone else moved on (compare-and-set on the reset this retry wrote)', async () => {
    world(undefined, false);
    mockEnqueueImpl = async () => {
      const t = rows('scheduled_posts'); const i = t.findIndex((p) => p.id === POST);
      t[i] = { ...t[i], status: 'publishing', error_code: 'PUBLISH_CLAIMED:w1' }; // a delivery claimed it meanwhile
      throw new Error('ambiguous add');
    };
    const r = await retry();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ post_restored: false });
    expect(post()).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:w1' });
  });

  it("enqueue answers 'duplicate' (someone else's live job exists) → 200, that job kept", async () => {
    world(undefined, false);
    mockEnqueueImpl = async () => 'duplicate';
    const r = await retry();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enqueue: 'duplicate' });
  });
});
