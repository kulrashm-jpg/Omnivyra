/**
 * G-11 — the Outreach producers on REAL PostgreSQL (needs 20270127000001 in the template).
 *
 * A WhatsApp STOP (recordWhatsAppOptOut) and an email unsubscribe link (recordOutreachUnsubscribe)
 * each keep THEIR channel closed for good, then hold every channel and open the company admin's
 * review through Orchestration's service (optOutReview.ts, via optOutHold.ts).
 *
 * Real: contact_governance_records with its canonical key, the governance writer, the
 * repository and `mayContact` (the verdict every send path's gate reaches), the review store and
 * service, unified_persons (the person's known address and number). Replaced: PostgREST
 * (pgTransport), and for the unsubscribe link the attempt and task reads (wp3UnsubscribeFlow
 * covers those against its double; seeding a real attempt needs a lead, a plan and a workflow
 * that this suite does not test).
 */

import { db, inRollback, seedTenants, newPerson, ORG_A, ORG_B } from './setup';
import { newUser, one, rows } from './helpers/journeyFixtures';

type Row = Record<string, unknown>;
const mockAttempt = { row: null as null | { id: string; task_id: string; company_id: string }, personId: null as string | null };

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return {
    __esModule: true,
    ownedDbTable: (t: string) => {
      if (t !== 'outreach_attempts') return pgTable(client, t);
      // The attempt read, tenant-bound as the service asks for it.
      const eqs: Array<[string, unknown]> = [];
      const b: Row = {
        select: () => b,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
        maybeSingle: async () => {
          const r = mockAttempt.row as Row | null;
          return { data: r && eqs.every(([c, v]) => r[c === 'id' ? 'id' : c] === v) ? r : null, error: null };
        },
      };
      return b;
    },
    ownedDbRpc: pgRpc(client),
  };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('../../services/leadOutreachExecution/storage', () => ({
  ...jest.requireActual('../../services/leadOutreachExecution/storage'),
  getOutreachTaskById: async (org: string, id: string) =>
    (mockAttempt.row && mockAttempt.row.company_id === org && mockAttempt.row.task_id === id ? { id, personId: mockAttempt.personId } : null),
}));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/orchestration/optOutReview');
const { recordWhatsAppOptOut } = require('../../services/whatsappOptOut');
const { recordOutreachUnsubscribe } = require('../../services/leadOutreachExecution/unsubscribeService');
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
const { loadGovernanceRecords, normalizeGovernanceTarget } = require('../../services/prospectIdentity/contactGovernanceRepository');
const { mayContact } = require('../../services/prospectIdentity/contactGovernance');
/* eslint-enable @typescript-eslint/no-var-requires */

const WA_ID = '447700900123';                 // Meta's `from`: digits, no '+'
const PHONE_SPACED = '+44 7700 900123';       // the person's stored number
const CANON = '+447700900123';
const RECIPIENT = 'Ana.Doe@Example.Test';     // the address the email went to
const PRIMARY = 'ana@work.example.test';      // the person's other known address
let fetchCalls = 0;

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = async () => { fetchCalls += 1; throw new Error('g11p: network refused'); };
});
afterAll(() => { expect(fetchCalls).toBe(0); });

// The database instant at FULL precision, as PostgREST renders it (microseconds, +00:00). A node-pg Date ->
// toISOString cut it to milliseconds, which made a hold written in the same transaction look 'not yet started'
// once the transport stopped cutting effective_from the same way (harness rows fix, 2026-11-13).
const dbNow = async (): Promise<string> => String((await one(`SELECT to_json(now()) #>> '{}' AS t`)).t);

async function allowed(org: string, channel: string, who: { personId?: string; target?: string }, at?: string): Promise<boolean> {
  const loaded = await loadGovernanceRecords({ organizationId: org, personId: who.personId ?? null, target: who.target ?? null, channel });
  expect(loaded.ok).toBe(true);
  return mayContact({
    organizationId: org, personId: who.personId ?? null, targetNormalized: normalizeGovernanceTarget(channel, who.target ?? null),
    channel, now: at ?? await dbNow(), records: loaded.records,
  }).decision === 'allowed';
}
/** The number, by target only (Path B carries no person). */
async function numberOpen(org: string, at?: string): Promise<string[]> {
  const open: string[] = [];
  for (const c of ['phone', 'whatsapp']) if (await allowed(org, c, { target: PHONE_SPACED }, at)) open.push(c);
  return open;
}

const stop = (wamid = 'wamid.1', org = ORG_A) =>
  recordWhatsAppOptOut({ organizationId: org, waId: WA_ID, waMessageId: wamid, keyword: 'STOP', socialAccountId: null });

async function setup() {
  await seedTenants();
  const admin = await newUser();
  const person = await newPerson(ORG_A);
  await db.query('UPDATE public.unified_persons SET primary_email = $2, primary_phone = $3 WHERE id = $1', [person, PRIMARY, PHONE_SPACED]);
  return { admin, person };
}
function link(personId: string | null) {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  mockAttempt.row = { id: attemptId, task_id: '22222222-2222-4222-8222-222222222222', company_id: ORG_A };
  mockAttempt.personId = personId;
  return { organizationId: ORG_A, attemptId, scope: '*', recipient: RECIPIENT, issuedAt: 1, keyId: 'k1' };
}
const decide = (admin: string, reviewId: string, reopenChannels: string[]) =>
  svc.decideOptOutReview({ organizationId: ORG_A, reviewId, actorUserId: admin, reopenChannels, reason: 'confirmed with the person' });
const reviews = () => rows('SELECT * FROM public.contact_opt_out_reviews WHERE organization_id = $1 ORDER BY opened_at, id', [ORG_A]);
const live = (sql = '') => rows(`SELECT id, channel, person_id, target_normalized, source, evidence->>'source_ref' AS ref
  FROM public.contact_governance_records WHERE organization_id = $1 AND revoked_at IS NULL ${sql} ORDER BY channel, target_normalized NULLS FIRST`, [ORG_A]);

describe('WhatsApp STOP', () => {
  it('closes whatsapp for good, holds phone too on the canonical number, opens one review; another tenant is untouched', () => inRollback(async () => {
    await setup();
    expect(await numberOpen(ORG_A)).toEqual(['phone', 'whatsapp']);
    const out = await stop();
    expect(out).toMatchObject({ status: 'recorded', review: 'opened' });
    expect(await numberOpen(ORG_A)).toEqual([]);
    expect(await allowed(ORG_B, 'phone', { target: PHONE_SPACED })).toBe(true);

    expect(await live()).toEqual([
      expect.objectContaining({ channel: '*', person_id: null, target_normalized: CANON, source: 'optout_review:whatsapp_stop', ref: 'wamid.1' }),
      expect.objectContaining({ channel: 'whatsapp', person_id: null, target_normalized: CANON, source: 'webhook:whatsapp_inbound' }),
    ]);
    const [r] = await reviews();
    const trigger = (await live(`AND channel = 'whatsapp'`))[0];
    expect(r).toMatchObject({
      id: out.reviewId, anchor_kind: 'target', anchor_channel: 'whatsapp', anchor_value: CANON, state: 'pending',
      triggers: ['whatsapp_stop'], locked_channels: ['whatsapp'], source_refs: ['wamid.1'], trigger_record_ids: [trigger.id],
    });
  }), 120_000);

  it('the admin may reopen phone, never whatsapp; whatsapp stays closed after the reopen', () => inRollback(async () => {
    const { admin } = await setup();
    const out = await stop();
    expect(await decide(admin, out.reviewId, ['whatsapp'])).toMatchObject({ ok: false, code: 'channel_locked' });
    expect(await numberOpen(ORG_A)).toEqual([]);
    expect(await decide(admin, out.reviewId, ['phone'])).toMatchObject({ ok: true, decision: 'reopen' });
    expect(await numberOpen(ORG_A)).toEqual(['phone']);
  }), 120_000);

  it('no decision: everything stays closed (no job, no expiry)', () => inRollback(async () => {
    await setup();
    await stop();
    // The gate asked 30 days after the due date: nothing has expired, and nothing ran.
    const [r] = await reviews();
    const later = new Date(new Date(r.due_at as Date).getTime() + 30 * 86_400_000).toISOString();
    expect(await numberOpen(ORG_A, later)).toEqual([]);
    expect((await one('SELECT state FROM public.contact_opt_out_reviews WHERE id = $1', [r.id])).state).toBe('pending');
  }), 120_000);

  it('a redelivered webhook while pending joins the same review with the same hold', () => inRollback(async () => {
    await setup();
    const a = await stop();
    const b = await stop();
    expect(b).toMatchObject({ status: 'already_present', review: 'joined', reviewId: a.reviewId });
    expect(await reviews()).toHaveLength(1);
    expect(await live(`AND channel = '*'`)).toHaveLength(1);
  }), 120_000);

  it('a redelivered webhook AFTER the decision holds nothing again; a NEW STOP does', () => inRollback(async () => {
    const { admin } = await setup();
    const a = await stop('wamid.1');
    await decide(admin, a.reviewId, ['phone']);
    expect(await stop('wamid.1')).toMatchObject({ status: 'already_present', review: 'already_decided', reviewId: a.reviewId });
    expect(await numberOpen(ORG_A)).toEqual(['phone']);
    expect(await reviews()).toHaveLength(1);

    const b = await stop('wamid.2');
    expect(b).toMatchObject({ review: 'opened' });
    expect(b.reviewId).not.toBe(a.reviewId);
    expect(await numberOpen(ORG_A)).toEqual([]);
  }), 120_000);

  it('the same number in tenant B opens tenant B its own review; deciding A leaves B closed', () => inRollback(async () => {
    const { admin } = await setup();
    const a = await stop('wamid.1', ORG_A);
    const b = await stop('wamid.1', ORG_B);
    expect(b.reviewId).not.toBe(a.reviewId);
    await decide(admin, a.reviewId, ['phone']);
    expect(await allowed(ORG_A, 'phone', { target: PHONE_SPACED })).toBe(true);
    expect(await allowed(ORG_B, 'phone', { target: PHONE_SPACED })).toBe(false);
  }), 120_000);
});

describe('email unsubscribe link (WP3-A replaced for new unsubscribes)', () => {
  it('closes email for good on the address and the person, holds every channel on the person, both addresses and the number', () => inRollback(async () => {
    const { person } = await setup();
    const out = await recordOutreachUnsubscribe(link(person), 'one_click');
    expect(out).toMatchObject({ status: 'recorded', created: 2 });

    for (const c of ['email', 'phone', 'whatsapp']) expect({ c, open: await allowed(ORG_A, c, { personId: person }) }).toEqual({ c, open: false });
    expect(await allowed(ORG_A, 'email', { target: RECIPIENT })).toBe(false);
    expect(await allowed(ORG_A, 'email', { target: PRIMARY })).toBe(false);
    expect(await numberOpen(ORG_A)).toEqual([]);

    const email = await live(`AND channel = 'email'`);
    expect(email).toHaveLength(2);
    expect(email.every((r) => r.source === 'outreach_unsubscribe_link')).toBe(true);
    expect(email.filter((r) => r.person_id === person)).toHaveLength(1);
    expect(email.filter((r) => r.person_id === null && r.target_normalized === 'ana.doe@example.test')).toHaveLength(1);
    const holds = await live(`AND channel = '*'`);
    expect(holds.map((h) => h.person_id ?? h.target_normalized).sort()).toEqual([CANON, PRIMARY, 'ana.doe@example.test', person].sort());
    expect(holds.every((h) => h.source === 'optout_review:email_unsubscribe' && h.ref === `attempt:${mockAttempt.row!.id}`)).toBe(true);

    const [r] = await reviews();
    expect(r).toMatchObject({
      id: out.reviewId, anchor_kind: 'person', anchor_value: person, locked_channels: ['email'], triggers: ['email_unsubscribe'],
    });
    expect((r.adopted_hold_ids as string[]).sort()).toEqual(holds.map((h) => h.id).sort());
  }), 120_000);

  it('the admin may reopen phone and whatsapp, never email; email stays closed on the person and the address', () => inRollback(async () => {
    const { admin, person } = await setup();
    const out = await recordOutreachUnsubscribe(link(person), 'one_click');
    expect(await decide(admin, out.reviewId, ['email'])).toMatchObject({ ok: false, code: 'channel_locked' });
    expect(await decide(admin, out.reviewId, ['phone', 'whatsapp'])).toMatchObject({ ok: true });
    expect(await allowed(ORG_A, 'phone', { personId: person })).toBe(true);
    expect(await numberOpen(ORG_A)).toEqual(['phone', 'whatsapp']);
    expect(await allowed(ORG_A, 'email', { personId: person })).toBe(false);
    expect(await allowed(ORG_A, 'email', { target: RECIPIENT })).toBe(false);
  }), 120_000);

  it('a task with no person anchors the review to the address', () => inRollback(async () => {
    await setup();
    const out = await recordOutreachUnsubscribe(link(null), 'confirmation');
    expect(out.status).toBe('recorded');
    const [r] = await reviews();
    expect(r).toMatchObject({ anchor_kind: 'target', anchor_channel: 'email', anchor_value: 'ana.doe@example.test', person_id: null });
  }), 120_000);

  it('a second click joins while pending, and holds nothing again once decided', () => inRollback(async () => {
    const { admin, person } = await setup();
    const a = await recordOutreachUnsubscribe(link(person), 'one_click');
    const b = await recordOutreachUnsubscribe(link(person), 'one_click');
    expect(b.reviewId).toBe(a.reviewId);
    await decide(admin, a.reviewId, ['phone']);
    const c = await recordOutreachUnsubscribe(link(person), 'one_click');
    expect(c).toMatchObject({ status: 'recorded', reviewId: a.reviewId });
    expect(await allowed(ORG_A, 'phone', { personId: person })).toBe(true);
    expect(await reviews()).toHaveLength(1);
  }), 120_000);

  it('a WP3-A `*` record written before the change is never released by a review', () => inRollback(async () => {
    const { admin, person } = await setup();
    const old = await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: '*', personId: person, source: 'outreach_unsubscribe_link', evidence: { attemptId: 'before' } });
    const out = await recordOutreachUnsubscribe(link(person), 'one_click');
    const [r] = await reviews();
    expect(r.pre_existing_hold_ids).toEqual([old.id]);
    expect(await decide(admin, out.reviewId, ['phone', 'whatsapp'])).toMatchObject({ ok: true });
    expect((await one('SELECT revoked_at FROM public.contact_governance_records WHERE id = $1', [old.id])).revoked_at).toBeNull();
    expect(await allowed(ORG_A, 'phone', { personId: person })).toBe(false);
  }), 120_000);
});

describe('two opt-outs on one number (c7 F2, through the real producers)', () => {
  it('reopening phone on the STOP review does not open the number while the unsubscribe review is pending', () => inRollback(async () => {
    const { admin, person } = await setup();
    const wa = await stop();
    const em = await recordOutreachUnsubscribe(link(person), 'one_click');
    expect(em.reviewId).not.toBe(wa.reviewId);
    const out = await decide(admin, wa.reviewId, ['phone']);
    expect(out).toMatchObject({ ok: true });
    expect(out.heldByOtherReview.length).toBeGreaterThan(0);
    expect(await numberOpen(ORG_A)).toEqual([]);
    // The unsubscribe review then reopens phone: the latest admin decision governs the number.
    expect(await decide(admin, em.reviewId, ['phone'])).toMatchObject({ ok: true });
    expect(await numberOpen(ORG_A)).toEqual(['phone']);
    expect(await allowed(ORG_A, 'email', { personId: person })).toBe(false);
  }), 120_000);
});
