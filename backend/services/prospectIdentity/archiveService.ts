/**
 * PI-LEAD-FOUNDATION-002 — canonical prospect archival.
 *
 * ─── THE CONTRACT, IN ONE LINE ────────────────────────────────────────────
 * AI recommends; a human confirms. A recommendation NEVER changes the
 * prospect's state. Only `confirmArchiveRecommendation` does, and only when a
 * real reviewing user is named.
 *
 *   ACTIVE ──► recommendation (status 'open') ──► review
 *                                                 ├─ confirm ─► ARCHIVED
 *                                                 └─ reject  ─► ACTIVE
 *
 * ─── WHAT ARCHIVE MEANS, AND THE THREE THINGS IT DOES NOT ─────────────────
 * Archive removes a prospect from the active working set by setting
 * `unified_persons.status = 'archived'`. It is NOT deletion, NOT DNC and NOT
 * suppression:
 *
 *   • nothing here deletes anything — no source record, no assertion, no
 *     enrichment attempt, no engagement history;
 *   • nothing here touches `contact_governance_records`. Suppression is a
 *     different axis with a different owner, and a prospect may be
 *     archived-and-contactable or active-and-suppressed;
 *   • nothing here changes retention. An archived prospect stays queryable.
 *
 * ─── NO NEW STATUS MODEL ──────────────────────────────────────────────────
 * `unified_persons.status` already carries the four-value vocabulary and is
 * already what `person_duplicate_candidates` consults. This module sets that
 * column. `canonical_leads.lead_status` is deliberately untouched: free text,
 * no CHECK, never read by PI.
 *
 * ─── EVERY OPERATION IS TENANT-BOUND, AND REFUSES BEFORE READING ──────────
 * The tenant is a required argument and is compared, never inferred. A
 * cross-tenant attempt is refused as `wrong_tenant` before any mutation — the
 * composite FK would also refuse it at the database, but a service that relied
 * on a constraint to express an authorization rule would be leaving the rule
 * somewhere a reader cannot see it.
 *
 * ─── AUTONOMOUS ARCHIVING IS NOT IMPLEMENTED ──────────────────────────────
 * There is no path here that archives without a reviewing user id. That is the
 * owner-approved default and PI-LEAD-FOUNDATION-002 explicitly withholds
 * autonomous archival pending a separate decision.
 */

/** Why a prospect looks archivable. Closed: an unexplainable recommendation cannot be reviewed. */
export const ARCHIVE_REASONS = [
  'no_response_after_repeated_outreach',
  'prolonged_inactivity',
  'stale_or_invalid_contact_data',
  'repeated_enrichment_failure',
  'insufficient_identity_confidence',
  'no_longer_matches_targeting',
] as const;
export type ArchiveReason = typeof ARCHIVE_REASONS[number];

export const ARCHIVE_RECOMMENDATION_STATUSES = ['open', 'confirmed', 'rejected', 'superseded'] as const;
export type ArchiveRecommendationStatus = typeof ARCHIVE_RECOMMENDATION_STATUSES[number];

/** The version of the rule set that produced a recommendation. */
export const ARCHIVE_RULES_VERSION = 'pi.archive-rules.1';

export interface ArchiveRecommendation {
  readonly id: string;
  readonly organizationId: string;
  readonly personId: string;
  readonly reason: ArchiveReason;
  readonly reasoning: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly modelVersion: string | null;
  readonly status: ArchiveRecommendationStatus;
  readonly recommendedAt: string;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
}

export type ArchiveRefusal =
  | 'tenant_required'
  | 'person_required'
  | 'actor_required'
  | 'wrong_tenant'
  | 'person_not_found'
  | 'recommendation_not_found'
  | 'recommendation_not_open'
  | 'already_archived'
  | 'reason_unrecognised';

export class ArchiveError extends Error {
  constructor(readonly refusal: ArchiveRefusal, detail?: string) {
    super(detail ? `${refusal}: ${detail}` : refusal);
    this.name = 'ArchiveError';
  }
}

// ── the evidence a recommendation is derived from ───────────────────────────

/**
 * What the rules look at. Supplied by the caller from canonical data, never
 * gathered here: a rule engine that also fetched its own inputs could not be
 * tested deterministically, and the contract requires the evidence to be
 * inspectable by the reviewing human.
 */
export interface ArchiveSignals {
  readonly organizationId: string;
  readonly personId: string;
  /** Outreach attempts with no reply. */
  readonly outreachAttemptsWithoutResponse?: number;
  /** Days since anything was observed about this person. */
  readonly daysSinceLastObservation?: number;
  /** Consecutive failed enrichment attempts. */
  readonly consecutiveEnrichmentFailures?: number;
  /** True when every known contact channel is invalid or absent. */
  readonly contactDataInvalid?: boolean;
  /** Identity confidence, 0..1, where the resolver stated one. */
  readonly identityConfidence?: number | null;
  /** True when the prospect no longer satisfies the tenant's active ICP. */
  readonly matchesTargeting?: boolean;
}

/**
 * Deterministic, explainable rules.
 *
 * THRESHOLDS ARE NOT INVENTED PRODUCT POLICY. No existing product requirement
 * defines them, and PI-LEAD-FOUNDATION-002 §16 says not to invent arbitrary
 * production thresholds — so they live here as a NAMED, VERSIONED, overridable
 * rule set rather than as magic numbers scattered through a query, and the
 * owner can replace them without touching the mechanism. They are the initial
 * simulation-grade defaults the brief permits.
 */
export interface ArchiveThresholds {
  readonly outreachAttemptsWithoutResponse: number;
  readonly daysSinceLastObservation: number;
  readonly consecutiveEnrichmentFailures: number;
  readonly minIdentityConfidence: number;
}

export const DEFAULT_ARCHIVE_THRESHOLDS: ArchiveThresholds = {
  outreachAttemptsWithoutResponse: 5,
  daysSinceLastObservation: 180,
  consecutiveEnrichmentFailures: 3,
  minIdentityConfidence: 0.3,
};

export interface ArchiveCandidacy {
  readonly recommend: boolean;
  readonly reason: ArchiveReason | null;
  readonly reasoning: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly modelVersion: string;
}

/**
 * Evaluate whether a prospect looks archivable. PURE: no clock, no I/O.
 *
 * Returns at most ONE reason, in a fixed precedence order, because a
 * recommendation a human has to act on is clearer with one stated cause than
 * with six. The full signal set is always returned as evidence, so nothing the
 * rules saw is hidden from the reviewer.
 */
export function evaluateArchiveCandidacy(
  signals: ArchiveSignals,
  thresholds: ArchiveThresholds = DEFAULT_ARCHIVE_THRESHOLDS,
): ArchiveCandidacy {
  const evidence: Record<string, unknown> = {
    outreachAttemptsWithoutResponse: signals.outreachAttemptsWithoutResponse ?? null,
    daysSinceLastObservation: signals.daysSinceLastObservation ?? null,
    consecutiveEnrichmentFailures: signals.consecutiveEnrichmentFailures ?? null,
    contactDataInvalid: signals.contactDataInvalid ?? null,
    identityConfidence: signals.identityConfidence ?? null,
    matchesTargeting: signals.matchesTargeting ?? null,
    thresholds,
  };

  const decide = (reason: ArchiveReason, reasoning: string): ArchiveCandidacy => ({
    recommend: true, reason, reasoning, evidence, modelVersion: ARCHIVE_RULES_VERSION,
  });

  if ((signals.outreachAttemptsWithoutResponse ?? 0) >= thresholds.outreachAttemptsWithoutResponse) {
    return decide('no_response_after_repeated_outreach',
      `${signals.outreachAttemptsWithoutResponse} outreach attempts with no response `
      + `(threshold ${thresholds.outreachAttemptsWithoutResponse})`);
  }
  if (signals.matchesTargeting === false) {
    return decide('no_longer_matches_targeting',
      'the prospect no longer satisfies the tenant\'s active targeting criteria');
  }
  if (signals.contactDataInvalid === true) {
    return decide('stale_or_invalid_contact_data',
      'every known contact channel is invalid or absent');
  }
  if ((signals.consecutiveEnrichmentFailures ?? 0) >= thresholds.consecutiveEnrichmentFailures) {
    return decide('repeated_enrichment_failure',
      `${signals.consecutiveEnrichmentFailures} consecutive enrichment failures `
      + `(threshold ${thresholds.consecutiveEnrichmentFailures})`);
  }
  if ((signals.daysSinceLastObservation ?? 0) >= thresholds.daysSinceLastObservation) {
    return decide('prolonged_inactivity',
      `${signals.daysSinceLastObservation} days since the last observation `
      + `(threshold ${thresholds.daysSinceLastObservation})`);
  }
  if (typeof signals.identityConfidence === 'number'
      && signals.identityConfidence < thresholds.minIdentityConfidence) {
    return decide('insufficient_identity_confidence',
      `identity confidence ${signals.identityConfidence} is below `
      + `${thresholds.minIdentityConfidence}`);
  }

  return { recommend: false, reason: null, reasoning: null, evidence, modelVersion: ARCHIVE_RULES_VERSION };
}

// ── persistence ports ───────────────────────────────────────────────────────

/**
 * The only writes this module performs, named explicitly so a reader can see
 * that the set does NOT include a delete, a governance write, or a retention
 * change.
 */
export interface ArchivePorts {
  /** Current status and tenant of a person, or null when unknown to this tenant. */
  readPerson(organizationId: string, personId: string):
    Promise<{ personId: string; organizationId: string; status: string } | null>;
  insertRecommendation(input: Omit<ArchiveRecommendation, 'id'>): Promise<ArchiveRecommendation>;
  readOpenRecommendation(organizationId: string, personId: string): Promise<ArchiveRecommendation | null>;
  readRecommendation(organizationId: string, recommendationId: string): Promise<ArchiveRecommendation | null>;
  updateRecommendationStatus(input: {
    organizationId: string; recommendationId: string;
    status: ArchiveRecommendationStatus; reviewedByUserId: string; reviewedAt: string;
  }): Promise<ArchiveRecommendation>;
  /** Sets `unified_persons.status`. The ONLY state mutation in this module. */
  setPersonStatus(input: {
    organizationId: string; personId: string; status: 'active' | 'archived';
  }): Promise<void>;
  now(): string;
}

const required = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

async function loadPerson(ports: ArchivePorts, organizationId: string, personId: string) {
  const person = await ports.readPerson(organizationId, personId);
  if (!person) throw new ArchiveError('person_not_found');
  // Compared, never assumed — see the header.
  if (person.organizationId !== organizationId) throw new ArchiveError('wrong_tenant');
  return person;
}

/**
 * Create a recommendation. DOES NOT ARCHIVE ANYTHING.
 *
 * This is the whole point of the contract: after this resolves, the prospect is
 * still active. A test asserts `setPersonStatus` is never called here.
 */
export async function recommendArchive(
  input: { organizationId: string; personId: string; candidacy: ArchiveCandidacy },
  ports: ArchivePorts,
): Promise<ArchiveRecommendation> {
  if (!required(input.organizationId)) throw new ArchiveError('tenant_required');
  if (!required(input.personId)) throw new ArchiveError('person_required');
  if (!input.candidacy.recommend || !input.candidacy.reason) {
    throw new ArchiveError('reason_unrecognised', 'candidacy does not recommend archival');
  }
  if (!(ARCHIVE_REASONS as readonly string[]).includes(input.candidacy.reason)) {
    throw new ArchiveError('reason_unrecognised', input.candidacy.reason);
  }

  const person = await loadPerson(ports, input.organizationId, input.personId);
  if (person.status === 'archived') throw new ArchiveError('already_archived');

  return ports.insertRecommendation({
    organizationId: input.organizationId,
    personId: input.personId,
    reason: input.candidacy.reason,
    reasoning: input.candidacy.reasoning,
    evidence: input.candidacy.evidence,
    modelVersion: input.candidacy.modelVersion,
    status: 'open',
    recommendedAt: ports.now(),
    reviewedByUserId: null,
    reviewedAt: null,
  });
}

/** Confirm: the ONLY path from a recommendation to an archived prospect. */
export async function confirmArchiveRecommendation(
  input: { organizationId: string; recommendationId: string; reviewedByUserId: string },
  ports: ArchivePorts,
): Promise<{ recommendation: ArchiveRecommendation; personStatus: 'archived' }> {
  if (!required(input.organizationId)) throw new ArchiveError('tenant_required');
  // A confirmation with no reviewer is exactly what the contract forbids.
  if (!required(input.reviewedByUserId)) throw new ArchiveError('actor_required');

  const rec = await ports.readRecommendation(input.organizationId, input.recommendationId);
  if (!rec) throw new ArchiveError('recommendation_not_found');
  if (rec.organizationId !== input.organizationId) throw new ArchiveError('wrong_tenant');
  if (rec.status !== 'open') throw new ArchiveError('recommendation_not_open', rec.status);

  await loadPerson(ports, input.organizationId, rec.personId);

  const reviewedAt = ports.now();
  const updated = await ports.updateRecommendationStatus({
    organizationId: input.organizationId,
    recommendationId: rec.id,
    status: 'confirmed',
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt,
  });
  await ports.setPersonStatus({
    organizationId: input.organizationId, personId: rec.personId, status: 'archived',
  });
  return { recommendation: updated, personStatus: 'archived' };
}

/** Reject: the prospect stays active, and the rejection is retained as audit. */
export async function rejectArchiveRecommendation(
  input: { organizationId: string; recommendationId: string; reviewedByUserId: string },
  ports: ArchivePorts,
): Promise<{ recommendation: ArchiveRecommendation; personStatus: 'active' }> {
  if (!required(input.organizationId)) throw new ArchiveError('tenant_required');
  if (!required(input.reviewedByUserId)) throw new ArchiveError('actor_required');

  const rec = await ports.readRecommendation(input.organizationId, input.recommendationId);
  if (!rec) throw new ArchiveError('recommendation_not_found');
  if (rec.organizationId !== input.organizationId) throw new ArchiveError('wrong_tenant');
  if (rec.status !== 'open') throw new ArchiveError('recommendation_not_open', rec.status);

  const updated = await ports.updateRecommendationStatus({
    organizationId: input.organizationId,
    recommendationId: rec.id,
    status: 'rejected',
    reviewedByUserId: input.reviewedByUserId,
    reviewedAt: ports.now(),
  });
  // Deliberately NO setPersonStatus call. Rejection is not a state change.
  return { recommendation: updated, personStatus: 'active' };
}

/**
 * User-initiated archive, without a recommendation.
 *
 * Still requires a named actor: the distinction the contract draws is between
 * AI and a human, not between a recommended and an unrecommended archive.
 */
export async function archiveProspect(
  input: { organizationId: string; personId: string; actorUserId: string },
  ports: ArchivePorts,
): Promise<{ personStatus: 'archived' }> {
  if (!required(input.organizationId)) throw new ArchiveError('tenant_required');
  if (!required(input.personId)) throw new ArchiveError('person_required');
  if (!required(input.actorUserId)) throw new ArchiveError('actor_required');

  const person = await loadPerson(ports, input.organizationId, input.personId);
  if (person.status === 'archived') throw new ArchiveError('already_archived');

  await ports.setPersonStatus({
    organizationId: input.organizationId, personId: input.personId, status: 'archived',
  });
  return { personStatus: 'archived' };
}

/**
 * Is this prospect eligible for NEW enrichment spend?
 *
 * PI-ADR-007 governs who may spend and the required ceiling. This adds one
 * orthogonal fact: an archived prospect is not in the active working set, so it
 * does not automatically generate new spend. Existing enrichment evidence is
 * untouched — this function reads a status and returns a boolean; it deletes
 * nothing.
 *
 * Reactivation is NOT implemented here. Setting status back to 'active' would
 * restore eligibility by this rule, but no reactivation path exists in this
 * workstream and none is invented.
 */
export const isEnrichmentEligible = (personStatus: string): boolean =>
  personStatus === 'active';
