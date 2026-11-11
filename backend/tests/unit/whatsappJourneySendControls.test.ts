/**
 * B-17 — a journey broadcast (`wf:<task>`) is checked again at send time. The adapter
 * checks the tenant controls before a broadcast exists, but a job can wait in the queue:
 * a kill switch thrown, or a reply received, in that window must stop the send.
 *
 * Real processBatch, governance config loader and contact-governance evaluator on a fake
 * database (helpers/fakeWhatsappDb.ts), with `fetch` spied. No Meta call and no real
 * schema. The real-schema form of the two main cases is in orch_engines_real.test.ts.
 */

import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../middleware/queueBackpressure', () => ({ enqueueOrThrow: jest.fn() }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}) }));
jest.mock('../../services/whatsappRateLimiter', () => ({ checkAndConsume: jest.fn(), getBroadcastChunkStrategy: jest.fn() }));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  BLOCKED_SEND_CONTROL,
  JOURNEY_BROADCAST_PREFIX,
  processBatch,
  whatsappChannelRefusal,
} from '../../services/whatsappBroadcastService';
import { broadcastNameFor, createWhatsAppAdapter, defaultWhatsAppDeps } from '../../services/orchestration/whatsappEngineAdapter';

const ORG = 'co-a';
const PHONE = '+15550100001';
const DIGITS = '15550100001';
const CREATED_AT = '2026-11-02T10:00:00.500Z';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const recipientRow = (id: string, phone = PHONE): Row => ({ id, broadcast_id: 'b1', encrypted_phone: encrypt(phone), status: 'pending', retry_count: 0 });

const seed = (over: { name?: string; broadcast?: Row } = {}) => resetFakeDb({
  whatsapp_broadcasts: [{
    id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'running', message_type: 'template', template_name: 'tpl',
    name: over.name ?? 'wf:task-1', created_at: CREATED_AT, ...over.broadcast,
  }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  whatsapp_broadcast_recipients: [recipientRow('r1')],
  outreach_governance_config: [{ company_id: ORG, enabled: true, kill_switch: false, enabled_channels: ['whatsapp'] }],
  contact_governance_records: [],
  engagement_threads: [],
  engagement_messages: [],
});
const config = (): Row => fakeDb.tables.outreach_governance_config[0];
const r = (id = 'r1'): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id)!;
const inboundAt = (createdAt: string, digits = DIGITS, over: Row = {}) => {
  const threadId = `th-${fakeDb.tables.engagement_threads.length + 1}`;
  fakeDb.tables.engagement_threads.push({ id: threadId, organization_id: ORG, platform: 'whatsapp', platform_thread_id: `wa:sa1:${digits}`, ...over });
  fakeDb.tables.engagement_messages.push({ id: `m-${threadId}`, thread_id: threadId, direction: 'inbound', created_at: createdAt, content: 'yes please', platform_message_id: `wamid.${threadId}` });
};

const fetchCalls: string[] = [];
beforeEach(() => {
  fetchCalls.length = 0;
  delete process.env.LEAD_OUTREACH_EXECUTION_DISABLED;
  (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.out.${fetchCalls.length}` }] }) };
  };
});
afterAll(() => { delete process.env.LEAD_OUTREACH_EXECUTION_DISABLED; });

describe('journey broadcasts: global and tenant controls, once per batch', () => {
  it('nothing in the way: it sends', async () => {
    seed();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
    expect(r().status).toBe('sent');
  });

  it.each<[string, () => void]>([
    ['tenant_kill_switch', () => { config().kill_switch = true; }],
    ['tenant_not_enabled', () => { config().enabled = false; }],
    ['tenant_not_enabled', () => { fakeDb.tables.outreach_governance_config = []; }],
    ['tenant_not_enabled', () => { failNext('outreach_governance_config', 'select'); }],    // unreadable fails closed
    ['channel_not_enabled', () => { config().enabled_channels = ['email']; }],
    ['global_kill_switch', () => { process.env.LEAD_OUTREACH_EXECUTION_DISABLED = 'true'; }],
  ])('%s stops the send', async (code, arrange) => {
    seed();
    arrange();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe(BLOCKED_SEND_CONTROL);
    expect(r().error_code).toBeNull();
    expect(r().error_message).toBe(`send_control: ${code}`);
  });

  it('is read once for the batch, and the whole batch is held', async () => {
    seed();
    fakeDb.tables.whatsapp_broadcast_recipients.push(recipientRow('r2', '+15550100002'));
    config().kill_switch = true;
    await processBatch('b1', ['r1', 'r2']);
    expect(fetchCalls).toHaveLength(0);
    expect([r('r1').status, r('r2').status]).toEqual([BLOCKED_SEND_CONTROL, BLOCKED_SEND_CONTROL]);
    expect(fakeDb.calls.filter((c) => c === 'outreach_governance_config:select')).toHaveLength(1);
  });

  it('never rewrites a recipient that already moved on: a retried job finds it sent', async () => {
    seed();
    await processBatch('b1', ['r1']);
    config().kill_switch = true;
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
    expect(r().status).toBe('sent');
  });

  it('a block that cannot be written fails the job: no send, and the row stays pending for the retry', async () => {
    seed();
    config().kill_switch = true;
    failNext('whatsapp_broadcast_recipients', 'update');
    await expect(processBatch('b1', ['r1'])).rejects.toThrow(/could not be recorded/);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe('pending');
  });

  it('is checked before the token, so a token failure cannot leave a stopped tenant\'s row pending', async () => {
    seed();
    config().kill_switch = true;
    const auth = require('../../auth/metaAuthService');
    const spy = jest.spyOn(auth, 'getValidAccessToken');
    await processBatch('b1', ['r1']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('journey broadcasts: an inbound message, per recipient, before the claim', () => {
  it('a reply after the broadcast was created stops the send, and the row never reaches `sending`', async () => {
    seed();
    inboundAt('2026-11-02T10:05:00.000Z');
    const statuses: unknown[] = [];
    const recipient = r();
    let status = recipient.status;
    Object.defineProperty(recipient, 'status', { get: () => status, set: (v) => { statuses.push(v); status = v; }, enumerable: true });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(statuses).toEqual([BLOCKED_SEND_CONTROL]);
    expect(r().error_message).toBe('send_control: inbound_since_broadcast');
  });

  it('a reply in the same second as the broadcast counts: Meta\'s timestamps have no milliseconds', async () => {
    seed();
    inboundAt('2026-11-02T10:00:00.000Z');
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe(BLOCKED_SEND_CONTROL);
  });

  it('a message before the broadcast does not', async () => {
    seed();
    inboundAt('2026-11-02T09:59:59.000Z');
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('an outbound message on the thread does not', async () => {
    seed();
    inboundAt('2026-11-02T10:05:00.000Z');
    fakeDb.tables.engagement_messages[0].direction = 'outbound';
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('another tenant\'s thread with the same key does not', async () => {
    seed();
    inboundAt('2026-11-02T10:05:00.000Z', DIGITS, { organization_id: 'co-other' });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('a reply reached through another account of this tenant does', async () => {
    seed();
    fakeDb.tables.social_accounts.push({ id: 'sa2', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn2', is_active: false });
    inboundAt('2026-11-02T10:05:00.000Z', DIGITS, { platform_thread_id: `wa:sa2:${DIGITS}` });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
  });

  it('applies to the recipient who replied, not the batch', async () => {
    seed();
    fakeDb.tables.whatsapp_broadcast_recipients.push(recipientRow('r2', '+15550100002'));
    inboundAt('2026-11-02T10:05:00.000Z');
    await processBatch('b1', ['r1', 'r2']);
    expect(fetchCalls).toHaveLength(1);
    expect(r('r1').status).toBe(BLOCKED_SEND_CONTROL);
    expect(r('r2').status).toBe('sent');
  });

  it.each(['social_accounts', 'engagement_threads', 'engagement_messages'])('%s unreadable: fails closed', async (table) => {
    seed();
    inboundAt('2026-11-02T09:00:00.000Z');
    // processBatch reads social_accounts for the phone number id first, then for the shared-number
    // check (a number held by another live account is refused); the reply check is the third read.
    failNext(table, 'select', table === 'social_accounts' ? 2 : 0);
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe(BLOCKED_SEND_CONTROL);
    expect(r().error_message).toBe('send_control: inbound_unreadable');
  });

  it('a broadcast with no usable creation time: fails closed', async () => {
    seed({ broadcast: { created_at: null } });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe(BLOCKED_SEND_CONTROL);
  });

  it('a recorded opt-out still reads as contact governance, which outranks it', async () => {
    seed();
    inboundAt('2026-11-02T10:05:00.000Z');
    fakeDb.tables.contact_governance_records.push({
      id: 'g1', organization_id: ORG, person_id: null, target_normalized: PHONE, channel: 'whatsapp', governance_type: 'unsubscribe',
      effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
    });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe('blocked_governance');
  });
});

// OWNER RULING (2026-11-11, "stop everything", via e9): the two KILL SWITCHES now stop operator
// broadcasts too - paused, recipients left pending, nothing sent. The journey-only controls
// (WS-3 enablement, the channel list, inbound replies) still do NOT apply to them.
describe('operator broadcasts: the kill switches stop them; journey-only controls do not apply', () => {
  const OPERATOR_NAMES = [undefined, 'Spring sale', 'wf', 'WF:task', 'x wf:task'];

  it.each(OPERATOR_NAMES)('name %p, TENANT kill switch on: nothing sent, recipient pending, broadcast paused', async (name) => {
    seed({ broadcast: { name: name ?? null } });
    config().kill_switch = true;
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe('pending');
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
  });

  it.each(OPERATOR_NAMES)('name %p, GLOBAL kill switch on: nothing sent, recipient pending, broadcast paused', async (name) => {
    seed({ broadcast: { name: name ?? null } });
    process.env.LEAD_OUTREACH_EXECUTION_DISABLED = 'true';
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe('pending');
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
  });

  it.each(OPERATOR_NAMES)('name %p, journey-only controls set (no WS-3 row, inbound reply): still sends; no engagement read', async (name) => {
    seed({ broadcast: { name: name ?? null } });
    fakeDb.tables.outreach_governance_config = [];               // tenant_not_enabled for a journey
    inboundAt('2026-11-02T10:05:00.000Z');                        // a reply that would hold a journey
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
    expect(r().status).toBe('sent');
    expect(fakeDb.calls.filter((c) => /engagement_/.test(c))).toEqual([]);
  });

  it('an UNREADABLE tenant kill switch counts as ON (fail closed) for an operator broadcast', async () => {
    seed({ broadcast: { name: 'Spring sale' } });
    failNext('outreach_governance_config', 'select');
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(r().status).toBe('pending');
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('paused');
  });
});

describe('agreement with the adapter, which this service cannot import', () => {
  const ctx = {
    organizationId: ORG, executionTaskId: 'task-1', executionInstanceId: 'i1', personId: 'p1', now: new Date().toISOString(),
    subject: { kind: 'prospect', id: 'pr1' }, step: { whatsapp: { template_name: 'tpl' } },
  };

  it('the prefix is the one the adapter names journey broadcasts with', () => {
    expect(broadcastNameFor('task-1').startsWith(JOURNEY_BROADCAST_PREFIX)).toBe(true);
  });

  it.each<[string, () => void]>([
    ['clear', () => undefined],
    ['kill switch', () => { config().kill_switch = true; }],
    ['disabled', () => { config().enabled = false; }],
    ['no row', () => { fakeDb.tables.outreach_governance_config = []; }],
    ['other channel', () => { config().enabled_channels = ['email']; }],
    ['global', () => { process.env.LEAD_OUTREACH_EXECUTION_DISABLED = 'true'; }],
  ])('the send-time refusal matches the adapter\'s pre-creation refusal: %s', async (_name, arrange) => {
    seed();
    arrange();
    expect(await whatsappChannelRefusal(ORG)).toBe(await defaultWhatsAppDeps.channelRefusal(ORG));
  });

  // The adapter has no case for the new status today and its default answers `wait`. Once
  // the proposed line lands it answers needs_human. Either way it must never settle as done.
  it('the journey never completes or advances on the new status', async () => {
    const transitions: unknown[] = [];
    const adapter = createWhatsAppAdapter({
      ...defaultWhatsAppDeps,
      getOrCreateRequest: async () => ({ id: 'q1', state: 'submitted', external_ref: 'b1', detail: null, updated_at: null }),
      readRecipientStatus: async () => BLOCKED_SEND_CONTROL,
      transitionRequest: async (_o: string, _t: string, _f: string, patch: { state: string }) => { transitions.push(patch.state); return true; },
    });
    const out = await adapter.execute(ctx as never);
    expect(['wait', 'needs_human']).toContain(out.disposition);
    expect(transitions).not.toContain('completed');
    expect(transitions).not.toContain('skipped');
  });
});
