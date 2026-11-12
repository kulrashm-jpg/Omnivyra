/**
 * Dead-lettered CMS publishes: visibility + manual retry (e9, pre-launch; 05's two conditions).
 *   - The queue is keyed on the PAIR status = 'dead_letter' AND dead_letter_at set, and every
 *     failure path keeps the two together (pinned below), so the view cannot fill with jobs a
 *     person need not look at.
 *   - One issue per blog: the blog's LATEST job, only if that job is dead-lettered.
 *   - Retry re-queues ONE dead-lettered job; an OUTCOME-UNKNOWN job only with an explicit
 *     confirmation (enforced server-side); compare-and-set so two clicks re-queue it once; audited.
 */
const mockAudit = jest.fn(async () => undefined);
const mockAdapter = { impl: async (): Promise<any> => ({ success: true, message: 'ok' }) };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: (...a: unknown[]) => (mockAudit as any)(...a) }));
jest.mock('../../services/cms/registry', () => ({
  isCmsProvider: () => true,
  getCmsAdapter: () => ({ publishPost: () => mockAdapter.impl(), updatePost: () => mockAdapter.impl(), deletePost: () => mockAdapter.impl() }),
}));
jest.mock('../../services/integrationService', () => ({ getIntegration: async () => ({ id: 'int1', config: {} }) }));
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/workerSnapshotShadowHook', () => ({ runWorkerSnapshotShadowHook: async () => undefined }));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  UNCERTAIN_PUBLISH_CATEGORY,
  executeClaimedPublishingJob,
  listPublishingIssues,
  requeueDeadLetteredPublishingJob,
} from '../../services/publishingJobService';

const CO = 'co-a';
const DL = '2026-11-12T10:00:00.000Z';
const j = (id: string, over: Row = {}): Row => ({
  id, company_id: CO, blog_id: 'b1', provider: 'wordpress', job_type: 'publish_post', status: 'dead_letter',
  dead_letter_at: DL, last_error: 'WordPress returned status 500.', failure_category: 'provider',
  attempt_count: 3, max_attempts: 3, created_at: '2026-11-12T09:00:00.000Z', ...over,
});
const jobRow = (id: string): Row => fakeDb.tables.publishing_jobs.find((x) => x.id === id)!;

beforeEach(() => {
  mockAudit.mockClear();
  mockAdapter.impl = async () => ({ success: true, message: 'ok' });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('listPublishingIssues', () => {
  it('one issue per blog, from the LATEST job, with the evidence of its last attempt', async () => {
    resetFakeDb({
      publishing_jobs: [
        j('old', { created_at: '2026-11-11T09:00:00.000Z' }),
        j('new', { failure_category: UNCERTAIN_PUBLISH_CATEGORY, last_error: 'Publish outcome unknown ...' }),
      ],
      publishing_attempts: [
        { job_id: 'new', attempt_number: 1, status: 'failed', error_message: 'first', started_at: 'x' },
        { job_id: 'new', attempt_number: 2, status: 'failed', error_message: 'WordPress returned status 502.', started_at: '2026-11-12T09:59:00.000Z', finished_at: '2026-11-12T10:00:00.000Z' },
      ],
    });
    const issues = await listPublishingIssues(CO);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      job_id: 'new', blog_id: 'b1', provider: 'wordpress', outcome_unknown: true,
      last_attempt: { status: 'failed', error_message: 'WordPress returned status 502.', finished_at: '2026-11-12T10:00:00.000Z' },
    });
  });

  it('a dead-lettered job SUPERSEDED by a later publish of the same blog is not an issue', async () => {
    resetFakeDb({ publishing_jobs: [j('dl', { created_at: '2026-11-11T09:00:00.000Z' }), j('ok', { status: 'published', dead_letter_at: null })], publishing_attempts: [] });
    expect(await listPublishingIssues(CO)).toEqual([]);
  });

  it('keyed on the PAIR: status dead_letter without dead_letter_at is not listed (05)', async () => {
    resetFakeDb({ publishing_jobs: [j('half', { dead_letter_at: null })], publishing_attempts: [] });
    expect(await listPublishingIssues(CO)).toEqual([]);
  });

  it('another company\\u2019s dead letters are not listed', async () => {
    resetFakeDb({ publishing_jobs: [j('x', { company_id: 'co-b' })], publishing_attempts: [] });
    expect(await listPublishingIssues(CO)).toEqual([]);
  });

  it('an UNREADABLE queue throws - never "no issues"', async () => {
    resetFakeDb({ publishing_jobs: [j('a')], publishing_attempts: [] });
    failNext('publishing_jobs', 'select');
    await expect(listPublishingIssues(CO)).rejects.toThrow('Publishing jobs unreadable');
  });
});

describe('requeueDeadLetteredPublishingJob', () => {
  it('an ordinary failure: re-queued without confirmation; dead-letter fields cleared; audited', async () => {
    resetFakeDb({ publishing_jobs: [j('a')], publishing_attempts: [] });
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'a', companyId: CO, actorUserId: 'u1' })).toEqual({ ok: true, outcome_unknown: false });
    expect(jobRow('a')).toMatchObject({ status: 'queued', dead_letter_at: null, failure_category: null, last_error: null, max_attempts: 4 });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'publishing_job.manual_retry', resourceId: 'a', actorUserId: 'u1' }));
  });

  it('OUTCOME UNKNOWN without confirmation: refused (server-side), nothing changes, not audited', async () => {
    resetFakeDb({ publishing_jobs: [j('u', { failure_category: UNCERTAIN_PUBLISH_CATEGORY })], publishing_attempts: [] });
    const r = await requeueDeadLetteredPublishingJob({ jobId: 'u', companyId: CO, actorUserId: 'u1' });
    expect(r).toMatchObject({ ok: false, code: 'CONFIRM_OUTCOME_UNKNOWN' });
    expect(jobRow('u').status).toBe('dead_letter');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('OUTCOME UNKNOWN WITH confirmation: re-queued, audited at warning with the confirmation recorded', async () => {
    resetFakeDb({ publishing_jobs: [j('u', { failure_category: UNCERTAIN_PUBLISH_CATEGORY })], publishing_attempts: [] });
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'u', companyId: CO, actorUserId: 'u1', confirmOutcomeUnknown: true }))
      .toEqual({ ok: true, outcome_unknown: true });
    expect(jobRow('u').status).toBe('queued');
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', metadata: expect.objectContaining({ confirmed_outcome_unknown: true }) }));
  });

  it('two retries of the same job: re-queued ONCE (compare-and-set)', async () => {
    resetFakeDb({ publishing_jobs: [j('a')], publishing_attempts: [] });
    const [r1, r2] = await Promise.all([
      requeueDeadLetteredPublishingJob({ jobId: 'a', companyId: CO, actorUserId: 'u1' }),
      requeueDeadLetteredPublishingJob({ jobId: 'a', companyId: CO, actorUserId: 'u1' }),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not dead-lettered', [j('a', { status: 'retrying', dead_letter_at: null })], 'NOT_DEAD_LETTER'],
    ['another company', [j('a', { company_id: 'co-b' })], 'NOT_FOUND'],
  ] as const)('%s: refused', async (_l, jobs, code) => {
    resetFakeDb({ publishing_jobs: [...jobs], publishing_attempts: [] });
    expect(await requeueDeadLetteredPublishingJob({ jobId: 'a', companyId: CO, actorUserId: 'u1', confirmOutcomeUnknown: true }))
      .toMatchObject({ ok: false, code });
  });
});

describe('the PAIR invariant: dead_letter_at is set exactly when status is dead_letter (05)', () => {
  const run = async (adapterResult: any) => {
    resetFakeDb({
      publishing_jobs: [j('r', { status: 'processing', locked_by: 'w', locked_at: '2026-11-12T09:59:00.000Z', dead_letter_at: null, attempt_count: 0, max_attempts: 3 })],
      publishing_attempts: [], blogs: [{ id: 'b1', company_id: CO, title: 't' }],
      company_integrations: [{ id: 'int1', company_id: CO, website_connection_id: 'c1' }], integration_logs: [],
    });
    mockAdapter.impl = async () => adapterResult;
    await executeClaimedPublishingJob({ ...j('r', { status: 'processing', locked_by: 'w', locked_at: '2026-11-12T09:59:00.000Z', attempt_count: 0, max_attempts: 3 }), connection_id: 'c1', request_payload: {} } as any, 'w');
    return jobRow('r');
  };
  it.each([
    ['uncertain', { success: false, message: 'WordPress returned status 500.' }, 'dead_letter'],
    ['auth refusal', { success: false, message: 'WordPress authentication failed.' }, 'dead_letter'],
    ['rate limit', { success: false, message: 'WordPress returned status 429.' }, 'retrying'],
    ['unsupported', { success: false, message: 'not supported', unsupported: true }, 'failed'],
  ] as const)('%s: dead_letter_at is present iff the status is dead_letter', async (_l, result, status) => {
    const row = await run(result);
    expect(row.status).toBe(status);
    expect(Boolean(row.dead_letter_at)).toBe(status === 'dead_letter');
  });
});
