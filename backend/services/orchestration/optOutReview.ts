/**
 * G-11 — the opt-out hold and its company-admin review. THE writer of
 * `contact_opt_out_reviews` (20270127000001).
 *
 * Owner rules (2026-11-07):
 *   1. Tenant only: the hold and the decision belong to one organization.
 *   2. EVERY opt-out starts it: a WhatsApp STOP, an email unsubscribe link, or an operator's
 *      free-text `opt_out` (a reply evaluation).
 *   3. Immediate hold: from that moment ALL channels are held for that contact in that tenant,
 *      on the person and on their known address and number.
 *   4. The tenant's OWN admin (COMPANY_ADMIN in that company; never the super-admin bypass)
 *      decides whether contact is allowed again, and on which channels, within 3 WORKING days
 *      (Mon–Fri, the company's timezone).
 *   5. No decision: every medium stays closed. Closed is the default; no job runs.
 *   6. After the window an admin may still reopen.
 *   Amendment: a STOP or an unsubscribe keeps THAT channel closed for good (only the person
 *   undoes it, through the existing opt-in paths); after an operator `opt_out` any channel
 *   may be reopened.
 *
 * THE HOLD is an all-channel (`*`) `unsubscribe` in contact_governance_records, written by the
 * CALLER through the canonical writer (`recordContactGovernance`, unchanged), before the review
 * is opened. Every send path's governance gate already refuses a `*` unsubscribe, so the hold
 * is in force before this module runs; a failed open leaves the contact closed (fail-safe) and
 * a retry adopts the hold.
 *
 * ADOPTION. A review may revoke only the holds it ADOPTED: rows whose (source, source ref) is
 * the caller's (holdSource, sourceRef), `unsubscribe` on `*`, live, in the same tenant. Any
 * other id the caller names (another review's hold, a W1-C `*` unsubscribe, a `dnc_permanent`)
 * is recorded as pre-existing and never revoked.
 *
 * HOLD SOURCES CARRY A PREFIX (agreed with Outreach, 2026-11-07). Every hold source starts with
 * `optout_review:` (`optout_review:reply_opt_out`, `optout_review:whatsapp_stop`,
 * `optout_review:email_unsubscribe`); openOptOutReview and writeOptOutHolds THROW
 * `invalid_hold_source` for any other value, so a mistaken caller can never adopt (and a
 * decision never revoke) a person's own unsubscribe record. The closes a decision writes carry
 * `manual:optout_review`, which deliberately lacks the prefix: no later review can adopt them.
 *
 * WHERE THE SOURCE REF LIVES. contact_governance_records.source_record_id is a uuid with a
 * composite foreign key to source_records (LI-2 evidence rows), so a Meta message id or a
 * `${runId}:${replyKey}` cannot be stored there: the database refuses it. The ref is written
 * as `evidence.source_ref` (a summary key, permitted by the writer). Adoption accepts either
 * place, so a caller that does hold an LI-2 evidence row may still pass it as sourceRecordId.
 *
 * TARGETS ARE CANONICAL. `normalizeGovernanceTarget('*', target)` only casefolds, so a `*` hold
 * written from '+44 7700 900123' would never match a whatsapp or phone lookup. Every target
 * here goes through the channel's own normaliser first (normalizePhone / normalizeEmail).
 *
 * THE DECISION, in an order that never leaves a gap: the channels that stay closed are closed
 * explicitly FIRST (a channel-scoped `unsubscribe` on the same anchors), then the adopted holds
 * are revoked, then the review is marked decided. A failure part-way leaves more closed, never
 * less. The review row moves by compare-and-set on `revision`, so a concurrent join and a
 * decision never overwrite each other.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { ALL_CHANNELS, KNOWN_CHANNELS, type KnownChannel } from '../prospectIdentity/contactGovernance';
import { normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';
import { recordContactGovernance, revokeContactGovernance } from '../prospectIdentity/contactGovernanceWriter';
import { toPgTextArrayLiteral } from '../enrichment/attributeSet';

export const OPT_OUT_REVIEWS_TABLE = 'contact_opt_out_reviews';
const GOVERNANCE_TABLE = 'contact_governance_records';

export type OptOutTrigger = 'whatsapp_stop' | 'email_unsubscribe' | 'reply_opt_out';
export const OPT_OUT_TRIGGERS: readonly OptOutTrigger[] = ['whatsapp_stop', 'email_unsubscribe', 'reply_opt_out'];

export type OptOutAnchor =
  | { kind: 'person'; personId: string }
  | { kind: 'target'; channel: 'whatsapp' | 'phone' | 'email'; target: string };   // CANONICAL

export interface OpenOptOutReviewInput {
  organizationId: string;
  anchor: OptOutAnchor;
  trigger: OptOutTrigger;
  /** EVERY `*` hold id the caller wrote, created OR already_present. */
  holdIds: readonly string[];
  /** The channel-scoped STOP / unsubscribe row: recorded, NEVER revoked. */
  triggerRecordId?: string | null;
  /** Stable per trigger, identifier only. */
  sourceRef: string;
  /** The `source` the caller wrote its holds with. */
  holdSource: string;
  now?: string;
}

export interface OpenOptOutReviewResult { reviewId: string; outcome: 'opened' | 'joined'; dueAt: string }

/** The channel a trigger keeps closed for good. An operator `opt_out` locks none. */
export const LOCKED_BY_TRIGGER: Readonly<Record<OptOutTrigger, readonly KnownChannel[]>> = {
  whatsapp_stop: ['whatsapp'],
  email_unsubscribe: ['email'],
  reply_opt_out: [],
};

/** Every adoptable hold's source starts with this (see the header). */
export const OPT_OUT_HOLD_SOURCE_PREFIX = 'optout_review:';
/** The hold source of each trigger. */
export const OPT_OUT_HOLD_SOURCES: Readonly<Record<OptOutTrigger, string>> = {
  whatsapp_stop: 'optout_review:whatsapp_stop',
  email_unsubscribe: 'optout_review:email_unsubscribe',
  reply_opt_out: 'optout_review:reply_opt_out',
};
/** Provenance of the channel-scoped closes a decision writes. NOT prefixed: never adoptable. */
export const OPT_OUT_REVIEW_SOURCE = 'manual:optout_review';

/** Refuse a hold source without the prefix (or with nothing after it). */
function assertHoldSource(holdSource: string): void {
  if (!holdSource.startsWith(OPT_OUT_HOLD_SOURCE_PREFIX) || holdSource.length === OPT_OUT_HOLD_SOURCE_PREFIX.length) {
    fail('invalid_hold_source', `a hold source starts with '${OPT_OUT_HOLD_SOURCE_PREFIX}'; '${holdSource}' could adopt a record that is not an opt-out hold`);
  }
}
/** The evidence key a hold's source ref is written under (see the header). */
export const SOURCE_REF_EVIDENCE_KEY = 'source_ref';
/** Working days an admin has to decide (owner rule 4). */
export const REVIEW_WORKING_DAYS = 3;

export class OptOutReviewError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'OptOutReviewError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
function fail(code: string, message: string): never { throw new OptOutReviewError(message, code); }
const union = (...lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())];
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

// ── due date: 3 working days in the company's timezone ──────────────────────────────

const DAY_MS = 86_400_000;

// The same two zone helpers journeyRetiming keeps private. They are not imported from there:
// the Q-4 guard (q4FollowUpRetiming.test.ts) pins the runtime importers of journeyRetiming to the
// operator resume route and its reply evaluation, and this module is neither.
const isValidZone = (tz: string | null | undefined): tz is string => {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** The zone's offset from UTC at instant `t`, in ms (wall clock minus UTC). */
function zoneOffsetMs(zone: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(t / 1000) * 1000;
}

/** `t` as wall-clock parts in `zone`, read off the zone's offset at `t`. */
function wallParts(t: number, zone: string) {
  const d = new Date(t + zoneOffsetMs(zone, t));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), wallMsOfDay: (t + zoneOffsetMs(zone, t)) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) };
}

/**
 * The review deadline: the same local wall-clock time, `REVIEW_WORKING_DAYS` Mon–Fri days
 * after the opening, in the company's zone. Fri → Wed; Sat or Sun → Wed. With no usable zone
 * the days are counted in UTC and the fallback is flagged. Holidays are not known (OPEN).
 */
export function optOutReviewDueAt(openedAt: string, zone: string | null | undefined): { dueAt: string; timezone: string; fallback: boolean } {
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t)) fail('invalid_input', 'the opening instant is not a timestamp');
  const fallback = !isValidZone(zone);
  const z = fallback ? 'UTC' : String(zone);
  const w = wallParts(t, z);
  let day = Date.UTC(w.y, w.mo, w.day);
  for (let counted = 0; counted < REVIEW_WORKING_DAYS;) {
    day += DAY_MS;
    const weekday = new Date(day).getUTCDay();
    if (weekday >= 1 && weekday <= 5) counted += 1;
  }
  // Local wall time → instant: two passes settle the offset across a DST change.
  const wall = day + w.wallMsOfDay;
  let due = wall - zoneOffsetMs(z, wall);
  const second = wall - zoneOffsetMs(z, due);
  if (second !== due) due = second;
  return { dueAt: new Date(due).toISOString(), timezone: z, fallback };
}

/** The company's scheduling zone; unreadable or unset falls back to UTC, flagged. */
async function companyZone(organizationId: string): Promise<string | null> {
  try {
    const res = await ownedDbTable('company_scheduler_prefs').select('timezone').eq('company_id', organizationId).maybeSingle();
    if (res.error) return null;
    const zone = (res.data as { timezone?: unknown } | null)?.timezone;
    return typeof zone === 'string' && zone.trim() !== '' ? zone.trim() : null;
  } catch {
    return null;
  }
}

// ── holds ───────────────────────────────────────────────────────────────────────────

interface HoldRow {
  id: string; organizationId: string; governanceType: string; channel: string; source: string;
  sourceRecordId: string | null; sourceRef: string | null; reviewId: string | null; revokedAt: string | null;
  personId: string | null; targetNormalized: string | null;
}

const HOLD_COLUMNS = 'id, organization_id, governance_type, channel, source, source_record_id, evidence, revoked_at, person_id, target_normalized';

const toHold = (r: Record<string, unknown>): HoldRow => {
  const evidence = (r.evidence && typeof r.evidence === 'object' ? r.evidence : {}) as Record<string, unknown>;
  const ref = evidence[SOURCE_REF_EVIDENCE_KEY];
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    governanceType: String(r.governance_type),
    channel: String(r.channel),
    source: String(r.source),
    sourceRecordId: r.source_record_id == null ? null : String(r.source_record_id),
    sourceRef: typeof ref === 'string' ? ref : null,
    reviewId: typeof evidence.review_id === 'string' ? evidence.review_id : null,
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    personId: r.person_id == null ? null : String(r.person_id),
    targetNormalized: r.target_normalized == null ? null : String(r.target_normalized),
  };
};

/** Governance rows by id, in this tenant only. Throws when unreadable. */
async function readGovernanceRows(organizationId: string, ids: readonly string[]): Promise<HoldRow[]> {
  if (ids.length === 0) return [];
  const res = await ownedDbTable(GOVERNANCE_TABLE).select(HOLD_COLUMNS)
    .eq('organization_id', organizationId)            // TENANT FIRST
    .in('id', [...ids]);
  if (res.error) fail('governance_unreadable', `the holds could not be read: ${(res.error as { message?: string }).message ?? 'error'}`);
  return ((res.data ?? []) as Array<Record<string, unknown>>).map(toHold).filter((h) => h.organizationId === organizationId);
}

/** Amendment A: only the caller's own live all-channel unsubscribe is adopted. */
export function isAdoptable(h: Pick<HoldRow, 'governanceType' | 'channel' | 'source' | 'sourceRecordId' | 'sourceRef' | 'revokedAt'>, holdSource: string, sourceRef: string): boolean {
  return h.governanceType === 'unsubscribe' && h.channel === ALL_CHANNELS && h.revokedAt === null
    && h.source === holdSource && (h.sourceRef === sourceRef || h.sourceRecordId === sourceRef);
}

/**
 * Write the `*` holds for one opt-out, on the person and on the CANONICAL email and phone.
 * Input: `personId?`, `email?`, `phone?` (raw; each is normalised here with normalizeEmail /
 * normalizePhone), `holdSource` (must carry the `optout_review:` prefix), `sourceRef`, `evidence?`.
 * There is no `targets` list. Each hold is an
 * `unsubscribe`, every channel, every purpose, `source: holdSource`, the source ref in
 * evidence. Returns every id written (created or already present). Throws the writer's error
 * on the first failure; a hold already written stays (fail-safe), and a retry adopts it.
 */
export async function writeOptOutHolds(input: {
  organizationId: string;
  personId?: string | null;
  email?: string | null;
  phone?: string | null;
  holdSource: string;
  sourceRef: string;
  evidence?: Record<string, unknown>;
}): Promise<string[]> {
  assertHoldSource(text(input.holdSource));
  if (text(input.sourceRef) === '') fail('invalid_input', 'sourceRef is required');
  const evidence = { ...(input.evidence ?? {}), [SOURCE_REF_EVIDENCE_KEY]: input.sourceRef };
  const anchors: Array<{ personId?: string; target?: string }> = [];
  if (input.personId) anchors.push({ personId: input.personId });
  const email = normalizeGovernanceTarget('email', input.email);
  if (email) anchors.push({ target: email });
  const phone = normalizeGovernanceTarget('phone', input.phone);
  if (phone) anchors.push({ target: phone });
  if (anchors.length === 0) fail('anchor_required', 'an opt-out hold needs a person, an address or a number');
  const ids: string[] = [];
  for (const a of anchors) {
    const written = await recordContactGovernance({
      organizationId: input.organizationId,
      governanceType: 'unsubscribe',
      channel: ALL_CHANNELS,
      ...a,
      source: input.holdSource,
      evidence,
    });
    ids.push(written.id);
  }
  return ids;
}

// ── the review row ──────────────────────────────────────────────────────────────────

export interface OptOutReview {
  id: string;
  organizationId: string;
  anchorKind: 'person' | 'target';
  anchorChannel: string | null;
  anchorValue: string;
  personId: string | null;
  triggers: string[];
  lockedChannels: string[];
  adoptedHoldIds: string[];
  preExistingHoldIds: string[];
  triggerRecordIds: string[];
  closingRecordIds: string[];
  sourceRefs: string[];
  openedAt: string;
  dueAt: string;
  dueTimezone: string;
  dueTimezoneFallback: boolean;
  state: 'pending' | 'decided';
  decision: 'reopen' | 'keep_closed' | null;
  reopenedChannels: string[];
  closedChannels: string[];
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  revision: number;
}

const REVIEW_COLUMNS = 'id, organization_id, anchor_kind, anchor_channel, anchor_value, person_id, triggers, locked_channels, '
  + 'adopted_hold_ids, pre_existing_hold_ids, trigger_record_ids, closing_record_ids, source_refs, opened_at, due_at, due_timezone, '
  + 'due_timezone_fallback, state, decision, reopened_channels, closed_channels, decided_by, decided_at, reason, revision';

const iso = (v: unknown): string => new Date(String(v)).toISOString();

const toReview = (r: Record<string, unknown>): OptOutReview => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  anchorKind: String(r.anchor_kind) as OptOutReview['anchorKind'],
  anchorChannel: r.anchor_channel == null ? null : String(r.anchor_channel),
  anchorValue: String(r.anchor_value),
  personId: r.person_id == null ? null : String(r.person_id),
  triggers: arr(r.triggers),
  lockedChannels: arr(r.locked_channels),
  adoptedHoldIds: arr(r.adopted_hold_ids),
  preExistingHoldIds: arr(r.pre_existing_hold_ids),
  triggerRecordIds: arr(r.trigger_record_ids),
  closingRecordIds: arr(r.closing_record_ids),
  sourceRefs: arr(r.source_refs),
  openedAt: iso(r.opened_at),
  dueAt: iso(r.due_at),
  dueTimezone: String(r.due_timezone),
  dueTimezoneFallback: r.due_timezone_fallback === true,
  state: String(r.state) as OptOutReview['state'],
  decision: r.decision == null ? null : String(r.decision) as OptOutReview['decision'],
  reopenedChannels: arr(r.reopened_channels),
  closedChannels: arr(r.closed_channels),
  decidedBy: r.decided_by == null ? null : String(r.decided_by),
  decidedAt: r.decided_at == null ? null : iso(r.decided_at),
  reason: r.reason == null ? null : String(r.reason),
  revision: Number(r.revision),
});

/** One review in this tenant, or null. Throws when unreadable. */
export async function getOptOutReview(organizationId: string, reviewId: string): Promise<OptOutReview | null> {
  if (!UUID.test(reviewId)) return null;
  const res = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS)
    .eq('organization_id', organizationId).eq('id', reviewId).maybeSingle();
  if (res.error) fail('review_unreadable', 'the review could not be read');
  return res.data ? toReview(res.data as unknown as Record<string, unknown>) : null;
}

async function pendingFor(organizationId: string, kind: string, value: string): Promise<OptOutReview | null> {
  const res = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS)
    .eq('organization_id', organizationId).eq('anchor_kind', kind).eq('anchor_value', value).eq('state', 'pending')
    .limit(1);
  if (res.error) fail('review_unreadable', 'the pending review could not be read');
  const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
  return rows.length ? toReview(rows[0]) : null;
}

/** Compare-and-set on `revision`. True when this write won; false when the row moved. */
async function casReview(organizationId: string, review: OptOutReview, patch: Record<string, unknown>, expectPending: boolean): Promise<boolean> {
  let q = ownedDbTable(OPT_OUT_REVIEWS_TABLE)
    .update({ ...patch, revision: review.revision + 1 })
    .eq('organization_id', organizationId)
    .eq('id', review.id)
    .eq('revision', review.revision);
  if (expectPending) q = q.eq('state', 'pending');
  const res = await q.select('id');
  if (res.error) fail('review_write_failed', `the review could not be written (${errCode(res.error) ?? 'error'})`);
  return ((res.data ?? []) as unknown[]).length === 1;
}

const pgUuids = (ids: readonly string[]) => toPgTextArrayLiteral([...ids]);

/** Every PENDING review in this tenant (the set a revoke must never strand). Throws when unreadable. */
async function pendingReviews(organizationId: string): Promise<OptOutReview[]> {
  const res = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS)
    .eq('organization_id', organizationId).eq('state', 'pending');
  if (res.error) fail('review_unreadable', 'the pending reviews could not be read');
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toReview);
}

/** Every DECIDED review in this tenant. Throws when unreadable. */
async function decidedReviews(organizationId: string): Promise<OptOutReview[]> {
  const res = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS)
    .eq('organization_id', organizationId).eq('state', 'decided');
  if (res.error) fail('review_unreadable', 'the decided reviews could not be read');
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toReview);
}

const references = (r: OptOutReview, id: string): boolean => r.adoptedHoldIds.includes(id) || r.preExistingHoldIds.includes(id);

/**
 * F3 — the review that already carries this trigger's source ref, so a producer can tell a
 * redelivered trigger from a new one. Tenant first. Several: pending first, then the latest.
 *
 * Read as organization_id + a filter on source_refs in the service (no GIN index): reviews are
 * few per tenant, the (organization_id, state, due_at) index serves the tenant predicate, and
 * the PostgREST containment filter is not available on the test transport. Revisit (a GIN
 * index on source_refs plus `.contains`) if a tenant's review count grows into the thousands.
 */
export async function findOptOutReviewBySourceRef(input: { organizationId: string; sourceRef: string }): Promise<OptOutReview | null> {
  const ref = text(input.sourceRef);
  if (!UUID.test(text(input.organizationId)) || ref === '') return null;
  const res = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS).eq('organization_id', input.organizationId);
  if (res.error) fail('review_unreadable', 'the reviews could not be read');
  const hits = ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toReview)
    .filter((r) => r.organizationId === input.organizationId && r.sourceRefs.includes(ref));
  hits.sort((a, b) => (a.state === b.state ? Date.parse(b.openedAt) - Date.parse(a.openedAt) : a.state === 'pending' ? -1 : 1));
  return hits[0] ?? null;
}

/**
 * Reinstate a revoked hold for a pending review that still relies on it: a fresh `*`
 * `unsubscribe` on the same anchor with the same source and source ref (the canonical key is
 * free again once revoked), appended to THAT review's adopted holds by compare-and-set.
 */
async function reinstateHold(organizationId: string, reviewId: string, h: HoldRow): Promise<string> {
  const written = await recordContactGovernance({
    organizationId,
    governanceType: 'unsubscribe',
    channel: ALL_CHANNELS,
    ...(h.personId ? { personId: h.personId } : { target: h.targetNormalized }),
    source: h.source,
    sourceRecordId: h.sourceRecordId,
    evidence: { ...(h.sourceRef === null ? {} : { [SOURCE_REF_EVIDENCE_KEY]: h.sourceRef }), reinstated_from: h.id },
  });
  for (let attempt = 0; attempt < MAX_OPEN_ATTEMPTS; attempt += 1) {
    const current = await getOptOutReview(organizationId, reviewId);
    if (current === null || current.adoptedHoldIds.includes(written.id)) return written.id;
    if (await casReview(organizationId, current, { adopted_hold_ids: pgUuids(union(current.adoptedHoldIds, [written.id])) }, false)) return written.id;
  }
  return fail('review_contended', 'a reinstated hold could not be recorded on its review; the hold stands');
}

// ── open ────────────────────────────────────────────────────────────────────────────

function canonicalAnchor(anchor: OptOutAnchor): { kind: 'person' | 'target'; channel: string | null; value: string; personId: string | null } {
  if (anchor?.kind === 'person') {
    const personId = text(anchor.personId);
    if (!UUID.test(personId)) fail('invalid_input', 'a person anchor needs the person id');
    return { kind: 'person', channel: null, value: personId.toLowerCase(), personId: personId.toLowerCase() };
  }
  if (anchor?.kind === 'target' && ['whatsapp', 'phone', 'email'].includes(anchor.channel)) {
    const value = normalizeGovernanceTarget(anchor.channel, anchor.target);
    if (!value) fail('invalid_input', 'a target anchor needs an address or a number');
    return { kind: 'target', channel: anchor.channel, value: value as string, personId: null };
  }
  return fail('invalid_input', "the anchor is { kind: 'person', personId } or { kind: 'target', channel, target }");
}

const MAX_OPEN_ATTEMPTS = 5;

/**
 * Open the review for one opt-out, or JOIN the pending one for the same anchor. Called AFTER
 * the caller wrote its `*` holds. Throws OptOutReviewError on refusal or failure; the caller
 * keeps the contact closed (the holds stand) and retries, which adopts the holds and joins.
 */
export async function openOptOutReview(input: OpenOptOutReviewInput): Promise<OpenOptOutReviewResult> {
  const organizationId = text(input.organizationId);
  if (!UUID.test(organizationId)) fail('invalid_input', 'organizationId is required');
  if (!OPT_OUT_TRIGGERS.includes(input.trigger)) fail('invalid_input', `trigger must be one of ${OPT_OUT_TRIGGERS.join(' | ')}`);
  const sourceRef = text(input.sourceRef);
  const holdSource = text(input.holdSource);
  if (sourceRef === '' || holdSource === '') fail('invalid_input', 'sourceRef and holdSource are required');
  assertHoldSource(holdSource);
  const holdIds = union((Array.isArray(input.holdIds) ? input.holdIds : []).map((h) => text(h).toLowerCase()));
  if (holdIds.length === 0 || !holdIds.every((h) => UUID.test(h))) fail('invalid_input', 'holdIds names every `*` hold the caller wrote');
  const triggerRecordId = input.triggerRecordId == null ? null : text(input.triggerRecordId).toLowerCase();
  if (triggerRecordId !== null && !UUID.test(triggerRecordId)) fail('invalid_input', 'triggerRecordId must be a governance record id');
  const anchor = canonicalAnchor(input.anchor);
  const now = input.now ?? new Date().toISOString();

  const holds = await readGovernanceRows(organizationId, holdIds);
  const found = new Set(holds.map((h) => h.id));
  const missing = holdIds.filter((h) => !found.has(h));
  if (missing.length) fail('hold_not_found', `no such hold in this tenant: ${missing.join(', ')}`);
  // A hold revoked between the caller's write and this open no longer holds anything: the
  // caller writes it again (the canonical key is free once revoked) and retries.
  if (holds.some((h) => h.revokedAt !== null)) fail('hold_revoked', 'a named hold is already revoked; write the holds again and retry');
  const adopted = holds.filter((h) => isAdoptable(h, holdSource, sourceRef)).map((h) => h.id);
  const preExisting = holdIds.filter((h) => !adopted.includes(h));
  const locked = [...LOCKED_BY_TRIGGER[input.trigger]];
  const triggerIds = triggerRecordId === null ? [] : [triggerRecordId];

  let result: OpenOptOutReviewResult | null = null;
  for (let attempt = 0; attempt < MAX_OPEN_ATTEMPTS && result === null; attempt += 1) {
    const pending = await pendingFor(organizationId, anchor.kind, anchor.value);
    if (pending !== null) {
      const adoptedNow = union(pending.adoptedHoldIds, adopted);
      const joined = await casReview(organizationId, pending, {
        triggers: toPgTextArrayLiteral(union(pending.triggers, [input.trigger])),
        locked_channels: toPgTextArrayLiteral(union(pending.lockedChannels, locked)),
        adopted_hold_ids: pgUuids(adoptedNow),
        pre_existing_hold_ids: pgUuids(union(pending.preExistingHoldIds, preExisting.filter((h) => !adoptedNow.includes(h)))),
        trigger_record_ids: pgUuids(union(pending.triggerRecordIds, triggerIds)),
        source_refs: toPgTextArrayLiteral(union(pending.sourceRefs, [sourceRef])),
      }, true);
      if (joined) result = { reviewId: pending.id, outcome: 'joined', dueAt: pending.dueAt };
      continue;                                   // the row moved: re-read, join again or open
    }
    const due = optOutReviewDueAt(now, await companyZone(organizationId));
    const ins = await ownedDbTable(OPT_OUT_REVIEWS_TABLE).insert({
      organization_id: organizationId,
      anchor_kind: anchor.kind,
      anchor_channel: anchor.channel,
      anchor_value: anchor.value,
      person_id: anchor.personId,
      triggers: toPgTextArrayLiteral([input.trigger]),
      locked_channels: toPgTextArrayLiteral(locked),
      adopted_hold_ids: pgUuids(adopted),
      pre_existing_hold_ids: pgUuids(preExisting),
      trigger_record_ids: pgUuids(triggerIds),
      source_refs: toPgTextArrayLiteral([sourceRef]),
      opened_at: now,
      due_at: due.dueAt,
      due_timezone: due.timezone,
      due_timezone_fallback: due.fallback,
    }).select('id').single();
    if (!ins.error) {
      result = { reviewId: String((ins.data as { id: string }).id), outcome: 'opened', dueAt: due.dueAt };
      continue;
    }
    // Amendment B: the loser of a concurrent open re-reads and JOINS; it never throws.
    if (errCode(ins.error) !== '23505') {
      fail(errCode(ins.error) === '23503' ? 'cross_tenant_reference' : 'review_write_failed',
        `the review could not be opened (${errCode(ins.error) ?? 'error'})`);
    }
  }
  if (result === null) return fail('review_contended', 'the pending review kept moving; retry');

  // A decision may have revoked a named hold between the read above and the join: then the
  // caller's opt-out holds nothing, so it is told to write the holds again and retry.
  if ((await readGovernanceRows(organizationId, holdIds)).some((h) => h.revokedAt !== null)) {
    fail('hold_revoked', 'a named hold was revoked while the review was being joined; write the holds again and retry');
  }
  return result;
}

// ── list ────────────────────────────────────────────────────────────────────────────

export type ListedOptOutReview = OptOutReview & { overdue: boolean };

/** A tenant's reviews, pending first by due date; `overdue` is pending past its due date. */
export async function listOptOutReviews(input: {
  organizationId: string; state?: 'pending' | 'decided' | 'all'; now?: string; limit?: number;
}): Promise<ListedOptOutReview[]> {
  const state = input.state ?? 'pending';
  let q = ownedDbTable(OPT_OUT_REVIEWS_TABLE).select(REVIEW_COLUMNS).eq('organization_id', input.organizationId);
  if (state !== 'all') q = q.eq('state', state);
  const res = await q.order('state', { ascending: false }).order('due_at', { ascending: true })
    .limit(Math.min(Math.max(Math.trunc(input.limit ?? 200), 1), 500));
  if (res.error) fail('review_unreadable', 'the reviews could not be read');
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toReview)
    .map((r) => ({ ...r, overdue: r.state === 'pending' && Date.parse(r.dueAt) <= nowMs }));
}

// ── decide ──────────────────────────────────────────────────────────────────────────

export type DecideRefusal =
  | 'actor_required' | 'reason_required' | 'invalid_channels' | 'unknown_channel' | 'channel_locked'
  | 'review_not_found' | 'decision_race_lost' | 'governance_write_failed' | 'reconcile_incomplete';

export type DecideOptOutReviewOutcome =
  | {
    ok: true;
    reviewId: string;
    decision: 'reopen' | 'keep_closed';
    reopenedChannels: KnownChannel[];
    closedChannels: KnownChannel[];
    /** Adopted holds (and this review's own earlier closes) revoked by this decision. */
    revokedIds: string[];
    /** Channel-scoped closes this decision created. */
    closingRecordIds: string[];
    /** Holds this review never adopted: they stay, and may still close what was reopened. */
    preExistingHoldIds: string[];
    /** Adopted holds NOT revoked because another pending review adopted or found them (F2). */
    heldByOtherReview: string[];
    /** Fresh holds written for a pending review that relied on a hold this decision revoked (F1). */
    reinstatedHoldIds: string[];
  }
  | {
    ok: false; code: DecideRefusal; reason: string; channels?: string[];
    /** Only with `reconcile_incomplete`: what this attempt did apply, for the audit record. */
    applied?: { reviewId: string; decision: 'reopen' | 'keep_closed'; recorded: boolean; revokedIds: string[]; heldByOtherReview: string[]; closingRecordIds: string[] };
  };

const refuse = (code: DecideRefusal, reason: string, channels?: string[]): DecideOptOutReviewOutcome =>
  (channels ? { ok: false, code, reason, channels } : { ok: false, code, reason });

/** Which known channels an anchor can carry: a person all, an address email, a number phone + whatsapp. */
const channelsFor = (a: { personId?: string; target?: string }): readonly KnownChannel[] =>
  (a.personId ? KNOWN_CHANNELS : (a.target ?? '').includes('@') ? ['email'] : ['phone', 'whatsapp']);

/**
 * A company admin's decision. The ROUTE checks the actor is COMPANY_ADMIN in THIS company
 * (no super-admin bypass) and writes the audit record. `reopenChannels` is a subset of the
 * known channels minus the locked ones; empty keeps everything closed. Allowed while pending
 * and after the deadline, and again on a decided review (rule 6: an admin may still reopen).
 */
export async function decideOptOutReview(input: {
  organizationId: string;
  reviewId: string;
  actorUserId: unknown;
  reopenChannels: unknown;
  reason: unknown;
  now?: string;
}): Promise<DecideOptOutReviewOutcome> {
  const actor = text(input.actorUserId);
  if (!UUID.test(actor)) return refuse('actor_required', 'a decision is a person\'s; no authenticated actor was given');
  const reason = text(input.reason);
  if (reason === '') return refuse('reason_required', 'a decision needs a reason');
  if (!Array.isArray(input.reopenChannels) || !input.reopenChannels.every((c) => typeof c === 'string')) {
    return refuse('invalid_channels', 'reopenChannels is a list of channels (empty keeps every channel closed)');
  }
  const asked = union(input.reopenChannels.map((c) => text(c)));
  const unknown = asked.filter((c) => !(KNOWN_CHANNELS as readonly string[]).includes(c));
  if (unknown.length) return refuse('unknown_channel', `only ${KNOWN_CHANNELS.join(', ')} can be reopened`, unknown);

  let review: OptOutReview | null;
  try {
    review = await getOptOutReview(input.organizationId, input.reviewId);
  } catch (e) {
    return refuse('governance_write_failed', `the review could not be read (${errCode(e) ?? 'error'})`);
  }
  if (review === null) return refuse('review_not_found', 'no such review in this company');
  const lockedAsked = asked.filter((c) => review!.lockedChannels.includes(c));
  if (lockedAsked.length) {
    return refuse('channel_locked', 'a STOP or an unsubscribe keeps that channel closed; only the person can undo it', lockedAsked);
  }
  const reopen = KNOWN_CHANNELS.filter((c) => asked.includes(c));
  const closed = KNOWN_CHANNELS.filter((c) => !asked.includes(c));
  const decision = reopen.length > 0 ? 'reopen' as const : 'keep_closed' as const;
  const now = input.now ?? new Date().toISOString();

  try {
    // Claim the review: a concurrent join or decision now loses its compare-and-set.
    if (!(await casReview(input.organizationId, review, {}, false))) {
      return refuse('decision_race_lost', 'the review changed while this decision was being applied; read it again');
    }
    const claimed: OptOutReview = { ...review, revision: review.revision + 1 };

    // The anchors: the review's own, plus every anchor of a hold it adopted OR found already
    // present (F2: a pre-existing hold's anchor is this contact too; this only adds closes).
    const adoptedRows = await readGovernanceRows(input.organizationId, review.adoptedHoldIds);
    const preExistingRows = await readGovernanceRows(input.organizationId, review.preExistingHoldIds);
    const anchors = new Map<string, { personId?: string; target?: string }>();
    if (review.anchorKind === 'person' && review.personId) anchors.set(`p:${review.personId}`, { personId: review.personId });
    if (review.anchorKind === 'target') anchors.set(`t:${review.anchorValue}`, { target: review.anchorValue });
    for (const h of [...adoptedRows, ...preExistingRows]) {
      if (h.personId) anchors.set(`p:${h.personId}`, { personId: h.personId });
      else if (h.targetNormalized) anchors.set(`t:${h.targetNormalized}`, { target: h.targetNormalized });
    }

    // 1. CLOSE FIRST: every known channel that stays closed, on every anchor that carries it.
    //    A close this review already wrote (an earlier, lost attempt) answers already_present and
    //    is still this review's own, so a later reopen can revoke it.
    const created: string[] = [];
    const ownExisting: string[] = [];
    for (const a of anchors.values()) {
      for (const channel of closed.filter((c) => channelsFor(a).includes(c))) {
        const written = await recordContactGovernance({
          organizationId: input.organizationId,
          governanceType: 'unsubscribe',
          channel,
          ...a,
          source: OPT_OUT_REVIEW_SOURCE,
          evidence: { review_id: review.id, actor, decision },
        });
        if (written.outcome === 'created') created.push(written.id);
        else ownExisting.push(written.id);
      }
    }
    const mine = (await readGovernanceRows(input.organizationId, ownExisting))
      .filter((h) => h.source === OPT_OUT_REVIEW_SOURCE && h.reviewId === review!.id).map((h) => h.id);
    const closingIds = union(review.closingRecordIds, mine, created);

    // 2. THEN REVOKE: the adopted holds, and this review's own earlier closes on a channel now
    //    reopened. A pre-existing hold or a trigger record is never touched. F2: a hold another
    //    PENDING review adopted or found present is not revoked either (`heldByOtherReview`).
    const others = (await pendingReviews(input.organizationId)).filter((r) => r.id !== review!.id);
    const revokeReason = `optout_review:${review.id}:${decision}`;
    const ownCloses = (await readGovernanceRows(input.organizationId, closingIds))
      .filter((h) => h.revokedAt === null && h.source === OPT_OUT_REVIEW_SOURCE
        && (reopen as readonly string[]).includes(h.channel) && !review!.triggerRecordIds.includes(h.id));
    // INHERITED: a hold this review found present that another review adopted, skipped then
    // because THIS review was pending (F2), and whose adopter has since been decided. Nobody else
    // can release it, so this review may; a hold no review ever adopted (W1-C, dnc) is never one.
    const decidedAdopted = new Set((await decidedReviews(input.organizationId)).filter((r) => r.id !== review!.id).flatMap((r) => r.adoptedHoldIds));
    const inherited = preExistingRows.filter((h) => h.revokedAt === null && decidedAdopted.has(h.id));
    const heldByOtherReview: string[] = [];
    const revokedIds: string[] = [];
    for (const h of [...adoptedRows.filter((r) => r.revokedAt === null), ...inherited, ...ownCloses]) {
      if (others.some((r) => references(r, h.id))) { heldByOtherReview.push(h.id); continue; }
      const r = await revokeContactGovernance({ organizationId: input.organizationId, id: h.id, reason: revokeReason, revokedAt: now });
      if (r.revoked) revokedIds.push(h.id);
    }

    // 3. THEN THE DECISION.
    const recorded = await casReview(input.organizationId, claimed, {
      state: 'decided',
      decision,
      reopened_channels: toPgTextArrayLiteral(reopen),
      closed_channels: toPgTextArrayLiteral(closed),
      closing_record_ids: pgUuids(closingIds),
      decided_by: actor,
      decided_at: now,
      reason,
    }, false);

    // 4. THEN RECONCILE. ORDER IS LOAD-BEARING (Outreach condition, 2026-11-07): this scan of
    //    the pending set is read AFRESH here, AFTER every revoke above has committed. It is never
    //    batched with, nor reused from, the read before the revokes: a trigger that joined in
    //    between is only visible now. Any pending review (this one too, when its decision lost)
    //    that references a hold now revoked gets that hold reinstated, so a lost or raced
    //    decision leaves nothing reopened (F1). A test pins revoke → scan.
    //    A failure HERE is its own code, `reconcile_incomplete` (503, retryable): holds were
    //    revoked and may not all be reinstated yet, so "nothing was reopened" cannot be claimed.
    //    The admin retries the decision; the retry's reconcile heals it from adoptedHoldIds.
    const candidates = union(review.adoptedHoldIds, revokedIds);
    const reinstated: string[] = [];
    try {
      const stranded = (await pendingReviews(input.organizationId)).filter((r) => candidates.some((id) => references(r, id)));
      if (stranded.length) {
        const revokedNow = (await readGovernanceRows(input.organizationId, candidates)).filter((h) => h.revokedAt !== null);
        for (const r of stranded) {
          for (const h of revokedNow.filter((x) => references(r, x.id))) reinstated.push(await reinstateHold(input.organizationId, r.id, h));
        }
      }
    } catch (e) {
      return {
        ok: false,
        code: 'reconcile_incomplete',
        reason: `the decision revoked holds, but a hold another pending review relies on could not be reinstated (${errCode(e) ?? 'error'}); retry the decision: its reconcile restores the hold`,
        applied: { reviewId: review.id, decision, recorded, revokedIds, heldByOtherReview, closingRecordIds: created },
      };
    }

    if (!recorded) return refuse('decision_race_lost', 'the review changed while this decision was being applied; read it again; nothing it revoked was left open');
    return {
      ok: true, reviewId: review.id, decision, reopenedChannels: reopen, closedChannels: closed,
      revokedIds, closingRecordIds: created, preExistingHoldIds: review.preExistingHoldIds, heldByOtherReview,
      reinstatedHoldIds: union(reinstated),
    };
  } catch (e) {
    return refuse('governance_write_failed', `the decision could not be applied (${errCode(e) ?? 'error'}); nothing was reopened that was not closed first`);
  }
}
