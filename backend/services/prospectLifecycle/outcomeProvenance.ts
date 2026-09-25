/**
 * PI-LIFECYCLE-003B Stage 1 — WHO ASSERTED THIS OUTCOME, AND MAY THEY?
 *
 * The interpreter received `{ id, type }`. That is enough to read what an
 * outcome SAYS and not enough to know whether anything should be believed on
 * its word: an operator's assertion, a vendor webhook, a CSV import and a row
 * whose `source` is NULL all arrive identically. `meeting_booked` is the case
 * that makes this matter — the platform has no booking integration, so the only
 * possible witness is a human, and a contract that cannot see the human cannot
 * tell one from an anonymous import.
 *
 * This module answers the authorization question and nothing else. It proposes
 * no transition, reads no database, and does not make `meeting_scheduled`
 * reachable. Whether an authorized human assertion SHOULD advance the lifecycle
 * has since been DECIDED — PI-LIFECYCLE-003B, option (a), by the programme
 * owner: it may not. This module is retained as an audit/attribution
 * capability, never as lifecycle authority (`PI-ADR-006`).
 *
 * ─── IT REUSES THE EXISTING VOCABULARY ────────────────────────────────────
 * `FeedbackSource` (leadOutreachExecution/types.ts) is the canonical
 * source-kind axis for this domain and already mirrors the
 * `outreach_outcomes_source_valid` CHECK. A second list would be a second
 * authority, so there is none here: the six values come from `FEEDBACK_SOURCES`
 * by import, and a test asserts this module's classification covers exactly
 * those six.
 *
 * ─── IT FAILS CLOSED, AND THAT IS THE POINT ───────────────────────────────
 * `outreach_outcomes.source` is NULLABLE (`source IS NULL OR source IN (...)`),
 * so a row genuinely can carry no provenance at all. Absent, unrecognised, or
 * internally inconsistent provenance yields `unauthorized` with a stated
 * reason. There is no path by which missing provenance is read as human.
 */

import type { FeedbackSource } from '../leadOutreachExecution/types';

/**
 * Membership in the canonical source vocabulary, as a TOTAL record.
 *
 * The runtime `FEEDBACK_SOURCES` array lives in `feedbackIngestion.ts`, which
 * reaches storage and the database. Importing it here would give a pure
 * authorization module a dependency on an ingestion path it is not part of —
 * the same reason `outcomeInterpreter` refuses to import the corpus. So the
 * TYPE is imported and membership is derived from a total
 * `Record<FeedbackSource, true>`: a seventh source, or a removed one, is a
 * COMPILE error here rather than a silent gap. That is the idiom
 * `OUTCOME_TRANSITION_MAP` already uses for the eight-value outcome vocabulary.
 */
const KNOWN_SOURCES: Record<FeedbackSource, true> = {
  provider_webhook: true,
  provider_poll: true,
  manual: true,
  import: true,
  derived: true,
  internal: true,
};

/** Bumped when the classification changes, so a stored decision traces its rule. */
export const OUTCOME_PROVENANCE_VERSION = 'pi.outcome-provenance.1';

/**
 * The actor behind a HUMAN assertion, bound to the tenant they acted in.
 *
 * Both fields are required together on purpose. `outreach_outcomes` has no
 * actor column — the id lives in `metadata.recordedByUserId`, written from the
 * route's authenticated principal — so a caller assembling this has already
 * resolved a real user. Carrying the organisation alongside lets the check
 * below compare it to the outcome's own tenant rather than trusting that the
 * caller looked.
 */
export interface AssertingActor {
  readonly userId: string;
  /** The tenant the actor was authenticated in. Compared, never assumed. */
  readonly organizationId: string;
}

/**
 * What is known about where an outcome came from.
 *
 * Every field mirrors something the row already stores, so this is a projection
 * of existing state rather than a new model:
 *   source          → outreach_outcomes.source        (nullable)
 *   provider        → outreach_outcomes.provider      (nullable)
 *   providerEventId → outreach_outcomes.provider_event_id
 *   derived         → outreach_outcomes.derived
 *   actor           → metadata.recordedByUserId, resolved by the caller
 *   organizationId  → outreach_outcomes.company_id, the ONLY tenant key
 */
export interface OutcomeProvenance {
  /** The tenant the outcome belongs to. The canonical company boundary. */
  readonly organizationId: string;
  /** Null is a real state, not a defect — and it is refused. */
  readonly source: FeedbackSource | string | null;
  readonly provider?: string | null;
  readonly providerEventId?: string | null;
  /** True when a rule asserted it rather than anything witnessing it. */
  readonly derived?: boolean;
  /** Present only for a human assertion. */
  readonly actor?: AssertingActor | null;
}

/**
 * The authority a source carries. Deliberately NOT a numeric confidence: the
 * question is categorical — may this source establish the claim — and a score
 * would invite arithmetic on it.
 */
export type AssertionAuthority =
  /** A named, tenant-bound human took responsibility for the claim. */
  | 'authorized_human'
  /** A vendor API we called. Identified, but no human vouched for it. */
  | 'provider'
  /** A vendor pushed it to us. Identified by provider + event id. */
  | 'webhook'
  /** It arrived in a batch. Provenance is the batch, not an observer. */
  | 'import'
  /** The platform itself produced it, including rule-derived assertions. */
  | 'system'
  /** Nothing here may be relied upon. Always the answer when unsure. */
  | 'unauthorized';

/** Why a classification came out as it did. Stable strings; safe to branch on. */
export type ProvenanceReason =
  | 'human_actor_present'
  | 'provider_identified'
  | 'webhook_identified'
  | 'import_batch'
  | 'system_generated'
  | 'tenant_missing'
  | 'source_absent'
  | 'source_unrecognised'
  | 'human_actor_missing'
  | 'actor_tenant_mismatch'
  | 'provider_unidentified'
  | 'derived_claims_human';

export interface ProvenanceVerdict {
  readonly authority: AssertionAuthority;
  readonly reason: ProvenanceReason;
  /** The actor, echoed only when the verdict actually rests on one. */
  readonly actor: AssertingActor | null;
  readonly version: string;
}

export const isFeedbackSource = (v: unknown): v is FeedbackSource =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_SOURCES, v);

/** The canonical six, derived from the total record rather than restated. */
export const PROVENANCE_SOURCES = Object.keys(KNOWN_SOURCES) as readonly FeedbackSource[];

const verdict = (
  authority: AssertionAuthority,
  reason: ProvenanceReason,
  actor: AssertingActor | null = null,
): ProvenanceVerdict => ({
  authority, reason, actor, version: OUTCOME_PROVENANCE_VERSION,
});

const blank = (v: string | null | undefined): boolean => !v || !String(v).trim();

/**
 * Classify what authority an outcome's provenance carries.
 *
 * Pure: no clock, no I/O, no database. Total over the six `FEEDBACK_SOURCES`
 * plus every malformed shape. Order matters — the tenant and the source
 * vocabulary are checked before anything is believed about either.
 */
export function classifyOutcomeProvenance(
  provenance: OutcomeProvenance | null | undefined,
): ProvenanceVerdict {
  // Absent provenance is the case this module exists for.
  if (!provenance) return verdict('unauthorized', 'source_absent');

  // A tenant-less claim cannot be checked against anything, so it is refused
  // before its contents are read. This is the same boundary every PI writer
  // uses; no second tenant key is introduced.
  if (blank(provenance.organizationId)) return verdict('unauthorized', 'tenant_missing');

  if (blank(typeof provenance.source === 'string' ? provenance.source : null)) {
    return verdict('unauthorized', 'source_absent');
  }
  if (!isFeedbackSource(provenance.source)) {
    // A source outside the closed vocabulary is reported, never mapped to the
    // nearest recognised one.
    return verdict('unauthorized', 'source_unrecognised');
  }

  const actor = provenance.actor ?? null;

  switch (provenance.source) {
    case 'manual': {
      // A manual row claims a human observed something. If no actor survived to
      // here, nobody is accountable for the claim and it is not a human
      // assertion — it is an unattributed one.
      if (!actor || blank(actor.userId)) return verdict('unauthorized', 'human_actor_missing');
      if (blank(actor.organizationId) || actor.organizationId !== provenance.organizationId) {
        // Cross-tenant: an actor authenticated in tenant A cannot establish an
        // outcome for tenant B, whatever the row says.
        return verdict('unauthorized', 'actor_tenant_mismatch', null);
      }
      if (provenance.derived === true) {
        // `derived` means a rule asserted it. A rule is not a witness, so a row
        // cannot be both derived and a human observation; the contradiction is
        // refused rather than resolved in either direction.
        return verdict('unauthorized', 'derived_claims_human', null);
      }
      return verdict('authorized_human', 'human_actor_present', actor);
    }

    case 'provider_webhook': {
      // A push we did not initiate. It must at least say who pushed it.
      if (blank(provenance.provider)) return verdict('unauthorized', 'provider_unidentified');
      return verdict('webhook', 'webhook_identified');
    }

    case 'provider_poll': {
      if (blank(provenance.provider)) return verdict('unauthorized', 'provider_unidentified');
      return verdict('provider', 'provider_identified');
    }

    case 'import':
      return verdict('import', 'import_batch');

    case 'derived':
    case 'internal':
      return verdict('system', 'system_generated');
  }
}

/**
 * Does this provenance establish a claim a HUMAN had to witness?
 *
 * `meeting_booked` is the motivating case: with no booking integration, no
 * machine can witness a booking, so only an authorized human assertion could
 * ever support it. This predicate is the single place that question is asked.
 *
 * It answers authorization ONLY. It does not decide whether an authorized
 * assertion advances the lifecycle: PI-LIFECYCLE-003B decided that it does not
 * (option (a), recorded in `PI-ADR-006`), and nothing in this module makes
 * `meeting_scheduled` reachable.
 */
export const establishesHumanWitnessedClaim = (
  provenance: OutcomeProvenance | null | undefined,
): boolean => classifyOutcomeProvenance(provenance).authority === 'authorized_human';
