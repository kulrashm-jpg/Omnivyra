/**
 * CMS publishing: a job left `processing` past its lock must NEVER be published twice
 * (e9: BLOCKING, correct-sending). Stale recovery used to flip every such job to `retrying`,
 * which republished a post that had already gone live whenever the job was never marked
 * published (worker crash after the provider call, or a failed status write). The job's LATEST
 * attempt now decides: succeeded -> published (repair); running -> dead-letter for review;
 * failed / none -> retrying; unreadable -> left alone this tick.
 * Real recoverStalePublishingJobs on the fake database.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { recoverStalePublishingJobs } from '../../services/publishingJobService';

const PAST = '2026-01-01T00:00:00.000Z';
const job = (id: string, over: Row = {}): Row => ({ id, status: 'processing', lock_expires_at: PAST, attempt_count: 1, ...over });
const attempt = (jobId: string, n: number, status: string, over: Row = {}): Row =>
  ({ id: `${jobId}-a${n}`, job_id: jobId, attempt_number: n, status, provider_response: { id: 'wp-123' }, ...over });
const seed = (jobs: Row[], attempts: Row[]) => resetFakeDb({ publishing_jobs: jobs, publishing_attempts: attempts });
const row = (id: string): Row => fakeDb.tables.publishing_jobs.find((x) => x.id === id)!;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('last attempt SUCCEEDED (published, never marked): marked published from the attempt - NOT re-queued', async () => {
  seed([job('j1')], [attempt('j1', 1, 'succeeded')]);
  expect(await recoverStalePublishingJobs('w')).toBe(1);
  expect(row('j1')).toMatchObject({ status: 'published', provider_response: { id: 'wp-123' }, locked_by: null });
  expect(row('j1').status).not.toBe('retrying');
});

it('last attempt RUNNING (crash mid-publish, outcome unknown): DEAD-LETTERED for review - never auto-republished', async () => {
  seed([job('j1')], [attempt('j1', 1, 'running')]);
  await recoverStalePublishingJobs('w');
  expect(row('j1')).toMatchObject({ status: 'dead_letter', last_error: expect.stringContaining('Verify on the site before retrying') });
});

it('the LATEST attempt decides (an older success does not mask a newer running attempt)', async () => {
  seed([job('j1', { attempt_count: 2 })], [attempt('j1', 1, 'succeeded'), attempt('j1', 2, 'running')]);
  await recoverStalePublishingJobs('w');
  expect(row('j1').status).toBe('dead_letter');
});

it('the attempt read FAILS: the job is left processing this tick (no guess either way), and logged', async () => {
  seed([job('j1')], [attempt('j1', 1, 'succeeded')]);
  failNext('publishing_attempts', 'select');
  expect(await recoverStalePublishingJobs('w')).toBe(0);
  expect(row('j1').status).toBe('processing');
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('last attempt is unreadable'), expect.objectContaining({ job_id: 'j1' }));
});

it.each([['FAILED', [attempt('j1', 1, 'failed')]], ['no attempt at all', []]] as const)(
  'NEGATIVE CONTROL: last attempt %s -> retrying, as before', async (_l, attempts) => {
    seed([job('j1')], [...attempts]);
    await recoverStalePublishingJobs('w');
    expect(row('j1').status).toBe('retrying');
  },
);

it('a job no longer processing when the write lands is not overwritten (status-guarded write)', async () => {
  seed([job('j1')], [attempt('j1', 1, 'running')]);
  // Another worker finished it between the read and the write.
  const real = require('../helpers/fakeWhatsappDb').fakeTable;
  const spy = jest.spyOn(require('../helpers/fakeWhatsappDb'), 'fakeTable').mockImplementation((t: unknown) => {
    if (t === 'publishing_jobs' && fakeDb.calls.includes('publishing_attempts:select')) row('j1').status = 'published';
    return real(t);
  });
  await recoverStalePublishingJobs('w');
  spy.mockRestore();
  expect(row('j1').status).toBe('published');
});
