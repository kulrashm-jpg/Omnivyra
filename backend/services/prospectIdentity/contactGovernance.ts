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

import { isScopeableGovernanceType, purposeApplies, type ContactPurpose } from './contactPurpose';

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
  /**
   * PG-001 restriction scope, from `contact_governance_records.purpose_scope`.
   *
   * OPTIONAL, and absence is not a gap: `null`, `undefined` and any
   * unrecognised value all mean "applies to every purpose" (DR-10). A loader
   * that does not select the column therefore evaluates exactly as it did
   * before, which is what lets this ship without touching every caller.
   */
  purposeScope?: string | null;
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
  /**
   * PG-001 ATTEMPT PURPOSE — what this delivery is for.
   *
   * OPTIONAL HERE ON PURPOSE. An undeclared attempt is `all`, so it stays
   * subject to every restriction; omitting it can never widen permission. The
   * requirement to state a purpose belongs at the EXECUTION BOUNDARY, where a
   * send actually happens, not on a pure function that planning, readiness,
   * export and recommendation paths all call without sending anything.
   */
  attemptPurpose?: ContactPurpose;
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
 * Accepted instant grammars, as MEASURED rather than assumed.
 *
 * PostgreSQL renders a `timestamptz` through `to_json` as `T`-separated, with 1-6
 * fractional digits and trailing zeros TRIMMED — so a whole second carries NO
 * fractional part at all — and an ALWAYS-EXPLICIT numeric offset `±HH:MM`, **never
 * `Z`**, not even at `TimeZone='UTC'`, where it emits `+00:00`. JS callers pass
 * `toISOString()`, which is always `Z` with exactly 3 digits. Both forms must be
 * accepted: they are the two sides this file used to compare as raw strings.
 */
const GOVERNANCE_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * One instant as integer epoch MICROSECONDS, or `null` if it is not a form we accept.
 *
 * WHY MICROSECONDS, AND WHY NOT `Date.parse`. PostgreSQL stores microseconds, while
 * `Date.parse` and the `Date` constructor resolve to MILLISECONDS — so `.123456` and
 * `.123100` both collapse to `.123`, and a restriction still in force for another
 * 356 µs reads as lapsed. `Date.parse` is never applied to the whole timestamp.
 *
 * The phrase above deliberately says "the `Date` constructor" rather than spelling the
 * call: `contactGovernanceEvaluator.test.ts:270` and `li3cGovernanceWiring.test.ts:223`
 * both read THIS FILE AS TEXT and fail on a `/new Date\(\)/` match, to keep the module
 * clock-free. A comment explaining that we avoid the clock would otherwise trip the
 * guard that enforces it.
 * `Date.UTC` is used on validated integer calendar parts, with the fraction and the
 * offset carried separately at full precision.
 *
 * Epoch microseconds stay exact in a `number`: about 1.78e15 in 2026 against
 * MAX_SAFE_INTEGER 9.007e15, so no BigInt is needed this side of ~2255. The result
 * is checked with `Number.isSafeInteger` anyway, so on the day that stops being true
 * this returns `null` and callers fail closed rather than comparing values that have
 * been silently rounded.
 *
 * Exported so that any other temporal check can DELEGATE to this one comparison
 * rather than mirror it — a mirrored comparison drifts, a delegated one cannot.
 */
export function parseGovernanceInstantUs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = GOVERNANCE_INSTANT.exec(value);
  if (m === null) return null;
  const [, yy, mo, dd, hh, mi, ss, frac, offset] = m;
  const year = Number(yy), month = Number(mo), day = Number(dd);
  const hour = Number(hh), minute = Number(mi), second = Number(ss);
  // The regex fixes the SHAPE; these fix the RANGE. `Date.UTC` rolls over silently
  // (month 13 becomes January), so an out-of-range value would otherwise parse to a
  // real but wrong instant, which is worse than rejecting it.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(ms)) return null;
  // Round-trip the calendar so 2026-02-30 and 2026-04-31 are rejected rather than
  // rolled forward into a different day.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  // `.5` means 500000 µs, not 5. Pad on the RIGHT: these digits are a decimal
  // fraction, and PostgreSQL trims trailing zeros before we ever see them.
  const micros = frac === undefined ? 0 : Number(frac.padEnd(6, '0'));
  let offsetUs = 0;
  if (offset !== 'Z') {
    const offHours = Number(offset.slice(1, 3));
    const offMinutes = Number(offset.slice(4, 6));
    if (offHours > 23 || offMinutes > 59) return null;
    const magnitude = (offHours * 3600 + offMinutes * 60) * 1_000_000;
    offsetUs = offset.startsWith('-') ? -magnitude : magnitude;
  }
  // The wall-clock reading is local to `offset`, so UTC is the reading MINUS the
  // offset: `10:00+05:30` is 04:30Z, and `21:15-05:00` is 02:15Z on the NEXT day.
  // A negative offset shifts the DATE too, which is why the calendar parts are
  // never assumed to be the UTC date.
  const us = ms * 1000 + micros - offsetUs;
  return Number.isSafeInteger(us) ? us : null;
}

/**
 * ADR §11: a deferment is in force while `now < effective_until`. An UNDATED
 * deferment (`effective_until` null) has no expiry the database can evaluate —
 * how long it should hold is an open product decision (ADR §22, P-1), so this
 * function reports it as deferred with a null lapse time and does NOT invent a
 * default window.
 *
 * THE INTERVAL IS HALF-OPEN, `[effectiveFrom, effectiveUntil)`, and the microsecond
 * rewrite does not change it: at exactly `effectiveFrom` a restriction IS in force,
 * and at exactly `effectiveUntil` it is NOT.
 *
 * EVERY COMPARISON IS ON INTEGER MICROSECONDS, never on the strings. The two sides
 * do not share a grammar — the DB renders `…+00:00` with up to 6 trimmed fractional
 * digits, a JS caller renders `…Z` with exactly 3 — and compared lexicographically
 * `+` (0x2B) sorts below both `.` (0x2E) and every digit, and far below the terminal
 * `Z` (0x5A). So a DB timestamp read as a string looks EARLIER than it is, which
 * expires a live restriction and PERMITS contact. Under a non-UTC session TimeZone
 * the same ordering error is HOURS wide in both directions, and this repo pins
 * TimeZone nowhere, so that is a live case rather than a theoretical one.
 *
 * FAIL-CLOSED, PER GUARD AND IN THE RIGHT DIRECTION. For a suppression check the
 * safe answer under uncertainty is "in force", so an unusable instant must never
 * become "not yet started" or "lapsed" — both of those PERMIT contact. An
 * unparseable `now`, an unparseable `effectiveFrom` and an unparseable
 * `effectiveUntil` therefore each resolve to in force.
 */
function isInForce(record: GovernanceRecord, now: string): boolean {
  // UNCHANGED, and deliberately FIRST: `revokedAt` is a null check, never a temporal
  // comparison. Comparing it against `now` would make a future-dated revocation read
  // as "still in force" — a behaviour change in the dangerous direction. It also
  // short-circuits before any timestamp is parsed.
  if (record.revokedAt !== null) return false;

  const nowUs = parseGovernanceInstantUs(now);
  if (nowUs === null) return true;                              // no usable decision instant

  const fromUs = parseGovernanceInstantUs(record.effectiveFrom);
  if (fromUs === null) return true;                             // NOT "not yet started"
  if (fromUs > nowUs) return false;                             // not yet started

  if (record.effectiveUntil !== null) {
    const untilUs = parseGovernanceInstantUs(record.effectiveUntil);
    if (untilUs === null) return true;                          // NOT "lapsed"
    if (untilUs <= nowUs) return false;                         // lapsed
  }
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
    // PG-001. Applicability, NOT severity — which is why it sits here, after
    // tenant, channel and anchor, and BEFORE the band sort. Folding purpose
    // into a band would make an outreach-scoped record look weaker than it is.
    //
    // It can only ever REMOVE a record whose scope explicitly disagrees with an
    // explicitly declared attempt purpose. An unlabelled record, an undeclared
    // attempt, and any unrecognised value on either side all collapse to `all`,
    // so today — with every stored scope NULL and DR-1 forbidding a narrow
    // write — this filter removes nothing and every verdict is unchanged.
    //
    // GATED ON THE TYPE, and that gate is load-bearing. Only the objection
    // family is scopeable; `bounce_hard` and `invalid_contact` are
    // endpoint-intrinsic, `deferred` is a temporal state (DR-5),
    // `campaign_exclusion` is inert and narrower than any purpose (DR-6), and
    // `dnc_permanent`/`dnc_channel` are all-purpose by their own semantics
    // (DR-2). The database refuses a scope on those six, but a row written
    // before that CHECK existed — or by direct database access — could still
    // carry one, and without this gate such a row would make an endpoint-
    // intrinsic restriction DODGEABLE by declaring a purpose. Ignoring the
    // stored value for a non-scopeable type is the only safe reading.
    .filter((x) => !isScopeableGovernanceType(x.record.governanceType)
      || purposeApplies(x.record.purposeScope, input.attemptPurpose))
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
