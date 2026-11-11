/**
 * Two owner rulings (via e9, 2026-11-11), on every WhatsApp send path of an OPERATOR broadcast:
 *   A. "Stop everything": the GLOBAL (env LEAD_OUTREACH_EXECUTION_DISABLED) or TENANT
 *      (outreach_governance_config.kill_switch) kill switch stops create, enqueue/Resume, Retry
 *      and batches already queued. 409 naming the switch; in processBatch the broadcast is
 *      PAUSED and recipients stay PENDING (Resume works once it clears). An unreadable tenant
 *      switch counts as ON. A switch flipped mid-run stops the rest of the batch (global per
 *      send; tenant at each A2b re-read).
 *   B. A phone_number_id held by another LIVE WhatsApp account (any tenant) is refused (409),
 *      mirroring the inbound processor; a disconnected holder does not count; an unreadable
 *      lookup fails closed.
 * (Journey broadcasts keep B-17: whatsappJourneySendControls.test.ts.)
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
import {
  WhatsAppSendStoppedError,
  WhatsAppSharedNumberError,
  createBroadcast,
  enqueueBroadcast,
  enqueueOutcomeResponse,
  processBatch,
  retryFailed,
  retryOutcomeResponse,
  senderAccountRefusalResponse,
} from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const OTHER_ORG = 'co-b';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';
const R3 = '0a000000-0000-4000-8000-000000000003';
const GLOBAL_ENV = 'LEAD_OUTREACH_EXECUTION_DISABLED';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const recipient = (id: string, phone: string, over: Row = {}): Row =>
  ({ id, broadcast_id: 'b1', encrypted_phone: encrypt(phone), status: 'pending', retry_count: 0, wa_message_id: null, ...over });

const seed = (opts: { recipients?: Row[]; accounts?: Row[]; killSwitch?: boolean } = {}) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'running', message_type: 'template', template_name: 'tpl', name: 'Spring sale' }],
  social_accounts: [
    { id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true },
    ...(opts.accounts ?? []),
  ],
  outreach_governance_config: [{ company_id: ORG, enabled: true, kill_switch: opts.killSwitch ?? false, enabled_channels: [] }],
  whatsapp_broadcast_recipients: opts.recipients ?? [recipient(R1, '+15550100001'), recipient(R2, '+15550100002')],
  contact_governance_records: [],
  whatsapp_provider_events: [],
});
const rec = (id: string): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id)!;
const broadcastStatus = (): unknown => fakeDb.tables.whatsapp_broadcasts[0].status;
let onSend: (() => void) | null = null;
const sends: string[] = [];

beforeEach(() => {
  delete process.env[GLOBAL_ENV];
  delete process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY;
  mockQueue.length = 0;
  mockRate.calls = 0;
  sends.length = 0;
  onSend = null;
  (global as any).fetch = async (_url: string, init: any) => {
    sends.push(JSON.parse(init.body).to);
    onSend?.();
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) };
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => { delete process.env[GLOBAL_ENV]; delete process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY; jest.restoreAllMocks(); });

const SWITCHES: Array<[string, () => void, string]> = [
  ['GLOBAL', () => { process.env[GLOBAL_ENV] = 'true'; }, 'global_kill_switch'],
  ['TENANT', () => { fakeDb.tables.outreach_governance_config[0].kill_switch = true; }, 'tenant_kill_switch'],
  ['UNREADABLE tenant', () => { failNext('outreach_governance_config', 'select'); }, 'kill_switch_unreadable'],
];

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (e) { return e; }
  return null;
}

describe('A. a kill switch stops every operator send path', () => {
  describe.each(SWITCHES)('%s switch', (_label, flip, reason) => {
    it('create: refused (409 naming the switch), no broadcast row written', async () => {
      seed();
      flip();
      const err = await refusal(() => createBroadcast({ company_id: ORG, social_account_id: 'sa1', name: 'New', message_type: 'text', body: 'hi' }));
      expect(err).toBeInstanceOf(WhatsAppSendStoppedError);
      expect(senderAccountRefusalResponse(err)).toMatchObject({ status: 409, code: `WHATSAPP_SENDING_STOPPED:${reason}` });
      expect(fakeDb.tables.whatsapp_broadcasts).toHaveLength(1);
    });

    it('enqueue / Resume: refused (409 naming the switch) before the screen or the quota; nothing queued', async () => {
      seed();
      flip();
      const err = await refusal(() => enqueueBroadcast('b1', 'free'));
      expect(enqueueOutcomeResponse({ ok: false, error: err })).toMatchObject({ status: 409, body: { enqueued: false, code: `WHATSAPP_SENDING_STOPPED:${reason}` } });
      expect(mockQueue).toHaveLength(0);
      expect(mockRate.calls).toBe(0);
    });

    it('Retry: refused (409) before any failed row is reset', async () => {
      seed({ recipients: [recipient(R1, '+15550100001', { status: 'failed', retry_count: 1 })] });
      flip();
      const err = await refusal(() => retryFailed('b1'));
      expect(retryOutcomeResponse({ ok: false, error: err })).toMatchObject({ status: 409, body: { retried: false, code: `WHATSAPP_SENDING_STOPPED:${reason}` } });
      expect(rec(R1).status).toBe('failed');
    });

    it('a batch ALREADY QUEUED: nothing sent, recipients stay PENDING, broadcast PAUSED, the job does not throw', async () => {
      seed();
      flip();
      await expect(processBatch('b1', [R1, R2])).resolves.toBeUndefined();
      expect(sends).toHaveLength(0);
      expect([rec(R1).status, rec(R2).status]).toEqual(['pending', 'pending']);
      expect(broadcastStatus()).toBe('paused');
    });
  });

  it('GLOBAL flipped MID-RUN: the next send stops (checked per send); the rest stay pending; paused', async () => {
    seed({ recipients: [recipient(R1, '+15550100001'), recipient(R2, '+15550100002'), recipient(R3, '+15550100003')] });
    onSend = () => { process.env[GLOBAL_ENV] = 'true'; };
    await processBatch('b1', [R1, R2, R3]);
    expect(sends).toHaveLength(1);
    expect(rec(R1).status).toBe('sent');
    expect([rec(R2).status, rec(R3).status]).toEqual(['pending', 'pending']);
    expect(broadcastStatus()).toBe('paused');
  });

  it('TENANT flipped MID-RUN: stops at the next A2b re-read (here every recipient); the rest stay pending; paused', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '1';
    seed({ recipients: [recipient(R1, '+15550100001'), recipient(R2, '+15550100002'), recipient(R3, '+15550100003')] });
    onSend = () => { fakeDb.tables.outreach_governance_config[0].kill_switch = true; };
    await processBatch('b1', [R1, R2, R3]);
    expect(sends).toHaveLength(1);
    expect([rec(R2).status, rec(R3).status]).toEqual(['pending', 'pending']);
    expect(broadcastStatus()).toBe('paused');
  });

  it('WS-3 channel_not_enabled (enabled, kill switch off, channels [email]) does NOT stop an operator broadcast (e9 scope)', async () => {
    seed();
    Object.assign(fakeDb.tables.outreach_governance_config[0], { enabled: true, kill_switch: false, enabled_channels: ['email'] });
    await enqueueBroadcast('b1', 'free');
    expect(mockQueue).toHaveLength(1);
    await processBatch('b1', mockQueue[0].ids);
    expect(sends).toHaveLength(2);
  });

  it('WS-3 tenant_not_enabled (row present, enabled false, kill switch off) does NOT stop an operator broadcast (e9 scope)', async () => {
    seed();
    Object.assign(fakeDb.tables.outreach_governance_config[0], { enabled: false, kill_switch: false });
    await enqueueBroadcast('b1', 'free');
    await processBatch('b1', mockQueue[0].ids);
    expect(sends).toHaveLength(2);
  });

  it('NEGATIVE CONTROL: no switch on, no tenant config row at all (never configured): every path proceeds and sends', async () => {
    seed();
    fakeDb.tables.outreach_governance_config = [];
    await enqueueBroadcast('b1', 'free');
    expect(mockQueue).toHaveLength(1);
    await processBatch('b1', mockQueue[0].ids);
    expect(sends).toHaveLength(2);
  });
});

describe('B. a phone number held by another live account is refused (mirrors inbound)', () => {
  const SHARED_IN_OTHER_TENANT = { id: 'sa-other', company_id: OTHER_ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true };
  const SHARED_IN_SAME_TENANT  = { id: 'sa-twin', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true };

  it.each([['another tenant', SHARED_IN_OTHER_TENANT], ['the same tenant', SHARED_IN_SAME_TENANT]])(
    'held by %s: create, enqueue/Resume, Retry refused 409; a queued batch sends nothing', async (_l, other) => {
      seed({ accounts: [other] });
      const create = await refusal(() => createBroadcast({ company_id: ORG, social_account_id: 'sa1', name: 'New', message_type: 'text', body: 'hi' }));
      expect(create).toBeInstanceOf(WhatsAppSharedNumberError);
      expect(senderAccountRefusalResponse(create)).toMatchObject({ status: 409, code: 'WHATSAPP_NUMBER_SHARED', error: expect.stringContaining('Contact support') });
      // The other holder's ids are logged for support, never returned to this operator.
      expect(JSON.stringify(senderAccountRefusalResponse(create))).not.toContain(other.id);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('held by more than one live account'),
        expect.objectContaining({ other_account_ids: [other.id], other_company_ids: [other.company_id] }));
      expect(enqueueOutcomeResponse({ ok: false, error: await refusal(() => enqueueBroadcast('b1', 'free')) }).status).toBe(409);
      expect(mockQueue).toHaveLength(0);
      fakeDb.tables.whatsapp_broadcast_recipients.push(recipient(R3, '+15550100003', { status: 'failed', retry_count: 1 }));
      expect(retryOutcomeResponse({ ok: false, error: await refusal(() => retryFailed('b1')) }).status).toBe(409);
      expect(rec(R3).status).toBe('failed');
      await expect(processBatch('b1', [R1, R2])).rejects.toBeInstanceOf(WhatsAppSharedNumberError);
      expect(sends).toHaveLength(0);
      expect([rec(R1).status, rec(R2).status]).toEqual(['pending', 'pending']);
    },
  );

  it('an unreadable lookup fails closed (503), nothing queued', async () => {
    seed();
    failNext('social_accounts', 'select', 1); // the ownership read passes; the shared-number read fails
    const err = await refusal(() => enqueueBroadcast('b1', 'free'));
    expect(enqueueOutcomeResponse({ ok: false, error: err }).status).toBe(503);
    expect(mockQueue).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: the other holder is DISCONNECTED (is_active false): it no longer sends, so this account proceeds', async () => {
    seed({ accounts: [{ ...SHARED_IN_OTHER_TENANT, is_active: false }] });
    await enqueueBroadcast('b1', 'free');
    expect(mockQueue).toHaveLength(1);
    await processBatch('b1', mockQueue[0].ids);
    expect(sends).toHaveLength(2);
  });
});
