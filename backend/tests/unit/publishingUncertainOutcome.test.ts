/**
 * CMS publishing, uncertain outcomes (05 on 6673e3493; e9: pre-launch). A `failed` attempt is
 * ambiguous: a CMS that timed out, reset, or answered 5xx AFTER accepting the post may have it LIVE.
 * For CREATE jobs, anything after the provider call started that is not a clear refusal is
 * UNCERTAIN -> dead-letter "verify on the site", never an automatic retry; stale recovery honours
 * the same verdict. The adapter is a spy here; every REAL adapter's failure messages are held to
 * the classification in cmsAdapterTransportFailureClassification.test.ts.
 */
const mockAdapter = { calls: 0, impl: null as null | (() => Promise<any>) };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/integrationService', () => ({ getIntegration: async () => ({ id: 'int1', config: {} }) }));
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/workerSnapshotShadowHook', () => ({ runWorkerSnapshotShadowHook: async () => undefined }));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';

const job = (over: Row = {}): any => ({
  id: 'j1', company_id: 'co-a', website_id: 'w1', connection_id: 'c1', provider: 'wordpress', blog_id: 'b1',
  // A REAL claim: the run's lock identity (the claim fence filters on it).
  job_type: 'publish_post', status: 'processing', locked_by: 'w', locked_at: '2026-11-12T09:59:00.000Z', attempt_count: 0, max_attempts: 3, request_payload: {}, ...over,
});
const seed = (over: Row = {}) => resetFakeDb({
  publishing_jobs: [job(over)],
  publishing_attempts: [],
  blogs: [{ id: 'b1', company_id: 'co-a', title: 't', status: 'draft', external_id: 'ext-old' }],
  company_integrations: [{ id: 'int1', company_id: 'co-a', website_connection_id: 'c1' }],
  integration_logs: [],
});
const jobRow = (): Row => fakeDb.tables.publishing_jobs.find((x) => x.id === 'j1')!;
const attemptRow = (): Row => fakeDb.tables.publishing_attempts[0];

describe('Part 1 - the job', () => {
  let svc: typeof import('../../services/publishingJobService');
  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock('../../services/cms/registry', () => ({
        isCmsProvider: () => true,
        getCmsAdapter: () => {
          const call = async () => { mockAdapter.calls += 1; return mockAdapter.impl!(); };
          return { publishPost: call, updatePost: call, deletePost: call };
        },
      }));
      svc = require('../../services/publishingJobService');
    });
  });
  beforeEach(() => {
    mockAdapter.calls = 0; mockAdapter.impl = null;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const returns = (r: any) => { mockAdapter.impl = async () => r; };

  it.each([
    ['a 5xx ("returned status 500")', { success: false, message: 'WordPress returned status 500.' }],
    ['a 404 status line (not a CMS refusal of OUR request)', { success: false, message: 'WordPress returned status 404.' }],
    ['an unrecognised failure', { success: false, message: 'Something odd happened.' }],
    ['a failure that still carried an external id (Wix: draft created, publish failed)', { success: false, message: 'Wix draft created but publish failed (status 500).', externalId: 'draft-1' }],
  ])('CREATE + %s: UNCERTAIN -> dead-letter with the review message; called once', async (_l, r) => {
    seed();
    returns(r);
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(mockAdapter.calls).toBe(1);
    expect(attemptRow()).toMatchObject({ status: 'failed', failure_category: svc.UNCERTAIN_PUBLISH_CATEGORY });
    expect(jobRow()).toMatchObject({ status: 'dead_letter', last_error: expect.stringContaining('Verify on the site before retrying') });
  });

  it('CREATE + the adapter THROWS after the call started (timeout / socket): UNCERTAIN -> dead-letter', async () => {
    seed();
    mockAdapter.impl = async () => { throw new Error('The operation was aborted due to timeout'); };
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(jobRow().status).toBe('dead_letter');
    expect(attemptRow().failure_category).toBe(svc.UNCERTAIN_PUBLISH_CATEGORY);
  });

  it.each([
    ['rate limited (429)', { success: false, message: 'WordPress returned status 429.' }, 'retrying'],
    ['authentication refused', { success: false, message: 'WordPress authentication failed. Check your credentials.' }, 'dead_letter'],
  ])('CREATE + a DEFINITE refusal (%s): not uncertain', async (_l, r, status) => {
    seed();
    returns(r);
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(attemptRow().failure_category).not.toBe(svc.UNCERTAIN_PUBLISH_CATEGORY);
    expect(jobRow().status).toBe(status);
    expect(String(jobRow().last_error)).not.toContain('Verify on the site');
  });

  it('a failure BEFORE the provider call (integration unreadable): not uncertain, retrying', async () => {
    seed();
    returns({ success: true, message: 'ok' });
    resetFakeDb({ ...fakeDb.tables, company_integrations: [] });
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(mockAdapter.calls).toBe(0);
    expect(jobRow().status).toBe('retrying');
  });

  it('UPDATE + a 5xx: retrying (an update cannot create a second post)', async () => {
    seed({ job_type: 'update_post' });
    returns({ success: false, message: 'WordPress returned status 500.' });
    await svc.executeClaimedPublishingJob(job({ job_type: 'update_post' }), 'w');
    expect(jobRow().status).toBe('retrying');
  });

  it('stale recovery: latest attempt failed + UNCERTAIN -> dead-letter; failed + provider -> retrying', async () => {
    const PAST = '2026-01-01T00:00:00.000Z';
    resetFakeDb({
      publishing_jobs: [
        { id: 'ju', status: 'processing', lock_expires_at: PAST, attempt_count: 1 },
        { id: 'jp', status: 'processing', lock_expires_at: PAST, attempt_count: 1 },
      ],
      publishing_attempts: [
        { id: 'a1', job_id: 'ju', attempt_number: 1, status: 'failed', failure_category: svc.UNCERTAIN_PUBLISH_CATEGORY },
        { id: 'a2', job_id: 'jp', attempt_number: 1, status: 'failed', failure_category: 'provider' },
      ],
    });
    await svc.recoverStalePublishingJobs('w');
    expect(fakeDb.tables.publishing_jobs.find((x) => x.id === 'ju')!.status).toBe('dead_letter');
    expect(fakeDb.tables.publishing_jobs.find((x) => x.id === 'jp')!.status).toBe('retrying');
  });

  it('UNSUPPORTED (no call was made, e.g. Squarespace): TERMINAL failed - not retried, not dead-lettered "verify on the site"', async () => {
    seed();
    returns({ success: false, message: 'Squarespace does not expose a public write API for blog posts. Publish is not supported.', unsupported: true });
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(attemptRow().failure_category).toBe('unsupported');
    expect(jobRow()).toMatchObject({ status: 'failed', dead_letter_at: null });
    expect(String(jobRow().last_error)).not.toContain('Verify on the site');
  });

  it('NEGATIVE CONTROL: a successful create is published, nothing uncertain', async () => {
    seed();
    returns({ success: true, message: 'ok', externalId: 'wp-1' });
    await svc.executeClaimedPublishingJob(job(), 'w');
    expect(jobRow().status).toBe('published');
    expect(attemptRow().status).toBe('succeeded');
  });
});
