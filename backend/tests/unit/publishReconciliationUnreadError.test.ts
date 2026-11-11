/**
 * Unread-error census, publish reconciliation (read-only verification of already-published posts).
 * F sites: the tenant-visible integrity verdict upsert, and the publishing-job / connection reads
 * of the context (missed by the scanner: ternary awaits). A failure in any of them must put the job
 * on its RETRY path - never complete it with a stale verdict or verify without its context.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/integrationCredentialService', () => ({ mergeConnectionConfig: async () => ({}) }));
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: async () => undefined, recordCredentialAccessAudit: async () => undefined }));
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/cms/cmsApiBaseResolver', () => ({ rediscoverAndRepairApiBase: async () => null, resolveCanonicalApiBase: async () => null }));

import { failNext, fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { runPublishReconciliationWorker } from '../../services/publishReconciliationService';

// A non-WordPress provider verifies as healthy without any network call.
const seed = () => resetFakeDb({
  reconciliation_jobs: [{ id: 'r1', company_id: 'co-a', website_id: 'w1', provider: 'ghost', publishing_job_id: 'pj1', status: 'queued', run_after: '2026-01-01T00:00:00.000Z', attempt_count: 0, max_attempts: 3, metadata: {} }],
  publishing_jobs: [{ id: 'pj1', company_id: 'co-a', connection_id: 'c1', external_id: 'g-1', blog_id: 'b1' }],
  website_connections: [{ id: 'c1', non_secret_config: {} }],
  publish_integrity_status: [],
  reconciliation_attempts: [],
});
const job = () => fakeDb.tables.reconciliation_jobs[0];

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('the integrity verdict upsert FAILS: the job retries - it is not completed with a stale verdict', async () => {
  seed();
  failNext('publish_integrity_status', 'upsert');
  await runPublishReconciliationWorker({ workerId: 'w' });
  expect(job()).toMatchObject({ status: 'retrying', last_error: expect.stringContaining('Publish integrity status not recorded') });
});

it.each([['publishing_jobs'], ['website_connections']])('the %s context read FAILS: the job retries, verification never runs blind', async (table) => {
  seed();
  failNext(table, 'select');
  await runPublishReconciliationWorker({ workerId: 'w' });
  expect(job().status).toBe('retrying');
  expect(fakeDb.tables.publish_integrity_status).toHaveLength(0);
});

it('NEGATIVE CONTROL: no injected error - verified healthy, verdict recorded, job completed', async () => {
  seed();
  await runPublishReconciliationWorker({ workerId: 'w' });
  expect(job().status).toBe('healthy');
  expect(fakeDb.tables.publish_integrity_status).toHaveLength(1);
});
