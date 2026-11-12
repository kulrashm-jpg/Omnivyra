/**
 * Follow-up A to Work Item 2 (L-4) — the unconfirmed-send sweep on REAL PostgreSQL: the real
 * broadcast service, webhook job processor and sweep over the real schema, with migration
 * 20270128000007's functions, constraints, append-only audit and grants. Meta HTTP, Redis and
 * the queue are test doubles, as in whatsapp_send_once_real.test.ts.
 *
 * Every case asserts that nothing is sent by the sweep: the Meta call counter only moves when
 * processBatch runs, and never during a sweep or a webhook.
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
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
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { broadcast_id: string; recipient_ids: string[] }) => { mockJobs.push(data); },
}));
// No live batch jobs; the enqueue lease is a DELIBERATE NO-OP pass-through (always
// acquired), so this suite does NOT cover lease or live-job behaviour -
// whatsappBroadcastResume.test.ts does.
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({ getJobs: async () => [] }) }));
jest.mock('../../../lib/platform/distributedLock', () => ({
  withLease: async (_n: string, _t: number, fn: () => Promise<unknown>) => ({ ran: true, value: await fn() }),
}));

process.env.PHONE_HASH_SALT = 'test-salt';

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/whatsappBroadcastService');
const sweep = require('../../services/whatsappUnconfirmedSendSweep');
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
/* eslint-enable @typescript-eslint/no-var-requires */

const PHONE = '+15551231001';
const WA_ID = '15551231001';
const PHONE_NUMBER_ID = 'pn-test-sweep';
const HOUR = 60 * 60 * 1000;
let metaCalls = 0;
let meta: () => Promise<unknown>;

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async () => { metaCalls += 1; return meta(); }) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });
beforeEach(() => {
  metaCalls = 0; mockJobs.length = 0; mockRedis.store.clear();
  meta = async () => { throw new Error('socket hang up'); };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

/** A manual broadcast of `org` with one recipient whose send was lost (send_uncertain, no id), aged. */
async function uncertainRecipient(org = ORG_A, phone = PHONE): Promise<{ b: string; r: string }> {
  await seedTenants();
  const user = await newUser();
  const pn = `${PHONE_NUMBER_ID}-${rnd()}`;
  const a = await one(`INSERT INTO public.social_accounts
    (user_id, platform, platform_user_id, account_name, access_token, company_id, phone_number_id, is_active)
    VALUES ($1,'whatsapp',$2,'wa','t',$3,$4,true) RETURNING id`, [user, rnd(), org, pn]);
  const tpl = `hello_${rnd()}`;
  await db.query(`INSERT INTO public.whatsapp_templates (company_id, social_account_id, template_name, template_category, status, is_active, components)
    VALUES ($1,$2,$3,'MARKETING','APPROVED',true,'[]')`, [org, String(a.id), tpl]);
  const b = await svc.createBroadcast({ company_id: org, social_account_id: String(a.id), name: `manual ${rnd()}`, message_type: 'template', template_name: tpl });
  await svc.expandRecipients(b, [{ phone_e164: phone }]);
  const r = String((await one('SELECT id FROM public.whatsapp_broadcast_recipients WHERE broadcast_id = $1', [b])).id);
  await svc.enqueueBroadcast(b, 'free');
  for (const job of mockJobs.splice(0)) await svc.processBatch(job.broadcast_id, job.recipient_ids);
  // The claim stamped the send; only then is it backdated for staleness.
  expect((await one('SELECT send_started_at FROM public.whatsapp_broadcast_recipients WHERE id = $1', [r])).send_started_at).not.toBeNull();
  await age(r);
  return { b, r };
}
const age = (r: string, ms = 2 * HOUR) =>
  db.query(`UPDATE public.whatsapp_broadcast_recipients SET send_started_at = now() - ($2 || ' milliseconds')::interval WHERE id = $1`, [r, String(ms)]);
const state = (r: string) => one('SELECT status, wa_message_id, error_code, delivered_at, read_at FROM public.whatsapp_broadcast_recipients WHERE id = $1', [r]);
const audit = async (r: string) => (await db.query(
  'SELECT outcome, from_status, to_status, wa_message_id, company_id FROM public.whatsapp_send_reconciliations WHERE recipient_id = $1 ORDER BY outcome', [r])).rows;
/** A provider event time RELATIVE TO NOW (CLASS-2, 8e066d443: an event older than the current send's claim is an
 * earlier message of the same recipient and attaches nothing). The literal keeps its offset from the original
 * fixed base 1762600000, so the order between a test's events is unchanged. */
const ts = (fixed: number): string => String(Math.floor(Date.now() / 1000) + (fixed - 1762600000));
const statusJob = (wamid: string, status: string, over: Record<string, unknown>) => ({
  data: { payload: { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: wamid, status, timestamp: ts(1762600000), ...over }] } }] }] } },
});
/** Verified evidence in the ledger with NO recipient change: what a webhook job leaves when it runs out of attempts. */
async function strandedEvidence(r: string, wamid: string, status: string, over: Record<string, unknown> = {}): Promise<void> {
  await db.query(`CREATE OR REPLACE FUNCTION pg_temp.refuse_attach() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.wa_message_id IS NOT NULL THEN RAISE EXCEPTION 'simulated outage' USING ERRCODE = '08006'; END IF; RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER zz_refuse_attach BEFORE UPDATE ON public.whatsapp_broadcast_recipients FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_attach()');
  await expect(processWhatsAppWebhookJob(statusJob(wamid, status, { biz_opaque_callback_data: r, recipient_id: WA_ID, ...over }))).rejects.toThrow();
  await db.query('DROP TRIGGER zz_refuse_attach ON public.whatsapp_broadcast_recipients');
}
const run = (org = ORG_A, over: Record<string, unknown> = {}) => sweep.sweepUnconfirmedWhatsAppSends({ companyId: org, ...over });

describe('the webhook job keeps verified evidence (ledger)', () => {
  it('a marked event whose number matches names the recipient; a mismatched number or no marker names nobody', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const w1 = `wamid.v.${rnd()}`; const w2 = `wamid.x.${rnd()}`; const w3 = `wamid.n.${rnd()}`;
    await processWhatsAppWebhookJob(statusJob(w2, 'sent', { biz_opaque_callback_data: r, recipient_id: '15550009999' }));
    await processWhatsAppWebhookJob(statusJob(w3, 'sent', {}));
    await processWhatsAppWebhookJob(statusJob(w1, 'sent', { biz_opaque_callback_data: r, recipient_id: WA_ID }));
    const ledger = (await db.query('SELECT wa_message_id, verified_recipient_id FROM public.whatsapp_provider_events WHERE wa_message_id = ANY($1)', [[w1, w2, w3]])).rows;
    const by = Object.fromEntries(ledger.map((x: { wa_message_id: string; verified_recipient_id: string | null }) => [x.wa_message_id, x.verified_recipient_id]));
    expect(by).toEqual({ [w1]: r, [w2]: null, [w3]: null });
    expect(await state(r)).toMatchObject({ status: 'sent', wa_message_id: w1 });
    expect(metaCalls).toBe(1);
  }), 120_000);
});

describe('evidence stranded by an exhausted webhook job is attached by the sweep', () => {
  it('attaches the message id, applies the events forward, audits once; a duplicate sweep changes nothing', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const wamid = `wamid.s.${rnd()}`;
    await strandedEvidence(r, wamid, 'sent');
    await strandedEvidence(r, wamid, 'delivered', { timestamp: ts(1762600100) });
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    const ev = (await db.query('SELECT count(*)::int AS n FROM public.whatsapp_provider_events WHERE verified_recipient_id = $1', [r])).rows[0].n;
    expect(ev).toBe(2);

    const first = await run();
    expect(first).toMatchObject({ examined: 1, attached: 1, markedUncertain: 0, flaggedForReview: 0, errors: [] });
    expect(await state(r)).toMatchObject({ status: 'delivered', wa_message_id: wamid });
    expect((await state(r)).delivered_at).not.toBeNull();
    expect(await audit(r)).toEqual([{ outcome: 'provider_evidence_attached', from_status: 'send_uncertain', to_status: 'delivered', wa_message_id: wamid, company_id: ORG_A }]);

    const second = await run();
    expect(second).toMatchObject({ examined: 0, attached: 0 });
    expect(await audit(r)).toHaveLength(1);
    expect(metaCalls).toBe(1);
    await svc.retryFailed((await one('SELECT broadcast_id FROM public.whatsapp_broadcast_recipients WHERE id = $1', [r])).broadcast_id);
    expect(mockJobs).toEqual([]);
  }), 120_000);

  it('a late webhook after the sweep only moves forward (read), and never re-attaches', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const wamid = `wamid.l.${rnd()}`;
    await strandedEvidence(r, wamid, 'sent');
    await run();
    await processWhatsAppWebhookJob(statusJob(wamid, 'delivered', { biz_opaque_callback_data: r, recipient_id: WA_ID, timestamp: ts(1762600200) }));
    await processWhatsAppWebhookJob(statusJob(wamid, 'read', { biz_opaque_callback_data: r, recipient_id: WA_ID, timestamp: ts(1762600300) }));
    await processWhatsAppWebhookJob(statusJob(wamid, 'sent', { biz_opaque_callback_data: r, recipient_id: WA_ID, timestamp: ts(1762600000) }));
    expect(await state(r)).toMatchObject({ status: 'read', wa_message_id: wamid });
    expect(metaCalls).toBe(1);
  }), 120_000);

  it('two sweeps at once: one attach, one audit row', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const wamid = `wamid.c.${rnd()}`;
    await strandedEvidence(r, wamid, 'sent');
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.attached + b.attached).toBe(1);
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
    expect(await audit(r)).toHaveLength(1);
    expect(await state(r)).toMatchObject({ status: 'sent', wa_message_id: wamid });
  }), 120_000);

  it('crash after the restriction, before the attach: the next run attaches once; the restriction is written once', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const wamid = `wamid.p.${rnd()}`;
    await strandedEvidence(r, wamid, 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] });
    await db.query(`CREATE OR REPLACE FUNCTION pg_temp.crash() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'process died' USING ERRCODE = '57P01'; END $$`);
    await db.query('CREATE TRIGGER zz_crash BEFORE INSERT ON public.whatsapp_send_reconciliations FOR EACH ROW EXECUTE FUNCTION pg_temp.crash()');
    const crashed = await run();
    expect(crashed.errors).toEqual([{ recipientId: r, code: 'rpc_failed' }]);
    // The function is one transaction: the state change did not survive the failed audit write.
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    await db.query('DROP TRIGGER zz_crash ON public.whatsapp_send_reconciliations');

    const restarted = await run();
    expect(restarted).toMatchObject({ attached: 1, errors: [] });
    expect(await state(r)).toMatchObject({ status: 'failed', wa_message_id: wamid, error_code: 131026 });
    const restrictions = (await db.query(`SELECT count(*)::int AS n FROM public.contact_governance_records
      WHERE organization_id = $1 AND governance_type = 'invalid_contact' AND channel = 'whatsapp' AND revoked_at IS NULL`, [ORG_A])).rows[0].n;
    expect(restrictions).toBe(1);
    expect(metaCalls).toBe(1);
  }), 120_000);
});

describe('no evidence: nothing is inferred', () => {
  it('send_uncertain stays send_uncertain (never failed), is flagged once, and is never resent', () => inRollback(async () => {
    const { b, r } = await uncertainRecipient();
    const first = await run();
    expect(first).toMatchObject({ examined: 1, attached: 0, markedUncertain: 0, flaggedForReview: 1 });
    const second = await run();
    expect(second).toMatchObject({ examined: 1, flaggedForReview: 0 });
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect(await audit(r)).toEqual([{ outcome: 'awaiting_operator_review', from_status: 'send_uncertain', to_status: 'send_uncertain', wa_message_id: null, company_id: ORG_A }]);
    await svc.retryFailed(b);
    expect(mockJobs).toEqual([]);
    expect(metaCalls).toBe(1);
    const unresolved = await sweep.listUnconfirmedWhatsAppSends({ companyId: ORG_A });
    expect(unresolved).toEqual([expect.objectContaining({ recipient_id: r, status: 'send_uncertain', has_evidence: false, flagged: true })]);
  }), 120_000);

  it('a stale `sending` row (the process died after the claim) becomes send_uncertain; a fresh one is untouched', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    await db.query(`UPDATE public.whatsapp_broadcast_recipients SET status = 'sending' WHERE id = $1`, [r]);
    await age(r, 4 * 60 * 1000);
    expect(await run()).toMatchObject({ examined: 0 });
    expect((await state(r)).status).toBe('sending');
    await age(r);
    expect(await run()).toMatchObject({ examined: 1, markedUncertain: 1, flaggedForReview: 1 });
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect((await audit(r)).map((x: { outcome: string }) => x.outcome)).toEqual(['awaiting_operator_review', 'stale_sending_marked_uncertain']);
    expect(metaCalls).toBe(1);
  }), 120_000);

  it('evidence outranks staleness: the mark function refuses a stale `sending` row that has evidence (a race with the read)', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    await db.query(`UPDATE public.whatsapp_broadcast_recipients SET status = 'sending' WHERE id = $1`, [r]);
    await db.query(`INSERT INTO public.whatsapp_provider_events (wa_message_id, event_status, event_at, verified_recipient_id) VALUES ($1,'sent',now(),$2)`, [`wamid.r.${rnd()}`, r]);
    const mark = await one('SELECT public.whatsapp_mark_stale_send_uncertain($1,$2,now(),$3) AS ok', [ORG_A, r, '00000000-0000-4000-8000-0000000000ac']);
    expect(mark.ok).toBe(false);
    expect((await state(r)).status).toBe('sending');
    expect(await run()).toMatchObject({ attached: 1, markedUncertain: 0 });
  }), 120_000);

  it('a late webhook after the flag reconciles the row through the Work Item 2 path; the sweep then has nothing to do', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    await run();
    const wamid = `wamid.late.${rnd()}`;
    await processWhatsAppWebhookJob(statusJob(wamid, 'delivered', { biz_opaque_callback_data: r, recipient_id: WA_ID }));
    expect(await state(r)).toMatchObject({ status: 'delivered', wa_message_id: wamid });
    expect(await run()).toMatchObject({ examined: 0 });
    expect(metaCalls).toBe(1);
  }), 120_000);

  it('evidence naming two message ids attaches nothing and is flagged as a conflict', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    await strandedEvidence(r, `wamid.a.${rnd()}`, 'sent');
    await strandedEvidence(r, `wamid.b.${rnd()}`, 'sent', { timestamp: ts(1762600050) });
    expect(await run()).toMatchObject({ attached: 0, conflicting: 1, flaggedForReview: 1 });
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect((await audit(r)).map((x: { outcome: string }) => x.outcome)).toEqual(['awaiting_operator_review', 'conflicting_provider_evidence']);
  }), 120_000);
});

describe('tenant scope, evidence binding, audit integrity', () => {
  it('another tenant sees none of these rows, and every function refuses a wrong tenant', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const wamid = `wamid.t.${rnd()}`;
    await strandedEvidence(r, wamid, 'sent');
    expect(await run(ORG_B)).toMatchObject({ examined: 0 });
    expect(await sweep.listUnconfirmedWhatsAppSends({ companyId: ORG_B })).toEqual([]);
    const ev = (await db.query('SELECT id FROM public.whatsapp_provider_events WHERE verified_recipient_id = $1', [r])).rows.map((x: { id: string }) => x.id);
    const runId = '00000000-0000-4000-8000-0000000000aa';
    const attach = await one(`SELECT public.whatsapp_attach_unconfirmed_send($1,$2,$3,'sent',now(),NULL,NULL,NULL,NULL,$4::uuid[],$5) AS ok`, [ORG_B, r, wamid, ev, runId]);
    const mark = await one('SELECT public.whatsapp_mark_stale_send_uncertain($1,$2,now(),$3) AS ok', [ORG_B, r, runId]);
    const flag = await one(`SELECT public.whatsapp_flag_unconfirmed_send($1,$2,'awaiting_operator_review',$3) AS ok`, [ORG_B, r, runId]);
    expect([attach.ok, mark.ok, flag.ok]).toEqual([false, false, false]);
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect(await audit(r)).toEqual([]);
  }), 120_000);

  it('the attach function refuses evidence that does not name this recipient and message (22023)', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    const other = await uncertainRecipient(ORG_A, '+15551231002');
    const wamid = `wamid.o.${rnd()}`;
    await db.query(`INSERT INTO public.whatsapp_provider_events (wa_message_id, event_status, event_at, verified_recipient_id) VALUES ($1,'sent',now(),$2)`, [wamid, other.r]);
    const ev = (await db.query('SELECT id FROM public.whatsapp_provider_events WHERE wa_message_id = $1', [wamid])).rows.map((x: { id: string }) => x.id);
    await db.query('SAVEPOINT f');
    let code = 'none';
    try {
      await db.query(`SELECT public.whatsapp_attach_unconfirmed_send($1,$2,$3,'sent',now(),NULL,NULL,NULL,NULL,$4::uuid[],$5)`, [ORG_A, r, wamid, ev, '00000000-0000-4000-8000-0000000000ab']);
    } catch (e) { code = String((e as { code?: string }).code); }
    await db.query('ROLLBACK TO SAVEPOINT f');
    expect(code).toBe('22023');
    expect(await state(r)).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
  }), 120_000);

  it('the audit is append-only, and only service_role may read and insert it', () => inRollback(async () => {
    const { r } = await uncertainRecipient();
    await run();
    for (const sql of ['UPDATE public.whatsapp_send_reconciliations SET outcome = outcome WHERE recipient_id = $1',
      'DELETE FROM public.whatsapp_send_reconciliations WHERE recipient_id = $1']) {
      await db.query('SAVEPOINT a');
      let code = 'none';
      try { await db.query(sql, [r]); } catch (e) { code = String((e as { code?: string }).code); }
      await db.query('ROLLBACK TO SAVEPOINT a');
      expect(code).toBe('42501');
    }
    const g = await one(`SELECT
      has_table_privilege('service_role','public.whatsapp_send_reconciliations','INSERT') AS ins,
      has_table_privilege('service_role','public.whatsapp_send_reconciliations','UPDATE') AS upd,
      has_table_privilege('authenticated','public.whatsapp_send_reconciliations','SELECT') AS auth_sel,
      has_function_privilege('authenticated','public.whatsapp_flag_unconfirmed_send(uuid,uuid,text,uuid)','EXECUTE') AS auth_exec`);
    expect(g).toEqual({ ins: true, upd: false, auth_sel: false, auth_exec: false });
  }), 120_000);

  it('a threshold below the floor is refused before anything is read', async () => {
    await expect(run(ORG_A, { staleAfterMs: 60_000 })).rejects.toThrow(/floor/);
    await expect(run(ORG_A, { batchSize: 501 })).rejects.toThrow(/batchSize/);
    await expect(sweep.sweepUnconfirmedWhatsAppSends({ companyId: 'not-a-tenant' })).rejects.toThrow(/tenant/);
  });
});
