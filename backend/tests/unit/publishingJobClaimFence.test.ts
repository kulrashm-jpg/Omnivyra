/**
 * CMS publishing: CLASS-2 read-then-act races (e9 sweep, 2026-11-12). Every act on a publishing
 * job is backed by a constraint, never by a read alone:
 *   - create: ON CONFLICT DO NOTHING on publishing_jobs_idempotency_unique; an existing job is re-armed
 *     only from a waiting/terminal-unsent state, by compare-and-set with the row count checked;
 *   - Publish now: claims only a WAITING job (never one another run is processing);
 *   - a run's writes are fenced on its claim (status + locked_by + locked_at);
 *   - stale recovery is pinned to the stale lock it read; the manual retry to the dead letter it read;
 *   - a failed publish never erases the blog's external id (which sent the next Publish down the
 *     create path - a duplicate post).
 * Real publishingJobService + blogService over the fake database; the CMS adapter is a counting spy.
 */
const mockAdapter = { calls: 0, impl: null as null | (() => Promise<any>) };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/cms/registry', () => ({
  isCmsProvider: () => true,
  getCmsAdapter: () => {
    const call = async () => { mockAdapter.calls += 1; return mockAdapter.impl!(); };
    return { publishPost: call, updatePost: call, deletePost: call };
  },
}));
jest.mock('../../services/integrationService', () => {
  const integration = { id: 'int1', type: 'wordpress', config: {}, website_id: 'w1', website_connection_id: 'c1' };
  return { getIntegration: async () => integration, getActiveIntegration: async () => integration };
});
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/workerSnapshotShadowHook', () => ({ runWorkerSnapshotShadowHook: async () => undefined }));
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: async () => undefined }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));
jest.mock('../../services/publishSnapshotCaptureService', () => ({ captureBlogPublishSnapshotSafely: async () => undefined }));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  UNCERTAIN_PUBLISH_CATEGORY,
  createPublishingJob,
  executeClaimedPublishingJob,
  executePublishingJob,
  recoverStalePublishingJobs,
  requeueDeadLetteredPublishingJob,
} from '../../services/publishingJobService';
import { publishBlogPost } from '../../services/blogService';

const CO = 'co-a';
const KEY = 'blog:b1:publish:int1';
const LOCK = '2026-11-12T09:59:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const DL = '2026-11-12T10:00:00.000Z';

const jobRow = (over: Row = {}): Row => ({
  id: 'j1', company_id: CO, website_id: 'w1', connection_id: 'c1', blog_id: 'b1', provider: 'wordpress',
  job_type: 'publish_post', status: 'queued', idempotency_key: KEY, attempt_count: 0, max_attempts: 3,
  request_payload: { title: 'old' }, ...over,
});
const blogRow = (over: Row = {}): Row => ({ id: 'b1', company_id: CO, title: 'Spring', slug: 'spring', content: '<p>x</p>', status: 'draft', external_id: null, ...over });
const seed = (jobs: Row[], blog: Row = blogRow()) => resetFakeDb({
  publishing_jobs: jobs, publishing_attempts: [], blogs: [blog],
  company_integrations: [{ id: 'int1', company_id: CO, website_connection_id: 'c1' }], integration_logs: [],
});
const job = (): Row => fakeDb.tables.publishing_jobs.find((x) => x.id === 'j1')!;
const blog = (): Row => fakeDb.tables.blogs[0];
const input = (over: Record<string, unknown> = {}) => ({
  companyId: CO, connectionId: 'c1', blogId: 'b1', provider: 'wordpress' as const, idempotencyKey: KEY,
  requestPayload: { title: 'new' }, ...over,
});

/** Runs `mutate` once, when the first builder on `table` is created after `afterCall` was issued. */
function interleave(table: string, afterCall: string, mutate: () => void) {
  const mod = require('../helpers/fakeWhatsappDb'); // the module object writeOwner's mock calls through
  const real = mod.fakeTable;
  let done = false;
  return jest.spyOn(mod, 'fakeTable').mockImplementation((t: string) => {
    if (!done && t === table && fakeDb.calls.includes(afterCall)) { done = true; mutate(); }
    return real(t);
  });
}

beforeEach(() => {
  mockAdapter.calls = 0;
  mockAdapter.impl = async () => ({ success: true, message: 'ok', externalId: 'wp-9', externalUrl: 'https://site/p/9' });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('D1 createPublishingJob never resets a live job', () => {
  it('NEGATIVE CONTROL: no job holds the key -> a queued job is created', async () => {
    seed([]);
    const created = await createPublishingJob(input());
    expect(created).toMatchObject({ status: 'queued', idempotency_key: KEY, request_payload: { title: 'new' } });
    expect(fakeDb.tables.publishing_jobs).toHaveLength(1);
  });

  it.each([
    ['processing (another run is calling the CMS)', { status: 'processing', locked_by: 'w', locked_at: LOCK, lock_expires_at: FUTURE }],
    ['published (the post is live)', { status: 'published', external_id: 'wp-1' }],
    ['dead_letter, outcome unknown (must go through the confirmed retry)', { status: 'dead_letter', dead_letter_at: DL, failure_category: UNCERTAIN_PUBLISH_CATEGORY }],
  ])('existing job %s: returned UNTOUCHED', async (_l, state) => {
    seed([jobRow(state)]);
    const before = { ...job() };
    const got = await createPublishingJob(input());
    expect(got.status).toBe(state.status);
    expect(job()).toEqual(before);
  });

  it.each(['queued', 'retrying', 'scheduled', 'failed', 'cancelled'])('existing job %s: re-armed with the new payload (CAS on the status read)', async (status) => {
    seed([jobRow({ status, attempt_count: 3, max_attempts: 3, last_error: 'x', failure_category: 'unsupported' })]);
    const got = await createPublishingJob(input());
    expect(got).toMatchObject({ id: 'j1', status: 'queued', request_payload: { title: 'new' }, last_error: null, failure_category: null, max_attempts: 4 });
  });

  it('the job moves to processing between the read and the re-arm: the CAS misses, and it is returned untouched', async () => {
    seed([jobRow({ status: 'queued' })]);
    interleave('publishing_jobs', 'publishing_jobs:select', () => Object.assign(job(), { status: 'processing', locked_by: 'w2', locked_at: LOCK }));
    const got = await createPublishingJob(input());
    expect(got).toMatchObject({ status: 'processing', locked_by: 'w2', request_payload: { title: 'old' } });
  });
});

describe('D2 Publish now never claims a job another run holds', () => {
  it('processing job: notClaimed, the CMS is NOT called, nothing written', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK, lock_expires_at: FUTURE })]);
    const before = { ...job() };
    expect(await executePublishingJob('j1')).toMatchObject({ success: false, notClaimed: true });
    expect(mockAdapter.calls).toBe(0);
    expect(job()).toEqual(before);
  });

  it('NEGATIVE CONTROL: a queued job is claimed and published once', async () => {
    seed([jobRow()]);
    expect(await executePublishingJob('j1')).toMatchObject({ success: true, external_id: 'wp-9' });
    expect(mockAdapter.calls).toBe(1);
    expect(job().status).toBe('published');
  });
});

describe('the double click: two Publish requests for one blog publish ONCE', () => {
  it('the second request, made while the first is calling the CMS, reports in-progress and calls nothing', async () => {
    seed([]);
    let second: Awaited<ReturnType<typeof publishBlogPost>> | null = null;
    mockAdapter.impl = async () => {
      // The second click lands mid-call - once (a regression that re-runs the job must fail by
      // name here, not recurse).
      if (mockAdapter.calls === 1) second = await publishBlogPost('b1', CO);
      return { success: true, message: 'ok', externalId: 'wp-9', externalUrl: 'https://site/p/9' };
    };
    const first = await publishBlogPost('b1', CO);
    expect(mockAdapter.calls).toBe(1);
    expect(first).toMatchObject({ success: true, external_id: 'wp-9' });
    expect(second).toMatchObject({ success: false, in_progress: true });
    expect(blog()).toMatchObject({ status: 'published', external_id: 'wp-9' });
  });

  it('Publish after the post is live (its id lost from the blog row): NOT republished; the blog row is repaired from the job', async () => {
    seed([jobRow({ status: 'published', external_id: 'wp-1', external_url: 'https://site/p/1' })]);
    const r = await publishBlogPost('b1', CO);
    expect(mockAdapter.calls).toBe(0);
    expect(r).toMatchObject({ success: true, external_id: 'wp-1' });
    expect(blog()).toMatchObject({ status: 'published', external_id: 'wp-1', external_url: 'https://site/p/1' });
  });

  it('Publish on an outcome-unknown dead letter: NOT re-run (the confirmed retry is the only way), blog untouched', async () => {
    seed([jobRow({ status: 'dead_letter', dead_letter_at: DL, failure_category: UNCERTAIN_PUBLISH_CATEGORY })]);
    const r = await publishBlogPost('b1', CO);
    expect(mockAdapter.calls).toBe(0);
    expect(r).toMatchObject({ success: false, needs_review: true });
    expect(job().status).toBe('dead_letter');
    expect(blog().status).toBe('draft');
  });
});

describe('D3 a failed publish never erases the live external id', () => {
  // Only Date is faked: the update job's key carries the minute, so it is seeded with the database's
  // column defaults (attempt_count 0, max_attempts 3), which the fake does not apply on insert.
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-12T12:00:30.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => jest.useRealTimers());

  it('an update of a live post fails: external_id / external_url kept, status failed', async () => {
    seed([jobRow({ job_type: 'update_post', idempotency_key: 'blog:b1:update:int1:2026-11-12T12:00' })], blogRow({ status: 'published', external_id: 'wp-live', external_url: 'https://site/p/live', published_at: DL }));
    mockAdapter.impl = async () => ({ success: false, message: 'WordPress returned status 500.' });
    expect(await publishBlogPost('b1', CO)).toMatchObject({ success: false });
    expect(mockAdapter.calls).toBe(1);
    expect(blog()).toMatchObject({ status: 'failed', external_id: 'wp-live', external_url: 'https://site/p/live', published_at: DL });
  });
});

describe('#6/#7 a run that lost its claim writes nothing over the newer run', () => {
  const claimed = () => ({ ...jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK }), request_payload: {} } as any);

  it('claim lost BEFORE the call (re-claimed by another run): no attempt row, no CMS call, attempt_count untouched', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: '2026-11-12T10:05:00.000Z', attempt_count: 2 })]);
    expect(await executeClaimedPublishingJob(claimed(), 'w')).toMatchObject({ success: false, notClaimed: true });
    expect(mockAdapter.calls).toBe(0);
    expect(fakeDb.tables.publishing_attempts).toHaveLength(0);
    expect(job().attempt_count).toBe(2);
  });

  it('claim lost DURING the call, then a definite failure: NOT written as retrying over the newer run', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK })]);
    mockAdapter.impl = async () => {
      Object.assign(job(), { locked_by: 'w2', locked_at: '2026-11-12T10:05:00.000Z' }); // recovered + re-claimed
      return { success: false, message: 'WordPress returned status 429.' };
    };
    await executeClaimedPublishingJob(claimed(), 'w');
    expect(job()).toMatchObject({ status: 'processing', locked_by: 'w2' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('lost its claim'), expect.objectContaining({ job_id: 'j1' }));
  });

  it('claim lost DURING the call, then success: the newer run is not overwritten, and the live id is logged at ERROR', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK })]);
    mockAdapter.impl = async () => {
      Object.assign(job(), { locked_by: 'w2', locked_at: '2026-11-12T10:05:00.000Z' });
      return { success: true, message: 'ok', externalId: 'wp-9' };
    };
    await executeClaimedPublishingJob(claimed(), 'w');
    expect(job()).toMatchObject({ status: 'processing', locked_by: 'w2' });
    expect(fakeDb.tables.publishing_attempts[0].status).toBe('succeeded');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('lost its claim'), expect.objectContaining({ external_id: 'wp-9' }));
  });

  it('NEGATIVE CONTROL: claim held throughout -> the failure is written (retrying)', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK })]);
    mockAdapter.impl = async () => ({ success: false, message: 'WordPress returned status 429.' });
    await executeClaimedPublishingJob(claimed(), 'w');
    expect(job().status).toBe('retrying');
  });
});

describe('D4 stale recovery is pinned to the stale lock it read', () => {
  it('re-claimed between the read and the write (a fresh lock): untouched, not counted', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK, lock_expires_at: PAST, attempt_count: 1 })]);
    fakeDb.tables.publishing_attempts = [{ id: 'a1', job_id: 'j1', attempt_number: 1, status: 'failed' }];
    interleave('publishing_jobs', 'publishing_attempts:select', () => Object.assign(job(), { locked_by: 'w2', locked_at: '2026-11-12T10:05:00.000Z', lock_expires_at: FUTURE }));
    expect(await recoverStalePublishingJobs('r')).toBe(0);
    expect(job()).toMatchObject({ status: 'processing', locked_by: 'w2', lock_expires_at: FUTURE });
  });

  it('re-claimed by the SAME worker process (one locked_by per process) with a fresh lock: untouched', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK, lock_expires_at: PAST, attempt_count: 1 })]);
    fakeDb.tables.publishing_attempts = [{ id: 'a1', job_id: 'j1', attempt_number: 1, status: 'failed' }];
    interleave('publishing_jobs', 'publishing_attempts:select', () => Object.assign(job(), { locked_at: '2026-11-12T10:05:00.000Z', lock_expires_at: FUTURE }));
    expect(await recoverStalePublishingJobs('r')).toBe(0);
    expect(job()).toMatchObject({ status: 'processing', lock_expires_at: FUTURE });
  });

  it('NEGATIVE CONTROL: still stale at the write -> recovered and counted', async () => {
    seed([jobRow({ status: 'processing', locked_by: 'w', locked_at: LOCK, lock_expires_at: PAST, attempt_count: 1 })]);
    fakeDb.tables.publishing_attempts = [{ id: 'a1', job_id: 'j1', attempt_number: 1, status: 'failed' }];
    expect(await recoverStalePublishingJobs('r')).toBe(1);
    expect(job().status).toBe('retrying');
  });
});

describe('#8 the manual retry is pinned to the dead letter it read', () => {
  const dl = (over: Row = {}) => jobRow({ status: 'dead_letter', dead_letter_at: DL, failure_category: 'provider', attempt_count: 3, ...over });

  it('the job cycled to a NEWER outcome-unknown dead letter after the read: not re-queued on the old decision', async () => {
    seed([dl()]);
    interleave('publishing_jobs', 'publishing_jobs:select', () => Object.assign(job(), { dead_letter_at: '2026-11-12T11:00:00.000Z', failure_category: UNCERTAIN_PUBLISH_CATEGORY }));
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'j1', companyId: CO, actorUserId: 'u1' })).toMatchObject({ ok: false, code: 'NOT_DEAD_LETTER' });
    expect(job().status).toBe('dead_letter');
  });

  it('a CONFIRMED outcome-unknown retry, but the job is a NEWER outcome-unknown dead letter by the write: not re-queued on the old confirmation', async () => {
    seed([dl({ failure_category: UNCERTAIN_PUBLISH_CATEGORY })]);
    interleave('publishing_jobs', 'publishing_jobs:select', () => Object.assign(job(), { dead_letter_at: '2026-11-12T11:00:00.000Z' }));
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'j1', companyId: CO, actorUserId: 'u1', confirmOutcomeUnknown: true })).toMatchObject({ ok: false });
    expect(job().status).toBe('dead_letter');
  });

  it('only the category changed (same dead_letter_at) to outcome unknown: not re-queued without confirmation', async () => {
    seed([dl()]);
    interleave('publishing_jobs', 'publishing_jobs:select', () => Object.assign(job(), { failure_category: UNCERTAIN_PUBLISH_CATEGORY }));
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'j1', companyId: CO, actorUserId: 'u1' })).toMatchObject({ ok: false });
    expect(job().status).toBe('dead_letter');
  });

  it('NEGATIVE CONTROL: unchanged since the read -> re-queued', async () => {
    seed([dl()]);
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'j1', companyId: CO, actorUserId: 'u1' })).toMatchObject({ ok: true });
    expect(job().status).toBe('queued');
  });
});
