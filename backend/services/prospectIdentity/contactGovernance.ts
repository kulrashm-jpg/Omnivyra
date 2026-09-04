/**
 * LI-3B — canonical contact governance contracts and evaluator.
 *
 * Implements OMNIVYRA_LI3_CONTACT_GOVERNANCE_ADR.md. It decides nothing on its
 * own; every semantic here traces to a numbered ADR section.
 *
 * ─── WHAT THIS MODULE IS ──────────────────────────────────────────────────
 * The type vocabulary, the channel semantics, and a PURE evaluation function
 * answering one question:
 *
 *     may this tenant contact this person, on this channel, at this instant?
 *
 * ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
 * It performs no I/O. It writes nothing, reads no database, calls no provider,
 * consumes no credits, creates no audit record and sends nothing. `now` is
 * injected rather than read from a clock, so the same inputs always produce the
 * same verdict — the property that makes a governance decision defensible
 * months later, and the same discipline WS-2's engines and LI-2's
 * `decideCanonicalUpdates` already follow.
 *
 * NOTHING CALLS IT YET. Wiring it into Path B's `suppression` gate is LI-3C.
 *
 * ─── SCOPE OF THE EVALUATION (ADR §14) ────────────────────────────────────
 * The ADR's full order has ten gates. This evaluator owns ONLY gates 3–6, the
 * governance blockers this table can answer:
 *
 *     3  dnc_permanent
 *     4  dnc_channel / unsubscribe / consent_withdrawn / complaint
 *     5  invalid_contact / bounce_hard
 *     6  deferred                                   (temporal)
 *
 * Gates 1–2 (tenant active, identity valid) and 7–10 (quiet hours, contact
 * fatigue, campaign rules, rate limit) are NOT this table's data and are not
 * evaluated here. Quiet hours and contact fatigue do not exist anywhere yet.
 */

export const CONTACT_GOVERNANCE_VERSION = 'li3b.1';

/**
 * ADR §9. A closed vocabulary, deliberately not a boolean.
 *
 * The distinctions this preserves, each of which a single `is_suppressed` flag
 * would destroy:
 *   bounce_hard     ≠ unsubscribe   a broken address a correction fixes, vs a
 *                                   wish that survives any correction
 *   invalid_contact ≠ dnc_*         our data is wrong, not their refusal
 *   deferred        ≠ dnc_*         an invitation, not a refusal
 *   campaign_exclusion ≠ permanent  one campaign, not the relationship
 */
export const GOVERNANCE_TYPES = [
  'dnc_permanent',
  'dnc_channel',
  'unsubscribe',
  'consent_withdrawn',
  'invalid_contact',
  'bounce_hard',
  'complaint',
  'deferred',
  'campaign_exclusion',
] as const;
export type GovernanceType = typeof GOVERNANCE_TYPES[number];

/** ADR §10. `*` means every channel, including channels that do not exist yet. */
export const ALL_CHANNELS = '*';
export const KNOWN_CHANNELS = ['email', 'phone', 'whatsapp'] as const;
export type KnownChannel = typeof KNOWN_CHANNELS[number];
/** Free text by design: a new channel must never require a migration. */
export type GovernanceChannel = string;

/**
 * ADR §14 gate bands, in evaluation order. A record's band decides when it is
 * considered, not how strongly it blocks.
 */
const GATE_BAND: Record<GovernanceType, number> = {
  dnc_permanent: 3,
  dnc_channel: 4,
  unsubscribe: 4,
  consent_withdrawn: 4,
  complaint: 4,
  invalid_contact: 5,
  bounce_hard: 5,
  deferred: 6,
  // Gate 9 — campaign rules. Never evaluated by this function; see
  // `campaign_exclusion` in the limitations note at the bottom of this file.
  campaign_exclusion: 9,
};

/** One stored instruction, as the evaluator sees it. */
export interface GovernanceRecord {
  id: string;
  organizationId: string;
  personId: string | null;
  targetNormalized: string | null;
  channel: GovernanceChannel;
  governanceType: GovernanceType;
  effectiveFrom: string;
  effectiveUntil: string | null;
  revokedAt: string | null;
}

export interface MayContactInput {
  organizationId: string;
  personId?: string | null;
  targetNormalized?: string | null;
  channel: GovernanceChannel;
  /** Injected, never read from a clock — see the header. */
  now: string;
  /** Records already loaded by the caller. This function performs no I/O. */
  records: GovernanceRecord[];
}

/**
 * Path B's existing vocabulary, reused rather than reinvented (ADR §14):
 * `blocked` is a standing instruction, `deferred` is backpressure — try later.
 */
export type GovernanceDecision = 'allowed' | 'blocked' | 'deferred';

export interface MayContactResult {
  decision: GovernanceDecision;
  /** The gate band that produced the verdict, or null when allowed. */
  gate: number | null;
  governanceType: GovernanceType | null;
  /** The record that decided it — so an operator can be shown why. */
  recordId: string | null;
  /** Matched via the canonical person, or via the target after D-3 nulling. */
  matchedBy: 'person' | 'target' | null;
  reason: string;
  /** When a deferment lapses; null otherwise. */
  deferredUntil: string | null;
  version: string;
}

const allowed = (): MayContactResult => ({
  decision: 'allowed',
  gate: null,
  governanceType: null,
  recordId: null,
  matchedBy: null,
  reason: 'no_governance_record_applies',
  deferredUntil: null,
  version: CONTACT_GOVERNANCE_VERSION,
});

export function isGovernanceType(v: unknown): v is GovernanceType {
  return typeof v === 'string' && (GOVERNANCE_TYPES as readonly string[]).includes(v);
}

/**
 * ADR §10: a record applies to the requested channel when it names that channel
 * or is the unqualified `*`.
 */
function channelApplies(recordChannel: GovernanceChannel, requested: GovernanceChannel): boolean {
  return recordChannel === ALL_CHANNELS || recordChannel === requested;
}

/**
 * D-3: match on person OR target. Matching on `person_id` alone would silently
 * stop enforcing a DNC the moment its person row was deleted — reintroducing
 * exactly the re-import hole the SET NULL design exists to close.
 */
function anchorMatches(
  record: GovernanceRecord,
  personId: string | null | undefined,
  target: string | null | undefined,
): 'person' | 'target' | null {
  if (personId && record.personId && record.personId === personId) return 'person';
  if (target && record.targetNormalized && record.targetNormalized === target) return 'target';
  return null;
}

/**
 * ADR §11: a deferment is in force while `now < effective_until`. An UNDATED
 * deferment (`effective_until` null) has no expiry the database can evaluate —
 * how long it should hold is an open product decision (ADR §22, P-1), so this
 * function reports it as deferred with a null lapse time and does NOT invent a
 * default window.
 */
function isInForce(record: GovernanceRecord, now: string): boolean {
  if (record.revokedAt !== null) return false;
  if (record.effectiveFrom > now) return false;                 // not yet started
  if (record.effectiveUntil !== null && record.effectiveUntil <= now) return false; // lapsed
  return true;
}

/**
 * ADR §14 gates 3–6, short-circuiting at the first blocking band.
 *
 * PURE. No database, no clock, no mutation, no logging. Callers load the
 * candidate records (tenant-filtered — this function trusts but also re-checks
 * `organizationId`) and hand them in.
 */
export function mayContact(input: MayContactInput): MayContactResult {
  if (!input.organizationId || !String(input.organizationId).trim()) {
    throw new Error('mayContact: organizationId is required — governance is never evaluated without a tenant');
  }
  if (!input.channel || !String(input.channel).trim()) {
    throw new Error('mayContact: channel is required');
  }

  const applicable = (input.records ?? [])
    .filter((r) => r.organizationId === input.organizationId)   // defence in depth: never cross a tenant
    .filter((r) => channelApplies(r.channel, input.channel))
    .filter((r) => isInForce(r, input.now))
    .map((r) => ({ record: r, matchedBy: anchorMatches(r, input.personId, input.targetNormalized) }))
    .filter((x) => x.matchedBy !== null)
    // Only the bands this evaluator owns. campaign_exclusion (band 9) is
    // deliberately excluded — it is a campaign rule, not a contact restriction.
    .filter((x) => GATE_BAND[x.record.governanceType] >= 3 && GATE_BAND[x.record.governanceType] <= 6)
    .sort((a, b) => GATE_BAND[a.record.governanceType] - GATE_BAND[b.record.governanceType]);

  const hit = applicable[0];
  if (!hit) return allowed();

  const band = GATE_BAND[hit.record.governanceType];
  const isDeferment = hit.record.governanceType === 'deferred';

  return {
    // ADR §14: bands 3–6 return `blocked`; a deferment is temporal backpressure,
    // which is Path B's `deferred`.
    decision: isDeferment ? 'deferred' : 'blocked',
    gate: band,
    governanceType: hit.record.governanceType,
    recordId: hit.record.id,
    matchedBy: hit.matchedBy,
    reason: isDeferment ? 'deferred_until_later' : `blocked_by_${hit.record.governanceType}`,
    deferredUntil: isDeferment ? hit.record.effectiveUntil : null,
    version: CONTACT_GOVERNANCE_VERSION,
  };
}

/** Database column names, so callers do not hand-write them and drift. */
export const CONTACT_GOVERNANCE_COLUMNS = [
  'id', 'organization_id', 'person_id', 'target_normalized', 'target_raw',
  'channel', 'governance_type', 'source', 'source_record_id', 'evidence',
  'effective_from', 'effective_until', 'revoked_at', 'revoked_reason',
  'created_at', 'updated_at',
] as const;

/**
 * KNOWN LIMITATIONS, recorded rather than hidden:
 *
 * 1. `campaign_exclusion` is in the vocabulary (ADR §9) but this evaluator
 *    never returns it, because it is a gate-9 campaign rule rather than a
 *    contact restriction. It also has no column naming the campaign it
 *    excludes — the ADR (§22, P-3) flags whether it belongs in this table at
 *    all as an open product question. Until that is answered it is storable
 *    but not actionable.
 *
 * 2. An UNDATED deferment blocks indefinitely here. ADR §22 P-1 owns the
 *    default; inventing one in code would decide a product question silently.
 *
 * 3. A person with both a resolved `person_id` and an unresolved
 *    `target_normalized` may hold two records for one instruction. Both match,
 *    the stricter band wins, and no incorrect verdict results — but the
 *    duplicate remains until the later backfill described in ADR §13.
 */
