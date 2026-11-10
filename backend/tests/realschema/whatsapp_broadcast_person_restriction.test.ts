/**
 * Owner GO (2026-11-08) — WhatsApp broadcasts apply PERSON-level restrictions as well as the
 * number's, on REAL PostgreSQL: the real broadcast service (createBroadcast,
 * expandPersonRecipients / expandRecipients, enqueueBroadcast, processBatch), the real
 * governance store and writer, the real G-11 review service, and migration 20270128000004.
 * Meta HTTP, Redis and the queue are stubbed, as in p4_governance_whatsapp.test.ts.
 *
 * Every send test asserts the Meta call counter. The person check is the variable under test:
 * the negative control (personId forced to null in recipientVerdict) must turn the tests
 * marked [PERSON] red.
 */

import { db, inRollback, seedTenants, attempt, newPerson, ORG_A, ORG_B } from './setup';
import { enableOutreach, newUser, one, rnd } from './helpers/journeyFixtures';

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
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { broadcast_id: string; recipient_ids: string[] }) => { mockJobs.push(data); },
}));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));

process.env.PHONE_HASH_SALT = 'test-salt';

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/whatsappBroadcastService');
const repo = require('../../services/prospectIdentity/contactGovernanceRepository');
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
const review = require('../../services/orchestration/optOutReview');
/* eslint-enable @typescript-eslint/no-var-requires */

const PHONE = '+15551230001';      // the number on the broadcast
const OTHER = '+15551239999';      // another number of the same person
const PHONE_NUMBER_ID = 'pn-test-1';
const metaCalls: string[] = [];

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    metaCalls.push(String(JSON.parse(String(init?.body ?? '{}')).to));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${rnd()}` }] }), text: async () => '' };
  }) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });
beforeEach(() => { metaCalls.length = 0; mockJobs.length = 0; mockRedis.store.clear(); jest.restoreAllMocks(); });

async function account(org: string): Promise<string> {
  const user = await newUser();
  const a = await one(`INSERT INTO public.social_accounts
    (user_id, platform, platform_user_id, account_name, access_token, company_id, phone_number_id, is_active)
    VALUES ($1,'whatsapp',$2,'wa','t',$3,$4,true) RETURNING id`, [user, rnd(), org, PHONE_NUMBER_ID]);
  await db.query(`INSERT INTO public.whatsapp_templates (company_id, social_account_id, template_name, template_category, status, is_active, components)
    VALUES ($1,$2,'hello_1','MARKETING','APPROVED',true,'[]')`, [org, String(a.id)]);
  return String(a.id);
}
/** A journey broadcast ('wf:' prefix, as the adapter names it) or a manual one. */
async function broadcast(org: string, kind: 'journey' | 'manual' = 'journey'): Promise<string> {
  await enableOutreach(org, ['whatsapp']);
  return svc.createBroadcast({
    company_id: org, social_account_id: await account(org),
    name: kind === 'journey' ? `wf:${rnd()}` : `manual ${rnd()}`, message_type: 'template', template_name: 'hello_1',
  });
}
const recipient = (broadcastId: string) => one(
  'SELECT id, status, retry_count, error_message, person_id, person_company_id FROM public.whatsapp_broadcast_recipients WHERE broadcast_id = $1', [broadcastId]);
const quotaConsumed = () => [...mockRedis.store.values()].reduce((a, b) => a + b, 0);
async function enqueueAndRun(broadcastId: string): Promise<void> {
  await svc.enqueueBroadcast(broadcastId, 'free');
  for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
}
const personOptOut = (org: string, personId: string, channel = 'whatsapp') => recordContactGovernance({
  organizationId: org, governanceType: 'unsubscribe', channel, personId, source: 'test:person_opt_out',
});

describe('[PERSON] person-level restrictions at broadcast send time', () => {
  it('[PERSON] a person-only restriction blocks a journey broadcast; the number carries none', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    await personOptOut(ORG_A, person);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    // Nothing pending, so the enqueue refuses to start: the recipient was screened out.
    await expect(svc.enqueueBroadcast(b, 'free')).rejects.toThrow(/No pending recipients/);
    expect(await recipient(b)).toMatchObject({ status: 'blocked_governance', person_id: person, retry_count: 0 });
    expect(metaCalls).toEqual([]);
  }), 120_000);

  it('[PERSON] an opt-out recorded AFTER queueing stops the send', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await svc.enqueueBroadcast(b, 'free');
    expect(mockJobs).toHaveLength(1);
    await personOptOut(ORG_A, person);
    for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
    expect(metaCalls).toEqual([]);
    expect(await recipient(b)).toMatchObject({ status: 'blocked_governance', retry_count: 0 });
  }), 120_000);

  it('[PERSON] a different number cannot bypass the person: held on PHONE, sent to OTHER', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    // The G-11 hold: the person AND their known number at the time.
    await review.writeOptOutHolds({ organizationId: ORG_A, personId: person, phone: PHONE, holdSource: 'optout_review:reply_opt_out', sourceRef: `run-${rnd()}` });
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: OTHER, person_id: person }]);
    await expect(enqueueAndRun(b)).rejects.toThrow(/No pending recipients/);
    expect(metaCalls).toEqual([]);
    expect(await recipient(b)).toMatchObject({ status: 'blocked_governance' });
  }), 120_000);

  it('control: the same journey recipient with no restriction IS sent (the harness reaches Meta)', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await enqueueAndRun(b);
    expect(metaCalls).toEqual([PHONE]);
    expect(await recipient(b)).toMatchObject({ status: 'sent' });
  }), 120_000);
});

describe('manual broadcasts stay number-only', () => {
  it('a manual recipient is judged on its number: the person-only restriction of someone with that number does not apply', () => inRollback(async () => {
    await seedTenants();
    const { rows: [p] } = await db.query(`INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1, $2) RETURNING id`, [ORG_A, PHONE]);
    await personOptOut(ORG_A, String(p.id));
    const b = await broadcast(ORG_A, 'manual');
    await svc.expandRecipients(b, [{ phone_e164: PHONE }]);
    await enqueueAndRun(b);
    expect(metaCalls).toEqual([PHONE]);                       // no phone-to-person lookup
    expect(await recipient(b)).toMatchObject({ person_id: null, person_company_id: null });
  }), 120_000);

  it('a manual recipient whose NUMBER is restricted is still refused', () => inRollback(async () => {
    await seedTenants();
    await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'whatsapp', target: PHONE, source: 'test:number' });
    const b = await broadcast(ORG_A, 'manual');
    await svc.expandRecipients(b, [{ phone_e164: PHONE }]);
    await expect(enqueueAndRun(b)).rejects.toThrow(/No pending recipients/);
    expect(metaCalls).toEqual([]);
  }), 120_000);

  it('a manual request body cannot attach a person: expandRecipients drops person_id', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A, 'manual');
    await svc.expandRecipients(b, [{ phone_e164: PHONE, person_id: person } as never]);
    expect(await recipient(b)).toMatchObject({ person_id: null });
  }), 120_000);
});

describe('fail closed', () => {
  it('a governance store that cannot be read: enqueue refuses before any quota; nothing is queued or sent', () => inRollback(async () => {
    await seedTenants();
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: await newPerson(ORG_A) }]);
    jest.spyOn(repo, 'loadTenantGovernanceRecords').mockResolvedValue({ ok: false, error: 'boom' });
    await expect(svc.enqueueBroadcast(b, 'free')).rejects.toThrow(/governance unreadable/);
    expect(mockJobs).toEqual([]);
    expect(quotaConsumed()).toBe(0);
    expect(metaCalls).toEqual([]);
  }), 120_000);

  it('a governance store that cannot be read at SEND time: nothing is sent', () => inRollback(async () => {
    await seedTenants();
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: await newPerson(ORG_A) }]);
    await svc.enqueueBroadcast(b, 'free');
    jest.spyOn(repo, 'loadTenantGovernanceRecords').mockResolvedValue({ ok: false, error: 'boom' });
    for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
    expect(metaCalls).toEqual([]);
    expect(await recipient(b)).toMatchObject({ status: 'blocked_governance', retry_count: 0 });
  }), 120_000);
});

describe('tenant isolation', () => {
  it("another tenant's restriction on the same number, or on its own person, does not block this tenant", () => inRollback(async () => {
    await seedTenants();
    const foreignPerson = await newPerson(ORG_B);
    await personOptOut(ORG_B, foreignPerson);
    await recordContactGovernance({ organizationId: ORG_B, governanceType: 'unsubscribe', channel: '*', target: PHONE, source: 'test:number' });
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: await newPerson(ORG_A) }]);
    await enqueueAndRun(b);
    expect(metaCalls).toEqual([PHONE]);
  }), 120_000);

  it("a person of ANOTHER tenant is refused by the database (23503); nothing is written", () => inRollback(async () => {
    await seedTenants();
    const foreignPerson = await newPerson(ORG_B);
    const b = await broadcast(ORG_A);
    await expect(svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: foreignPerson }])).rejects.toThrow();
    expect(await one('SELECT count(*)::int n FROM public.whatsapp_broadcast_recipients WHERE broadcast_id = $1', [b])).toEqual({ n: 0 });
    const raw = await attempt(`INSERT INTO public.whatsapp_broadcast_recipients (broadcast_id, hashed_phone, encrypted_phone, person_id)
      VALUES ($1, 'h-x', 'e', $2)`, [b, foreignPerson]);
    expect(raw).toBe('23503');
  }), 120_000);

  it('the tenant is derived from the broadcast; a supplied tenant that disagrees is refused (42501)', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    expect(await recipient(b)).toMatchObject({ person_id: person, person_company_id: ORG_A });
    expect(await attempt(`INSERT INTO public.whatsapp_broadcast_recipients (broadcast_id, hashed_phone, encrypted_phone, person_id, person_company_id)
      VALUES ($1, 'h-y', 'e', $2, $3)`, [b, person, ORG_B])).toBe('42501');
  }), 120_000);

  it('the new columns: RLS on, no client role can read or write them, service_role can', async () => {
    const r = await one(`SELECT relrowsecurity rls FROM pg_class WHERE oid = 'public.whatsapp_broadcast_recipients'::regclass`);
    expect(r.rls).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      for (const col of ['person_id', 'person_company_id']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
          const p = await one(`SELECT has_column_privilege($1, 'public.whatsapp_broadcast_recipients', $2, $3) ok`, [role, col, priv]);
          expect({ role, col, priv, ok: p.ok }).toEqual({ role, col, priv, ok: false });
        }
      }
    }
    const fn = await one(`SELECT has_function_privilege('authenticated', 'public.whatsapp_broadcast_recipients_person_guard()', 'EXECUTE') ok`);
    expect(fn.ok).toBe(false);
  });
});

describe('the person link: erasure and immutability', () => {
  it('deleting the person SUCCEEDS with a recipient attached: person_id becomes NULL, the tenant stays, the number still governs', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
    expect(await recipient(b)).toMatchObject({ person_id: null, person_company_id: ORG_A, status: 'pending' });
  }), 120_000);

  it('MEASURED: inside the FK action the deleted person is no longer visible; during an application UPDATE it is', () => inRollback(async () => {
    await seedTenants();
    // A BEFORE UPDATE probe on the same table, so it sees what the guard sees; it goes with the rollback.
    await db.query(`CREATE TEMP TABLE person_probe (person_visible boolean, new_person_null boolean)`);
    await db.query(`CREATE FUNCTION pg_temp.probe_person() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO person_probe VALUES (EXISTS (SELECT 1 FROM public.unified_persons p WHERE p.id = OLD.person_id), NEW.person_id IS NULL);
        RETURN NEW;
      END $$`);
    await db.query(`CREATE TRIGGER zz_person_probe BEFORE UPDATE ON public.whatsapp_broadcast_recipients
      FOR EACH ROW EXECUTE FUNCTION pg_temp.probe_person()`);
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await db.query(`UPDATE public.whatsapp_broadcast_recipients SET status = 'pending' WHERE broadcast_id = $1`, [b]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
    expect((await db.query('SELECT person_visible, new_person_null FROM person_probe')).rows).toEqual([
      { person_visible: true, new_person_null: false },   // the application UPDATE
      { person_visible: false, new_person_null: true },   // the FK's SET NULL, after the delete
    ]);
  }), 120_000);

  it('NEGATIVE CONTROL: an UNRELATED trigger that clears person_id while the person exists is refused (23514)', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    // A nested trigger context that is NOT the person delete: an insert elsewhere clears the link.
    await db.query(`CREATE TEMP TABLE unrelated_event (broadcast_id uuid)`);
    await db.query(`CREATE FUNCTION pg_temp.clear_person() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE public.whatsapp_broadcast_recipients SET person_id = NULL WHERE broadcast_id = NEW.broadcast_id; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER unrelated_clear AFTER INSERT ON unrelated_event FOR EACH ROW EXECUTE FUNCTION pg_temp.clear_person()`);
    expect(await attempt('INSERT INTO unrelated_event VALUES ($1)', [b])).toBe('23514');
    expect(await recipient(b)).toMatchObject({ person_id: person });
  }), 120_000);

  it('an application UPDATE cannot clear or change the person, nor its tenant (23514)', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    const other = await newPerson(ORG_A);
    expect(await attempt('UPDATE public.whatsapp_broadcast_recipients SET person_id = NULL WHERE broadcast_id = $1', [b])).toBe('23514');
    expect(await attempt('UPDATE public.whatsapp_broadcast_recipients SET person_id = $2 WHERE broadcast_id = $1', [b, other])).toBe('23514');
    expect(await attempt('UPDATE public.whatsapp_broadcast_recipients SET person_company_id = $2 WHERE broadcast_id = $1', [b, ORG_B])).toBe('23514');
    // A manual recipient cannot gain a person either.
    const m = await broadcast(ORG_A, 'manual');
    await svc.expandRecipients(m, [{ phone_e164: PHONE }]);
    expect(await attempt('UPDATE public.whatsapp_broadcast_recipients SET person_id = $2 WHERE broadcast_id = $1', [m, person])).toBe('23514');
    // Ordinary status updates still work.
    expect(await attempt(`UPDATE public.whatsapp_broadcast_recipients SET status = 'sending' WHERE broadcast_id = $1`, [b])).toBe('ok');
  }), 120_000);
});

describe('G-11 reopening and independent restrictions', () => {
  async function reopenedWhatsApp(extra?: () => Promise<unknown>) {
    await seedTenants();
    const actor = await newUser();
    const person = await newPerson(ORG_A);
    const ref = `run-${rnd()}`;
    const holdIds = await review.writeOptOutHolds({ organizationId: ORG_A, personId: person, holdSource: 'optout_review:reply_opt_out', sourceRef: ref });
    const r = await review.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds, sourceRef: ref, holdSource: 'optout_review:reply_opt_out' });
    if (extra) await extra.call(null);
    expect(await review.decideOptOutReview({ organizationId: ORG_A, reviewId: r.reviewId, actorUserId: actor, reopenChannels: ['whatsapp'], reason: 'admin reopened whatsapp' })).toMatchObject({ ok: true });
    return person;
  }

  it('[PERSON] while the review holds, the journey broadcast is refused', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const ref = `run-${rnd()}`;
    const holdIds = await review.writeOptOutHolds({ organizationId: ORG_A, personId: person, holdSource: 'optout_review:reply_opt_out', sourceRef: ref });
    await review.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds, sourceRef: ref, holdSource: 'optout_review:reply_opt_out' });
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await expect(enqueueAndRun(b)).rejects.toThrow(/No pending recipients/);
    expect(metaCalls).toEqual([]);
  }), 120_000);

  it('an authorised WhatsApp reopen with nothing else in force: the broadcast IS sent', () => inRollback(async () => {
    const person = await reopenedWhatsApp();
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await enqueueAndRun(b);
    expect(metaCalls).toEqual([PHONE]);
  }), 120_000);

  it('[PERSON] the reopen does not override an independent all-channel complaint on the person', () => inRollback(async () => {
    let person = '';
    person = await reopenedWhatsApp();
    await recordContactGovernance({ organizationId: ORG_A, governanceType: 'complaint', channel: '*', personId: person, source: 'test:complaint' });
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await expect(enqueueAndRun(b)).rejects.toThrow(/No pending recipients/);
    expect(metaCalls).toEqual([]);
  }), 120_000);

  it('the reopen does not override a STOP on the number', () => inRollback(async () => {
    const person = await reopenedWhatsApp();
    await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'whatsapp', target: PHONE, source: 'webhook:whatsapp' });
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await expect(enqueueAndRun(b)).rejects.toThrow(/No pending recipients/);
    expect(metaCalls).toEqual([]);
  }), 120_000);
});

describe('a held recipient consumes no attempt, quota or retry budget', () => {
  it('[PERSON] of two recipients, the held one is not counted against the quota, never claimed, never retried', () => inRollback(async () => {
    await seedTenants();
    const held = await newPerson(ORG_A);
    const free = await newPerson(ORG_A);
    await personOptOut(ORG_A, held);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: held }, { phone_e164: OTHER, person_id: free }]);
    await enqueueAndRun(b);
    expect(quotaConsumed()).toBe(1);
    expect(metaCalls).toEqual([OTHER]);
    const heldRow = await one('SELECT status, retry_count, wa_message_id, sent_at FROM public.whatsapp_broadcast_recipients WHERE person_id = $1', [held]);
    expect(heldRow).toMatchObject({ status: 'blocked_governance', retry_count: 0, wa_message_id: null, sent_at: null });
    // retryFailed re-queues only `failed`: the held recipient is never picked up.
    await svc.retryFailed(b);
    expect(mockJobs).toEqual([]);
  }), 120_000);

  it('held at SEND time (after the quota was counted): no claim, no provider attempt, retry_count unchanged', () => inRollback(async () => {
    await seedTenants();
    const person = await newPerson(ORG_A);
    const b = await broadcast(ORG_A);
    await svc.expandPersonRecipients(b, [{ phone_e164: PHONE, person_id: person }]);
    await svc.enqueueBroadcast(b, 'free');
    await personOptOut(ORG_A, person);
    for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
    expect(metaCalls).toEqual([]);
    expect(await recipient(b)).toMatchObject({ status: 'blocked_governance', retry_count: 0 });
  }), 120_000);
});
