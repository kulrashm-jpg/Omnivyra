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
import { newUser, one, rows } from './helpers/journeyFixtures';

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
  it('everything stays closed; the listing (database clock) calls a review overdue past its due date and not before', () => inRollback(async () => {
    const { person } = await setup();
    const now = await dbNow();
    const old = await operatorOptOut(person, 'r:old', new Date(Date.parse(now) - 8 * 86_400_000).toISOString());
    const fresh = await whatsappStop('wamid.fresh');
    const listed = await call(listRoute, 'GET', { company_id: ORG_A });
    expect(listed.status).toBe(200);
    const byId = new Map((listed.json.reviews as Row[]).map((x) => [x.id, x]));
    expect(byId.get(old.reviewId)).toMatchObject({ state: 'pending', overdue: true });
    expect(byId.get(fresh.reviewId)).toMatchObject({ state: 'pending', overdue: false });
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
