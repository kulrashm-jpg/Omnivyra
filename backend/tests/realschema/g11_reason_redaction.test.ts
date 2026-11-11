/**
 * G-11 — "Wipe it" (owner, 2026-11-07): when a person is erased, the free-text `reason` on their
 * DECIDED opt-out reviews becomes '[redacted: subject erased]', written by
 * contact_opt_out_reviews_guard() in the same FK SET NULL that writes the 'erased:<review id>'
 * tombstone (20270127000006). On REAL PostgreSQL.
 *
 * Covered: a decided person review is redacted (audit fields and the tombstone intact); a pending
 * review's reason stays NULL; a merged row is unaffected; a decided TARGET review keeps its reason
 * (the stated limit); the decision_complete CHECK holds; no person review keeps the typed text; two
 * people erased in one tenant are each redacted with their own tombstone.
 */

import { db, inRollback, seedTenants, attempt, newPerson, ORG_A } from './setup';
import { newUser, one, rows } from './helpers/journeyFixtures';

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
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/orchestration/optOutReview');
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
const { loadGovernanceRecords, normalizeGovernanceTarget } = require('../../services/prospectIdentity/contactGovernanceRepository');
const { mayContact } = require('../../services/prospectIdentity/contactGovernance');
/* eslint-enable @typescript-eslint/no-var-requires */

const PLACEHOLDER = '[redacted: subject erased]';
const EMAIL = 'ana@example.test';
const PHONE = '+44 7700 900123';
const CANON = '+447700900123';
const TYPED = 'Ana Smith rang to say stop: zebra-quokka-7731';

const review = (id: string) => one('SELECT * FROM public.contact_opt_out_reviews WHERE id = $1', [id]);
async function optOut(person: string, ref: string, email: string | null = EMAIL) {
  const holdIds = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: person, email, holdSource: 'optout_review:reply_opt_out', sourceRef: ref });
  return (await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: person }, trigger: 'reply_opt_out', holdIds, sourceRef: ref, holdSource: 'optout_review:reply_opt_out' })).reviewId as string;
}
const decide = (reviewId: string, actor: string, reopenChannels: string[], reason = TYPED) =>
  svc.decideOptOutReview({ organizationId: ORG_A, reviewId, actorUserId: actor, reopenChannels, reason });
/** What personErasure does to governance before the delete, then the delete (the FK's SET NULL fires the guard). */
async function erase(person: string) {
  await db.query(`UPDATE public.contact_governance_records SET revoked_at = now(), revoked_reason = 'erasure (test)' WHERE person_id = $1 AND revoked_at IS NULL`, [person]);
  await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);
}
/**
 * The erasure, in its own savepoint, reporting 'ok' or the raised error as `<SQLSTATE>:<constraint>`.
 * A redaction that left a decided row with a NULL or blank reason would be refused HERE, by
 * contact_opt_out_reviews_decision_complete (23514), so the person delete itself would fail.
 */
async function eraseOutcome(person: string): Promise<string> {
  await db.query('SAVEPOINT rr_erase');
  try {
    await erase(person);
    await db.query('RELEASE SAVEPOINT rr_erase');
    return 'ok';
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT rr_erase');
    const err = e as { code?: string; constraint?: string };
    return `${err.code ?? '?'}:${err.constraint ?? '?'}`;
  }
}
const anyReviewHas =async (needle: string) => Number((await one(
  `SELECT count(*)::int n FROM public.contact_opt_out_reviews r WHERE position($1 IN row_to_json(r)::text) > 0`, [needle])).n);

describe('"Wipe it": a DECIDED person review\'s reason is redacted with the person (20270127000006)', () => {
  it('a decided person review gets the placeholder; decided_by, decided_at, decision and channels unchanged; the tombstone is set', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const person = await newPerson(ORG_A);
    const id = await optOut(person, 'run-rr:1');
    expect(await decide(id, actor, ['phone'])).toMatchObject({ ok: true });
    const before = await review(id);
    expect(before.reason).toBe(TYPED);
    expect(await eraseOutcome(person)).toBe('ok');
    const after = await review(id);
    expect(after).toMatchObject({
      state: 'decided', reason: PLACEHOLDER, anchor_kind: 'person', anchor_value: `erased:${id}`, person_id: null,
      decision: before.decision, decided_by: before.decided_by, reopened_channels: before.reopened_channels, closed_channels: before.closed_channels,
    });
    expect((after.decided_at as Date).getTime()).toBe((before.decided_at as Date).getTime());
    // The placeholder keeps the decided row inside decision_complete: non-null and non-blank.
    expect(typeof after.reason).toBe('string');
    expect(String(after.reason).trim().length).toBeGreaterThan(0);
    expect(await anyReviewHas('zebra-quokka-7731')).toBe(0);
    expect(await anyReviewHas(person)).toBe(0);
  }), 120_000);

  it('a PENDING person review keeps reason NULL (by CHECK); a MERGED row is unaffected', () => inRollback(async () => {
    await seedTenants();
    const pendingPerson = await newPerson(ORG_A);
    const pending = await optOut(pendingPerson, 'run-rr:2');
    // A merged row: the same unsubscribe event seen as a target review, then as the person's review.
    const mergedPerson = await newPerson(ORG_A);
    const th = await svc.writeOptOutHolds({ organizationId: ORG_A, email: 'm@example.test', holdSource: 'optout_review:email_unsubscribe', sourceRef: 'attempt:rr' });
    const t = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'target', channel: 'email', target: 'm@example.test' }, trigger: 'email_unsubscribe', holdIds: th, sourceRef: 'attempt:rr', holdSource: 'optout_review:email_unsubscribe' });
    const rh = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: mergedPerson, email: 'm@example.test', holdSource: 'optout_review:email_unsubscribe', sourceRef: 'attempt:rr' });
    const r = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: mergedPerson }, trigger: 'email_unsubscribe', holdIds: rh, sourceRef: 'attempt:rr', holdSource: 'optout_review:email_unsubscribe' });
    await db.query(`SELECT * FROM public.g11_reanchor_pending_opt_out_reviews($1, $2, $3::jsonb)`, [ORG_A, mergedPerson, JSON.stringify([{ channel: 'email', value: 'm@example.test' }])]);
    expect(await review(r.reviewId)).toMatchObject({ state: 'merged', merged_into: t.reviewId, reason: null });
    await erase(pendingPerson);
    await erase(mergedPerson);
    expect(await review(pending)).toMatchObject({ state: 'pending', reason: null, anchor_value: `erased:${pending}` });
    expect(await review(r.reviewId)).toMatchObject({ state: 'merged', reason: null, anchor_value: `erased:${r.reviewId}`, merged_into: t.reviewId });
  }), 120_000);

  it('the LIMIT: a decided TARGET-anchored review keeps its reason when the person behind the number is erased', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const { rows: [p] } = await db.query(`INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1, $2) RETURNING id`, [ORG_A, PHONE]);
    const trigger = await recordContactGovernance({ organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'whatsapp', target: PHONE, source: 'webhook:whatsapp' });
    const holdIds = await svc.writeOptOutHolds({ organizationId: ORG_A, phone: PHONE, holdSource: 'optout_review:whatsapp_stop', sourceRef: 'wamid.rr' });
    const t = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'target', channel: 'whatsapp', target: CANON }, trigger: 'whatsapp_stop', holdIds, triggerRecordId: trigger.id, sourceRef: 'wamid.rr', holdSource: 'optout_review:whatsapp_stop' });
    expect(await decide(t.reviewId, actor, ['email'])).toMatchObject({ ok: true });
    await erase(String(p.id));
    expect(await review(t.reviewId)).toMatchObject({ anchor_kind: 'target', anchor_value: CANON, reason: TYPED });
    // The kept prose is the stated limit; the erased person's KEY is in no review row.
    expect(await anyReviewHas(String(p.id))).toBe(0);
  }), 120_000);

  it('the decision_complete CHECK still holds: a decided row cannot be given a blank reason, and every redacted row satisfies it', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const person = await newPerson(ORG_A);
    const id = await optOut(person, 'run-rr:4');
    await decide(id, actor, []);
    await erase(person);
    expect(await attempt(`UPDATE public.contact_opt_out_reviews SET reason = '  ' WHERE id = $1`, [id])).toBe('23514');
    expect(await one(`SELECT count(*)::int n FROM public.contact_opt_out_reviews
      WHERE state = 'decided' AND (reason IS NULL OR length(btrim(reason)) = 0)`)).toEqual({ n: 0 });
  }), 120_000);

  it('two people erased in one tenant: both decided reviews are redacted, each with its own tombstone', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const [a, b] = [await newPerson(ORG_A), await newPerson(ORG_A)];
    const ra = await optOut(a, 'run-rr:a', 'a@example.test');
    const rb = await optOut(b, 'run-rr:b', 'b@example.test');
    await decide(ra, actor, [], `${TYPED} (A)`);
    await decide(rb, actor, ['email'], `${TYPED} (B)`);
    await erase(a);
    await erase(b);
    const both = await rows(`SELECT id, reason, anchor_value FROM public.contact_opt_out_reviews WHERE id = ANY($1::uuid[]) ORDER BY anchor_value`, [[ra, rb]]);
    expect(both.map((x) => x.reason)).toEqual([PLACEHOLDER, PLACEHOLDER]);
    expect(both.map((x) => x.anchor_value).sort()).toEqual([`erased:${ra}`, `erased:${rb}`].sort());
    expect(await anyReviewHas('zebra-quokka-7731')).toBe(0);
  }), 120_000);

  it('the branch is keyed on the TRANSITION: a later update of a redacted row does not re-fire it', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const person = await newPerson(ORG_A);
    const id = await optOut(person, 'run-rr:6');
    await decide(id, actor, []);
    await erase(person);
    // A later re-decision (rule 6) writes a new reason; the guard must not overwrite it.
    expect(await decide(id, actor, ['email'], 'second look, after erasure')).toMatchObject({ ok: true });
    expect((await review(id)).reason).toBe('second look, after erasure');
  }), 120_000);
});

// Outreach item (c): the wipe removes the TEXT only. The contact restriction it records survives the
// erasure, and nothing else on the review row changes.
describe('"Wipe it" changes nothing but the text: restrictions still refuse, the rest of the row is unchanged', () => {
  /** The verdict every send path's gate reaches for a canonical target with no person (the person is gone). */
  async function refused(channel: 'email' | 'phone' | 'whatsapp', target: string): Promise<boolean> {
    const loaded = await loadGovernanceRecords({ organizationId: ORG_A, personId: null, target, channel });
    expect(loaded.ok).toBe(true);
    return mayContact({ organizationId: ORG_A, personId: null, targetNormalized: normalizeGovernanceTarget(channel, target), channel,
      now: new Date().toISOString(), records: loaded.records }).decision !== 'allowed';
  }
  /** PI's erasure order: the re-anchor call (as service_role), then the person-hold revoke, then the delete. */
  async function eraseWithReanchor(person: string, targets: Array<{ channel: string; value: string }>) {
    await db.query('SAVEPOINT rr_reanchor');
    await db.query('SET LOCAL ROLE service_role');
    await db.query(`SELECT * FROM public.g11_reanchor_pending_opt_out_reviews($1, $2, $3::jsonb)`, [ORG_A, person, JSON.stringify(targets)]);
    await db.query('RESET ROLE');
    await db.query('RELEASE SAVEPOINT rr_reanchor');
    await erase(person);
  }

  it('after erasure, every channel the review held is still REFUSED on the canonical targets: a decided review (its closes) and a pending one (re-anchored onto the target)', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    // A DECIDED review: keep_closed wrote its closes on the person, the address and the number.
    const decided = await newPerson(ORG_A);
    const dh = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: decided, email: 'd@example.test', phone: '+44 7700 900111', holdSource: 'optout_review:reply_opt_out', sourceRef: 'run-rr:c1' });
    const d = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: decided }, trigger: 'reply_opt_out', holdIds: dh, sourceRef: 'run-rr:c1', holdSource: 'optout_review:reply_opt_out' });
    expect(await decide(d.reviewId, actor, [])).toMatchObject({ ok: true, closedChannels: ['email', 'phone', 'whatsapp'] });
    // A PENDING review: re-anchored onto the address by the erasure, its target holds kept.
    const pending = await newPerson(ORG_A);
    const ph = await svc.writeOptOutHolds({ organizationId: ORG_A, personId: pending, email: 'p@example.test', phone: '+44 7700 900222', holdSource: 'optout_review:reply_opt_out', sourceRef: 'run-rr:c2' });
    const p = await svc.openOptOutReview({ organizationId: ORG_A, anchor: { kind: 'person', personId: pending }, trigger: 'reply_opt_out', holdIds: ph, sourceRef: 'run-rr:c2', holdSource: 'optout_review:reply_opt_out' });

    await eraseWithReanchor(decided, [{ channel: 'email', value: 'd@example.test' }, { channel: 'phone', value: '+447700900111' }]);
    await eraseWithReanchor(pending, [{ channel: 'email', value: 'p@example.test' }, { channel: 'phone', value: '+447700900222' }]);

    expect(await review(d.reviewId)).toMatchObject({ state: 'decided', reason: PLACEHOLDER, anchor_value: `erased:${d.reviewId}` });
    expect(await review(p.reviewId)).toMatchObject({ state: 'pending', anchor_kind: 'target', anchor_value: 'p@example.test', person_id: null });
    for (const [address, number] of [['d@example.test', '+44 7700 900111'], ['p@example.test', '+44 7700 900222']]) {
      expect(await refused('email', address)).toBe(true);
      expect(await refused('phone', number)).toBe(true);
      expect(await refused('whatsapp', number)).toBe(true);
    }
  }), 120_000);

  it('a WHOLE-ROW comparison: every column except reason, anchor_value and person_id is unchanged by the erasure (the column list is read from information_schema)', () => inRollback(async () => {
    await seedTenants();
    const actor = await newUser();
    const person = await newPerson(ORG_A);
    const id = await optOut(person, 'run-rr:c3');
    expect(await decide(id, actor, ['phone'])).toMatchObject({ ok: true });
    const all = (await rows(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contact_opt_out_reviews' ORDER BY ordinal_position`)).map((r) => String(r.column_name));
    const changed = ['reason', 'anchor_value', 'person_id'];
    const kept = all.filter((c) => !changed.includes(c));
    // The set is non-empty and the three excluded columns exist: a renamed column fails here, not silently.
    expect(changed.every((c) => all.includes(c))).toBe(true);
    expect(kept.length).toBeGreaterThan(20);
    const select = `SELECT ${kept.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')} FROM public.contact_opt_out_reviews WHERE id = $1`;
    const before = await one(select, [id]);
    expect(await eraseOutcome(person)).toBe('ok');
    const after = await one(select, [id]);
    expect(after).toEqual(before);
    expect(await review(id)).toMatchObject({ reason: PLACEHOLDER, anchor_value: `erased:${id}`, person_id: null });
  }), 120_000);
});
