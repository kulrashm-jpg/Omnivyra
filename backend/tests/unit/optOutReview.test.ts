/**
 * G-11 — the opt-out hold and its company-admin review (optOutReview.ts), against an
 * in-memory store that models the two unique indexes the design leans on:
 *   uq_contact_governance_identity            (org, channel, type, person|target, purpose) live
 *   uq_contact_opt_out_reviews_pending_anchor (org, anchor kind, anchor value) pending
 * and parses the PostgreSQL array literals the service writes, as PostgreSQL would.
 *
 * The real governance writer, the real repository and the real `mayContact` run on top of it,
 * so "blocked" below is the verdict every send path's gate reaches. It is a FAKE: constraints,
 * triggers, grants and real types are proved in backend/tests/realschema/g11_optout_review.test.ts.
 */

export {};

type Row = Record<string, unknown>;

const mockDb = {
  tables: {} as Record<string, Row[]>,
  failInsert: new Map<string, number>(),
  seq: 0,
  /** Every call, as `table:op:eq-columns`, so a suite can pin the order of reads and writes. */
  log: [] as string[],
};
const mockUuid = () => `00000000-0000-4000-8000-${String(++mockDb.seq).padStart(12, '0')}`;
/** `{"a","b"}` → ['a', 'b'], as PostgreSQL reads an array literal into text[] / uuid[]. */
const mockArray = (v: unknown): unknown => {
  if (typeof v !== 'string' || !/^\{.*\}$/.test(v)) return v;
  const body = v.slice(1, -1);
  if (body === '') return [];
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
};
const ARRAY_COLS = new Set(['triggers', 'locked_channels', 'adopted_hold_ids', 'pre_existing_hold_ids', 'trigger_record_ids',
  'closing_record_ids', 'source_refs', 'reopened_channels', 'closed_channels']);
const DEFAULTS: Record<string, () => Row> = {
  contact_governance_records: () => ({ revoked_at: null, revoked_reason: null, purpose_scope: null, source_record_id: null, effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, evidence: {} }),
  contact_opt_out_reviews: () => ({
    state: 'pending', decision: null, decided_by: null, decided_at: null, reason: null, revision: 0, person_id: null, anchor_channel: null,
    locked_channels: [], adopted_hold_ids: [], pre_existing_hold_ids: [], trigger_record_ids: [], closing_record_ids: [],
    reopened_channels: [], closed_channels: [], due_timezone_fallback: false,
  }),
};
const UNIQUE: Record<string, (a: Row, b: Row) => boolean> = {
  contact_governance_records: (a, b) => a.revoked_at == null && b.revoked_at == null && a.organization_id === b.organization_id
    && a.channel === b.channel && a.governance_type === b.governance_type
    && (a.person_id ?? a.target_normalized) === (b.person_id ?? b.target_normalized)
    && (a.purpose_scope ?? 'all') === (b.purpose_scope ?? 'all'),
  contact_opt_out_reviews: (a, b) => a.state === 'pending' && b.state === 'pending' && a.organization_id === b.organization_id
    && a.anchor_kind === b.anchor_kind && a.anchor_value === b.anchor_value,
};
const mockTable = (table: string) => {
  const st = { eqs: [] as string[], op: 'select', payload: null as Row | null, tests: [] as Array<(r: Row) => boolean>, limit: null as number | null, mode: 'many', order: [] as Array<[string, boolean]> };
  const rows = () => (mockDb.tables[table] ??= []);
  const exec = async () => {
    await Promise.resolve();                       // let concurrent callers interleave between calls
    mockDb.log.push(`${table}:${st.op}:${st.eqs.join(',')}`);
    if (st.op === 'insert') {
      const left = mockDb.failInsert.get(table) ?? 0;
      if (left > 0) { mockDb.failInsert.set(table, left - 1); return { data: null, error: { code: '08006', message: 'fake outage' } }; }
      const row: Row = { id: mockUuid(), ...DEFAULTS[table]?.() };
      for (const [k, v] of Object.entries(st.payload ?? {})) row[k] = ARRAY_COLS.has(k) ? mockArray(v) : v;
      if (UNIQUE[table] && rows().some((r) => UNIQUE[table](r, row))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      rows().push(row);
      return { data: st.mode === 'many' ? [{ ...row }] : { ...row }, error: null };
    }
    let out = rows().filter((r) => st.tests.every((t) => t(r)));
    if (st.op === 'update') {
      for (const r of out) for (const [k, v] of Object.entries(st.payload ?? {})) r[k] = ARRAY_COLS.has(k) ? mockArray(v) : v;
    }
    for (const [col, asc] of [...st.order].reverse()) out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
    if (st.limit !== null) out = out.slice(0, st.limit);
    const copy = out.map((r) => JSON.parse(JSON.stringify(r)) as Row);
    if (st.mode === 'single' && copy.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not one row' } };
    if (st.mode !== 'many') return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null };
  };
  const b: Row = {
    select: () => b,
    insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
    update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
    eq: (c: string, v: unknown) => { st.eqs.push(c); st.tests.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { st.tests.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    in: (c: string, vs: unknown[]) => { st.tests.push((r) => vs.includes(r[c])); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { st.order.push([c, o?.ascending !== false]); return b; },
    limit: (n: number) => { st.limit = n; return b; },
    single: () => { st.mode = 'single'; return b; },
    maybeSingle: () => { st.mode = 'one'; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
};
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));

/* eslint-disable import/first */
import {
  openOptOutReview, decideOptOutReview, listOptOutReviews, writeOptOutHolds, optOutReviewDueAt, isAdoptable,
  OPT_OUT_REVIEW_SOURCE, findOptOutReviewBySourceRef,
} from '../../services/orchestration/optOutReview';
import * as governanceWriter from '../../services/prospectIdentity/contactGovernanceWriter';
import { recordContactGovernance } from '../../services/prospectIdentity/contactGovernanceWriter';
import { loadGovernanceRecords, normalizeGovernanceTarget } from '../../services/prospectIdentity/contactGovernanceRepository';
import { mayContact } from '../../services/prospectIdentity/contactGovernance';
import { durableIntelligencePort, loadIndividualFacts } from '../../services/orchestration/individualIntelligence';
/* eslint-enable import/first */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b1';
const PERSON = '00000000-0000-4000-8000-0000000000c1';
const ADMIN = '00000000-0000-4000-8000-0000000000d1';
const EMAIL = 'Ana@Example.test';
const PHONE = '+44 7700 900123';
const WA_SOURCE = 'optout_review:whatsapp_stop';

/** The verdict every send path's gate reaches for this recipient. */
async function allowed(org: string, channel: string, who: { personId?: string; target?: string }): Promise<boolean> {
  const loaded = await loadGovernanceRecords({ organizationId: org, personId: who.personId ?? null, target: who.target ?? null, channel });
  expect(loaded.ok).toBe(true);
  return mayContact({
    organizationId: org, personId: who.personId ?? null, targetNormalized: normalizeGovernanceTarget(channel, who.target ?? null),
    channel, now: new Date().toISOString(), records: loaded.records,
  }).decision === 'allowed';
}
/** Every channel for the person, and for the address and the number with no person known. */
async function openChannels(org = ORG): Promise<string[]> {
  const open: string[] = [];
  for (const c of ['email', 'phone', 'whatsapp', 'community']) if (await allowed(org, c, { personId: PERSON })) open.push(`person:${c}`);
  if (await allowed(org, 'email', { target: EMAIL })) open.push('target:email');
  for (const c of ['phone', 'whatsapp']) if (await allowed(org, c, { target: PHONE })) open.push(`target:${c}`);
  return open;
}
const ALL_OPEN = ['person:email', 'person:phone', 'person:whatsapp', 'person:community', 'target:email', 'target:phone', 'target:whatsapp'];
const reviews = () => (mockDb.tables.contact_opt_out_reviews ?? []) as Row[];
const gov = () => (mockDb.tables.contact_governance_records ?? []) as Row[];

/** The operator path: `*` holds on the person, the address and the number, then the review. */
async function operatorOptOut(ref = 'run-1:reply-1') {
  const holdIds = await writeOptOutHolds({ organizationId: ORG, personId: PERSON, email: EMAIL, phone: PHONE, holdSource: 'optout_review:reply_opt_out', sourceRef: ref });
  const opened = await openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds, sourceRef: ref, holdSource: 'optout_review:reply_opt_out' });
  return { holdIds, ...opened };
}
/** The Outreach STOP path, from a number no person resolves for. */
async function whatsappStop(ref = 'wamid.1') {
  const trigger = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: 'whatsapp', target: PHONE, source: WA_SOURCE });
  const holdIds = await writeOptOutHolds({ organizationId: ORG, phone: PHONE, holdSource: WA_SOURCE, sourceRef: ref });
  const opened = await openOptOutReview({
    organizationId: ORG, anchor: { kind: 'target', channel: 'whatsapp', target: normalizeGovernanceTarget('whatsapp', PHONE) as string },
    trigger: 'whatsapp_stop', holdIds, triggerRecordId: trigger.id, sourceRef: ref, holdSource: WA_SOURCE,
  });
  return { holdIds, triggerId: trigger.id, ...opened };
}
const decide = (reviewId: string, reopenChannels: unknown, reason: unknown = 'customer confirmed by phone') =>
  decideOptOutReview({ organizationId: ORG, reviewId, actorUserId: ADMIN, reopenChannels, reason });

beforeEach(() => { mockDb.tables = {}; mockDb.failInsert = new Map(); mockDb.seq = 100; mockDb.log = []; jest.restoreAllMocks(); });

describe('the hold (owner rule 3): immediate, every channel, every medium', () => {
  it('blocks every channel for the person, the address and the number, before anyone decides', async () => {
    expect(await openChannels()).toEqual(ALL_OPEN);
    const r = await operatorOptOut();
    expect(r.outcome).toBe('opened');
    expect(await openChannels()).toEqual([]);
  });

  it('a NEW journey for the same person plans no send: every permission fact is false', async () => {
    await operatorOptOut();
    const facts = await loadIndividualFacts(ORG, { kind: 'prospect', id: 'p' }, new Date().toISOString(), {
      ...durableIntelligencePort,
      resolvePerson: async () => ({ ok: true, personId: PERSON }),
      readPersonContacts: async () => ({ email: EMAIL, phone: PHONE }),
      readProspectScore: async () => null,
    });
    expect(facts.facts).toMatchObject({ email_permitted: false, whatsapp_permitted: false, community_permitted: false });
  });

  it('TRAP: a `*` hold is written on the CANONICAL number, so a whatsapp and a phone lookup both find it', async () => {
    await writeOptOutHolds({ organizationId: ORG, phone: PHONE, holdSource: WA_SOURCE, sourceRef: 'wamid.t' });
    expect(gov().map((g) => g.target_normalized)).toEqual(['+447700900123']);
    expect(await allowed(ORG, 'whatsapp', { target: PHONE })).toBe(false);
    expect(await allowed(ORG, 'phone', { target: '+447700900123' })).toBe(false);
  });

  it('TRAP, the control: the same hold written with the spaced number blocks NEITHER lookup', async () => {
    await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', target: PHONE, source: WA_SOURCE });
    expect(await allowed(ORG, 'whatsapp', { target: PHONE })).toBe(true);
    expect(await allowed(ORG, 'phone', { target: PHONE })).toBe(true);
  });

  it('the hold carries its source ref in evidence (source_record_id is an LI-2 foreign key) and no purpose scope', async () => {
    await writeOptOutHolds({ organizationId: ORG, personId: PERSON, holdSource: 'optout_review:reply_opt_out', sourceRef: 'run:key', evidence: { actor: ADMIN } });
    expect(gov()[0]).toMatchObject({ governance_type: 'unsubscribe', channel: '*', source: 'optout_review:reply_opt_out', source_record_id: null, purpose_scope: null, evidence: { actor: ADMIN, source_ref: 'run:key' } });
  });
});

describe('no decision (rule 5) and another tenant (rule 1)', () => {
  it('everything stays closed past the due date; the listing calls it overdue; another tenant is unaffected', async () => {
    const r = await operatorOptOut();
    const later = new Date(Date.parse(r.dueAt) + 1).toISOString();
    const [listed] = await listOptOutReviews({ organizationId: ORG, now: later });
    expect(listed).toMatchObject({ id: r.reviewId, state: 'pending', overdue: true });
    expect((await listOptOutReviews({ organizationId: ORG, now: r.dueAt }))[0].overdue).toBe(true);
    expect((await listOptOutReviews({ organizationId: ORG, now: new Date(Date.parse(r.dueAt) - 1).toISOString() }))[0].overdue).toBe(false);
    expect(await openChannels()).toEqual([]);
    expect(await allowed(ORG_B, 'email', { target: EMAIL })).toBe(true);
    expect(await allowed(ORG_B, 'whatsapp', { target: PHONE })).toBe(true);
    expect(await listOptOutReviews({ organizationId: ORG_B })).toEqual([]);
  });

  it('another tenant cannot decide this review: it is not found there, and nothing changes', async () => {
    const r = await operatorOptOut();
    const other = await decideOptOutReview({ organizationId: ORG_B, reviewId: r.reviewId, actorUserId: ADMIN, reopenChannels: ['email'], reason: 'x' });
    expect(other).toMatchObject({ ok: false, code: 'review_not_found' });
    expect(await openChannels()).toEqual([]);
  });
});

describe('the decision (rule 4)', () => {
  it('reopening ONE channel leaves the others closed: closes are written first, then the adopted holds revoked', async () => {
    const r = await operatorOptOut();
    const d = await decide(r.reviewId, ['email']);
    expect(d).toMatchObject({ ok: true, decision: 'reopen', reopenedChannels: ['email'], closedChannels: ['phone', 'whatsapp'] });
    expect(await openChannels()).toEqual(['person:email', 'person:community', 'target:email']);
    const review = reviews()[0];
    expect(review).toMatchObject({ state: 'decided', decision: 'reopen', decided_by: ADMIN, reason: 'customer confirmed by phone' });
    expect(gov().filter((g) => g.source === OPT_OUT_REVIEW_SOURCE).map((g) => `${g.channel}:${g.person_id ?? g.target_normalized}`).sort())
      .toEqual([`phone:${PERSON}`, 'phone:+447700900123', `whatsapp:${PERSON}`, 'whatsapp:+447700900123'].sort());
  });

  it('ORDER: when a close cannot be written, nothing is revoked and the review stays pending', async () => {
    const r = await operatorOptOut();
    mockDb.failInsert.set('contact_governance_records', 1);
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ ok: false, code: 'governance_write_failed' });
    expect(gov().filter((g) => g.revoked_at != null)).toEqual([]);
    expect(reviews()[0].state).toBe('pending');
    expect(await openChannels()).toEqual([]);
  });

  it('after a STOP, reopening "all" is refused (channel_locked); email and phone reopen and whatsapp stays closed', async () => {
    const r = await whatsappStop();
    expect(await decide(r.reviewId, ['email', 'phone', 'whatsapp'])).toMatchObject({ ok: false, code: 'channel_locked', channels: ['whatsapp'] });
    expect(reviews()[0].state).toBe('pending');
    const d = await decide(r.reviewId, ['email', 'phone']);
    expect(d).toMatchObject({ ok: true, closedChannels: ['whatsapp'] });
    expect(await allowed(ORG, 'phone', { target: PHONE })).toBe(true);
    expect(await allowed(ORG, 'whatsapp', { target: PHONE })).toBe(false);
    // The STOP record itself is recorded and never revoked.
    expect(gov().find((g) => g.id === r.triggerId)).toMatchObject({ revoked_at: null });
    expect(reviews()[0].trigger_record_ids).toEqual([r.triggerId]);
  });

  it('after an operator opt_out the admin may reopen every channel', async () => {
    const r = await operatorOptOut();
    expect(await decide(r.reviewId, ['email', 'phone', 'whatsapp'])).toMatchObject({ ok: true, closedChannels: [] });
    expect(await openChannels()).toEqual(ALL_OPEN);
  });

  it('keep_closed, then (rule 6) a later reopen of the same review revokes its own closes for that channel only', async () => {
    const r = await operatorOptOut();
    expect(await decide(r.reviewId, [])).toMatchObject({ ok: true, decision: 'keep_closed', closedChannels: ['email', 'phone', 'whatsapp'] });
    expect(await openChannels()).toEqual(['person:community']);   // a future channel opens with the `*` hold gone (accepted)
    expect(await decide(r.reviewId, ['whatsapp'], 'second look')).toMatchObject({ ok: true, decision: 'reopen' });
    expect(await openChannels()).toEqual(['person:whatsapp', 'person:community', 'target:whatsapp']);
    expect(reviews()[0]).toMatchObject({ state: 'decided', reason: 'second look', reopened_channels: ['whatsapp'] });
  });

  it('refusals: no reason, an unknown channel, a non-list, no actor; none changes anything', async () => {
    const r = await operatorOptOut();
    expect(await decide(r.reviewId, [], '  ')).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await decide(r.reviewId, ['sms'])).toMatchObject({ ok: false, code: 'unknown_channel', channels: ['sms'] });
    expect(await decide(r.reviewId, 'email')).toMatchObject({ ok: false, code: 'invalid_channels' });
    expect(await decideOptOutReview({ organizationId: ORG, reviewId: r.reviewId, actorUserId: '', reopenChannels: [], reason: 'x' }))
      .toMatchObject({ ok: false, code: 'actor_required' });
    expect(await openChannels()).toEqual([]);
    expect(reviews()[0].state).toBe('pending');
  });
});

describe('adoption (amendment A)', () => {
  it('RETRY: the open fails after the holds exist; the retry adopts them, and a reopen revokes them', async () => {
    const holdIds = await writeOptOutHolds({ organizationId: ORG, personId: PERSON, email: EMAIL, holdSource: 'optout_review:reply_opt_out', sourceRef: 'r:1' });
    mockDb.failInsert.set('contact_opt_out_reviews', 1);
    const input = { organizationId: ORG, anchor: { kind: 'person' as const, personId: PERSON }, trigger: 'reply_opt_out' as const, holdIds, sourceRef: 'r:1', holdSource: 'optout_review:reply_opt_out' };
    await expect(openOptOutReview(input)).rejects.toMatchObject({ code: 'review_write_failed' });
    expect(reviews()).toEqual([]);
    expect(await allowed(ORG, 'email', { personId: PERSON })).toBe(false);          // fail-safe: still held
    const again = await writeOptOutHolds({ organizationId: ORG, personId: PERSON, email: EMAIL, holdSource: 'optout_review:reply_opt_out', sourceRef: 'r:1' });
    expect(again).toEqual(holdIds);                                                    // already present
    const r = await openOptOutReview({ ...input, holdIds: again });
    expect(reviews()[0]).toMatchObject({ adopted_hold_ids: holdIds, pre_existing_hold_ids: [] });
    await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    expect(gov().filter((g) => holdIds.includes(String(g.id))).every((g) => g.revoked_at != null)).toBe(true);
    expect(await allowed(ORG, 'email', { personId: PERSON, target: EMAIL })).toBe(true);
  });

  it('a pre-existing `*` row (a W1-C unsubscribe) is recorded, never adopted, never revoked', async () => {
    const w1c = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', personId: PERSON, source: 'manual' });
    const r = await operatorOptOut();
    expect(r.holdIds).toContain(w1c.id);                                               // the writer answered already_present
    expect(reviews()[0].pre_existing_hold_ids).toEqual([w1c.id]);
    expect(reviews()[0].adopted_hold_ids).not.toContain(w1c.id);
    const d = await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    expect(d).toMatchObject({ ok: true, preExistingHoldIds: [w1c.id] });
    expect(gov().find((g) => g.id === w1c.id)).toMatchObject({ revoked_at: null });
    expect(await allowed(ORG, 'email', { personId: PERSON })).toBe(false);            // the W1-C opt-out still stands
    expect(await allowed(ORG, 'email', { target: EMAIL })).toBe(true);               // the review's own address hold is gone
  });

  it('isAdoptable: only the caller\'s own live all-channel unsubscribe', () => {
    const h = { governanceType: 'unsubscribe', channel: '*', source: 'S', sourceRecordId: null, sourceRef: 'R', revokedAt: null };
    expect(isAdoptable(h, 'S', 'R')).toBe(true);
    expect(isAdoptable({ ...h, sourceRef: null, sourceRecordId: 'R' }, 'S', 'R')).toBe(true);
    for (const bad of [{ source: 'T' }, { sourceRef: 'X' }, { channel: 'email' }, { governanceType: 'dnc_permanent' }, { revokedAt: 'now' }]) {
      expect(isAdoptable({ ...h, ...bad }, 'S', 'R')).toBe(false);
    }
  });

  it('a hold id from another tenant, or one already revoked, is refused, and no review is opened', async () => {
    const theirs = await recordContactGovernance({ organizationId: ORG_B, governanceType: 'unsubscribe', channel: '*', personId: PERSON, source: 'optout_review:reply_opt_out' });
    await expect(openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds: [theirs.id], sourceRef: 'R', holdSource: 'optout_review:reply_opt_out' }))
      .rejects.toMatchObject({ code: 'hold_not_found' });
    const mine = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', personId: PERSON, source: 'optout_review:reply_opt_out' });
    gov().find((g) => g.id === mine.id)!.revoked_at = new Date().toISOString();
    gov().find((g) => g.id === mine.id)!.revoked_reason = 'x';
    await expect(openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds: [mine.id], sourceRef: 'R', holdSource: 'optout_review:reply_opt_out' }))
      .rejects.toMatchObject({ code: 'hold_revoked' });
    expect(reviews()).toEqual([]);
  });
});

describe('one pending review per anchor (amendment B)', () => {
  it('two concurrent opens give ONE review: the loser of the insert re-reads and joins, and never throws', async () => {
    const a = await writeOptOutHolds({ organizationId: ORG, personId: PERSON, holdSource: 'optout_review:reply_opt_out', sourceRef: 'a' });
    const results = await Promise.all([
      openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds: a, sourceRef: 'a', holdSource: 'optout_review:reply_opt_out' }),
      openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'email_unsubscribe', holdIds: a, sourceRef: 'attempt:b', holdSource: 'optout_review:email_unsubscribe' }),
    ]);
    expect(results.map((x) => x.outcome).sort()).toEqual(['joined', 'opened']);
    expect(new Set(results.map((x) => x.reviewId)).size).toBe(1);
    expect(reviews()).toHaveLength(1);
    expect(reviews()[0]).toMatchObject({ locked_channels: ['email'], source_refs: expect.arrayContaining(['a', 'attempt:b']), revision: 1 });
    expect((reviews()[0].triggers as string[]).sort()).toEqual(['email_unsubscribe', 'reply_opt_out']);
  });

  it('join, then decide, then a new trigger opens a NEW review; the decided one is untouched', async () => {
    const first = await operatorOptOut('run-1:a');
    const joined = await operatorOptOut('run-2:b');
    expect(joined).toMatchObject({ outcome: 'joined', reviewId: first.reviewId });
    expect(reviews()[0].source_refs).toEqual(['run-1:a', 'run-2:b']);
    expect(reviews()[0].pre_existing_hold_ids).toEqual([]);              // its own adopted holds are not "pre-existing"
    expect(await decide(first.reviewId, ['email', 'phone', 'whatsapp'])).toMatchObject({ ok: true });
    expect(await openChannels()).toEqual(ALL_OPEN);
    const next = await operatorOptOut('run-3:c');
    expect(next.outcome).toBe('opened');
    expect(next.reviewId).not.toBe(first.reviewId);
    expect(reviews().map((r) => r.state)).toEqual(['decided', 'pending']);
    expect(await openChannels()).toEqual([]);
  });

  it('a STOP from an unresolved number and an operator opt_out for the person are TWO reviews (OPEN: identity linking)', async () => {
    await whatsappStop();
    await operatorOptOut();
    expect(reviews().map((r) => `${r.anchor_kind}:${r.anchor_value}`)).toEqual(['target:+447700900123', `person:${PERSON}`]);
  });
});

describe('hold sources carry the `optout_review:` prefix (agreed with Outreach, 2026-11-07)', () => {
  it.each(['manual:reply_evaluation', 'manual:optout_review', 'manual', 'webhook:whatsapp', 'optout_review:', 'optout_review'])(
    'openOptOutReview THROWS invalid_hold_source for %p, before any read; nothing is opened', async (holdSource) => {
      const own = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', personId: PERSON, source: holdSource || 'x' });
      await expect(openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds: [own.id], sourceRef: 'R', holdSource }))
        .rejects.toMatchObject({ name: 'OptOutReviewError', code: 'invalid_hold_source' });
      expect(reviews()).toEqual([]);
    },
  );

  it('a mistaken caller naming the person\'s OWN unsubscribe with its source cannot adopt it, so no decision could ever revoke it', async () => {
    const theirOwn = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', personId: PERSON, source: 'manual', evidence: { source_ref: 'R' } });
    await expect(openOptOutReview({ organizationId: ORG, anchor: { kind: 'person', personId: PERSON }, trigger: 'reply_opt_out', holdIds: [theirOwn.id], sourceRef: 'R', holdSource: 'manual' }))
      .rejects.toMatchObject({ code: 'invalid_hold_source' });
    expect(gov().find((g) => g.id === theirOwn.id)).toMatchObject({ revoked_at: null });
  });

  it('writeOptOutHolds refuses an unprefixed source too, writing nothing', async () => {
    await expect(writeOptOutHolds({ organizationId: ORG, personId: PERSON, holdSource: 'manual:reply_evaluation', sourceRef: 'r' }))
      .rejects.toMatchObject({ code: 'invalid_hold_source' });
    expect(gov()).toEqual([]);
  });

  it('the closes a decision writes carry `manual:optout_review`: unprefixed, so no later review can adopt them', async () => {
    const r = await operatorOptOut();
    await decide(r.reviewId, []);
    const closes = gov().filter((g) => g.channel !== '*');
    expect(closes.length).toBeGreaterThan(0);
    expect(closes.every((g) => g.source === OPT_OUT_REVIEW_SOURCE && !String(g.source).startsWith('optout_review:'))).toBe(true);
  });

  it('the email unsubscribe producer shape: channel `email` permanent record, `*` holds from `optout_review:email_unsubscribe`, ref `attempt:<id>`; email stays closed', async () => {
    const permanent = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: 'email', target: EMAIL, source: 'link:unsubscribe' });
    const holdIds = await writeOptOutHolds({ organizationId: ORG, email: EMAIL, holdSource: 'optout_review:email_unsubscribe', sourceRef: 'attempt:42' });
    const r = await openOptOutReview({
      organizationId: ORG, anchor: { kind: 'target', channel: 'email', target: 'ana@example.test' }, trigger: 'email_unsubscribe',
      holdIds, triggerRecordId: permanent.id, sourceRef: 'attempt:42', holdSource: 'optout_review:email_unsubscribe',
    });
    expect(reviews()[0]).toMatchObject({ anchor_kind: 'target', anchor_channel: 'email', locked_channels: ['email'], adopted_hold_ids: holdIds });
    expect(await decide(r.reviewId, ['email'])).toMatchObject({ ok: false, code: 'channel_locked', channels: ['email'] });
    expect(await decide(r.reviewId, ['phone', 'whatsapp'])).toMatchObject({ ok: true, closedChannels: ['email'] });
    expect(await allowed(ORG, 'email', { target: EMAIL })).toBe(false);
    expect(gov().find((g) => g.id === permanent.id)).toMatchObject({ revoked_at: null });
  });
});

describe('Outreach review of ef93c367: one hold row can serve two reviews (the canonical key has no source)', () => {
  const PERSON_PHONE = PHONE;

  /** STOP on the number first (R1 adopts the number hold), then an operator opt_out for the person (R2). */
  async function stopThenOperator() {
    const r1 = await whatsappStop('wamid.f2');
    const r2 = await operatorOptOut('run-f2:a');
    return { r1, r2 };
  }

  it('F2, order A: deciding R1 does NOT revoke the number hold R2 found present (heldByOtherReview); the number stays held while R2 is pending', async () => {
    const { r1, r2 } = await stopThenOperator();
    const h1 = r1.holdIds[0];
    expect(reviews()[1].pre_existing_hold_ids).toEqual([h1]);            // R2 found R1's number hold present
    const d = await decide(r1.reviewId, ['email', 'phone']);
    expect(d).toMatchObject({ ok: true, heldByOtherReview: [h1], revokedIds: [] });
    expect(gov().find((g) => g.id === h1)).toMatchObject({ revoked_at: null });
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(false);   // Path B, target only
    void r2;
  });

  it('F2, order A, step 4 (c): R2\'s keep_closed closes the number hold\'s TARGET too, so the phone stays closed after both decisions', async () => {
    const { r1, r2 } = await stopThenOperator();
    await decide(r1.reviewId, ['email', 'phone']);
    expect(await decide(r2.reviewId, [])).toMatchObject({ ok: true, decision: 'keep_closed' });
    expect(gov().some((g) => g.source === OPT_OUT_REVIEW_SOURCE && g.channel === 'phone' && g.target_normalized === '+447700900123' && g.revoked_at == null)).toBe(true);
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(false);
  });

  it('F2, order A, then R2 REOPENS the phone: the number hold R1 adopted (decided) is inherited and released by R2; whatsapp stays closed by the STOP', async () => {
    const { r1, r2 } = await stopThenOperator();
    await decide(r1.reviewId, ['email', 'phone']);
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(false);
    const d = await decide(r2.reviewId, ['email', 'phone', 'whatsapp']);
    expect(d).toMatchObject({ ok: true });
    expect((d as { revokedIds: string[] }).revokedIds).toContain(r1.holdIds[0]);
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(true);
    expect(await allowed(ORG, 'whatsapp', { target: PERSON_PHONE })).toBe(false);
  });

  it('a pre-existing hold NO review adopted (W1-C) is never inherited', async () => {
    const w1c = await recordContactGovernance({ organizationId: ORG, governanceType: 'unsubscribe', channel: '*', target: '+447700900123', source: 'manual' });
    const r = await operatorOptOut();
    await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    expect(gov().find((g) => g.id === w1c.id)).toMatchObject({ revoked_at: null });
  });

  it('F2, order B: operator opt_out first, then the STOP; deciding R1 leaves R2\'s number hold alone; deciding R2 then reopens per its admin', async () => {
    const r2 = await operatorOptOut('run-f2:b');
    const r1 = await whatsappStop('wamid.f2b');
    const numberHold = r2.holdIds[2];
    expect(reviews()[1]).toMatchObject({ adopted_hold_ids: [], pre_existing_hold_ids: [numberHold] });
    expect(await decide(r1.reviewId, ['email', 'phone'])).toMatchObject({ ok: true, revokedIds: [] });
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(false);
    expect(await decide(r2.reviewId, ['email', 'phone'])).toMatchObject({ ok: true });
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(true);
    expect(await allowed(ORG, 'whatsapp', { target: PERSON_PHONE })).toBe(false);   // the STOP record stands
  });

  it('F1: a join lands between the decision\'s claim and its revoke; the decision loses, and R stays pending with a LIVE hold on every channel', async () => {
    const r = await operatorOptOut('run-f1:a');
    const real = governanceWriter.revokeContactGovernance;
    let joined: unknown = null;
    jest.spyOn(governanceWriter, 'revokeContactGovernance').mockImplementation(async (i) => {
      if (joined === null) joined = await operatorOptOut('run-f1:b');      // H is already_present: it joins R
      return real(i);
    });
    const d = await decide(r.reviewId, ['email', 'phone', 'whatsapp']);
    expect(joined).toMatchObject({ outcome: 'joined', reviewId: r.reviewId });
    expect(d).toMatchObject({ ok: false, code: 'decision_race_lost' });
    expect(reviews()[0].state).toBe('pending');
    expect(await openChannels()).toEqual([]);
    const live = gov().filter((g) => (reviews()[0].adopted_hold_ids as string[]).includes(String(g.id)) && g.revoked_at == null);
    expect(live.map((g) => g.person_id ?? g.target_normalized).sort()).toEqual([PERSON, '+447700900123', 'ana@example.test'].sort());
    expect(live.every((g) => g.source === 'optout_review:reply_opt_out' && (g.evidence as Row).source_ref === 'run-f1:a')).toBe(true);
  });

  it('ORDER (Outreach condition): the reconcile scan of pending reviews runs AFTER every revoke has committed', async () => {
    const r = await operatorOptOut();
    expect((await decide(r.reviewId, ['email', 'phone', 'whatsapp'])).ok).toBe(true);
    const revokes = mockDb.log.map((l, i) => [l, i] as const).filter(([l]) => l === 'contact_governance_records:update:organization_id,id').map(([, i]) => i);
    const scans = mockDb.log.map((l, i) => [l, i] as const).filter(([l]) => l === 'contact_opt_out_reviews:select:organization_id,state').map(([, i]) => i);
    expect(revokes.length).toBe(3);
    expect(scans.length).toBe(3);                                           // pending (a) and decided before the revokes; the reconcile scan after
    expect(Math.max(...scans)).toBeGreaterThan(Math.max(...revokes));
  });

  it('a lost decision\'s closes stay the review\'s own: the retry records them, and a later reopen can revoke them', async () => {
    const r = await operatorOptOut();
    jest.spyOn(governanceWriter, 'revokeContactGovernance').mockImplementationOnce(async () => {
      reviews()[0].revision = Number(reviews()[0].revision) + 1;            // the row moves: the final CAS loses
      return { revoked: false };
    });
    expect(await decide(r.reviewId, [])).toMatchObject({ ok: false, code: 'decision_race_lost' });
    jest.restoreAllMocks();
    expect(await decide(r.reviewId, [])).toMatchObject({ ok: true });
    expect((reviews()[0].closing_record_ids as string[]).length).toBe(6);  // person ×3, number ×2, address ×1, written by the LOST attempt
    expect(await decide(r.reviewId, ['email', 'phone', 'whatsapp'], 'reopen after all')).toMatchObject({ ok: true });
    expect(await openChannels()).toEqual(ALL_OPEN);
  });

  it('m1: the reconcile cannot reinstate a hold → reconcile_incomplete (not "nothing reopened"); a retry of the decision heals it with a LIVE hold', async () => {
    const r1 = await whatsappStop('wamid.m1');
    const h1 = r1.holdIds[0];
    const realRevoke = governanceWriter.revokeContactGovernance;
    let r2: { reviewId: string } | null = null;
    jest.spyOn(governanceWriter, 'revokeContactGovernance').mockImplementation(async (i) => {
      if (r2 === null) r2 = await operatorOptOut('run-m1:a');              // finds H1 present AFTER the decision's (a) read
      return realRevoke(i);
    });
    const realRecord = governanceWriter.recordContactGovernance;
    let failed = false;
    jest.spyOn(governanceWriter, 'recordContactGovernance').mockImplementation(async (i) => {
      if (!failed && (i.evidence as Row | undefined)?.reinstated_from) { failed = true; throw Object.assign(new Error('write refused'), { code: '57014' }); }
      return realRecord(i);
    });
    const first = await decide(r1.reviewId, ['email', 'phone']);
    expect(first).toMatchObject({ ok: false, code: 'reconcile_incomplete', applied: { reviewId: r1.reviewId, recorded: true, revokedIds: [h1] } });
    expect((first as { reason: string }).reason).not.toMatch(/nothing was reopened/);
    expect(gov().find((g) => g.id === h1)).toMatchObject({ revoked_at: expect.any(String) });
    jest.restoreAllMocks();
    const retry = await decide(r1.reviewId, ['email', 'phone']);
    expect(retry).toMatchObject({ ok: true });
    const fresh = (retry as { reinstatedHoldIds: string[] }).reinstatedHoldIds;
    expect(fresh).toHaveLength(1);
    expect(gov().find((g) => g.id === fresh[0])).toMatchObject({ channel: '*', target_normalized: '+447700900123', revoked_at: null, source: 'optout_review:whatsapp_stop' });
    expect(reviews().find((x) => x.id === r2!.reviewId)!.adopted_hold_ids).toContain(fresh[0]);
    expect(await allowed(ORG, 'phone', { target: PERSON_PHONE })).toBe(false);   // R2 is pending: the number is held again
  });

  it('F3: findOptOutReviewBySourceRef finds a decided, a pending or no review, tenant first; pending wins over decided', async () => {
    const first = await operatorOptOut('ref-1');
    expect(await findOptOutReviewBySourceRef({ organizationId: ORG, sourceRef: 'ref-1' })).toMatchObject({ id: first.reviewId, state: 'pending' });
    await decide(first.reviewId, []);
    expect(await findOptOutReviewBySourceRef({ organizationId: ORG, sourceRef: 'ref-1' })).toMatchObject({ id: first.reviewId, state: 'decided' });
    expect(await findOptOutReviewBySourceRef({ organizationId: ORG, sourceRef: 'ref-none' })).toBeNull();
    expect(await findOptOutReviewBySourceRef({ organizationId: ORG_B, sourceRef: 'ref-1' })).toBeNull();
    // The same ref on a newer pending review: pending is preferred.
    const again = await operatorOptOut('ref-1');
    expect(again.outcome).toBe('opened');
    expect(await findOptOutReviewBySourceRef({ organizationId: ORG, sourceRef: 'ref-1' })).toMatchObject({ id: again.reviewId, state: 'pending' });
  });
});

describe('due date (rule 4): 3 working days, Mon–Fri, the company timezone', () => {
  const due = (at: string, zone: string | null) => optOutReviewDueAt(at, zone);
  it('Fri gives Wed; Mon gives Thu; at the same local time', () => {
    expect(due('2026-11-06T10:00:00.000Z', 'UTC')).toEqual({ dueAt: '2026-11-11T10:00:00.000Z', timezone: 'UTC', fallback: false });
    expect(due('2026-11-09T10:00:00.000Z', 'UTC').dueAt).toBe('2026-11-12T10:00:00.000Z');
  });
  it('a Saturday or a Sunday start counts Mon, Tue, Wed', () => {
    expect(due('2026-11-07T08:30:00.000Z', 'UTC').dueAt).toBe('2026-11-11T08:30:00.000Z');
    expect(due('2026-11-08T23:59:00.000Z', 'UTC').dueAt).toBe('2026-11-11T23:59:00.000Z');
  });
  it('the company zone decides the day: Friday 23:30 UTC is Saturday morning in Kolkata', () => {
    // UTC: Fri → Wed 23:30Z. Asia/Kolkata (+05:30): Sat 05:00 → Wed 05:00 IST = Tue 23:30Z.
    expect(due('2026-11-06T23:30:00.000Z', 'UTC').dueAt).toBe('2026-11-11T23:30:00.000Z');
    expect(due('2026-11-06T23:30:00.000Z', 'Asia/Kolkata')).toEqual({ dueAt: '2026-11-10T23:30:00.000Z', timezone: 'Asia/Kolkata', fallback: false });
    // America/Los_Angeles (-08:00): Mon 2026-11-09 06:00Z is Sun 22:00 local → Wed 22:00 local = Thu 06:00Z.
    expect(due('2026-11-09T06:00:00.000Z', 'America/Los_Angeles').dueAt).toBe('2026-11-12T06:00:00.000Z');
  });
  it('across a DST change the local wall time is kept', () => {
    // Europe/London leaves BST on Sun 2026-10-25: Fri 23 Oct 09:00 BST (08:00Z) → Wed 28 Oct 09:00 GMT (09:00Z).
    expect(due('2026-10-23T08:00:00.000Z', 'Europe/London').dueAt).toBe('2026-10-28T09:00:00.000Z');
  });
  it('no timezone, or an unusable one, counts in UTC and says so', () => {
    expect(due('2026-11-06T10:00:00.000Z', null)).toEqual({ dueAt: '2026-11-11T10:00:00.000Z', timezone: 'UTC', fallback: true });
    expect(due('2026-11-06T10:00:00.000Z', 'Mars/Olympus').fallback).toBe(true);
  });
  it('the review stores the company zone, or the flagged fallback', async () => {
    (mockDb.tables.company_scheduler_prefs = [{ company_id: ORG, timezone: 'Asia/Kolkata' }]);
    const r = await operatorOptOut();
    expect(reviews()[0]).toMatchObject({ due_timezone: 'Asia/Kolkata', due_timezone_fallback: false, due_at: r.dueAt });
    mockDb.tables.company_scheduler_prefs = [];
    await whatsappStop();
    expect(reviews()[1]).toMatchObject({ due_timezone: 'UTC', due_timezone_fallback: true });
  });
});
