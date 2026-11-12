/**
 * CLASS-2 (e9 sweep): the periodic re-enqueue of a publish-integrity check never resets a job a
 * worker is PROCESSING. It was an upsert ON CONFLICT DO UPDATE (status -> queued), so a second
 * worker verified the same post at the same time. Now insert-if-absent, and an existing job is
 * re-armed by compare-and-set on the status read - never from `processing`.
 * The real enqueuePublishReconciliation over the fake database.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/integrationCredentialService', () => ({ mergeConnectionConfig: async () => ({}) }));
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: async () => undefined, recordCredentialAccessAudit: async () => undefined }));
jest.mock('../../services/queueOperationsService', () => ({ captureQueueMetrics: async () => null, recordWorkerHeartbeat: async () => null }));
jest.mock('../../services/cms/cmsApiBaseResolver', () => ({ rediscoverAndRepairApiBase: async () => null, resolveCanonicalApiBase: async () => null }));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { enqueuePublishReconciliation } from '../../services/publishReconciliationService';

const KEY = 'publish-integrity:pj-1';
const job = (): Row => fakeDb.tables.reconciliation_jobs[0];
const enqueue = () => enqueuePublishReconciliation({ companyId: 'co-a', publishingJobId: 'pj-1', provider: 'wordpress', externalId: 'wp-1', idempotencyKey: KEY });

it('NEGATIVE CONTROL: no job yet -> one queued job is created', async () => {
  resetFakeDb({ reconciliation_jobs: [] });
  await enqueue();
  expect(fakeDb.tables.reconciliation_jobs).toHaveLength(1);
  expect(job()).toMatchObject({ status: 'queued', idempotency_key: KEY });
});

it('a job being PROCESSING is returned untouched - never reset to queued under its worker', async () => {
  resetFakeDb({ reconciliation_jobs: [{ id: 'rj-1', company_id: 'co-a', idempotency_key: KEY, status: 'processing', locked_by: 'w1' }] });
  const before = { ...job() };
  await enqueue();
  expect(job()).toEqual(before);
});

it.each(['completed', 'failed', 'retrying', 'queued'])('a %s job is re-armed for re-verification (queued)', async (status) => {
  resetFakeDb({ reconciliation_jobs: [{ id: 'rj-1', company_id: 'co-a', idempotency_key: KEY, status }] });
  await enqueue();
  expect(job().status).toBe('queued');
  expect(fakeDb.tables.reconciliation_jobs).toHaveLength(1);
});

it('claimed between the read and the re-arm: the CAS misses and the claim is left alone', async () => {
  resetFakeDb({ reconciliation_jobs: [{ id: 'rj-1', company_id: 'co-a', idempotency_key: KEY, status: 'completed' }] });
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    if (t === 'reconciliation_jobs' && fakeDb.calls.includes('reconciliation_jobs:select') && job().status === 'completed') {
      Object.assign(job(), { status: 'processing', locked_by: 'w2' });
    }
    return real(t);
  });
  await enqueue();
  jest.restoreAllMocks();
  expect(job()).toMatchObject({ status: 'processing', locked_by: 'w2' });
});
