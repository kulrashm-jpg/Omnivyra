/**
 * Unread-error census, CMS publishing (publishingJobService, main-only). The F sites:
 *   - attempt_count (the persisted retry bound) is written BEFORE the provider call and a failure
 *     there aborts - nothing is published;
 *   - after a SUCCESSFUL publish, a failed job/blog write is not silent: logged at ERROR with the
 *     external id (the job is repaired by stale recovery from the succeeded attempt);
 *   - a failed attempt-result write is logged (the attempt stays 'running' = reviewed, never
 *     republished);
 *   - a failed integration read is recorded as the real cause, not "Integration not found";
 *   - an unwritten claim does not run the job, and is logged.
 * Real service on the fake database; the CMS adapter is a spy.
 */
const mockAdapter = { calls: 0, result: { success: true, message: 'ok', externalId: 'wp-9', externalUrl: 'https://site/p/9' } as any };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/cms/registry', () => ({
  isCmsProvider: () => true,
  getCmsAdapter: () => ({
    publishPost: async () => { mockAdapter.calls += 1; return mockAdapter.result; },
    updatePost: async () => { mockAdapter.calls += 1; return mockAdapter.result; },
    deletePost: async () => { mockAdapter.calls += 1; return mockAdapter.result; },
  }),
}));
jest.mock('../../services/integrationService', () => ({ getIntegration: async () => ({ id: 'int1', config: {} }) }));
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/workerSnapshotShadowHook', () => ({ runWorkerSnapshotShadowHook: async () => undefined }));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { claimDuePublishingJobs, executeClaimedPublishingJob } from '../../services/publishingJobService';

const job = (over: Row = {}): any => ({
  id: 'j1', company_id: 'co-a', website_id: 'w1', connection_id: 'c1', provider: 'wordpress', blog_id: 'b1',
  // A REAL claim: the run's lock identity (the claim fence filters on it).
  job_type: 'publish_post', status: 'processing', locked_by: 'w', locked_at: '2026-11-12T09:59:00.000Z', attempt_count: 0, max_attempts: 3, request_payload: {}, ...over,
});
const seed = () => resetFakeDb({
  publishing_jobs: [job()],
  publishing_attempts: [],
  blogs: [{ id: 'b1', company_id: 'co-a', title: 't', status: 'draft' }],
  company_integrations: [{ id: 'int1', company_id: 'co-a', website_connection_id: 'c1' }],
  integration_logs: [],
});
const jobRow = (): Row => fakeDb.tables.publishing_jobs.find((x) => x.id === 'j1')!;

beforeEach(() => {
  mockAdapter.calls = 0;
  mockAdapter.result = { success: true, message: 'ok', externalId: 'wp-9', externalUrl: 'https://site/p/9' };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('attempt_count write FAILS: aborts BEFORE the provider call - nothing published', async () => {
  seed();
  failNext('publishing_jobs', 'update');
  await expect(executeClaimedPublishingJob(job(), 'w')).rejects.toThrow('Publishing attempt not recorded');
  expect(mockAdapter.calls).toBe(0);
});

it('published, but the JOB write fails: logged at ERROR with the external id (stale recovery repairs it, never republishes)', async () => {
  seed();
  failNext('publishing_jobs', 'update', 1); // [0] attempt_count, [1] markJobPublished
  const r = await executeClaimedPublishingJob(job(), 'w');
  expect(r.success).toBe(true);
  expect(mockAdapter.calls).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('PUBLISHED but the job was not marked published'),
    expect.objectContaining({ job_id: 'j1', external_id: 'wp-9' }));
});

it('published, but the BLOG row write fails: logged at ERROR with the external id', async () => {
  seed();
  failNext('blogs', 'update');
  await executeClaimedPublishingJob(job(), 'w');
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('blog row was NOT updated'),
    expect.objectContaining({ blog_id: 'b1', external_id: 'wp-9' }));
});

it('the attempt RESULT write fails: logged - the attempt stays running, so recovery reviews it', async () => {
  seed();
  failNext('publishing_attempts', 'update');
  await executeClaimedPublishingJob(job(), 'w');
  expect(fakeDb.tables.publishing_attempts[0].status).toBe('running');
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('attempt result NOT recorded'), expect.objectContaining({ job_id: 'j1' }));
});

it('the INTEGRATION read fails: the real cause is recorded, not "Integration not found"', async () => {
  seed();
  failNext('company_integrations', 'select');
  const r = await executeClaimedPublishingJob(job(), 'w');
  expect(r).toMatchObject({ success: false, message: expect.stringContaining('Publishing integration unreadable') });
  expect(mockAdapter.calls).toBe(0);
});

it('an unwritten CLAIM does not run the job, and is logged', async () => {
  resetFakeDb({ publishing_jobs: [job({ status: 'queued', run_after: '2026-01-01T00:00:00.000Z' })], publishing_attempts: [] });
  failNext('publishing_jobs', 'update');
  const claimed = await claimDuePublishingJobs({ workerId: 'w' });
  expect(claimed).toHaveLength(0);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('claim not written'), expect.objectContaining({ job_id: 'j1' }));
});

it('NEGATIVE CONTROL: no injected error - published once; job, attempt and blog all record it', async () => {
  seed();
  const r = await executeClaimedPublishingJob(job(), 'w');
  expect(r.success).toBe(true);
  expect(mockAdapter.calls).toBe(1);
  expect(jobRow()).toMatchObject({ status: 'published', external_id: 'wp-9', attempt_count: 1 });
  expect(fakeDb.tables.publishing_attempts[0].status).toBe('succeeded');
  expect(fakeDb.tables.blogs[0]).toMatchObject({ status: 'published', external_id: 'wp-9' });
});
