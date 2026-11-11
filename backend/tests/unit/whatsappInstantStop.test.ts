/**
 * The instant Super Admin "stop all WhatsApp" switch (owner ruling via e9, 2026-11-11: "YES,
 * fail SAFE"): rollout flag `whatsapp-sending`, checked next to the env stop - before every send
 * and at create / enqueue-Resume / Retry. kill (or mode off) = stop; an UNREADABLE admin config
 * PAUSES sending and raises an ERROR alert (D2b's log-alert path); the kit-wide rollout kill is
 * NOT a send stop. Real service on the fake database; the kit's checked resolution is mocked.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const mockQueue: Array<{ jobId: string; ids: string[] }> = [];
type Checked = { decision: { mode: string; source: string }; adminReadable: boolean | null };
const mockFlag: { next: Checked; calls: number; onCall: (() => void) | null } = {
  next: { decision: { mode: 'enforce', source: 'default' }, adminReadable: true }, calls: 0, onCall: null,
};

jest.mock('../../../lib/platform/rolloutAdmin', () => ({
  resolveRolloutChecked: async () => { mockFlag.calls += 1; mockFlag.onCall?.(); return mockFlag.next; },
}));
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
  checkAndConsume: async () => ({ allowed: true, tier: 'TIER_1', remaining: 900 }),
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
  WhatsAppSendStoppedError,
  __resetStopAlertWindow,
  createBroadcast,
  enqueueBroadcast,
  enqueueOutcomeResponse,
  processBatch,
  retryFailed,
  retryOutcomeResponse,
  senderAccountRefusalResponse,
} from '../../services/whatsappBroadcastService';
import { WHATSAPP_SENDING_FLAG } from '../../services/whatsappSendingFlag';
import { getRolloutFlag } from '../../../lib/platform/rollout';

const ORG = 'co-a';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';
const R3 = '0a000000-0000-4000-8000-000000000003';

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
let onSend: (() => void) | null = null;

const ALLOW: Checked = { decision: { mode: 'enforce', source: 'default' }, adminReadable: true };
const KILLED: Checked = { decision: { mode: 'off', source: 'admin-kill' }, adminReadable: true };
const MODE_OFF: Checked = { decision: { mode: 'off', source: 'admin' }, adminReadable: true };
const UNREADABLE: Checked = { decision: { mode: 'enforce', source: 'default' }, adminReadable: false };

beforeEach(() => {
  delete process.env.LEAD_OUTREACH_EXECUTION_DISABLED;
  mockFlag.next = ALLOW; mockFlag.calls = 0; mockFlag.onCall = null;
  mockQueue.length = 0; sends.length = 0; onSend = null;
  __resetStopAlertWindow();
  (global as any).fetch = async (_url: string, init: any) => {
    sends.push(JSON.parse(init.body).to);
    onSend?.();
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) };
  };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const refusal = async (run: () => Promise<unknown>): Promise<unknown> => { try { await run(); } catch (e) { return e; } return null; };
const ALERT = expect.stringContaining('stop switch UNREADABLE');

it('the flag is registered on the operator surface under its key, sending allowed by default', () => {
  expect(getRolloutFlag('whatsapp-sending')).toBe(WHATSAPP_SENDING_FLAG);
  expect(WHATSAPP_SENDING_FLAG.defaultMode).toBe('enforce');
});

describe.each([
  ['Super Admin KILL', KILLED, 'super_admin_stop'],
  ['Super Admin mode OFF', MODE_OFF, 'super_admin_stop'],
  ['admin config UNREADABLE (fail safe)', UNREADABLE, 'stop_switch_unreadable'],
] as const)('%s stops every path', (_l, state, reason) => {
  it('create: 409 naming the switch', async () => {
    seed(); mockFlag.next = state;
    const err = await refusal(() => createBroadcast({ company_id: ORG, social_account_id: 'sa1', name: 'New', message_type: 'text', body: 'hi' }));
    expect(err).toBeInstanceOf(WhatsAppSendStoppedError);
    expect(senderAccountRefusalResponse(err)).toMatchObject({ status: 409, code: `WHATSAPP_SENDING_STOPPED:${reason}` });
  });

  it('enqueue / Resume: 409, nothing queued', async () => {
    seed(); mockFlag.next = state;
    expect(enqueueOutcomeResponse({ ok: false, error: await refusal(() => enqueueBroadcast('b1', 'free')) }))
      .toMatchObject({ status: 409, body: { code: `WHATSAPP_SENDING_STOPPED:${reason}` } });
    expect(mockQueue).toHaveLength(0);
  });

  it('Retry: 409, no failed row reset', async () => {
    seed([recipient(R1, '+15550100001', { status: 'failed', retry_count: 1 })]); mockFlag.next = state;
    expect(retryOutcomeResponse({ ok: false, error: await refusal(() => retryFailed('b1')) }).status).toBe(409);
    expect(rec(R1).status).toBe('failed');
  });

  it('a queued batch: nothing sent, recipients PENDING, broadcast PAUSED', async () => {
    seed(); mockFlag.next = state;
    await processBatch('b1', [R1, R2]);
    expect(sends).toHaveLength(0);
    expect([rec(R1).status, rec(R2).status]).toEqual(['pending', 'pending']);
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
  });
});

it('KILLED MID-RUN: the next send stops (checked per send); the rest stay pending; paused', async () => {
  seed([recipient(R1, '+15550100001'), recipient(R2, '+15550100002'), recipient(R3, '+15550100003')]);
  onSend = () => { mockFlag.next = KILLED; };
  await processBatch('b1', [R1, R2, R3]);
  expect(sends).toHaveLength(1);
  expect([rec(R2).status, rec(R3).status]).toEqual(['pending', 'pending']);
  expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
});

it('UNREADABLE: the ERROR alert fires (stable marker), once per window however many sends check', async () => {
  seed(); mockFlag.next = UNREADABLE;
  await processBatch('b1', [R1, R2]);
  await refusal(() => enqueueBroadcast('b1', 'free'));
  const alerts = (console.error as jest.Mock).mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('stop switch UNREADABLE'));
  expect(alerts).toHaveLength(1);
  expect(console.error).toHaveBeenCalledWith(ALERT, expect.objectContaining({ flag: 'whatsapp-sending' }));
});

it('the ENV stop still works alone (either stop stops sending)', async () => {
  seed(); process.env.LEAD_OUTREACH_EXECUTION_DISABLED = 'true';
  await processBatch('b1', [R1, R2]);
  expect(sends).toHaveLength(0);
});

it('the kit-wide rollout kill (source global-kill) is NOT a send stop', async () => {
  seed(); mockFlag.next = { decision: { mode: 'off', source: 'global-kill' }, adminReadable: true };
  await processBatch('b1', [R1, R2]);
  expect(sends).toHaveLength(2);
});

it('no admin layer at all (adminReadable null: Redis not configured): env only, sends', async () => {
  seed(); mockFlag.next = { decision: { mode: 'enforce', source: 'default' }, adminReadable: null };
  await processBatch('b1', [R1, R2]);
  expect(sends).toHaveLength(2);
  expect(console.error).not.toHaveBeenCalledWith(ALERT, expect.anything());
});

it('NEGATIVE CONTROL: flag allowed and readable - every path proceeds and sends', async () => {
  seed();
  await enqueueBroadcast('b1', 'free');
  expect(mockQueue).toHaveLength(1);
  await processBatch('b1', mockQueue[0].ids);
  expect(sends).toHaveLength(2);
});

it('the flag is consulted up front AND before each send (3 recipients: create-path checks + 3 sends)', async () => {
  seed([recipient(R1, '+15550100001'), recipient(R2, '+15550100002'), recipient(R3, '+15550100003')]);
  mockFlag.calls = 0;
  await processBatch('b1', [R1, R2, R3]);
  expect(sends).toHaveLength(3);
  expect(mockFlag.calls).toBeGreaterThanOrEqual(4); // batch start (send-fitness) + one per send
});
