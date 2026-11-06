/**
 * Owner GO 2026-11-06 — N-1..N-5 and M-1..M-5, on REAL PostgreSQL (disposable cluster).
 *
 *   N-3  one manual outcome per (company, task, type): a repeat at another instant is a
 *        duplicate; provider rows keep their own key;
 *   N-5  the engagement_messages upsert arbiter is created by the migration chain, and the
 *        migration is a no-op where an equivalent already exists;
 *   G-9b the WhatsApp status ledger: written by the real processor, replay-safe, append-only,
 *        service_role SELECT+INSERT only;
 *   N-2  a permanent Meta failure (131026) writes invalid_contact on (tenant, whatsapp,
 *        number) before the recipient moves; other codes write nothing;
 *   M-2  a re-delivery never rewrites a stored message; M-3 no timestamp is stored, not
 *        dead-lettered; M-4 a re-delivery after the active account changed is not a failure;
 *   N-4  clearing only with an approval, never younger than 3 days; a cleared STOP is still a
 *        STOP and a cleared reply is not (Orchestration's two conditions); keys survive;
 *        notes and approvals are guarded and service_role only; dead letters are cleared.
 * No provider, no network: Meta is never called (fetch refuses).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import { newUser, rnd, one } from './helpers/journeyFixtures';

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
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
const { appendOutcome } = require('../../services/leadOutreachExecution/storage');
const retention = require('../../services/retention/messageContentRetention');
const { detectWhatsAppOptOut } = require('../../services/whatsappOptOut');
const { requireEncryptionKey } = require('../../auth/credentialEncryption');
/* eslint-enable @typescript-eslint/no-var-requires */

const PHONE = '+15551239001';
const WA_ID = '15551239001';
const PN = 'pn-n4-1';
const DAY = 24 * 60 * 60 * 1000;

let fetchCalls = 0;
const realFetch = global.fetch;
beforeAll(() => { global.fetch = (async () => { fetchCalls += 1; throw new Error('no network in this test'); }) as unknown as typeof fetch; });
afterAll(() => { global.fetch = realFetch; expect(fetchCalls).toBe(0); });
beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined); jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { jest.restoreAllMocks(); });

/** A statement that must be refused, run under a savepoint so the test transaction survives. */
async function refusedCode(sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query('SAVEPOINT r');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT r');
    return null;
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT r');
    return String((e as { code?: string }).code ?? 'unknown');
  }
}

const job = (payload: unknown) => ({ data: { payload } });
const statusBody = (id: string, status: string, ts: number, errors?: unknown[]) => ({
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PN }, statuses: [{ id, status, timestamp: String(ts), ...(errors ? { errors } : {}) }] } }] }],
});
const inboundBody = (message: Record<string, unknown>) => ({
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PN }, messages: [{ from: WA_ID, ...message }] } }] }],
});

function encryptPhone(e164: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', requireEncryptionKey(), iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
}

async function waAccount(org: string, active = true): Promise<string> {
  const user = await newUser();
  const a = await one(`INSERT INTO public.social_accounts
    (user_id, platform, platform_user_id, account_name, access_token, company_id, phone_number_id, is_active)
    VALUES ($1,'whatsapp',$2,'wa','t',$3,$4,$5) RETURNING id`, [user, rnd(), org, PN, active]);
  return String(a.id);
}

async function sentRecipient(org: string, waMessageId: string): Promise<string> {
  const account = await waAccount(org);
  const b = await one(`INSERT INTO public.whatsapp_broadcasts (company_id, social_account_id, name, status)
    VALUES ($1,$2,$3,'sending') RETURNING id`, [org, account, `n4-${rnd()}`]);
  const r = await one(`INSERT INTO public.whatsapp_broadcast_recipients (broadcast_id, hashed_phone, encrypted_phone, wa_message_id, status)
    VALUES ($1,$2,$3,$4,'sent') RETURNING id`, [b.id, `h-${rnd()}`, encryptPhone(PHONE), waMessageId]);
  return String(r.id);
}

const invalidContacts = async (org: string) => Number((await one(`SELECT count(*) n FROM public.contact_governance_records
  WHERE organization_id = $1 AND governance_type = 'invalid_contact' AND channel = 'whatsapp' AND revoked_at IS NULL`, [org])).n);

async function newTask(org: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, channel, action,
        status, planner_version, translation_version, governance_version, execution_runtime_version, materialized_at)
     VALUES ($1,$2,$3,'email','Say hello','pending','p','t','g','r', now()) RETURNING id`,
    [org, `n4-lead-${rnd()}`, `n4-task-${rnd()}`]);
  return rows[0].id as string;
}

const priv = async (table: string, role: string, p: string) =>
  (await one(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, p])).ok as boolean;

// ════════════════════════════════════════════════════════════════════════════
describe('N-3 one manual outcome per (company, task, type)', () => {
  it('a manual repeat at another instant is a duplicate; a provider row is not', () => inRollback(async () => {
    await seedTenants();
    const task = await newTask(ORG_A);
    const base = { companyId: ORG_A, taskId: task, outcomeType: 'replied', derived: false, evidence: {}, provider: null, providerEventId: null, metadata: {} };
    expect(await appendOutcome({ ...base, occurredAt: '2026-11-01T10:00:00Z', source: 'manual' })).toEqual({ ok: true });
    expect(await appendOutcome({ ...base, occurredAt: '2026-11-02T10:00:00Z', source: 'manual' })).toEqual({ ok: true, duplicate: true });
    expect(await appendOutcome({ ...base, occurredAt: '2026-11-03T10:00:00Z', source: 'provider_webhook', provider: 'ses', providerEventId: `e-${rnd()}` })).toEqual({ ok: true });
    expect(await appendOutcome({ ...base, outcomeType: 'converted', occurredAt: '2026-11-04T10:00:00Z', source: 'manual' })).toEqual({ ok: true });
    const n = await one(`SELECT count(*) n FROM public.outreach_outcomes WHERE task_id = $1`, [task]);
    expect(Number(n.n)).toBe(3);
  }));
});

// ════════════════════════════════════════════════════════════════════════════
describe('N-5 the engagement_messages arbiter is in the migration chain', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/20270128000001_engagement_message_thread_arbiter.sql'), 'utf8');
  const arbiters = async () => (await db.query(`SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname = 'engagement_messages' AND x.indisunique AND x.indpred IS NULL
    AND pg_get_indexdef(x.indexrelid) LIKE '%(thread_id, platform_message_id)%'`)).rows.map((r: { relname: string }) => r.relname);

  it('creates the arbiter when the chain lacks it, and is a no-op when re-run or when an equivalent exists', () => inRollback(async () => {
    await db.query('DROP INDEX IF EXISTS public.idx_engagement_messages_platform_thread');
    expect(await arbiters()).toEqual([]);
    await db.query(sql);
    expect(await arbiters()).toEqual(['idx_engagement_messages_platform_thread']);
    await db.query(sql);
    expect(await arbiters()).toEqual(['idx_engagement_messages_platform_thread']);

    await db.query('DROP INDEX public.idx_engagement_messages_platform_thread');
    await db.query('CREATE UNIQUE INDEX some_other_name ON public.engagement_messages (thread_id, platform_message_id)');
    await db.query(sql);
    expect(await arbiters()).toEqual(['some_other_name']);
  }));
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-9b / N-2 WhatsApp status events', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('records each status once, append-only, and moves the recipient as before', () => inRollback(async () => {
    await seedTenants();
    const wamid = `wamid.out.${rnd()}`;
    const recipient = await sentRecipient(ORG_A, wamid);
    const ts = now();
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'delivered', ts)));
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'delivered', ts)));   // replay
    const rows = (await db.query(`SELECT event_status, error_code FROM public.whatsapp_provider_events WHERE wa_message_id = $1`, [wamid])).rows;
    expect(rows).toEqual([{ event_status: 'delivered', error_code: null }]);
    expect((await one(`SELECT status FROM public.whatsapp_broadcast_recipients WHERE id = $1`, [recipient])).status).toBe('delivered');

    expect(await refusedCode(`UPDATE public.whatsapp_provider_events SET error_code = 1 WHERE wa_message_id = $1`, [wamid])).toBe('42501');
    expect(await refusedCode(`DELETE FROM public.whatsapp_provider_events WHERE wa_message_id = $1`, [wamid])).toBe('42501');
  }));

  it('a status for a message that is not ours is still kept in the ledger, and moves nothing', () => inRollback(async () => {
    await seedTenants();
    const wamid = `wamid.foreign.${rnd()}`;
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'read', now())));
    expect(Number((await one(`SELECT count(*) n FROM public.whatsapp_provider_events WHERE wa_message_id = $1`, [wamid])).n)).toBe(1);
  }));

  it('N-2: 131026 writes invalid_contact on (tenant, whatsapp, number) once; the recipient fails', () => inRollback(async () => {
    await seedTenants();
    const wamid = `wamid.out.${rnd()}`;
    const recipient = await sentRecipient(ORG_A, wamid);
    const errors = [{ code: 131026, title: 'Message undeliverable' }];
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'failed', now(), errors)));
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'failed', now() + 1, errors)));   // re-sent with a new stamp
    expect(await invalidContacts(ORG_A)).toBe(1);
    expect(await invalidContacts(ORG_B)).toBe(0);
    const rec = await one(`SELECT target_normalized, source, evidence FROM public.contact_governance_records
      WHERE organization_id = $1 AND governance_type = 'invalid_contact'`, [ORG_A]);
    expect(rec.target_normalized).toBe(PHONE);
    expect(rec.source).toBe('webhook:whatsapp_status');
    expect(JSON.stringify(rec.evidence)).not.toContain(WA_ID);
    expect((await one(`SELECT status, error_code FROM public.whatsapp_broadcast_recipients WHERE id = $1`, [recipient]))).toEqual({ status: 'failed', error_code: 131026 });
  }));

  it('N-2: any other failure code is evidence only', () => inRollback(async () => {
    await seedTenants();
    const wamid = `wamid.out.${rnd()}`;
    await sentRecipient(ORG_A, wamid);
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'failed', now(), [{ code: 131047, title: 'Re-engagement message' }])));
    expect(await invalidContacts(ORG_A)).toBe(0);
    expect(Number((await one(`SELECT count(*) n FROM public.whatsapp_provider_events WHERE wa_message_id = $1 AND error_code = 131047`, [wamid])).n)).toBe(1);
  }));

  it('N-2: a late failure after delivery restricts nothing', () => inRollback(async () => {
    await seedTenants();
    const wamid = `wamid.out.${rnd()}`;
    await sentRecipient(ORG_A, wamid);
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'delivered', now())));
    await processWhatsAppWebhookJob(job(statusBody(wamid, 'failed', now() + 1, [{ code: 131026, title: 'x' }])));
    expect(await invalidContacts(ORG_A)).toBe(0);
  }));

  it('the ledger is service_role SELECT+INSERT only; anon and authenticated have nothing', () => inRollback(async () => {
    expect(await priv('whatsapp_provider_events', 'service_role', 'SELECT')).toBe(true);
    expect(await priv('whatsapp_provider_events', 'service_role', 'INSERT')).toBe(true);
    expect(await priv('whatsapp_provider_events', 'service_role', 'UPDATE')).toBe(false);
    expect(await priv('whatsapp_provider_events', 'service_role', 'DELETE')).toBe(false);
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await priv('whatsapp_provider_events', role, p)).toBe(false);
    }
  }));
});

// ════════════════════════════════════════════════════════════════════════════
describe('M-2 / M-3 / M-4 inbound messages', () => {
  const stored = async (wamid: string) => (await db.query(`SELECT id, content, status, created_at FROM public.engagement_messages
    WHERE platform = 'whatsapp' AND platform_message_id = $1`, [wamid])).rows;

  it('M-2: a re-delivery never rewrites the stored message', () => inRollback(async () => {
    await seedTenants();
    await waAccount(ORG_A);
    const wamid = `wamid.in.${rnd()}`;
    const ts = String(Math.floor(Date.now() / 1000));
    await processWhatsAppWebhookJob(job(inboundBody({ id: wamid, timestamp: ts, text: { body: 'first words' } })));
    const [before] = await stored(wamid);
    await db.query(`UPDATE public.engagement_messages SET status = 'read' WHERE id = $1`, [before.id]);
    await processWhatsAppWebhookJob(job(inboundBody({ id: wamid, timestamp: ts, text: { body: 'rewritten' } })));
    const after = await stored(wamid);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before.id, content: 'first words', status: 'read' });
  }));

  it('M-3: a message with no timestamp is stored at receipt time, not dead-lettered', () => inRollback(async () => {
    await seedTenants();
    await waAccount(ORG_A);
    const wamid = `wamid.in.${rnd()}`;
    const t0 = Date.now();
    await expect(processWhatsAppWebhookJob(job(inboundBody({ id: wamid, text: { body: 'hello' } })))).resolves.toBeUndefined();
    const [row] = await stored(wamid);
    expect(new Date(row.created_at).getTime()).toBeGreaterThanOrEqual(t0 - 5000);
  }));

  it('M-4: a re-delivery after the active account changed is stored once and does not fail', () => inRollback(async () => {
    await seedTenants();
    const first = await waAccount(ORG_A);
    const wamid = `wamid.in.${rnd()}`;
    const body = inboundBody({ id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'STOP' } });
    await processWhatsAppWebhookJob(job(body));
    await db.query(`UPDATE public.social_accounts SET is_active = false WHERE id = $1`, [first]);
    await waAccount(ORG_A);
    await expect(processWhatsAppWebhookJob(job(body))).resolves.toBeUndefined();
    expect(await stored(wamid)).toHaveLength(1);
  }));
});

// ════════════════════════════════════════════════════════════════════════════
describe('N-4 clearing only with an approval, never younger than 3 days', () => {
  const ADMIN = '00000000-0000-4000-8000-00000000ad01';

  async function message(org: string, content: string, ageDays: number): Promise<{ id: string; wamid: string; created_at: string }> {
    const thread = await one(`INSERT INTO public.engagement_threads (platform, platform_thread_id, organization_id)
      VALUES ('whatsapp', $1, $2) RETURNING id`, [`wa:n4:${rnd()}`, org]);
    const wamid = `wamid.n4.${rnd()}`;
    const m = await one(`INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, direction, content, raw_payload, status, created_at, organization_id)
      VALUES ($1,'whatsapp',$2,'inbound',$3,$4,'received', now() - ($5 || ' days')::interval, $6) RETURNING id, created_at`,
      [thread.id, wamid, content, JSON.stringify({ id: wamid, type: 'text', from: WA_ID, text: { body: content } }), String(ageDays), org]);
    return { id: String(m.id), wamid, created_at: new Date(m.created_at as string).toISOString() };
  }
  const cutoff = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

  it("Orchestration's conditions: a cleared STOP is still a STOP; a cleared reply is not", () => {
    for (const stop of ['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'STOP PROMOTIONS']) {
      const cleared = retention.clearedContentFor(stop);
      expect(detectWhatsAppOptOut(cleared)).not.toBeNull();
      expect(detectWhatsAppOptOut(cleared)!.keyword).toBe(detectWhatsAppOptOut(stop)!.keyword);
    }
    expect(retention.clearedContentFor('call me tomorrow, +1 555 123')).toBe('[redacted]');
    expect(detectWhatsAppOptOut('[redacted]')).toBeNull();
    expect(detectWhatsAppOptOut(retention.clearedContentFor(null))).toBeNull();
  });

  it('refuses anything younger than 3 days, in code and in the database, and writes nothing', () => inRollback(async () => {
    await seedTenants();
    await expect(retention.approveAndClear({ store: 'engagement_messages', organizationId: ORG_A, cutoff: cutoff(1), approvedBy: ADMIN, reason: 'r' }))
      .rejects.toMatchObject({ code: 'cutoff_too_recent' });
    expect(Number((await one(`SELECT count(*) n FROM public.message_retention_approvals`)).n)).toBe(0);
    expect(await refusedCode(`INSERT INTO public.message_retention_approvals (organization_id, store, cutoff, approved_by)
      VALUES ($1, 'engagement_messages', now() - interval '2 days', $2)`, [ORG_A, ADMIN])).toBe('23514');
    expect(await refusedCode(`INSERT INTO public.message_retention_approvals (organization_id, store, cutoff, approved_by)
      VALUES ($1, 'dead_letters', now() - interval '5 days', $2)`, [ORG_A, ADMIN])).toBe('23514');
    await expect(retention.approveAndClear({ store: 'engagement_messages', organizationId: null, cutoff: cutoff(5), approvedBy: ADMIN, reason: 'r' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
    // At the edge the database's clock decides. The cutoff is 1 ms under 3 days by the
    // transaction's clock, and this process's clock is set a minute ahead so its own check
    // passes: the CHECK refuses it, and that is reported as too recent, not as an error.
    // (Both clocks are read, never assumed: Postgres's can lead Node's by a few ms.)
    const dbNow = Number((await one(`SELECT floor(extract(epoch FROM now()) * 1000) AS t`)).t);
    await expect(retention.approveAndClear(
      { store: 'engagement_messages', organizationId: ORG_A, cutoff: new Date(dbNow - 3 * DAY + 1).toISOString(), approvedBy: ADMIN, reason: 'r' },
      dbNow + 60_000,
    )).rejects.toMatchObject({ code: 'cutoff_too_recent' });
    expect(Number((await one(`SELECT count(*) n FROM public.message_retention_approvals`)).n)).toBe(0);
  }));

  it('clears approved, old messages of the named tenant only; keys survive; STOP stays STOP; executed once', () => inRollback(async () => {
    await seedTenants();
    const stop = await message(ORG_A, 'STOP', 5);
    const reply = await message(ORG_A, 'my number is 555 0101', 5);
    const recent = await message(ORG_A, 'still talking', 1);
    const other = await message(ORG_B, 'tenant b text', 5);

    expect(await retention.previewClearing({ store: 'engagement_messages', organizationId: ORG_A, cutoff: cutoff(4) })).toBe(2);
    const r = await retention.approveAndClear({ store: 'engagement_messages', organizationId: ORG_A, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'retention review' });
    expect(r.rowsCleared).toBe(2);

    const row = async (id: string) => one(`SELECT platform_message_id, content, raw_payload, created_at, thread_id FROM public.engagement_messages WHERE id = $1`, [id]);
    const s = await row(stop.id);
    expect(detectWhatsAppOptOut(s.content)).not.toBeNull();
    expect(s.platform_message_id).toBe(stop.wamid);
    expect(new Date(s.created_at as string).toISOString()).toBe(stop.created_at);
    expect(JSON.stringify(s.raw_payload)).not.toContain(WA_ID);
    const p = await row(reply.id);
    expect(p.content).toBe('[redacted]');
    expect(detectWhatsAppOptOut(p.content)).toBeNull();
    expect(JSON.stringify(p.raw_payload)).not.toContain('555 0101');
    expect((await row(recent.id)).content).toBe('still talking');
    expect((await row(other.id)).content).toBe('tenant b text');

    const a = await one(`SELECT executed_at, rows_cleared, approved_by FROM public.message_retention_approvals WHERE id = $1`, [r.approvalId]);
    expect(a.rows_cleared).toBe(2);
    expect(a.executed_at).not.toBeNull();
    expect(a.approved_by).toBe(ADMIN);
    expect(await refusedCode(`UPDATE public.message_retention_approvals SET rows_cleared = 9, executed_at = now() WHERE id = $1`, [r.approvalId])).toBe('23514');
    expect(await refusedCode(`DELETE FROM public.message_retention_approvals WHERE id = $1`, [r.approvalId])).toBe('42501');

    expect((await retention.approveAndClear({ store: 'engagement_messages', organizationId: ORG_A, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'again' })).rowsCleared).toBe(0);
  }));

  it('a re-delivered message is not refilled after clearing (M-2)', () => inRollback(async () => {
    await seedTenants();
    await waAccount(ORG_A);
    const wamid = `wamid.in.${rnd()}`;
    const ts = String(Math.floor((Date.now() - 5 * DAY) / 1000));
    await processWhatsAppWebhookJob(job(inboundBody({ id: wamid, timestamp: ts, text: { body: 'private words' } })));
    await retention.approveAndClear({ store: 'engagement_messages', organizationId: ORG_A, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'r' });
    await processWhatsAppWebhookJob(job(inboundBody({ id: wamid, timestamp: ts, text: { body: 'private words' } })));
    const m = await one(`SELECT content FROM public.engagement_messages WHERE platform_message_id = $1`, [wamid]);
    expect(m.content).toBe('[redacted]');
  }));

  it('operator notes: stored once, cleared only by a named approval, never deleted', () => inRollback(async () => {
    await seedTenants();
    const task = await newTask(ORG_A);
    expect(await retention.recordOutcomeNote({ companyId: ORG_A, taskId: task, outcomeType: 'replied', note: 'wants a demo', recordedBy: ADMIN })).toBe(true);
    await db.query(`ALTER TABLE public.outreach_outcome_notes DISABLE TRIGGER outreach_outcome_notes_guard`);
    await db.query(`UPDATE public.outreach_outcome_notes SET created_at = now() - interval '5 days' WHERE task_id = $1`, [task]);
    await db.query(`ALTER TABLE public.outreach_outcome_notes ENABLE TRIGGER outreach_outcome_notes_guard`);

    expect(await refusedCode(`UPDATE public.outreach_outcome_notes SET note = 'edited' WHERE task_id = $1`, [task])).toBe('23514');
    expect(await refusedCode(`UPDATE public.outreach_outcome_notes SET note = null WHERE task_id = $1`, [task])).toBe('23514');
    expect(await refusedCode(`DELETE FROM public.outreach_outcome_notes WHERE task_id = $1`, [task])).toBe('42501');

    const r = await retention.approveAndClear({ store: 'outreach_outcome_notes', organizationId: ORG_A, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'r' });
    expect(r.rowsCleared).toBe(1);
    const n = await one(`SELECT note, cleared_at, clearing_approval_id FROM public.outreach_outcome_notes WHERE task_id = $1`, [task]);
    expect(n.note).toBeNull();
    expect(n.clearing_approval_id).toBe(r.approvalId);
    expect(await refusedCode(`UPDATE public.outreach_outcome_notes SET cleared_at = now() WHERE task_id = $1`, [task])).toBe('23514');
  }));

  it('dead letters: only old whatsapp-webhook payloads are cleared, platform-wide', () => inRollback(async () => {
    await seedTenants();
    const payload = { job_id: 'j', data: { payload: { entry: [{ changes: [{ value: { messages: [{ from: WA_ID, text: { body: 'secret' } }] } }] }] } } };
    const old = await one(`INSERT INTO public.worker_dead_letter_queue (worker_name, job_payload, created_at) VALUES ('whatsapp-webhook', $1, now() - interval '5 days') RETURNING id`, [JSON.stringify(payload)]);
    const fresh = await one(`INSERT INTO public.worker_dead_letter_queue (worker_name, job_payload) VALUES ('whatsapp-webhook', $1) RETURNING id`, [JSON.stringify(payload)]);
    const other = await one(`INSERT INTO public.worker_dead_letter_queue (worker_name, job_payload, created_at) VALUES ('whatsapp-broadcast', $1, now() - interval '5 days') RETURNING id`, [JSON.stringify(payload)]);
    await expect(retention.approveAndClear({ store: 'dead_letters', organizationId: ORG_A, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'r' }))
      .rejects.toMatchObject({ code: 'tenant_not_allowed' });
    const r = await retention.approveAndClear({ store: 'dead_letters', organizationId: null, cutoff: cutoff(4), approvedBy: ADMIN, reason: 'r' });
    expect(r.rowsCleared).toBe(1);
    const body = async (id: unknown) => JSON.stringify((await one(`SELECT job_payload FROM public.worker_dead_letter_queue WHERE id = $1`, [id])).job_payload);
    expect(await body(old.id)).not.toContain('secret');
    expect(await body(old.id)).toContain('"job_id":"j"');
    expect(await body(fresh.id)).toContain('secret');
    expect(await body(other.id)).toContain('secret');
  }));

  it('notes and approvals are service_role SELECT/INSERT/UPDATE only, no DELETE; nothing for anon/authenticated', () => inRollback(async () => {
    for (const t of ['outreach_outcome_notes', 'message_retention_approvals']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE']) expect(await priv(t, 'service_role', p)).toBe(true);
      expect(await priv(t, 'service_role', 'DELETE')).toBe(false);
      for (const role of ['anon', 'authenticated']) {
        for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await priv(t, role, p)).toBe(false);
      }
    }
  }));
});
