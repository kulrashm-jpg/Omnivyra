/**
 * Work Item 2 / L-4 — WhatsApp send-once and reconciliation on REAL PostgreSQL: the real
 * broadcast service (createBroadcast, expandRecipients, enqueueBroadcast, processBatch,
 * retryFailed, updateRecipientDelivery) and the real webhook job processor over the real
 * schema, including the provider event ledger's unique key (20270128000002). Meta HTTP,
 * Redis and the queue are test doubles, as in whatsapp_broadcast_person_restriction.test.ts.
 *
 * Every case asserts the Meta call counter: one call per recipient, whatever happens after.
 */

import { db, inRollback, seedTenants, ORG_A } from './setup';
import { newUser, one, rnd } from './helpers/journeyFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
  async ttl() { return 60; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
const mockJobs: Array<{ broadcast_id: string; recipient_ids: string[] }> = [];
const mockEnqueue = { fail: null as null | Error };
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { broadcast_id: string; recipient_ids: string[] }) => {
    if (mockEnqueue.fail) throw mockEnqueue.fail;
    mockJobs.push(data);
  },
}));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));

process.env.PHONE_HASH_SALT = 'test-salt';

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/whatsappBroadcastService');
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
/* eslint-enable @typescript-eslint/no-var-requires */

const PHONE = '+15551230001';
const PHONE_NUMBER_ID = 'pn-test-once';
const metaCalls: Array<{ to: string; marker: string }> = [];
let meta: () => Promise<unknown>;

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    metaCalls.push({ to: String(body.to), marker: String(body.biz_opaque_callback_data) });
    return meta();
  }) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });
beforeEach(() => {
  metaCalls.length = 0; mockJobs.length = 0; mockRedis.store.clear(); mockEnqueue.fail = null;
  meta = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${rnd()}` }] }) });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

/** A manual (operator) broadcast with one recipient: the send path without journey controls. */
async function broadcastWithRecipient(): Promise<{ b: string; r: string }> {
  await seedTenants();
  const user = await newUser();
  const a = await one(`INSERT INTO public.social_accounts
    (user_id, platform, platform_user_id, account_name, access_token, company_id, phone_number_id, is_active)
    VALUES ($1,'whatsapp',$2,'wa','t',$3,$4,true) RETURNING id`, [user, rnd(), ORG_A, PHONE_NUMBER_ID]);
  await db.query(`INSERT INTO public.whatsapp_templates (company_id, social_account_id, template_name, template_category, status, is_active, components)
    VALUES ($1,$2,'hello_1','MARKETING','APPROVED',true,'[]')`, [ORG_A, String(a.id)]);
  const b = await svc.createBroadcast({ company_id: ORG_A, social_account_id: String(a.id), name: `manual ${rnd()}`, message_type: 'template', template_name: 'hello_1' });
  await svc.expandRecipients(b, [{ phone_e164: PHONE }]);
  const r = await one('SELECT id FROM public.whatsapp_broadcast_recipients WHERE broadcast_id = $1', [b]);
  return { b, r: String(r.id) };
}
const state = (r: string) => one('SELECT status, wa_message_id, error_code, error_message FROM public.whatsapp_broadcast_recipients WHERE id = $1', [r]);
async function runQueued(): Promise<void> {
  for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
}
const statusJob = (wamid: string, status: string, over: Record<string, unknown>) => ({
  data: { payload: { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: wamid, status, timestamp: '1762600000', ...over }] } }] }] } },
});

describe('WhatsApp send-once on the real schema (L-4)', () => {
  it('a lost response is send_uncertain; the marked status webhook reconciles it; replays collapse in the ledger; one Meta call', () => inRollback(async () => {
    const { b, r } = await broadcastWithRecipient();
    meta = async () => { throw new Error('socket hang up'); };
    await svc.enqueueBroadcast(b, 'free');
    await runQueued();
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect(metaCalls).toEqual([{ to: PHONE, marker: r }]);
    await svc.retryFailed(b);
    expect(mockJobs).toEqual([]);

    const wamid = `wamid.late.${rnd()}`;
    await processWhatsAppWebhookJob(statusJob(wamid, 'sent', { biz_opaque_callback_data: r, recipient_id: '15551230001' }));
    expect(await state(r)).toMatchObject({ status: 'sent', wa_message_id: wamid });
    await processWhatsAppWebhookJob(statusJob(wamid, 'delivered', { biz_opaque_callback_data: r, recipient_id: '15551230001', timestamp: '1762600100' }));
    await processWhatsAppWebhookJob(statusJob(wamid, 'delivered', { biz_opaque_callback_data: r, recipient_id: '15551230001', timestamp: '1762600100' }));
    expect(await state(r)).toMatchObject({ status: 'delivered', wa_message_id: wamid });
    const ledger = await db.query('SELECT event_status FROM public.whatsapp_provider_events WHERE wa_message_id = $1 ORDER BY event_status', [wamid]);
    expect(ledger.rows.map((x: { event_status: string }) => x.event_status)).toEqual(['delivered', 'sent']);
    expect(metaCalls).toHaveLength(1);
  }), 120_000);

  it('a marker for another number changes nothing', () => inRollback(async () => {
    const { b, r } = await broadcastWithRecipient();
    meta = async () => { throw new Error('socket hang up'); };
    await svc.enqueueBroadcast(b, 'free');
    await runQueued();
    await processWhatsAppWebhookJob(statusJob(`wamid.${rnd()}`, 'sent', { biz_opaque_callback_data: r, recipient_id: '15551239999' }));
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
  }), 120_000);

  it('a lost queue acknowledgement withdraws the recipient (never sent); a retry sends exactly once', () => inRollback(async () => {
    const { b, r } = await broadcastWithRecipient();
    mockEnqueue.fail = new Error('Connection is closed.');
    await expect(svc.enqueueBroadcast(b, 'free')).rejects.toThrow('Connection is closed.');
    expect(await state(r)).toMatchObject({ status: 'failed', error_code: null, error_message: svc.ENQUEUE_UNCONFIRMED_MESSAGE });
    expect(metaCalls).toEqual([]);
    mockEnqueue.fail = null;
    await svc.retryFailed(b);
    await runQueued();
    await runQueued();
    expect(metaCalls).toHaveLength(1);
    expect((await state(r)).status).toBe('sent');
  }), 120_000);

  it('a 5xx is send_uncertain with its HTTP code and is never retried', () => inRollback(async () => {
    const { b, r } = await broadcastWithRecipient();
    meta = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Service Unavailable' } }) });
    await svc.enqueueBroadcast(b, 'free');
    await runQueued();
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', error_code: 503 });
    await svc.retryFailed(b);
    expect(mockJobs).toEqual([]);
    expect(metaCalls).toHaveLength(1);
  }), 120_000);
});
