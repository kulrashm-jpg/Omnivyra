/**
 * D1 — canonical contracts for the tenant-owned Ideal Customer Profile.
 *
 * ONE ICP (contract 14). There is no account ICP and no person ICP. There is a
 * single versioned document, and `subject` says which side of the prospect a
 * given criterion reads. Account fit and person fit are two EVALUATIONS of the
 * same ratified version — see `evaluate.ts`.
 *
 * ─── THE CRITERION SHAPE IS MODELLED ON QualificationPolicy ───────────────
 * `backend/services/qualificationIntelligence/types.ts` already established the
 * repository's answer to "a versioned, typed, IMMUTABLE declarative input that
 * something else evaluates": `{ policyId, policyVersion, criteria[] }` with
 * `CriterionKind = 'mandatory' | 'required' | 'optional'`. That vocabulary is
 * reused verbatim rather than re-invented, because the semantics are identical
 * — a mandatory criterion is disqualifying, a required one is expected, an
 * optional one is a bonus — and two spellings of the same idea is how two
 * subtly different meanings eventually appear.
 *
 * ─── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────
 *
 * PER-CRITERION WEIGHTS. A weight is a tuning knob, and a tuning knob invented
 * without a calibration set is a guess with a number attached. `kind` already
 * expresses the only distinction the evaluator needs, and it is a distinction a
 * person can state and defend.
 *
 * NEGATION / EXCLUSION PREDICATES (`not_one_of`, `excludes`). An exclusion is a
 * different product decision — "never approach these" is suppression, which
 * `contact_governance_records` and the outreach governance stack already own.
 * An ICP describes who you WANT.
 *
 * FUZZY, CONTAINS, PREFIX AND REGEX MATCHING. Contract 17 permits exact-match
 * and numeric-range predicates only on the fields with no established
 * vocabulary. `industry LIKE '%software%'` is not a predicate, it is an
 * improvised taxonomy, and it would silently classify "Software-Defined
 * Storage" and "Software Training" as the same market.
 *
 * AN INDUSTRY / REVENUE-BAND / FUNDING-STAGE VOCABULARY. P2A assigned those to
 * the first real enrichment provider, which has not been chosen. Inventing one
 * here would make every criterion written against it wrong the day a provider
 * with a different taxonomy arrives.
 */

import type { EvidenceRef, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution } from '../intelligence/canonical';

// ── Score dimension ─────────────────────────────────────────────────────────
/**
 * The single dimension this module contributes to.
 *
 * Declared LOCALLY and deliberately NOT added to `leadUnderstanding`'s
 * `SCORE_DIMENSIONS`: wiring ICP fit into lead scoring is a later phase with a
 * different owner. The string matches the `icp` dimension `personaIcp.ts`
 * already emits, so when that wiring happens the contributions land in the
 * dimension that already exists rather than opening a second one.
 */
export type IcpScoreDimension = 'icp';
export type IcpContribution = ScoreContribution<IcpScoreDimension>;

// ── Lifecycle ───────────────────────────────────────────────────────────────
/**
 * Mirrors `prospect_icp_versions_status_valid` exactly; the database is the
 * authority and this array must not drift from it.
 *
 * `draft` and `proposed` are BOTH pre-ratification and neither is an input to
 * scoring (contract 16). They are distinguished because a proposal has been put
 * forward for a decision and a draft has not — the difference between "the
 * model suggested this" and "someone is still writing it".
 */
export const ICP_VERSION_STATUSES = ['draft', 'proposed', 'ratified', 'superseded'] as const;
export type IcpVersionStatus = typeof ICP_VERSION_STATUSES[number];

/** The only statuses that are an input to scoring. Exactly one of them. */
export const RATIFIED_STATUS: IcpVersionStatus = 'ratified';

// ── Criteria ────────────────────────────────────────────────────────────────
export type IcpSubject = 'account' | 'person';
export const ICP_SUBJECTS: readonly IcpSubject[] = ['account', 'person'];

/** Reused verbatim from `QualificationPolicy`'s `CriterionKind`. */
export const ICP_CRITERION_KINDS = ['mandatory', 'required', 'optional'] as const;
export type IcpCriterionKind = typeof ICP_CRITERION_KINDS[number];

/**
 * How a criterion's values are checked. Which of these an attribute may use is
 * decided by that attribute's DATA KIND in `criteria.ts`, and contract 17 is
 * enforced there: exact-match (`one_of`) or numeric range, and nothing else.
 */
export type IcpPredicate =
  /** Exact membership of a stated set. The ONLY text predicate that exists. */
  | { op: 'one_of'; values: string[] }
  | { op: 'between'; min: number; max: number }
  | { op: 'at_least'; value: number }
  | { op: 'at_most'; value: number }
  /** Array attributes only (`technologies`). Membership, still exact. */
  | { op: 'includes_any'; values: string[] }
  | { op: 'includes_all'; values: string[] };

export type IcpPredicateOp = IcpPredicate['op'];

export interface IcpCriterion {
  /** Stable within a version. Cited by every evidence reference. */
  id: string;
  kind: IcpCriterionKind;
  subject: IcpSubject;
  /** A column name on `prospect_accounts` or `unified_persons`. */
  attribute: string;
  predicate: IcpPredicate;
  /** Prose for the console. Never read by the evaluator. */
  description?: string | null;
}

// ── The versioned document ──────────────────────────────────────────────────
/**
 * The repository's EXISTING proposal-state shape, reused rather than forked:
 * `UserGuidedStrategicField` from `backend/services/companyProfile/types.ts`.
 *
 * It is re-declared structurally (not imported) for one reason: importing
 * `companyProfile/types` here would make the prospect spine depend on the
 * company-profile module, and this contract must be readable by anything. The
 * FIELD NAMES are identical on purpose, so a console component already written
 * against a `UserGuidedStrategicField` renders this without translation.
 */
export interface IcpProposal {
  ai_value?: string | null;
  approved_value?: string | null;
  edited_value?: string | null;
  status?: 'ai_suggested' | 'approved' | 'edited' | 'rejected' | 'regenerate_requested';
  guidance?: string | null;
  updated_at?: string | null;
}

export interface IcpVersionRecord {
  id: string;
  organizationId: string;
  icpId: string;
  version: number;
  status: IcpVersionStatus;
  criteria: IcpCriterion[];
  proposal: IcpProposal;
  proposedByModel: string | null;
  ratifiedAt: ISOTimestamp | null;
  /** A user id. A model has none, which is the point (contract 16). */
  ratifiedBy: string | null;
  supersededAt: ISOTimestamp | null;
  supersededByVersion: number | null;
  createdAt: ISOTimestamp;
}

/**
 * A ratified version, narrowed. The evaluator accepts ONLY this type, so a
 * draft cannot reach scoring by accident — the type system refuses it before
 * any runtime check does.
 */
export interface RatifiedIcp {
  organizationId: string;
  icpId: string;
  icpKey: string;
  version: number;
  criteria: IcpCriterion[];
  ratifiedAt: ISOTimestamp;
  ratifiedBy: string;
}

// ── Evaluation ──────────────────────────────────────────────────────────────
/**
 * Per contract 18, `unknown` is a first-class outcome and is NEITHER satisfied
 * NOR unsatisfied. A criterion whose attribute the platform has never observed
 * says nothing about fit, and treating it as a failure would penalise a
 * prospect for our own missing data.
 */
export type IcpCriterionOutcome = 'satisfied' | 'unsatisfied' | 'unknown';

export interface IcpCriterionResult {
  id: string;
  kind: IcpCriterionKind;
  subject: IcpSubject;
  attribute: string;
  outcome: IcpCriterionOutcome;
}

/** The observed attributes of ONE side of a prospect, keyed by column name. */
export interface IcpSubjectFacts {
  subject: IcpSubject;
  /** Raw values as stored; normalisation happens in the evaluator. */
  attributes: Record<string, unknown>;
  /** When these attributes were observed. Falls back to `asOf`. */
  observedAt?: ISOTimestamp | null;
}

export interface IcpFitEvaluation {
  /** Null ONLY when there is no ratified ICP — the contract-18 abstention. */
  icpId: string | null;
  version: number | null;
  subject: IcpSubject;
  results: IcpCriterionResult[];
  satisfied: string[];
  unsatisfied: string[];
  unknown: string[];
  /**
   * ZERO OR ONE contribution. Empty when abstaining — never a contribution
   * carrying `value: 0`, and never one carrying `0.5`. `combineDimension`
   * treats an absent contribution as an abstention; a zero is a claim.
   */
  contributions: IcpContribution[];
  evidence: EvidenceRef[];
  abstained: boolean;
  /** Machine-readable abstention/derivation reason. Stable strings. */
  reason: IcpEvaluationReason;
}

export type IcpEvaluationReason =
  | 'no_ratified_icp'
  | 'no_criteria_for_subject'
  | 'no_evaluable_criteria'
  | 'mandatory_unsatisfied'
  | 'evaluated';

/** Raised by the criteria validator and the writers. Never by the evaluator. */
export class IcpContractError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'IcpContractError';
  }
}
