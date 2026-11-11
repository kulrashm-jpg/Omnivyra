/**
 * G-11 — a prospect CLOSED FOR NEW JOURNEYS by its company's admin. THE writer of
 * `contact_enrolment_closures` (20270127000004) and the reader enrolment asks.
 *
 * Owner ruling (2026-11-07), verbatim: "new journey gets closed while prospect is closed and once
 * it is opened by admin it will be open for new journeys. only copany admin can close or reopen
 * the prospect"; and on closing without an opt-out: "Also a manual close". PI ruled (option A)
 * that this lives on the Orchestration side: PI's terminal closed_disqualified is NOT used or made
 * reversible (its terminality underpins the Prompt 5 key-change certification), so P-1's terminal
 * closure for an opt-out is withdrawn, and no PI file changes.
 *
 * TWO GATES, both reported to enrolment as `contact_closed_by_admin`:
 *
 *   REVIEW-DERIVED (no write of its own). A prospect is closed while an opt-out review in its
 *   tenant that TOUCHES it is PENDING, or DECIDED with decision `keep_closed` (its latest
 *   decision: a re-decision overwrites it). A review touches the prospect when it is anchored on
 *   the prospect's person, or on a target equal to the prospect's canonical email (an email
 *   anchor) or canonical phone (a phone or whatsapp anchor), canonicalised with the SAME
 *   normalizers the review anchors use. A MERGED review is followed to the review it was merged
 *   into (merged_into), which carries the state. A reopen decision (any channel reopened) opens
 *   it. Reading the review state directly means an opt-out cannot half-land: there is no second
 *   write to miss.
 *
 *   MANUAL. An active row in contact_enrolment_closures (reopened_at IS NULL), written and
 *   reopened only by a company admin through /api/contact-enrolment-closures. A reopen clears the
 *   MANUAL gate only; while a review still holds, the reopen is refused (`closed_by_optout_review`)
 *   — a review is reopened only by deciding it.
 *
 * Only NEW journeys are gated: runs already active are not touched by a close (owner: "new
 * journey gets closed"). Their sends stay governed by the holds the review wrote.
 *
 * ERASURE (PI item 1, verified): after a person is erased the prospect has no person, so neither
 * arm can link it to an address. That gap is UNREACHABLE for sending: every journey send path
 * needs a canonical person — the bridge refuses `person_unresolved` before it writes
 * (outreachBridgeStore), email resolves only unified_persons.primary_email of that person
 * (resolveEmailRecipient), WhatsApp only its primary_phone, and community and WS-3 refuse
 * `person_unresolved`. Nothing in a journey reads lead_intelligence.identity, canonical_users or
 * contacts for a recipient. A realschema test erases the person and shows no send.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';

export const CLOSURES_TABLE = 'contact_enrolment_closures';
const REVIEWS_TABLE = 'contact_opt_out_reviews';

/** The enrolment exclusion reasons (beside PI's `prospect_lifecycle_closed`). */
export const CONTACT_CLOSED_BY_ADMIN = 'contact_closed_by_admin';
export const CONTACT_CLOSURE_UNREADABLE = 'contact_closure_unreadable';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;
const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

export type ClosureState =
  | { closed: false }
  | { closed: true; gate: 'optout_review'; reviewId: string }
  | { closed: true; gate: 'manual'; closureId: string };

export type ClosureRead = { ok: true; state: ClosureState; reviewHold: string | null; manualHold: string | null } | { ok: false; error: string };

interface ReviewRow { id: string; organizationId: string; anchorKind: string; anchorChannel: string | null; anchorValue: string; personId: string | null; state: string; decision: string | null; mergedInto: string | null }

const REVIEW_COLUMNS = 'id, organization_id, anchor_kind, anchor_channel, anchor_value, person_id, state, decision, merged_into';
const toReview = (r: Record<string, unknown>): ReviewRow => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  anchorKind: String(r.anchor_kind),
  anchorChannel: r.anchor_channel == null ? null : String(r.anchor_channel),
  anchorValue: String(r.anchor_value),
  personId: r.person_id == null ? null : String(r.person_id),
  state: String(r.state),
  decision: r.decision == null ? null : String(r.decision),
  mergedInto: r.merged_into == null ? null : String(r.merged_into),
});

/** Pending, or decided keep_closed, holds the prospect closed. */
const holds = (r: ReviewRow): boolean => r.state === 'pending' || (r.state === 'decided' && r.decision === 'keep_closed');

async function readRows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Array<Record<string, unknown>>> {
  const res = await q;
  if (res.error) throw Object.assign(new Error('closure state unreadable'), { code: errCode(res.error) ?? 'unreadable' });
  return Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
}

/**
 * The review that holds this prospect closed, or null. Tenant first; every row is re-checked in
 * code (tenant, anchor) so a broader read can never close or open the wrong prospect.
 */
async function reviewHold(organizationId: string, personId: string | null, email: string | null, phone: string | null): Promise<string | null> {
  const canonEmail = normalizeGovernanceTarget('email', email);
  const canonPhone = normalizeGovernanceTarget('phone', phone);
  const found: ReviewRow[] = [];
  if (personId) {
    found.push(...(await readRows(ownedDbTable(REVIEWS_TABLE).select(REVIEW_COLUMNS)
      .eq('organization_id', organizationId).eq('anchor_kind', 'person').eq('person_id', personId))).map(toReview));
  }
  const targets = [canonEmail, canonPhone].filter((v): v is string => v !== null);
  if (targets.length) {
    found.push(...(await readRows(ownedDbTable(REVIEWS_TABLE).select(REVIEW_COLUMNS)
      .eq('organization_id', organizationId).eq('anchor_kind', 'target').in('anchor_value', targets))).map(toReview));
  }
  const touches = (r: ReviewRow): boolean => r.organizationId === organizationId && (
    (r.anchorKind === 'person' && personId !== null && r.personId === personId)
    || (r.anchorKind === 'target' && ((r.anchorChannel === 'email' && r.anchorValue === canonEmail)
      || ((r.anchorChannel === 'phone' || r.anchorChannel === 'whatsapp') && r.anchorValue === canonPhone))));
  const touching = found.filter(touches);

  // A merged review carries no state of its own: follow it to the review it was merged into.
  const byId = new Map(touching.map((r) => [r.id, r]));
  let frontier = touching.filter((r) => r.state === 'merged' && r.mergedInto && !byId.has(r.mergedInto)).map((r) => r.mergedInto as string);
  for (let depth = 0; frontier.length && depth < 5; depth += 1) {
    const next = (await readRows(ownedDbTable(REVIEWS_TABLE).select(REVIEW_COLUMNS)
      .eq('organization_id', organizationId).in('id', frontier))).map(toReview).filter((r) => r.organizationId === organizationId);
    for (const r of next) byId.set(r.id, r);
    frontier = next.filter((r) => r.state === 'merged' && r.mergedInto && !byId.has(r.mergedInto)).map((r) => r.mergedInto as string);
  }
  const effective = (r: ReviewRow): ReviewRow | null => {
    let cur: ReviewRow | undefined = r;
    for (let depth = 0; cur && cur.state === 'merged' && depth < 6; depth += 1) cur = cur.mergedInto ? byId.get(cur.mergedInto) : undefined;
    return cur && cur.state !== 'merged' ? cur : null;
  };
  for (const r of touching) {
    const e = effective(r);
    if (e && holds(e)) return e.id;
  }
  return null;
}

/** The ACTIVE manual closure of this prospect, or null. */
async function manualHold(organizationId: string, prospectId: string): Promise<string | null> {
  const rows = await readRows(ownedDbTable(CLOSURES_TABLE).select('id, organization_id, prospect_id, reopened_at')
    .eq('organization_id', organizationId).eq('prospect_id', prospectId).is('reopened_at', null));
  const active = rows.find((r) => String(r.organization_id) === organizationId && String(r.prospect_id) === prospectId && r.reopened_at == null);
  return active ? String(active.id) : null;
}

/**
 * Is this prospect closed to new journeys? Never throws: an unreadable state is `ok: false`, and
 * the caller FAILS CLOSED on it.
 */
export async function readContactEnrolmentClosure(input: {
  organizationId: string; prospectId: string; personId: string | null; email: string | null; phone: string | null;
}): Promise<ClosureRead> {
  try {
    const review = await reviewHold(input.organizationId, input.personId, input.email, input.phone);
    const manual = await manualHold(input.organizationId, input.prospectId);
    const state: ClosureState = review !== null ? { closed: true, gate: 'optout_review', reviewId: review }
      : manual !== null ? { closed: true, gate: 'manual', closureId: manual } : { closed: false };
    return { ok: true, state, reviewHold: review, manualHold: manual };
  } catch (e) {
    return { ok: false, error: errCode(e) ?? (e instanceof Error ? e.message : 'unreadable') };
  }
}

// ── the manual gate: close and reopen (the route checks the admin and audits) ─────

export interface EnrolmentClosure {
  id: string; prospectId: string; closedBy: string; closedAt: string; closeReason: string;
  reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null;
}
const CLOSURE_COLUMNS = 'id, organization_id, prospect_id, closed_by, closed_at, close_reason, reopened_by, reopened_at, reopen_reason';
const iso = (v: unknown): string => new Date(String(v)).toISOString();
const toClosure = (r: Record<string, unknown>): EnrolmentClosure => ({
  id: String(r.id), prospectId: String(r.prospect_id), closedBy: String(r.closed_by), closedAt: iso(r.closed_at), closeReason: String(r.close_reason),
  reopenedBy: r.reopened_by == null ? null : String(r.reopened_by), reopenedAt: r.reopened_at == null ? null : iso(r.reopened_at),
  reopenReason: r.reopen_reason == null ? null : String(r.reopen_reason),
});

export type ClosureRefusal = 'invalid_prospect' | 'reason_required' | 'actor_required' | 'prospect_not_found' | 'already_closed'
  | 'not_closed' | 'closed_by_optout_review' | 'closure_unavailable';
export type ClosureOutcome<T> = { ok: true; value: T } | { ok: false; code: ClosureRefusal; reason: string; reviewId?: string };
const no = <T>(code: ClosureRefusal, reason: string, reviewId?: string): ClosureOutcome<T> =>
  (reviewId ? { ok: false, code, reason, reviewId } : { ok: false, code, reason });

function validate(input: { prospectId: unknown; reason: unknown; actorUserId: unknown }): ClosureOutcome<{ prospectId: string; reason: string; actor: string }> {
  const prospectId = typeof input.prospectId === 'string' ? input.prospectId.trim() : '';
  if (!UUID.test(prospectId)) return no('invalid_prospect', 'prospectId is a prospect id');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '' || reason.length > REASON_MAX) return no('reason_required', `a reason of 1 to ${REASON_MAX} characters is required`);
  const actor = typeof input.actorUserId === 'string' ? input.actorUserId.trim() : '';
  if (!UUID.test(actor)) return no('actor_required', 'only an authenticated admin closes or reopens a prospect');
  return { ok: true, value: { prospectId, reason, actor } };
}

/** A prospect's closure history, newest first. */
export async function listEnrolmentClosures(organizationId: string, prospectId: string): Promise<ClosureOutcome<EnrolmentClosure[]>> {
  const res = await ownedDbTable(CLOSURES_TABLE).select(CLOSURE_COLUMNS)
    .eq('organization_id', organizationId).eq('prospect_id', prospectId).order('closed_at', { ascending: false });
  if (res.error) return no('closure_unavailable', 'the closures could not be read');
  return { ok: true, value: ((res.data ?? []) as unknown as Array<Record<string, unknown>>)
    .filter((r) => String(r.organization_id) === organizationId).map(toClosure) };
}

/** Close a prospect to new journeys. One active closure per prospect (409 `already_closed`). */
export async function closeProspectToJourneys(input: { organizationId: string; prospectId: unknown; reason: unknown; actorUserId: unknown }): Promise<ClosureOutcome<EnrolmentClosure>> {
  const v = validate(input);
  if (v.ok !== true) return v;
  const res = await ownedDbTable(CLOSURES_TABLE)
    .insert({ organization_id: input.organizationId, prospect_id: v.value.prospectId, closed_by: v.value.actor, close_reason: v.value.reason })
    .select(CLOSURE_COLUMNS).single();
  if (res.error) {
    if (errCode(res.error) === '23505') return no('already_closed', 'this prospect is already closed to new journeys');
    if (errCode(res.error) === '23503') return no('prospect_not_found', 'no such prospect in this company');
    return no('closure_unavailable', `the closure could not be recorded (${errCode(res.error) ?? 'error'})`);
  }
  return { ok: true, value: toClosure(res.data as unknown as Record<string, unknown>) };
}

/**
 * Reopen the MANUAL closure. Refused, changing nothing, while an opt-out review still holds the
 * prospect (409 `closed_by_optout_review`, with the review): a review is reopened only by
 * deciding it, so a reopen here would not open the prospect.
 */
export async function reopenProspectToJourneys(input: {
  organizationId: string; prospectId: unknown; reason: unknown; actorUserId: unknown; personId: string | null; email: string | null; phone: string | null;
}): Promise<ClosureOutcome<EnrolmentClosure>> {
  const v = validate(input);
  if (v.ok !== true) return v;
  const state = await readContactEnrolmentClosure({ organizationId: input.organizationId, prospectId: v.value.prospectId, personId: input.personId, email: input.email, phone: input.phone });
  if (state.ok !== true) return no('closure_unavailable', 'the closure state could not be read');
  if (state.reviewHold !== null) {
    return no('closed_by_optout_review', 'an opt-out review still holds this prospect; decide the review to reopen it', state.reviewHold);
  }
  if (state.manualHold === null) return no('not_closed', 'this prospect has no active manual closure');
  // reopened_at is NOT sent: the guard trigger (20270129000003) stamps it from the database clock,
  // the clock closed_at came from. An app-clock stamp lost to the CHECK reopened_at >= closed_at
  // whenever the app clock ran behind the database (a refused reopen, 503).
  const res = await ownedDbTable(CLOSURES_TABLE)
    .update({ reopened_by: v.value.actor, reopen_reason: v.value.reason })
    .eq('organization_id', input.organizationId).eq('id', state.manualHold).is('reopened_at', null)
    .select(CLOSURE_COLUMNS);
  if (res.error) return no('closure_unavailable', `the reopen could not be recorded (${errCode(res.error) ?? 'error'})`);
  const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (rows.length !== 1) return no('not_closed', 'the closure was reopened meanwhile');
  return { ok: true, value: toClosure(rows[0]) };
}
