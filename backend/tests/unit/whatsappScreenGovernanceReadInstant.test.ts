/**
 * A2 at S's pre-send screen (screenPendingRecipients, run by enqueueBroadcast before the
 * rate limit is consumed). On S this screen judged governance at a HOST-CLOCK `now`
 * (`new Date()`), like processBatch did; the S-WA combined port routes both through
 * evaluateGovernanceReads, so each read's rows are judged at the read's own DATABASE
 * instant. processBatch's A2 tests are in w0cWhatsappBroadcastGovernance.test.ts; this
 * suite isolates the SCREEN: the queue only records jobs and never runs them, so a
 * recipient the screen lets through stays `pending` and is queued, never sent.
 *
 * Real enqueueBroadcast and the real governance repository over the fake database
 * (helpers/fakeWhatsappDb.ts). No Meta call, no Redis, no send.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const mockQueue: Array<{ jobId: string; ids: string[] }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}) }));
// No live batch jobs; the enqueue lease is a no-op pass-through (lease behaviour is
// covered by whatsappBroadcastResume.test.ts).
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({ getJobs: async () => [] }) }));
jest.mock('../../../lib/platform/distributedLock', () => ({
  withLease: async (_n: string, _t: number, fn: () => Promise<unknown>) => ({ ran: true, value: await fn() }),
}));
const mockCheckAndConsume = jest.fn(async () => ({ allowed: true, tier: 'TIER_1' }));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: (...a: unknown[]) => (mockCheckAndConsume as any)(...a),
  getBroadcastChunkStrategy: () => ({ batch_size: 10, delay_ms: 0 }),
}));
// The queue RECORDS the job and never runs it: only the screen can change a recipient.
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: any, opts: any) => {
    mockQueue.push({ jobId: opts.jobId, ids: data.recipient_ids });
    return { id: opts.jobId };
  },
}));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { enqueueBroadcast } from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const R1 = '0a000000-0000-4000-8000-000000000001';
const PHONE1 = '+15550100001';
/** The DATABASE instant every governance row comes back with (the read's `read_at`). */
const DB_NOW = '2026-11-11T10:00:00.000Z';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};

const seed = (governance: Row[]) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'draft', message_type: 'template', template_name: 'tpl', name: 'Launch' }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  whatsapp_broadcast_recipients: [{ id: R1, broadcast_id: 'b1', encrypted_phone: encrypt(PHONE1), status: 'pending', retry_count: 0, wa_message_id: null }],
  contact_governance_records: governance,
});

const restriction = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG, person_id: null, target_normalized: PHONE1,
  channel: 'whatsapp', governance_type: 'dnc_channel',
  effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, read_at: DB_NOW, ...over,
});

const rec = (): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === R1)!;
const sends: unknown[] = [];

beforeEach(() => {
  mockQueue.length = 0;
  sends.length = 0;
  mockCheckAndConsume.mockClear();
  (global as any).fetch = async () => { sends.push(1); throw new Error('no provider call is expected in this suite'); };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('A2 at the pre-send screen: judged at the governance READ instant, never the host clock', () => {
  it('NEGATIVE CONTROL: a host clock 2 h AHEAD does not unlock a restriction still in force at the database instant', async () => {
    // In force at DB_NOW (ends 1 h later); "over" only by a host clock 2 h ahead.
    seed([restriction({ effective_until: '2026-11-11T11:00:00.000Z' })]);
    jest.useFakeTimers({ now: new Date('2026-11-11T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('No pending recipients');

    expect(rec().status).toBe('blocked_governance');
    expect(String(rec().error_message)).toContain('dnc_channel');
    expect(mockQueue).toHaveLength(0);                 // nothing queued
    expect(mockCheckAndConsume).not.toHaveBeenCalled(); // no quota consumed
    expect(sends).toHaveLength(0);
  });

  it('control: once the database instant is past effective_until, the screen lets the recipient through to the queue', async () => {
    seed([restriction({ effective_until: '2026-11-11T09:00:00.000Z' })]); // ended before DB_NOW

    await enqueueBroadcast('b1', 'free');

    expect(rec().status).toBe('pending');
    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].ids).toEqual([R1]);
    expect(sends).toHaveLength(0);
  });

  it('rows that arrive WITHOUT a database read instant are indeterminate: the screen refuses, naming it', async () => {
    // Not even this number: a judgeable read would allow it. Without an instant, nothing is judged.
    seed([restriction({ read_at: undefined, target_normalized: '+15550109999' })]);

    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('No pending recipients');

    expect(rec().status).toBe('blocked_governance');
    expect(String(rec().error_message)).toContain('governance indeterminate');
    expect(mockQueue).toHaveLength(0);
  });
});
