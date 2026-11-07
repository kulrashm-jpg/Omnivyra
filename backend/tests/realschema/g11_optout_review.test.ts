/**
 * G-11 — the opt-out hold and its company-admin review, on REAL PostgreSQL (needs
 * 20270127000001 in the template).
 *
 * Real: the review table (its unique partial index, CHECKs, guard trigger, grants and RLS),
 * contact_governance_records with its canonical key, the governance writer, the repository
 * and `mayContact` (the verdict every send path's gate reaches), the review service, both
 * admin routes, the canonical tenant decision (TenantGuard over user_company_roles) and the
 * execution_audit write. Replaced: PostgREST (pgTransport), the session in front of the
 * routes (enforceCompanyAccess admits the test's actor), telemetry.
 *
 * Edge assertions read the DATABASE clock, never Date.now(): Postgres leads Node by up to
 * 1.8 ms, and inside a test's transaction now() is the transaction's start.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, attempt, newPerson, ORG_A, ORG_B } from './setup';
import { emailStep, enrol, newProspect, newUser, one, rows } from './helpers/journeyFixtures';

type Row = Record<string, unknown>;
const mockFaults = { failReviewInserts: 0 };
jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return {
    __esModule: true,
    ownedDbTable: (t: string) => {
      const real = pgTable(client, t);
      if (t !== 'contact_opt_out_reviews') return real;
      // One injected outage on the review store's insert: the "open failed after the hold" case.
      const insert = real.insert;
      real.insert = (row: Row) => {
        if (mockFaults.failReviewInserts > 0) {
          mockFaults.failReviewInserts -= 1;
          const failed: Row = { select: () => failed, single: () => failed, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '08006', message: 'injected outage' } }).then(res) };
          return failed;
        }
        return insert(row);
      };
      return real;
    },
    ownedDbRpc: pgRpc(client),
  };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
const mockActor = { id: 'unset' };
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: mockActor.id })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/orchestration/optOutReview');
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
const { loadGovernanceRecords, normalizeGovernanceTarget } = require('../../services/prospectIdentity/contactGovernanceRepository');
const { mayContact } = require('../../services/prospectIdentity/contactGovernance');
const listRoute = require('../../../pages/api/contact-optout-reviews/index').default;
const reviewRoute = require('../../../pages/api/contact-optout-reviews/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const EMAIL = 'ana@example.test';
const PHONE = '+44 7700 900123';
const CANON = '+447700900123';
let fetchCalls = 0;

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = async () => { fetchCalls += 1; throw new Error('g11: network refused'); };
});
afterAll(() => { expect(fetchCalls).toBe(0); });

const dbNow = async (): Promise<string> => new Date((await one('SELECT now() AS t')).t as Date).toISOString();

async function allowed(org: string, channel: string, who: { personId?: string; target?: string }): Promise<boolean> {
  const loaded = await loadGovernanceRecords({ organizationId: org, personId: who.personId ?? null, target: who.target ?? null, channel });
  expect(loaded.ok).toBe(true);
  return mayContact({
    organizationId: org, personId: who.personId ?? null, targetNormalized: normalizeGovernanceTarget(channel, who.target ?? null),
    channel, now: await dbNow(), records: loaded.records,
  }).decision === 'allowed';
}
async function openChannels(org: string, personId: string): Promise<string[]> {
  const open: string[] = [];
  for (const c of ['email', 'phone', 'whatsapp', 'community']) if (await allowed(org, c, { personId })) open.push(`person:${c}`);
  if (await allowed(org, 'email', { target: EMAIL })) open.push('target:email');
  for (const c of ['phone', 'whatsapp']) if (await allowed(org, c, { target: PHONE })) open.push(`target:${c}`);
  return open;
}
const ALL_OPEN = ['person:email', 'person:phone', 'person:whatsapp', 'person:community', 'target:email', 'target:phone', 'target:whatsapp'];

async function member(org: string, role: string): Promise<string> {
  const user = await newUser();
  await db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, $3, 'active')`, [user, org, role]);
  return user;
}
async function setup() {
  await seedTenants();
  const person = await newPerson(ORG_A);
  const admin = await member(ORG_A, 'COMPANY_ADMIN');
  mockActor.id = admin;
  return { person, admin };
}
async function operatorOptOut(person: string, ref = 'run-1:reply-1', now?: string) {
  const holdIds = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: person, email: EMAIL, phone: PHONE, holdSource: 'optout_review:reply_opt_out', sourceRef: ref });
  const opened = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds, sourceRef: ref, holdSource: 'optout_review:reply_opt_out', now });
  return { holdIds, ...opened };
}
async function whatsappStop(ref = 'wamid.1') {
  const trigger = await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'whatsapp', target: PHONE, source: 'optout_review:whatsapp_stop' });
  const holdIds = await svc.writeOptOutHolds({ organizationId: ORG_A, phone: PHONE, holdSource: 'optout_review:whatsapp_stop', sourceRef: ref });
  const opened = await svc.openOptOutReview({
    organizationId: ORG_A, anchor: { kind: 'target', channel: 'whatsapp', target: CANON }, trigger: 'whatsapp_stop',
    holdIds, triggerRecordId: trigger.id, sourceRef: ref, holdSource: 'optout_review:whatsapp_stop',
  });
  return { holdIds, triggerId: String(trigger.id), ...opened };
}

function call(route: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, query: Row, body: Row = {}) {
  const out = { status: 0, json: {} as Row };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method, query, body, headers: {}, url: '/api/contact-optout-reviews' };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}
const decide = (reviewId: string, reopenChannels: string[], reason = 'confirmed with the person') =>
  call(reviewRoute, 'POST', { id: reviewId, company_id: ORG_A }, { reopenChannels, reason });
const review = (id: string) => one('SELECT * FROM public.contact_opt_out_reviews WHERE id = $1', [id]);
const holdRow = (id: string) => one('SELECT * FROM public.contact_governance_records WHERE id = $1', [id]);

describe('the store (20270127000001)', () => {
  it('RLS on; anon and authenticated hold nothing; service_role reads, inserts and updates but never deletes', () => inRollback(async () => {
    expect((await one(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_opt_out_reviews'::regclass`)).relrowsecurity).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect({ role, p, has: (await one(`SELECT has_table_privilege($1, 'public.contact_opt_out_reviews', $2) AS h`, [role, p])).h }).toEqual({ role, p, has: false });
      }
    }
    for (const [p, want] of [['SELECT', true], ['INSERT', true], ['UPDATE', true], ['DELETE', false]] as const) {
      expect({ p, has: (await one(`SELECT has_table_privilege('service_role', 'public.contact_opt_out_reviews', $1) AS h`, [p])).h }).toEqual({ p, has: want });
    }
    const [idx] = await rows(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_contact_opt_out_reviews_pending_anchor'`);
    expect(String(idx.indexdef)).toMatch(/UNIQUE INDEX .*\(organization_id, anchor_kind, anchor_value\) WHERE \(state = 'pending'::text\)/);
  }), 120_000);

  it('the database refuses: a second pending review per anchor, reopening a locked channel, a decided review back to pending, a moved anchor', () => inRollback(async () => {
    const { person, admin } = await setup();
    const r = await operatorOptOut(person);
    const dup = await attempt(`INSERT INTO public.contact_opt_out_reviews (organization_id, anchor_kind, anchor_value, person_id, triggers, source_refs, due_at, due_timezone)
      VALUES ($1, 'person', $2, $3, '{reply_opt_out}', '{x}', now() + interval '3 days', 'UTC')`, [ORG_A, person, person]);
    expect(dup).toBe('23505');
    const stop = await whatsappStop();
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET state = 'decided', decision = 'reopen', reopened_channels = '{whatsapp}',
      decided_by = $2, decided_at = now(), reason = 'x' WHERE id = $1`, [stop.reviewId, admin])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET anchor_value = 'someone-else' WHERE id = $1`, [r.reviewId])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET adopted_hold_ids = '{}' WHERE id = $1`, [r.reviewId])).toBe('23514');
    expect((await decide(r.reviewId, [])).status).toBe(200);
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET state = 'pending', decision = NULL, decided_by = NULL, decided_at = NULL,
      reason = NULL, reopened_channels = '{}', closed_channels = '{}' WHERE id = $1`, [r.reviewId])).toBe('23514');
  }), 120_000);
});

describe('the hold (owner rule 3)', () => {
  it('blocks every channel for the person, the address and the number at once; another tenant is unaffected', () => inRollback(async () => {
    const { person } = await setup();
    expect(await openChannels(ORG_A, person)).toEqual(ALL_OPEN);
    const r = await operatorOptOut(person);
    expect(r.outcome).toBe('opened');
    expect(await openChannels(ORG_A, person)).toEqual([]);
    expect(await allowed(ORG_B, 'email', { target: EMAIL })).toBe(true);
    expect(await allowed(ORG_B, 'whatsapp', { target: PHONE })).toBe(true);
    const held = await rows(`SELECT channel, governance_type, person_id, target_normalized, source, source_record_id, purpose_scope, evidence->>'source_ref' AS ref
      FROM public.contact_governance_records WHERE id = ANY($1::uuid[]) ORDER BY target_normalized NULLS FIRST`, [r.holdIds]);
    expect(held).toEqual([
      { channel: '*', governance_type: 'unsubscribe', person_id: person, target_normalized: null, source: 'optout_review:reply_opt_out', source_record_id: null, purpose_scope: null, ref: 'run-1:reply-1' },
      { channel: '*', governance_type: 'unsubscribe', person_id: null, target_normalized: CANON, source: 'optout_review:reply_opt_out', source_record_id: null, purpose_scope: null, ref: 'run-1:reply-1' },
      { channel: '*', governance_type: 'unsubscribe', person_id: null, target_normalized: EMAIL, source: 'optout_review:reply_opt_out', source_record_id: null, purpose_scope: null, ref: 'run-1:reply-1' },
    ]);
  }), 120_000);

  it('TRAP: the `*` hold from a spaced number is stored canonical and blocks a whatsapp AND a phone lookup; the raw spelling would block neither', () => inRollback(async () => {
    await setup();
    await svc.writeOptOutHolds({ organizationId: ORG_A, phone: PHONE, holdSource: 'optout_review:whatsapp_stop', sourceRef: 'wamid.t' });
    expect(await allowed(ORG_A, 'whatsapp', { target: PHONE })).toBe(false);
    expect(await allowed(ORG_A, 'phone', { target: CANON })).toBe(false);
    // Control, in tenant B: the same hold written with the raw spaced number.
    await recordContactGovernance({ organizationId: ORG_B, governanceType: 'unsubscribe', channel: '*', target: PHONE, source: 'optout_review:whatsapp_stop' });
    expect(await allowed(ORG_B, 'whatsapp', { target: PHONE })).toBe(true);
    expect(await allowed(ORG_B, 'phone', { target: PHONE })).toBe(true);
  }), 120_000);

  it('the source ref cannot go in source_record_id: that column is an LI-2 foreign key (why it is written to evidence)', () => inRollback(async () => {
    const { person } = await setup();
    await expect(recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: '*', personId: person, source: 'S', sourceRecordId: 'wamid.HBgM' }))
      .rejects.toBeDefined();
  }), 120_000);
});

describe('no decision (rule 5)', () => {
  it('everything stays closed; overdue (database clock) needs 3 ENDED weekdays of admin activity, past the estimated due_at', () => inRollback(async () => {
    const { person } = await setup();
    const now = await dbNow();
    const old = await operatorOptOut(person, 'r:old', new Date(Date.parse(now) - 8 * 86_400_000).toISOString());
    const fresh = await whatsappStop('wamid.fresh');
    const byId = async () => new Map(((await call(listRoute, 'GET', { company_id: ORG_A })).json.reviews as Row[]).map((x) => [x.id, x]));
    // No admin activity on any earlier day: past its estimated due_at, but NOT overdue.
    expect((await byId()).get(old.reviewId)).toMatchObject({ state: 'pending', qualifyingDays: 0, overdue: false });
    // The admin opened the reviews on every day since (UTC: no zone set); today is still running.
    await db.query(`INSERT INTO public.contact_opt_out_review_activity_days (organization_id, local_date)
      SELECT $1, d::date FROM generate_series(($2::timestamptz AT TIME ZONE 'UTC')::date + 1, (now() AT TIME ZONE 'UTC')::date - 1, interval '1 day') d
      ON CONFLICT DO NOTHING`, [ORG_A, new Date(Date.parse(now) - 8 * 86_400_000).toISOString()]);
    const listed = await byId();
    expect(listed.get(old.reviewId)).toMatchObject({ state: 'pending', overdue: true, activityUnreadable: false });
    expect(Number(listed.get(old.reviewId)!.qualifyingDays)).toBeGreaterThanOrEqual(3);
    expect(listed.get(fresh.reviewId)).toMatchObject({ state: 'pending', qualifyingDays: 0, overdue: false });
    const due = (await one(`SELECT due_at > now() AS future, due_at <= now() AS past FROM public.contact_opt_out_reviews WHERE id = $1`, [old.reviewId]));
    expect(due).toEqual({ future: false, past: true });
    expect(await openChannels(ORG_A, person)).toEqual([]);
  }), 120_000);

  it('due_at is 3 working days in the company zone; with no zone it is UTC and flagged', () => inRollback(async () => {
    const { person } = await setup();
    const now = await dbNow();
    const a = await whatsappStop('wamid.utc');
    expect(await review(a.reviewId)).toMatchObject({ due_timezone: 'UTC', due_timezone_fallback: true });
    await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Asia/Kolkata')
      ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
    const b = await operatorOptOut(person, 'r:zone', now);
    const row = await review(b.reviewId);
    expect(row).toMatchObject({ due_timezone: 'Asia/Kolkata', due_timezone_fallback: false });
    expect((row.opened_at as Date).toISOString()).toBe(now);
    expect((row.due_at as Date).toISOString()).toBe(svc.optOutReviewDueAt(now, 'Asia/Kolkata').dueAt);
    const { isodow } = await one(`SELECT extract(isodow FROM due_at AT TIME ZONE 'Asia/Kolkata')::int AS isodow FROM public.contact_opt_out_reviews WHERE id = $1`, [b.reviewId]);
    expect(isodow).toBeLessThanOrEqual(5);
  }), 120_000);
});

describe('the admin decides (rule 4), through the real route and the real tenant decision', () => {
  it('reopening ONE channel leaves the others closed; decided_by, the reason and an audit row are recorded', () => inRollback(async () => {
    const { person, admin } = await setup();
    const r = await operatorOptOut(person);
    const d = await decide(r.reviewId, ['email']);
    expect(d).toMatchObject({ status: 200, json: { decision: { decision: 'reopen', reopenedChannels: ['email'], closedChannels: ['phone', 'whatsapp'] } } });
    expect(await openChannels(ORG_A, person)).toEqual(['person:email', 'person:community', 'target:email']);
    expect(await review(r.reviewId)).toMatchObject({ state: 'decided', decision: 'reopen', decided_by: admin, reason: 'confirmed with the person' });
    for (const id of r.holdIds) expect((await holdRow(id)).revoked_at).not.toBeNull();
    const [audit] = await rows(`SELECT stage, decision, reason, actor, evidence FROM public.execution_audit WHERE company_id = $1 AND reason LIKE 'optout_review_%'`, [ORG_A]);
    expect(audit).toMatchObject({ stage: 'suppression', decision: 'cancelled', reason: 'optout_review_reopen', actor: admin });
    expect((audit.evidence as Row).review_id).toBe(r.reviewId);
    for (const v of [EMAIL, CANON, PHONE]) expect(JSON.stringify(audit.evidence)).not.toContain(v);   // no address in the audit
  }), 120_000);

  it('after a STOP, reopening "all" answers 400 channel_locked and changes nothing; email and phone reopen, whatsapp stays closed', () => inRollback(async () => {
    await setup();
    const r = await whatsappStop();
    const all = await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    expect(all).toMatchObject({ status: 400, json: { code: 'channel_locked', channels: ['whatsapp'] } });
    expect((await review(r.reviewId)).state).toBe('pending');
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
    expect((await decide(r.reviewId, ['email', 'phone'])).status).toBe(200);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(true);
    expect(await allowed(ORG_A, 'whatsapp', { target: PHONE })).toBe(false);
    expect((await holdRow(r.triggerId)).revoked_at).toBeNull();                      // the STOP itself is never revoked
  }), 120_000);

  it('refused: another tenant\'s admin, a super-admin (bypass), a non-admin member; nothing changes', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person);
    mockActor.id = await member(ORG_B, 'COMPANY_ADMIN');
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    mockActor.id = await member(ORG_B, 'SUPER_ADMIN');
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    expect((await call(listRoute, 'GET', { company_id: ORG_A })).status).toBe(403);
    mockActor.id = await member(ORG_A, 'VIEW_ONLY');
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    // A tenant-B admin asking about the review through tenant B: it does not exist there.
    mockActor.id = await member(ORG_B, 'COMPANY_ADMIN');
    expect((await call(reviewRoute, 'POST', { id: r.reviewId, company_id: ORG_B }, { reopenChannels: ['email'], reason: 'x' })).status).toBe(404);
    expect((await review(r.reviewId)).state).toBe('pending');
    expect(await openChannels(ORG_A, person)).toEqual([]);
  }), 120_000);
});

describe('adoption and joining (amendments A and B)', () => {
  it('RETRY: the open fails after the hold exists; the retry adopts it; an admin reopen revokes it', () => inRollback(async () => {
    const { person } = await setup();
    mockFaults.failReviewInserts = 1;
    await expect(operatorOptOut(person, 'r:retry')).rejects.toMatchObject({ code: 'review_write_failed' });
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_reviews WHERE organization_id = $1', [ORG_A])).n)).toBe(0);
    expect(await openChannels(ORG_A, person)).toEqual([]);                            // fail-safe: held
    const r = await operatorOptOut(person, 'r:retry');
    expect((await review(r.reviewId)).adopted_hold_ids).toEqual(r.holdIds);
    expect((await decide(r.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(200);
    expect(await openChannels(ORG_A, person)).toEqual(ALL_OPEN);
  }), 120_000);

  it('a pre-existing `*` unsubscribe is recorded, never adopted and never revoked', () => inRollback(async () => {
    const { person } = await setup();
    const w1c = await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: '*', personId: person, source: 'manual' });
    const r = await operatorOptOut(person);
    const row = await review(r.reviewId);
    expect(row.pre_existing_hold_ids).toEqual([w1c.id]);
    expect(row.adopted_hold_ids).not.toContain(w1c.id);
    expect((await decide(r.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(200);
    expect((await holdRow(w1c.id)).revoked_at).toBeNull();
    expect(await allowed(ORG_A, 'email', { personId: person })).toBe(false);
  }), 120_000);

  it('an unprefixed hold source (the person\'s own unsubscribe) is refused with invalid_hold_source; nothing is opened or revoked', () => inRollback(async () => {
    const { person } = await setup();
    const own = await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: '*', personId: person, source: 'manual', evidence: { source_ref: 'R' } });
    await expect(svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds: [own.id], sourceRef: 'R', holdSource: 'manual' }))
      .rejects.toMatchObject({ code: 'invalid_hold_source' });
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_reviews WHERE organization_id = $1', [ORG_A])).n)).toBe(0);
    expect((await holdRow(own.id)).revoked_at).toBeNull();
  }), 120_000);

  it('two concurrent opens on the real unique index: ONE review, the loser joins and does not throw', () => inRollback(async () => {
    const { person } = await setup();
    const holds = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: person, holdSource: 'optout_review:reply_opt_out', sourceRef: 'a' });
    const results = await Promise.all([
      svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds: holds, sourceRef: 'a', holdSource: 'optout_review:reply_opt_out' }),
      svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'email_unsubscribe', holdIds: holds, sourceRef: 'attempt:b', holdSource: 'optout_review:email_unsubscribe' }),
    ]);
    expect(results.map((x: Row) => x.outcome).sort()).toEqual(['joined', 'opened']);
    expect(new Set(results.map((x: Row) => x.reviewId)).size).toBe(1);
    const all = await rows('SELECT triggers, locked_channels, source_refs FROM public.contact_opt_out_reviews WHERE organization_id = $1', [ORG_A]);
    expect(all).toHaveLength(1);
    expect([...(all[0].triggers as string[])].sort()).toEqual(['email_unsubscribe', 'reply_opt_out']);
    expect(all[0].locked_channels).toEqual(['email']);
  }), 120_000);

  it('join, then decide, then a new trigger opens a NEW review', () => inRollback(async () => {
    const { person } = await setup();
    const first = await operatorOptOut(person, 'run-1:a');
    expect(await operatorOptOut(person, 'run-2:b')).toMatchObject({ outcome: 'joined', reviewId: first.reviewId });
    expect((await decide(first.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(200);
    expect(await openChannels(ORG_A, person)).toEqual(ALL_OPEN);
    const next = await operatorOptOut(person, 'run-3:c');
    expect(next.outcome).toBe('opened');
    expect(next.reviewId).not.toBe(first.reviewId);
    expect(await openChannels(ORG_A, person)).toEqual([]);
    expect((await review(first.reviewId)).state).toBe('decided');
  }), 120_000);
});

describe('Outreach review of ef93c367: one hold row can serve two reviews', () => {
  it('F1: a join between the decision\'s claim and its revoke; the decision answers decision_race_lost and R stays pending with a LIVE hold on every channel', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'run-f1:a');
    const writer = require('../../services/prospectIdentity/contactGovernanceWriter');
    const real = writer.revokeContactGovernance;
    let joined: Row | null = null;
    const spy = jest.spyOn(writer, 'revokeContactGovernance').mockImplementation(async (...a: unknown[]) => {
      if (joined === null) joined = await operatorOptOut(person, 'run-f1:b');
      return real(...a);
    });
    const d = await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    spy.mockRestore();
    expect(joined).toMatchObject({ outcome: 'joined', reviewId: r.reviewId });
    expect(d).toMatchObject({ status: 409, json: { code: 'decision_race_lost' } });
    const row = await review(r.reviewId);
    expect(row.state).toBe('pending');
    expect(await openChannels(ORG_A, person)).toEqual([]);
    const live = await rows(`SELECT person_id, target_normalized FROM public.contact_governance_records
      WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND channel = '*'`, [row.adopted_hold_ids]);
    expect(live.map((g) => g.person_id ?? g.target_normalized).sort()).toEqual([person, CANON, EMAIL].sort());
  }), 120_000);

  it('F2, order A: STOP then operator; deciding R1 leaves the number hold for pending R2 (phone stays held by target); R2 keep_closed closes that target', () => inRollback(async () => {
    const { person } = await setup();
    const r1 = await whatsappStop('wamid.f2a');
    const r2 = await operatorOptOut(person, 'run-f2:a');
    const h1 = r1.holdIds[0];
    expect((await review(r2.reviewId)).pre_existing_hold_ids).toEqual([h1]);
    const d1 = await decide(r1.reviewId, ['email', 'phone']);
    expect(d1).toMatchObject({ status: 200, json: { decision: { heldByOtherReview: [h1], revokedIds: [] } } });
    expect((await holdRow(h1)).revoked_at).toBeNull();
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);          // Path B, target only
    expect((await decide(r2.reviewId, [])).status).toBe(200);
    const [close] = await rows(`SELECT id FROM public.contact_governance_records WHERE organization_id = $1 AND source = 'manual:optout_review'
      AND channel = 'phone' AND person_id IS NULL AND target_normalized = $2 AND revoked_at IS NULL`, [ORG_A, CANON]);
    expect(close).toBeDefined();
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
  }), 120_000);

  it('F2, order A, then R2 reopens the phone: the hold R1 adopted is inherited and released; whatsapp stays closed by the STOP', () => inRollback(async () => {
    const { person } = await setup();
    const r1 = await whatsappStop('wamid.f2c');
    const r2 = await operatorOptOut(person, 'run-f2:c');
    expect((await decide(r1.reviewId, ['email', 'phone'])).status).toBe(200);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
    expect((await decide(r2.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(200);
    expect((await holdRow(r1.holdIds[0])).revoked_at).not.toBeNull();
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(true);
    expect(await allowed(ORG_A, 'whatsapp', { target: PHONE })).toBe(false);
  }), 120_000);

  it('F2, order B: operator then STOP; deciding R1 revokes nothing of R2\'s; the number stays held until R2 is decided', () => inRollback(async () => {
    const { person } = await setup();
    const r2 = await operatorOptOut(person, 'run-f2:b');
    const r1 = await whatsappStop('wamid.f2b');
    expect((await review(r1.reviewId))).toMatchObject({ adopted_hold_ids: [], pre_existing_hold_ids: [r2.holdIds[2]] });
    expect(await decide(r1.reviewId, ['email', 'phone'])).toMatchObject({ status: 200, json: { decision: { revokedIds: [] } } });
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
    expect((await decide(r2.reviewId, ['email', 'phone'])).status).toBe(200);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(true);
    expect(await allowed(ORG_A, 'whatsapp', { target: PHONE })).toBe(false);       // the STOP record stands
  }), 120_000);

  it('F3: findOptOutReviewBySourceRef: pending, decided, none, and another tenant gets null', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'ref-f3');
    expect(await svc.findOptOutReviewBySourceRef({ organizationId: ORG_A, sourceRef: 'ref-f3' })).toMatchObject({ id: r.reviewId, state: 'pending' });
    expect((await decide(r.reviewId, [])).status).toBe(200);
    expect(await svc.findOptOutReviewBySourceRef({ organizationId: ORG_A, sourceRef: 'ref-f3' })).toMatchObject({ id: r.reviewId, state: 'decided' });
    expect(await svc.findOptOutReviewBySourceRef({ organizationId: ORG_A, sourceRef: 'ref-none' })).toBeNull();
    expect(await svc.findOptOutReviewBySourceRef({ organizationId: ORG_B, sourceRef: 'ref-f3' })).toBeNull();
  }), 120_000);
});

describe('F-1 (PI): erasure leaves no person key in the review store', () => {
  /** What personErasure does to governance before the delete: live person-anchored rows are revoked (targets already carry the holds). */
  async function erase(person: string) {
    await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)'
      WHERE person_id = $1 AND revoked_at IS NULL`, [person]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
  }
  const anyColumnHas = async (needle: string) => Number((await one(
    `SELECT count(*)::int n FROM public.contact_opt_out_reviews r WHERE position($1 IN row_to_json(r)::text) > 0`, [needle])).n);

  it('a person review is tombstoned with the REVIEW\'s own id, keeps its state, and the target holds still block', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'run-erase:a');
    await erase(person);
    expect(await anyColumnHas(person)).toBe(0);
    const row = await review(r.reviewId);
    expect(row).toMatchObject({ anchor_kind: 'person', person_id: null, anchor_value: `erased:${r.reviewId}`, state: 'pending' });
    expect(await allowed(ORG_A, 'email', { target: EMAIL })).toBe(false);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
    expect(await allowed(ORG_A, 'whatsapp', { target: PHONE })).toBe(false);
  }), 120_000);

  it('a TARGET review is untouched when its person is deleted (PI ruling: keep the canonical value)', () => inRollback(async () => {
    const { person } = await setup();
    const stop = await whatsappStop('wamid.erase');
    await operatorOptOut(person, 'run-erase:t');
    await erase(person);
    expect(await review(stop.reviewId)).toMatchObject({ anchor_kind: 'target', anchor_channel: 'whatsapp', anchor_value: CANON, state: 'pending' });
  }), 120_000);

  // PROOF THAT THE PENDING-ANCHOR UNIQUE INDEX SURVIVES ERASURES. Do not delete as redundant:
  // a CONSTANT tombstone (say 'erased') would make the second erasure in a tenant collide on
  // uq_contact_opt_out_reviews_pending_anchor (org, 'person', anchor_value) WHERE pending and
  // abort that person's delete with 23505. The tombstone is 'erased:' || the review's own id.
  it('two pending person reviews in one tenant, both people erased: both rows survive with DISTINCT tombstones (unique-index proof)', () => inRollback(async () => {
    const { person } = await setup();
    const other = await newPerson(ORG_A);
    const a = await operatorOptOut(person, 'run-erase:1');
    const holds = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: other, holdSource: 'optout_review:reply_opt_out', sourceRef: 'run-erase:2' });
    const b = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: other }, trigger: 'reply_opt_out', holdIds: holds, sourceRef: 'run-erase:2', holdSource: 'optout_review:reply_opt_out' });
    await erase(person);
    await erase(other);
    const both = await rows(`SELECT id, anchor_value, state FROM public.contact_opt_out_reviews WHERE id = ANY($1::uuid[]) ORDER BY anchor_value`, [[a.reviewId, b.reviewId]]);
    expect(both).toHaveLength(2);
    expect(both.map((x) => x.anchor_value).sort()).toEqual([`erased:${a.reviewId}`, `erased:${b.reviewId}`].sort());
    expect(both.every((x) => x.state === 'pending')).toBe(true);
    expect(await anyColumnHas(person)).toBe(0);
    expect(await anyColumnHas(other)).toBe(0);
  }), 120_000);

  it('the guard permits no other anchor change: a person id may not be swapped, and an erased tombstone may not be forged on a live person', () => inRollback(async () => {
    const { person } = await setup();
    const other = await newPerson(ORG_A);
    const r = await operatorOptOut(person, 'run-erase:g');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET person_id = $2, anchor_value = $3 WHERE id = $1`, [r.reviewId, other, other])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET anchor_value = 'erased:' || id::text WHERE id = $1`, [r.reviewId])).toBe('23514');
  }), 120_000);
});

describe('PI F-2: a target anchor holds no person, so a person delete can never abort on this table', () => {
  /** Run a statement and KEEP it on success (unlike attempt()); return 'ok' or { code, constraint }. */
  async function keep(sql: string, params: unknown[]): Promise<string | { code: string; constraint: string | undefined }> {
    await db.query('SAVEPOINT keep');
    try {
      await db.query(sql, params);
      await db.query('RELEASE SAVEPOINT keep');
      return 'ok';
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT keep');
      return { code: (e as { code: string }).code, constraint: (e as { constraint?: string }).constraint };
    }
  }

  it('(a) a target anchor WITH a person_id is refused by contact_opt_out_reviews_target_has_no_person', () => inRollback(async () => {
    const { person } = await setup();
    const r = await keep(`INSERT INTO public.contact_opt_out_reviews (organization_id, anchor_kind, anchor_channel, anchor_value, person_id, triggers, source_refs, due_at, due_timezone)
      VALUES ($1, 'target', 'whatsapp', $2, $3, '{whatsapp_stop}', '{wamid.pi}', now() + interval '3 days', 'UTC')`, [ORG_A, CANON, person]);
    expect(r).toEqual({ code: '23514', constraint: 'contact_opt_out_reviews_target_has_no_person' });
  }), 120_000);

  it('(b) PI\'s probe shape is unreachable: the insert fails, so deleting that person succeeds and never aborts in the guard', () => inRollback(async () => {
    const { person } = await setup();
    const inserted = await keep(`INSERT INTO public.contact_opt_out_reviews (organization_id, anchor_kind, anchor_channel, anchor_value, person_id, triggers, source_refs, due_at, due_timezone)
      VALUES ($1, 'target', 'phone', $2, $3, '{whatsapp_stop}', '{wamid.probe}', now() + interval '3 days', 'UTC')`, [ORG_A, CANON, person]);
    // Had this row been stored, the FK's SET NULL would reach the guard's person_id branch and
    // RAISE, aborting the person's delete. The CHECK makes the row impossible:
    const deleted = await attempt('DELETE FROM public.unified_persons WHERE id = $1', [person]);
    // Both together, so a regression shows both effects: the row stored AND the delete aborted (23514).
    expect({ inserted: inserted === 'ok' ? 'ok' : 'refused', deleted }).toEqual({ inserted: 'refused', deleted: 'ok' });
  }), 120_000);
});

describe('admin activity days (owner ruling 2026-11-07: "Admin opened reviews"; "No, activity is enough")', () => {
  const activity = (org = ORG_A) => rows(`SELECT local_date::text AS d, first_seen_at, last_seen_at FROM public.contact_opt_out_review_activity_days
    WHERE organization_id = $1 ORDER BY local_date`, [org]);
  const seen = (org: string, days: string[]) => db.query(`INSERT INTO public.contact_opt_out_review_activity_days (organization_id, local_date)
    SELECT $1, unnest($2::date[]) ON CONFLICT DO NOTHING`, [org, days]);
  const review = (id: string, now: string) => svc.listOptOutReviews({ organizationId: ORG_A, state: 'all', now })
    .then((all: Row[]) => all.find((r) => r.id === id) as Row);

  it('the store: RLS, no client privileges, service_role SELECT/INSERT/UPDATE only, and NO personal-data column', () => inRollback(async () => {
    expect((await one(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_opt_out_review_activity_days'::regclass`)).relrowsecurity).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect({ role, p, has: (await one(`SELECT has_table_privilege($1, 'public.contact_opt_out_review_activity_days', $2) AS h`, [role, p])).h }).toEqual({ role, p, has: false });
      }
    }
    for (const [p, want] of [['SELECT', true], ['INSERT', true], ['UPDATE', true], ['DELETE', false]] as const) {
      expect({ p, has: (await one(`SELECT has_table_privilege('service_role', 'public.contact_opt_out_review_activity_days', $1) AS h`, [p])).h }).toEqual({ p, has: want });
    }
    const cols = await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contact_opt_out_review_activity_days' ORDER BY column_name`);
    expect(cols.map((c) => c.column_name)).toEqual(['first_seen_at', 'last_seen_at', 'local_date', 'organization_id']);
  }), 120_000);

  it('an authorised admin GET (list, then one review) records ONE row for the company\'s local day; the second view moves last_seen_at', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person);
    expect((await call(listRoute, 'GET', { company_id: ORG_A })).status).toBe(200);
    const [first] = await activity();
    expect(first.d).toBe(new Date().toISOString().slice(0, 10));            // no zone set: UTC
    expect((await call(reviewRoute, 'GET', { id: r.reviewId, company_id: ORG_A })).status).toBe(200);
    const after = await activity();
    expect(after).toHaveLength(1);
    expect((after[0].last_seen_at as Date).getTime()).toBeGreaterThanOrEqual((first.last_seen_at as Date).getTime());
    expect((after[0].first_seen_at as Date).getTime()).toBe((first.first_seen_at as Date).getTime());
  }), 120_000);

  it('REFUSED requests record nothing: a non-admin member, another tenant\'s admin, a super-admin (bypass)', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person);
    for (const [org, role] of [[ORG_A, 'VIEW_ONLY'], [ORG_B, 'COMPANY_ADMIN'], [ORG_B, 'SUPER_ADMIN']] as const) {
      mockActor.id = await member(org, role);
      expect((await call(listRoute, 'GET', { company_id: ORG_A })).status).toBe(403);
      expect((await call(reviewRoute, 'GET', { id: r.reviewId, company_id: ORG_A })).status).toBe(403);
    }
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_review_activity_days')).n)).toBe(0);
  }), 120_000);

  it('a recording failure does not fail the GET', () => inRollback(async () => {
    await setup();
    const spy = jest.spyOn(svc, 'recordReviewActivity').mockResolvedValueOnce({ ok: false, localDate: null, error: 'injected' });
    expect((await call(listRoute, 'GET', { company_id: ORG_A })).status).toBe(200);
    spy.mockRestore();
    expect(await activity()).toEqual([]);
  }), 120_000);

  it('the company\'s LOCAL day is recorded (Kolkata: Fri 23:30Z is Sat 7 Nov)', () => inRollback(async () => {
    await setup();
    await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Asia/Kolkata')
      ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
    expect(await svc.recordReviewActivity(ORG_A, '2026-11-06T23:30:00.000Z')).toEqual({ ok: true, localDate: '2026-11-07' });
    expect((await activity()).map((a) => a.d)).toEqual(['2026-11-07']);
  }), 120_000);

  it('overdue only after the 3rd ENDED qualifying weekday; the opening day, a weekend and another company\'s days do not count', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'act:rs', '2026-11-06T10:00:00.000Z');              // Fri 6 Nov
    await seen(ORG_A, ['2026-11-06', '2026-11-07', '2026-11-08']);                              // opening day + weekend
    await seen(ORG_B, ['2026-11-09', '2026-11-10', '2026-11-11']);                              // the other company
    expect(await review(r.reviewId, '2026-11-20T00:00:00.000Z')).toMatchObject({ qualifyingDays: 0, overdue: false });
    await seen(ORG_A, ['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(await review(r.reviewId, '2026-11-11T23:59:59.000Z')).toMatchObject({ qualifyingDays: 2, overdue: false });
    expect(await review(r.reviewId, '2026-11-12T00:00:00.000Z')).toMatchObject({ qualifyingDays: 3, overdue: true });
    // The stored due_at is the weekdays-only ESTIMATE (earliest possible), unchanged.
    expect(((await one('SELECT due_at FROM public.contact_opt_out_reviews WHERE id = $1', [r.reviewId])).due_at as Date).toISOString()).toBe('2026-11-11T10:00:00.000Z');
  }), 120_000);

  it('Los Angeles across midnight: the LA Monday counts once it has ended in LA', () => inRollback(async () => {
    const { person } = await setup();
    await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'America/Los_Angeles')
      ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
    const r = await operatorOptOut(person, 'act:la', '2026-11-09T06:00:00.000Z');              // Sun 8 Nov 22:00 PST
    await seen(ORG_A, ['2026-11-09']);
    expect(await review(r.reviewId, '2026-11-10T07:59:00.000Z')).toMatchObject({ qualifyingDays: 0 });
    expect(await review(r.reviewId, '2026-11-10T08:00:00.000Z')).toMatchObject({ qualifyingDays: 1 });
  }), 120_000);
});

describe('re-anchor at erasure: public.g11_reanchor_pending_opt_out_reviews (20270127000003)', () => {
  const T_EMAIL = { channel: 'email', value: EMAIL };
  const T_PHONE = { channel: 'phone', value: CANON };
  /** Called AS service_role (the only role granted EXECUTE); returns the dispositions, sorted. */
  async function reanchor(org: string, person: string, targets: unknown[]): Promise<Row[]> {
    // Its own savepoint: a raise rolls back to here (the role with it) and the test's transaction lives on.
    await db.query('SAVEPOINT ra');
    try {
      await db.query('SET LOCAL ROLE service_role');
      const { rows: out } = await db.query(`SELECT review_id, disposition, onto_review_id FROM public.g11_reanchor_pending_opt_out_reviews($1, $2, $3::jsonb)`,
        [org, person, JSON.stringify(targets)]);
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT ra');
      return out.sort((a, b) => String(a.review_id).localeCompare(String(b.review_id)));
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT ra');
      throw e;
    }
  }
  const snapshot = async () => (await rows(`SELECT row_to_json(r)::text AS j FROM public.contact_opt_out_reviews r ORDER BY id`)).map((x) => x.j)
    .concat((await rows(`SELECT row_to_json(l)::text AS j FROM public.contact_opt_out_review_reanchors l ORDER BY review_id`)).map((x) => x.j));
  /** What personErasure does before the delete: revoke the person-anchored holds (targets carry theirs). */
  async function erase(person: string) {
    await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)' WHERE person_id = $1 AND revoked_at IS NULL`, [person]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
  }
  const anyColumnHas = async (needle: string) => Number((await one(
    `SELECT count(*)::int n FROM public.contact_opt_out_reviews r WHERE position($1 IN row_to_json(r)::text) > 0`, [needle])).n);
  /** A pending review already on the email target (an email unsubscribe from an unresolved address). */
  async function emailTargetReview() {
    const holdIds = await svc.writeOptOutHolds({ organizationId: ORG_A, email: EMAIL, holdSource: 'optout_review:email_unsubscribe', sourceRef: 'attempt:77' });
    return svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'target', channel: 'email', target: EMAIL }, trigger: 'email_unsubscribe',
      holdIds, sourceRef: 'attempt:77', holdSource: 'optout_review:email_unsubscribe' });
  }

  it('re_anchored: the first applicable target (email before phone), person_id NULL, revision + 1', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'run-ra:1');
    const before = await review(r.reviewId);
    expect(await reanchor(ORG_A, person, [T_PHONE, T_EMAIL])).toEqual([{ review_id: r.reviewId, disposition: 're_anchored', onto_review_id: null }]);
    expect(await review(r.reviewId)).toMatchObject({ anchor_kind: 'target', anchor_channel: 'email', anchor_value: EMAIL, person_id: null, state: 'pending', revision: Number(before.revision) + 1 });
  }), 120_000);

  it('merged: a pending review already holds the target → JOIN (arrays unioned, its revision + 1); the person review becomes merged', () => inRollback(async () => {
    const { person } = await setup();
    const t = await emailTargetReview();
    const r = await operatorOptOut(person, 'run-ra:2');
    const [tBefore, rBefore] = [await review(t.reviewId), await review(r.reviewId)];
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual([{ review_id: r.reviewId, disposition: 'merged', onto_review_id: t.reviewId }]);
    const tAfter = await review(t.reviewId);
    expect(tAfter.revision).toBe(Number(tBefore.revision) + 1);
    expect([...(tAfter.triggers as string[])].sort()).toEqual(['email_unsubscribe', 'reply_opt_out']);
    expect(tAfter.locked_channels).toEqual(['email']);
    expect([...(tAfter.source_refs as string[])].sort()).toEqual(['attempt:77', 'run-ra:2']);
    for (const id of rBefore.adopted_hold_ids as string[]) expect(tAfter.adopted_hold_ids).toContain(id);
    for (const id of tBefore.adopted_hold_ids as string[]) expect(tAfter.adopted_hold_ids).toContain(id);
    expect(await review(r.reviewId)).toMatchObject({ state: 'merged', merged_into: t.reviewId, decision: null, decided_by: null, reason: null });
    expect((await review(r.reviewId)).merged_at).not.toBeNull();
  }), 120_000);

  it('no_target: with no targets the row is left for the FK tombstone; nothing is written', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'run-ra:3');
    const before = await snapshot();
    expect(await reanchor(ORG_A, person, [])).toEqual([{ review_id: r.reviewId, disposition: 'no_target', onto_review_id: null }]);
    expect(await snapshot()).toEqual(before);
  }), 120_000);

  it('IDEMPOTENT: a second call with the same inputs writes nothing and returns the same dispositions', () => inRollback(async () => {
    const { person } = await setup();
    const t = await emailTargetReview();
    const a = await operatorOptOut(person, 'run-ra:4');
    const first = await reanchor(ORG_A, person, [T_EMAIL]);
    expect(first).toEqual([{ review_id: a.reviewId, disposition: 'merged', onto_review_id: t.reviewId }]);
    const after = await snapshot();
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual(first);
    expect(await snapshot()).toEqual(after);
  }), 120_000);

  it('decided and merged rows are untouched; only PENDING person reviews of THAT person move', () => inRollback(async () => {
    const { person } = await setup();
    const d = await operatorOptOut(person, 'run-ra:5');
    expect((await decide(d.reviewId, [])).status).toBe(200);
    const other = await newPerson(ORG_A);
    const holds = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: other, holdSource: 'optout_review:reply_opt_out', sourceRef: 'run-ra:5b' });
    const o = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: other }, trigger: 'reply_opt_out', holdIds: holds, sourceRef: 'run-ra:5b', holdSource: 'optout_review:reply_opt_out' });
    const [dBefore, oBefore] = [JSON.stringify(await review(d.reviewId)), JSON.stringify(await review(o.reviewId))];
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual([]);
    expect(JSON.stringify(await review(d.reviewId))).toBe(dBefore);
    expect(JSON.stringify(await review(o.reviewId))).toBe(oBefore);
  }), 120_000);

  it('RAISES: a person outside the organization, and a malformed target', () => inRollback(async () => {
    const { person } = await setup();
    await operatorOptOut(person, 'run-ra:6');
    await expect(reanchor(ORG_B, person, [T_EMAIL])).rejects.toMatchObject({ code: '22023' });
    await expect(reanchor(ORG_A, person, [{ channel: 'sms', value: '1' }])).rejects.toMatchObject({ code: '22023' });
    expect((await one('SELECT current_user AS u')).u).not.toBe('service_role');      // the role was reset with the savepoint
  }), 120_000);

  it('FULL SEQUENCE: function, person delete, NO person uuid anywhere; the target review is decidable and an admin reopen behaves', () => inRollback(async () => {
    const { person } = await setup();
    const t = await emailTargetReview();                      // merged-into target
    const a = await operatorOptOut(person, 'run-ra:7');        // merges into t
    // A second pending person review of the same person cannot exist (one pending per anchor), so a
    // re_anchored case runs for another person on the phone target in the same sequence:
    const other = await newPerson(ORG_A);
    const oh = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: other, holdSource: 'optout_review:reply_opt_out', sourceRef: 'run-ra:7b' });
    const o = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: other }, trigger: 'reply_opt_out', holdIds: oh, sourceRef: 'run-ra:7b', holdSource: 'optout_review:reply_opt_out' });
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual([{ review_id: a.reviewId, disposition: 'merged', onto_review_id: t.reviewId }]);
    expect(await reanchor(ORG_A, other, [T_PHONE])).toEqual([{ review_id: o.reviewId, disposition: 're_anchored', onto_review_id: null }]);
    await erase(person);
    await erase(other);
    expect(await anyColumnHas(person)).toBe(0);
    expect(await anyColumnHas(other)).toBe(0);
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_review_reanchors')).n)).toBe(0);   // the ledger went with the people
    expect(await review(a.reviewId)).toMatchObject({ state: 'merged', anchor_value: `erased:${a.reviewId}`, person_id: null });
    expect(await allowed(ORG_A, 'email', { target: EMAIL })).toBe(false);
    // The admin can still decide both: the re-anchored phone review, then the review the person's
    // one merged into. The number stays held until t (which adopted the person's number hold) is decided.
    expect((await decide(o.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(200);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(false);
    expect((await decide(t.reviewId, ['email', 'phone', 'whatsapp'])).status).toBe(400);                           // email is locked by the unsubscribe
    expect((await decide(t.reviewId, ['phone', 'whatsapp'])).status).toBe(200);
    expect(await allowed(ORG_A, 'phone', { target: PHONE })).toBe(true);
    expect(await allowed(ORG_A, 'email', { target: EMAIL })).toBe(false);
  }), 120_000);

  it('a merged review cannot be decided or reopened: 409 review_merged, and the database refuses any move out of merged', () => inRollback(async () => {
    const { person, admin } = await setup();
    const t = await emailTargetReview();
    const r = await operatorOptOut(person, 'run-ra:8');
    await reanchor(ORG_A, person, [T_EMAIL]);
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ status: 409, json: { code: 'review_merged' } });
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET state = 'pending', merged_into = NULL, merged_at = NULL WHERE id = $1`, [r.reviewId])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET state = 'decided', merged_into = NULL, merged_at = NULL, decision = 'keep_closed',
      decided_by = $2, decided_at = now(), reason = 'x', closed_channels = '{email}' WHERE id = $1`, [r.reviewId, admin])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET revision = revision + 1 WHERE id = $1`, [r.reviewId])).toBe('23514');
    void t;
  }), 120_000);

  it('outside the function the database refuses pending → merged and the person → target move', () => inRollback(async () => {
    const { person } = await setup();
    const t = await emailTargetReview();
    const r = await operatorOptOut(person, 'run-ra:9');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET state = 'merged', merged_into = $2, merged_at = now() WHERE id = $1`, [r.reviewId, t.reviewId])).toBe('23514');
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET anchor_kind = 'target', anchor_channel = 'phone', anchor_value = $2, person_id = NULL WHERE id = $1`, [r.reviewId, CANON])).toBe('23514');
  }), 120_000);

  it('EXECUTE is refused for anon and authenticated (granted to service_role only); the listing shows merged as neither pending nor overdue', () => inRollback(async () => {
    const { person } = await setup();
    for (const role of ['anon', 'authenticated']) {
      expect((await one(`SELECT has_function_privilege($1, 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE') AS h`, [role])).h).toBe(false);
      await db.query('SAVEPOINT r');
      await db.query(`SET LOCAL ROLE ${role}`);
      const code = await db.query(`SELECT public.g11_reanchor_pending_opt_out_reviews($1, $2, '[]'::jsonb)`, [ORG_A, person]).then(() => 'ok', (e) => e.code);
      await db.query('ROLLBACK TO SAVEPOINT r');
      expect({ role, code }).toEqual({ role, code: '42501' });
    }
    expect((await one(`SELECT has_function_privilege('service_role', 'public.g11_reanchor_pending_opt_out_reviews(uuid, uuid, jsonb)', 'EXECUTE') AS h`)).h).toBe(true);
    const t = await emailTargetReview();
    const r = await operatorOptOut(person, 'run-ra:10');
    await reanchor(ORG_A, person, [T_EMAIL]);
    const pending = (await call(listRoute, 'GET', { company_id: ORG_A })).json.reviews as Row[];
    expect(pending.map((x) => x.id)).toEqual([t.reviewId]);
    const merged = ((await call(listRoute, 'GET', { company_id: ORG_A, state: 'merged' })).json.reviews as Row[]);
    expect(merged).toEqual([expect.objectContaining({ id: r.reviewId, state: 'merged', mergedInto: t.reviewId, overdue: false })]);
  }), 120_000);
});

describe('re-anchor IDEMPOTENCY, explicitly (PI): same inputs → exactly the same set, until the person delete', () => {
  const T_EMAIL = { channel: 'email', value: EMAIL };
  async function reanchor(org: string, person: string, targets: unknown[]): Promise<Row[]> {
    await db.query('SAVEPOINT ra');
    try {
      await db.query('SET LOCAL ROLE service_role');
      const { rows: out } = await db.query(`SELECT review_id, disposition, onto_review_id FROM public.g11_reanchor_pending_opt_out_reviews($1, $2, $3::jsonb)`,
        [org, person, JSON.stringify(targets)]);
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT ra');
      return out.sort((a, b) => String(a.review_id).localeCompare(String(b.review_id)));
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT ra');
      throw e;
    }
  }
  const state = async () => (await rows(`SELECT row_to_json(r)::text AS j FROM public.contact_opt_out_reviews r ORDER BY id`)).map((x) => x.j)
    .concat((await rows(`SELECT row_to_json(l)::text AS j FROM public.contact_opt_out_review_reanchors l ORDER BY review_id`)).map((x) => x.j));
  const exactlyOnce = (set: Row[]) => expect(new Set(set.map((x) => x.review_id)).size).toBe(set.length);

  /** P re-anchored once onto the email (R1), then a NEW opt-out for P (R2) that will merge into R1. */
  async function history() {
    const { person } = await setup();
    const r1 = await operatorOptOut(person, 'run-idem:1');
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual([{ review_id: r1.reviewId, disposition: 're_anchored', onto_review_id: null }]);
    const r2 = await operatorOptOut(person, 'run-idem:2');      // R1 is now on the email target: R2 opens person-anchored
    expect(r2.reviewId).not.toBe(r1.reviewId);
    return { person, r1, r2 };
  }

  it('re_anchored + merged in one call; the 2nd and 3rd calls return EXACTLY the same set (length, no duplicate review_id, dispositions, onto) and write nothing', () => inRollback(async () => {
    const { person, r1, r2 } = await history();
    const first = await reanchor(ORG_A, person, [T_EMAIL]);
    const want = [
      { review_id: r1.reviewId, disposition: 're_anchored', onto_review_id: null },
      { review_id: r2.reviewId, disposition: 'merged', onto_review_id: r1.reviewId },
    ].sort((a, b) => a.review_id.localeCompare(b.review_id));
    expect(first).toEqual(want);
    exactlyOnce(first);
    const after = await state();
    for (const n of [2, 3]) {
      const again = await reanchor(ORG_A, person, [T_EMAIL]);
      expect({ n, set: again }).toEqual({ n, set: first });
      exactlyOnce(again);
      expect(await state()).toEqual(after);
    }
  }), 120_000);

  it('no_target (empty targets): the 1st, 2nd and 3rd calls return the same single row and write nothing (it never meets re_anchored/merged in one call: those need targets)', () => inRollback(async () => {
    const { person } = await setup();
    const r = await operatorOptOut(person, 'run-idem:nt');
    const before = await state();
    const first = await reanchor(ORG_A, person, []);
    expect(first).toEqual([{ review_id: r.reviewId, disposition: 'no_target', onto_review_id: null }]);
    for (const n of [2, 3]) expect({ n, set: await reanchor(ORG_A, person, []) }).toEqual({ n, set: first });
    expect(await state()).toEqual(before);
  }), 120_000);

  it('PARTIAL RETRY: a call that raises part-way (after moving R2, at its ledger write) leaves nothing; the retry returns each review exactly once', () => inRollback(async () => {
    const { person, r1, r2 } = await history();
    const before = await state();
    // Test-only fault: the ledger write raises, AFTER the function has already moved R2.
    await db.query(`CREATE FUNCTION pg_temp.g11_fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'injected ledger failure' USING ERRCODE = 'P0001'; END $f$`);
    await db.query(`CREATE TRIGGER g11_fail_ledger BEFORE INSERT ON public.contact_opt_out_review_reanchors FOR EACH ROW EXECUTE FUNCTION pg_temp.g11_fail_ledger()`);
    await expect(reanchor(ORG_A, person, [T_EMAIL])).rejects.toMatchObject({ code: 'P0001' });
    await db.query('DROP TRIGGER g11_fail_ledger ON public.contact_opt_out_review_reanchors');
    expect(await state()).toEqual(before);                                 // R2 still pending, person-anchored; nothing half-done
    const retry = await reanchor(ORG_A, person, [T_EMAIL]);
    expect(retry).toEqual([
      { review_id: r1.reviewId, disposition: 're_anchored', onto_review_id: null },
      { review_id: r2.reviewId, disposition: 'merged', onto_review_id: r1.reviewId },
    ].sort((a, b) => a.review_id.localeCompare(b.review_id)));
    exactlyOnce(retry);
    expect(await reanchor(ORG_A, person, [T_EMAIL])).toEqual(retry);
  }), 120_000);

  it('THE BOUNDARY: after the person delete the ledger is gone with the person, and a further call RAISES (the person is no longer in the organization)', () => inRollback(async () => {
    const { person } = await history();
    await reanchor(ORG_A, person, [T_EMAIL]);
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_review_reanchors WHERE person_id = $1', [person])).n)).toBe(2);
    await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)' WHERE person_id = $1 AND revoked_at IS NULL`, [person]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
    expect(Number((await one('SELECT count(*)::int n FROM public.contact_opt_out_review_reanchors')).n)).toBe(0);
    await expect(reanchor(ORG_A, person, [T_EMAIL])).rejects.toMatchObject({ code: '22023' });
  }), 120_000);
});

describe('enrolment closure (owner 2026-11-07: "new journey gets closed while prospect is closed ... only copany admin can close or reopen the prospect"; "Also a manual close")', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const closureRoute = require('../../../pages/api/contact-enrolment-closures/index').default;
  const closureSvc = require('../../services/orchestration/contactEnrolmentClosure');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const DEF = { steps: [emailStep('hello')] };
  const report = async (actor: string, prospectId: string, org = ORG_A) => (await enrol(org, actor, prospectId, DEF)).report as Row;
  const refusedBy = (r: Row) => Object.keys((r.exclusionReasons as Row) ?? {});
  const closeVia = (prospectId: string, action: 'close' | 'reopen', reason: unknown = 'asked us by phone') =>
    call(closureRoute, 'POST', { company_id: ORG_A }, { action, prospectId, reason });
  const piTransitions = async (prospectId: string) => Number((await one(
    'SELECT count(*)::int n FROM public.prospect_lifecycle_transitions WHERE organization_id = $1 AND prospect_id = $2', [ORG_A, prospectId])).n);
  /** A prospect with a person who has the address and the (spaced) number, and that person's opt-out review. */
  async function optedOut(admin: string) {
    const { prospectId, personId } = await newProspect(ORG_A, { email: EMAIL, phone: PHONE });
    const r = await operatorOptOut(personId, `run-cl:${prospectId}`);
    void admin;
    return { prospectId, personId, reviewId: r.reviewId as string };
  }
  async function erase(person: string) {
    await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)' WHERE person_id = $1 AND revoked_at IS NULL`, [person]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
  }

  it('an opt-out review closes the prospect (contact_closed_by_admin); an admin reopen of ANY channel reopens it; PI is untouched', () => inRollback(async () => {
    const { admin } = await setup();
    const p = await optedOut(admin);
    const pi = await piTransitions(p.prospectId);
    const refused = await report(admin, p.prospectId);
    expect(refused).toMatchObject({ enrolled: 0, excluded: 1 });
    expect(refusedBy(refused)).toEqual(['contact_closed_by_admin']);
    expect((await decide(p.reviewId, ['email'])).status).toBe(200);
    expect(await report(admin, p.prospectId)).toMatchObject({ enrolled: 1 });
    expect(await piTransitions(p.prospectId)).toBe(pi);                                     // 0 PI transitions
  }), 120_000);

  it('keep_closed holds; a later reopen opens', () => inRollback(async () => {
    const { admin } = await setup();
    const p = await optedOut(admin);
    expect((await decide(p.reviewId, [])).status).toBe(200);
    expect(refusedBy(await report(admin, p.prospectId))).toEqual(['contact_closed_by_admin']);
    expect((await decide(p.reviewId, ['phone'], 'second look')).status).toBe(200);
    expect(await report(admin, p.prospectId)).toMatchObject({ enrolled: 1 });
  }), 120_000);

  it('a target-anchored STOP review on the canonical number closes the prospect whose stored phone is spaced; another tenant is unaffected', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId } = await newProspect(ORG_A, { email: 'someone@example.test', phone: PHONE });
    await whatsappStop('wamid.cl');
    expect(refusedBy(await report(admin, prospectId))).toEqual(['contact_closed_by_admin']);
    const b = await newProspect(ORG_B, { email: 'someone@example.test', phone: PHONE });
    expect(await report(admin, b.prospectId, ORG_B)).toMatchObject({ enrolled: 1 });
  }), 120_000);

  it('MERGED: the person review merged into a pending target review; the target review governs and the prospect stays closed', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId, personId } = await newProspect(ORG_A, { email: EMAIL, phone: PHONE });
    const holds = await svc.writeOptOutHolds({ organizationId: ORG_A, email: EMAIL, holdSource: 'optout_review:email_unsubscribe', sourceRef: 'attempt:cl' });
    const t = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'target', channel: 'email', target: EMAIL }, trigger: 'email_unsubscribe', holdIds: holds, sourceRef: 'attempt:cl', holdSource: 'optout_review:email_unsubscribe' });
    const r = await operatorOptOut(personId, 'run-cl:m');
    await db.query(`SELECT * FROM public.g11_reanchor_pending_opt_out_reviews($1, $2, $3::jsonb)`, [ORG_A, personId, JSON.stringify([{ channel: 'email', value: EMAIL }])]);
    expect(await review(r.reviewId)).toMatchObject({ state: 'merged', merged_into: t.reviewId });
    expect(refusedBy(await report(admin, prospectId))).toEqual(['contact_closed_by_admin']);
    expect((await decide(t.reviewId, ['phone', 'whatsapp'])).status).toBe(200);           // a reopen decision (email is locked by the unsubscribe)
    expect(await report(admin, prospectId)).toMatchObject({ enrolled: 1 });
  }), 120_000);

  it('MANUAL: close refuses, reopen opens; a reopen while a review holds is 409 closed_by_optout_review and enrolment stays refused; audited without the reason', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId, personId } = await newProspect(ORG_A, { email: EMAIL, phone: PHONE });
    expect((await closeVia(prospectId, 'close')).status).toBe(201);
    expect(refusedBy(await report(admin, prospectId))).toEqual(['contact_closed_by_admin']);
    expect((await closeVia(prospectId, 'reopen', 'confirmed again')).status).toBe(200);
    expect(await report(admin, prospectId)).toMatchObject({ enrolled: 1 });
    // A review now, then a manual close and a manual reopen: the review still holds.
    const r = await operatorOptOut(personId, 'run-cl:man');
    expect((await closeVia(prospectId, 'close', 'again')).status).toBe(201);
    expect(await closeVia(prospectId, 'reopen', 'try')).toMatchObject({ status: 409, json: { code: 'closed_by_optout_review', reviewId: r.reviewId } });
    expect(refusedBy(await report(admin, prospectId))).toEqual(['contact_closed_by_admin']);
    const audit = await rows(`SELECT decision, reason, actor, evidence FROM public.execution_audit WHERE company_id = $1 AND reason LIKE 'contact_enrolment_%' ORDER BY created_at`, [ORG_A]);
    // One transaction's now(): created_at ties, so compare the multiset.
    expect(audit.map((a) => String(a.reason)).sort()).toEqual(['contact_enrolment_closed', 'contact_enrolment_closed', 'contact_enrolment_reopened']);
    expect(JSON.stringify(audit)).not.toMatch(/asked us by phone|confirmed again|example\.test/);
    expect(await one('SELECT count(*)::int n FROM public.contact_enrolment_closures WHERE prospect_id = $1 AND reopened_at IS NULL', [prospectId])).toEqual({ n: 1 });
  }), 120_000);

  it('who: a non-admin member, another tenant\'s admin, a super-admin are refused; a reason is required', () => inRollback(async () => {
    await setup();
    const { prospectId } = await newProspect(ORG_A, { email: EMAIL });
    expect(await closeVia(prospectId, 'close', '  ')).toMatchObject({ status: 400, json: { code: 'reason_required' } });
    for (const [org, role] of [[ORG_A, 'VIEW_ONLY'], [ORG_B, 'COMPANY_ADMIN'], [ORG_B, 'SUPER_ADMIN']] as const) {
      mockActor.id = await member(org, role);
      expect(await closeVia(prospectId, 'close')).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    }
    expect(await one('SELECT count(*)::int n FROM public.contact_enrolment_closures')).toEqual({ n: 0 });
  }), 120_000);

  it('FAIL CLOSED: an unreadable closure state refuses enrolment (contact_closure_unreadable)', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId } = await newProspect(ORG_A, { email: EMAIL });
    const spy = jest.spyOn(closureSvc, 'readContactEnrolmentClosure').mockResolvedValue({ ok: false, error: 'injected' });
    const r = await report(admin, prospectId);
    spy.mockRestore();
    expect(refusedBy(r)).toEqual(['contact_closure_unreadable']);
    expect(r).toMatchObject({ enrolled: 0 });
  }), 120_000);

  it('the store: one active closure, append-only, reopen once, no DELETE for service_role, no client privileges', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId } = await newProspect(ORG_A, { email: EMAIL });
    const ins = () => attempt(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason) VALUES ($1, $2, $3, 'r')`, [ORG_A, prospectId, admin]);
    await db.query(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason) VALUES ($1, $2, $3, 'r')`, [ORG_A, prospectId, admin]);
    expect(await ins()).toBe('23505');
    expect(await attempt(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason) VALUES ($1, $2, $3, 'r')`, [ORG_B, prospectId, admin])).toBe('23503');
    expect(await attempt(`UPDATE public.contact_enrolment_closures SET close_reason = 'changed' WHERE prospect_id = $1`, [prospectId])).toBe('23514');
    await db.query(`UPDATE public.contact_enrolment_closures SET reopened_by = $2, reopened_at = now(), reopen_reason = 'ok' WHERE prospect_id = $1`, [prospectId, admin]);
    expect(await attempt(`UPDATE public.contact_enrolment_closures SET reopen_reason = 'again' WHERE prospect_id = $1`, [prospectId])).toBe('23514');
    for (const [role, p, want] of [['service_role', 'DELETE', false], ['service_role', 'UPDATE', true], ['anon', 'SELECT', false], ['authenticated', 'SELECT', false]] as const) {
      expect({ role, p, has: (await one(`SELECT has_table_privilege($1, 'public.contact_enrolment_closures', $2) AS h`, [role, p])).h }).toEqual({ role, p, has: want });
    }
  }), 120_000);
});

describe('closure reasons at erasure (PI SPLIT: row KEEP, close_reason/reopen_reason MAPPED → \'[redacted: subject erased]\')', () => {
  const PLACEHOLDER = '[redacted: subject erased]';
  async function redact(org: string, ids: unknown): Promise<number> {
    await db.query('SAVEPOINT rd');
    try {
      await db.query('SET LOCAL ROLE service_role');
      const { rows: out } = await db.query('SELECT public.g11_redact_enrolment_closure_reasons($1, $2::uuid[]) AS n', [org, ids]);
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT rd');
      return Number(out[0].n);
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT rd');
      throw e;
    }
  }
  async function closedTwoShapes(admin: string) {
    const a = await newProspect(ORG_A, { email: 'a@example.test' });
    const b = await newProspect(ORG_A, { email: 'b@example.test' });
    // a: closed, never reopened. b: closed, reopened, closed again (two rows).
    await db.query(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason) VALUES ($1, $2, $3, 'Ana Smith asked by phone')`, [ORG_A, a.prospectId, admin]);
    await db.query(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason, reopened_by, reopened_at, reopen_reason)
      VALUES ($1, $2, $3, 'Bob said stop', $3, now(), 'Bob said go')`, [ORG_A, b.prospectId, admin]);
    await db.query(`INSERT INTO public.contact_enrolment_closures (organization_id, prospect_id, closed_by, close_reason) VALUES ($1, $2, $3, 'Bob again')`, [ORG_A, b.prospectId, admin]);
    return { a, b };
  }
  const shape = (prospectId: string) => rows(`SELECT close_reason, reopen_reason, reopened_by IS NOT NULL AS has_reopened_by, reopened_at IS NOT NULL AS has_reopened_at, closed_by, closed_at
    FROM public.contact_enrolment_closures WHERE prospect_id = $1 ORDER BY closed_at, reopened_at NULLS LAST`, [prospectId]);

  it('BOTH ROW SHAPES: un-reopened gets the placeholder and stays un-reopened; reopened gets it on both reasons; operators and times survive', () => inRollback(async () => {
    const { admin } = await setup();
    const { a, b } = await closedTwoShapes(admin);
    const [beforeA] = await shape(a.prospectId);
    expect(await redact(ORG_A, [a.prospectId, b.prospectId])).toBe(3);
    expect(await shape(a.prospectId)).toEqual([{ ...beforeA, close_reason: PLACEHOLDER, reopen_reason: null, has_reopened_by: false, has_reopened_at: false }]);
    const sb = await shape(b.prospectId);
    expect(sb.map((x) => [x.close_reason, x.reopen_reason, x.has_reopened_by])).toEqual([[PLACEHOLDER, PLACEHOLDER, true], [PLACEHOLDER, null, false]]);
    expect(sb.every((x) => x.closed_by === admin)).toBe(true);
    expect(await anyClosureHas(['Ana Smith', 'Bob'])).toBe(0);
  }), 120_000);

  it('idempotent; {} returns 0 and writes nothing; NULL, a NULL element and another tenant\'s prospect RAISE', () => inRollback(async () => {
    const { admin } = await setup();
    const { a } = await closedTwoShapes(admin);
    expect(await redact(ORG_A, [a.prospectId])).toBe(1);
    expect(await redact(ORG_A, [a.prospectId])).toBe(0);
    const before = await rows('SELECT row_to_json(c)::text j FROM public.contact_enrolment_closures c ORDER BY id');
    expect(await redact(ORG_A, [])).toBe(0);
    expect(await rows('SELECT row_to_json(c)::text j FROM public.contact_enrolment_closures c ORDER BY id')).toEqual(before);
    await expect(redact(ORG_A, null)).rejects.toMatchObject({ code: '22023' });
    await expect(redact(ORG_A, [a.prospectId, null])).rejects.toMatchObject({ code: '22023' });
    const other = await newProspect(ORG_B, { email: 'x@example.test' });
    await expect(redact(ORG_A, [other.prospectId])).rejects.toMatchObject({ code: '22023' });
    await expect(redact(ORG_A, ['not-a-uuid'])).rejects.toMatchObject({ code: '22P02' });
  }), 120_000);

  it('EXECUTE is refused for anon and authenticated; outside the function the guard still refuses any change to close_reason (even to the placeholder)', () => inRollback(async () => {
    const { admin } = await setup();
    const { a } = await closedTwoShapes(admin);
    for (const role of ['anon', 'authenticated']) {
      expect((await one(`SELECT has_function_privilege($1, 'public.g11_redact_enrolment_closure_reasons(uuid, uuid[])', 'EXECUTE') AS h`, [role])).h).toBe(false);
    }
    expect(await attempt(`UPDATE public.contact_enrolment_closures SET close_reason = $2 WHERE prospect_id = $1`, [a.prospectId, PLACEHOLDER])).toBe('23514');
  }), 120_000);

  it('ERASURE, end to end: redact, delete the person; the prospect stays closed (manual gate) and no reason text or person key remains', () => inRollback(async () => {
    const { admin } = await setup();
    const { prospectId, personId } = await newProspect(ORG_A, { email: EMAIL, phone: PHONE });
    expect((await call(require('../../../pages/api/contact-enrolment-closures/index').default, 'POST', { company_id: ORG_A }, { action: 'close', prospectId, reason: 'Ana asked by phone' })).status).toBe(201);
    expect(await redact(ORG_A, [prospectId])).toBe(1);
    await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)' WHERE person_id = $1 AND revoked_at IS NULL`, [personId]);
    await db.query('DELETE FROM public.unified_persons WHERE id = $1', [personId]);
    expect(await anyClosureHas(['Ana asked', personId])).toBe(0);
    const r = (await enrol(ORG_A, admin, prospectId, { steps: [emailStep('hello')] })).report as Row;
    expect(Object.keys(r.exclusionReasons as Row)).toEqual(['contact_closed_by_admin']);
  }), 120_000);

  const anyClosureHas = async (needles: string[]) => {
    let n = 0;
    for (const needle of needles) {
      n += Number((await one(`SELECT count(*)::int n FROM public.contact_enrolment_closures c WHERE position($1 IN row_to_json(c)::text) > 0`, [needle])).n);
    }
    return n;
  };
});
