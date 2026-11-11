/**
 * Unread-error census, WhatsApp send path (S line; e9 package 2026-11-12). Each F site: a FAILED
 * read or write must not be taken as "none" / "not found" / "nothing to retry", and must not
 * reset a counter that bounds retries. Real service on the fake database; failNext injects the
 * error at exactly the call under test.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const mockQueue: Array<{ jobId: string; ids: string[] }> = [];
const mockRate = { calls: 0 };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../../lib/platform/rolloutAdmin', () => ({
  resolveRolloutChecked: async () => ({ decision: { mode: 'enforce', source: 'default' }, adminReadable: true }),
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}) }));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({ getJobs: async () => [] }) }));
jest.mock('../../../lib/platform/distributedLock', () => ({
  ...jest.requireActual('../../../lib/platform/distributedLock'),
  withLease: async (_n: string, _t: number, fn: () => Promise<unknown>) => ({ ran: true, value: await fn() }),
}));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: async () => { mockRate.calls += 1; return { allowed: true, tier: 'TIER_1', remaining: 900 }; },
  getBroadcastChunkStrategy: () => ({ batch_size: 10, delay_ms: 0 }),
}));
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: any, opts: any) => {
    mockQueue.push({ jobId: opts.jobId, ids: data.recipient_ids });
    return { id: opts.jobId };
  },
}));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { enqueueBroadcast, processBatch, retryFailed } from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const recipient = (id: string, phone: string, over: Row = {}): Row =>
  ({ id, broadcast_id: 'b1', encrypted_phone: encrypt(phone), status: 'pending', retry_count: 0, wa_message_id: null, ...over });
const seed = (recipients?: Row[]) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'running', message_type: 'template', template_name: 'tpl', name: 'Spring sale' }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  outreach_governance_config: [],
  whatsapp_broadcast_recipients: recipients ?? [recipient(R1, '+15550100001'), recipient(R2, '+15550100002')],
  contact_governance_records: [],
  whatsapp_provider_events: [],
});
const rec = (id: string): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id)!;
const sends: string[] = [];
let provider: () => unknown;

beforeEach(() => {
  delete process.env.LEAD_OUTREACH_EXECUTION_DISABLED;
  mockQueue.length = 0; mockRate.calls = 0; sends.length = 0;
  provider = () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) });
  (global as any).fetch = async (_url: string, init: any) => { sends.push(JSON.parse(init.body).to); return provider(); };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const selectsOf = (table: string) => fakeDb.calls.filter((c) => c === `${table}:select`).length;

it('enqueue: a failed PENDING COUNT is not "no pending recipients" - refused as unreadable, nothing queued, no quota', async () => {
  seed();
  // The screen reads the pending page twice (rows, then the empty page); the count is the third read.
  failNext('whatsapp_broadcast_recipients', 'select', 2);
  await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('Broadcast recipients unreadable');
  expect(mockQueue).toHaveLength(0);
  expect(mockRate.calls).toBe(0);
});

it('processBatch: a failed BROADCAST read is not "not found" - the job fails with the cause; nothing sent', async () => {
  seed();
  failNext('whatsapp_broadcasts', 'select');
  await expect(processBatch('b1', [R1])).rejects.toThrow('Broadcast unreadable');
  expect(sends).toHaveLength(0);
});

it('processBatch: a failed CLAIM write sends NOTHING to that recipient and is logged; it stays pending', async () => {
  seed([recipient(R1, '+15550100001')]);
  failNext('whatsapp_broadcast_recipients', 'update');
  await processBatch('b1', [R1]);
  expect(sends).toHaveLength(0);
  expect(rec(R1).status).toBe('pending');
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('claim not written'), expect.objectContaining({ recipient_id: R1 }));
});

it('a provider refusal increments the EXISTING retry_count from the batch read (2 -> 3), with no separate re-read', async () => {
  seed([recipient(R1, '+15550100001', { retry_count: 2 })]);
  provider = () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131026, message: 'undeliverable' } }) });
  const before = selectsOf('whatsapp_broadcast_recipients');
  await processBatch('b1', [R1]);
  expect(rec(R1)).toMatchObject({ status: 'failed', retry_count: 3 });
  expect(selectsOf('whatsapp_broadcast_recipients') - before).toBe(1); // the batch read only
});

it('Retry: a failed read of the failed rows is not "nothing to retry" - refused as unreadable, nothing reset', async () => {
  seed([recipient(R1, '+15550100001', { status: 'failed', retry_count: 1 })]);
  failNext('whatsapp_broadcast_recipients', 'select');
  await expect(retryFailed('b1')).rejects.toThrow('Failed recipients unreadable');
  expect(rec(R1).status).toBe('failed');
  expect(mockQueue).toHaveLength(0);
});

it('NEGATIVE CONTROL: no injected error - enqueue queues, the batch sends both, a failure counts from the batch value', async () => {
  seed();
  await enqueueBroadcast('b1', 'free');
  expect(mockQueue).toHaveLength(1);
  await processBatch('b1', mockQueue[0].ids);
  expect(sends).toHaveLength(2);
});
