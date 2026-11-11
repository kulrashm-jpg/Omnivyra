/**
 * Resume and Retry are safe to offer (e9's four properties, 2026-11-11). The page now shows
 * Resume (POST ?action=enqueue) and Retry wherever recipients are stranded; these prove the
 * SERVER keeps every check on those paths, so offering a button never weakens one.
 *   1. Resume re-runs full governance at the read instant (the screen, then processBatch per
 *      recipient), and consumes quota for what it queues; a still-exceeded limit re-pauses.
 *   2. A broadcast on a DISCONNECTED sender account cannot be resumed, retried or sent: a
 *      disconnect keeps the tokens (is_active=false), so ownership + token alone let it send.
 *   Retry's 409 says WHY nothing is retryable (refusals are not retried) (05).
 * (3: concurrency is whatsappBroadcastResume.test.ts "one run at a time"; 4: the route gates
 * are whatsappBroadcastRouteGates.test.ts.)
 *
 * Real enqueueBroadcast / retryFailed / processBatch and the real governance repository on
 * the fake database. The queue records jobs and never runs them; the provider is a spy.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const mockQueue: Array<{ jobId: string; ids: string[] }> = [];
const mockRate = { allowed: true, calls: [] as Array<Record<string, unknown>> };

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
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({ getJobs: async () => [] }) }));
jest.mock('../../../lib/platform/distributedLock', () => ({
  ...jest.requireActual('../../../lib/platform/distributedLock'),
  withLease: async (_n: string, _t: number, fn: () => Promise<unknown>) => ({ ran: true, value: await fn() }),
}));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: async (p: Record<string, unknown>) => {
    mockRate.calls.push(p);
    return mockRate.allowed ? { allowed: true, tier: 'TIER_1', remaining: 900 } : { allowed: false, tier: 'TIER_1', remaining: 0 };
  },
  getBroadcastChunkStrategy: () => ({ batch_size: 10, delay_ms: 0 }),
}));
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: any, opts: any) => {
    mockQueue.push({ jobId: opts.jobId, ids: data.recipient_ids });
    return { id: opts.jobId };
  },
}));

import { fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  WhatsAppSenderAccountError,
  enqueueBroadcast,
  enqueueOutcomeResponse,
  processBatch,
  retryFailed,
  retryOutcomeResponse,
} from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';
const PHONE1 = '+15550100001';
const PHONE2 = '+15550100002';
const DB_NOW = '2026-11-11T10:00:00.000Z';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const recipient = (id: string, phone: string, over: Row = {}): Row =>
  ({ id, broadcast_id: 'b1', encrypted_phone: encrypt(phone), status: 'pending', retry_count: 0, wa_message_id: null, ...over });

/** A broadcast PAUSED mid-run (rate limit or a failed governance re-read), as Resume finds it. */
const seed = (opts: { active?: boolean; recipients?: Row[]; governance?: Row[] } = {}) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'paused', message_type: 'template', template_name: 'tpl', name: 'Launch' }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: opts.active ?? true }],
  whatsapp_broadcast_recipients: opts.recipients ?? [recipient(R1, PHONE1), recipient(R2, PHONE2)],
  contact_governance_records: opts.governance ?? [],
  whatsapp_provider_events: [],
});
const stop = (phone: string, id = 'g1'): Row => ({
  id, organization_id: ORG, person_id: null, target_normalized: phone, channel: 'whatsapp', governance_type: 'dnc_channel',
  effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, read_at: DB_NOW,
});
const rec = (id: string): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id)!;
const sends: string[] = [];

beforeEach(() => {
  mockQueue.length = 0;
  sends.length = 0;
  mockRate.allowed = true;
  mockRate.calls.length = 0;
  (global as any).fetch = async (_url: string, init: any) => {
    sends.push(JSON.parse(init.body).to);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) };
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('1. Resume re-runs full governance and the quota', () => {
  it('a STOP recorded while paused: Resume blocks that recipient at the screen, queues only the other, quota counts only it', async () => {
    seed({ governance: [stop(PHONE1)] });
    await enqueueBroadcast('b1', 'free');
    expect(rec(R1).status).toBe('blocked_governance');
    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].ids).toEqual([R2]);
    expect(mockRate.calls).toHaveLength(1);
    expect(mockRate.calls[0].count).toBe(1);
  });

  it('a STOP recorded AFTER Resume queued the batch: processBatch re-checks at send, nothing goes to that number', async () => {
    seed();
    await enqueueBroadcast('b1', 'free');
    expect(mockQueue[0].ids).toEqual([R1, R2]);
    fakeDb.tables.contact_governance_records.push(stop(PHONE1));
    await processBatch('b1', mockQueue[0].ids);
    expect(rec(R1).status).toBe('blocked_governance');
    expect(sends).toEqual([PHONE2]);
  });

  it('the limit still exceeded: Resume re-pauses and queues nothing', async () => {
    seed();
    mockRate.allowed = false;
    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('Rate limit exceeded');
    expect(mockQueue).toHaveLength(0);
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
  });
});

describe('2. a disconnected sender account cannot be resumed, retried or sent', () => {
  it('Resume: refused (409 naming the cause) before the screen or the quota; nothing queued', async () => {
    seed({ active: false });
    let err: unknown;
    try { await enqueueBroadcast('b1', 'free'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WhatsAppSenderAccountError);
    expect(enqueueOutcomeResponse({ ok: false, error: err })).toEqual({ status: 409, body: { enqueued: false, error: expect.stringContaining('disconnected') } });
    expect(mockQueue).toHaveLength(0);
    expect(mockRate.calls).toHaveLength(0);
    expect(rec(R1).status).toBe('pending');
  });

  it('Retry: refused before any failed row is reset', async () => {
    seed({ active: false, recipients: [recipient(R1, PHONE1, { status: 'failed', retry_count: 1 })] });
    let err: unknown;
    try { await retryFailed('b1'); } catch (e) { err = e; }
    expect(retryOutcomeResponse({ ok: false, error: err }).status).toBe(409);
    expect(rec(R1).status).toBe('failed');
    expect(mockQueue).toHaveLength(0);
  });

  it('a batch queued BEFORE the disconnect: processBatch refuses, nothing is sent, the rows stay pending', async () => {
    seed({ active: false });
    await expect(processBatch('b1', [R1, R2])).rejects.toBeInstanceOf(WhatsAppSenderAccountError);
    expect(sends).toHaveLength(0);
    expect([rec(R1).status, rec(R2).status]).toEqual(['pending', 'pending']);
  });

  it('NEGATIVE CONTROL: the same broadcast on a connected account resumes and queues', async () => {
    seed({ active: true });
    await enqueueBroadcast('b1', 'free');
    expect(mockQueue).toHaveLength(1);
  });
});

describe('Retry says WHY nothing is retryable (05)', () => {
  it('only refusals left: 409 that says they were refused, not "nothing to retry"', async () => {
    seed({ recipients: [recipient(R1, PHONE1, { status: 'blocked_governance' }), recipient(R2, PHONE2, { status: 'sent', wa_message_id: 'w' })] });
    const result = await retryFailed('b1');
    expect(result).toMatchObject({ retried: 0, refused: 1 });
    const answer = retryOutcomeResponse({ ok: true, result });
    expect(answer.status).toBe(409);
    expect(String(answer.body.error)).toContain('1 were refused by contact governance or send controls');
  });

  it('NEGATIVE CONTROL: a failed recipient with retries left is retried', async () => {
    seed({ recipients: [recipient(R1, PHONE1, { status: 'failed', retry_count: 1 })] });
    expect(retryOutcomeResponse({ ok: true, result: await retryFailed('b1') }).status).toBe(200);
  });
});
