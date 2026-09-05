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

  // ── ICP-SELECTION-CONTRACT-001 §13 — the ranked shortlist and its provenance
  //
  // PROPOSAL METADATA ONLY. The evaluator never reads these, and they never
  // become criteria: §10 is explicit that the selected titles form ONE union
  // `one_of` criterion, because `satisfied / evaluable` would score a person
  // matching one of five role-criteria at 0.2.
  //
  // NAMING: the six fields above are snake_case because they mirror
  // `UserGuidedStrategicField` verbatim. These three are camelCase because
  // §13 names them that way, and the frozen contract owns its own field names.
  targets?: IcpTarget[];
  rejected?: IcpRejected[];
  stageAssumption?: IcpStageAssumption;
}

// ── ICP-SELECTION-CONTRACT-001 vocabularies ─────────────────────────────────
/**
 * §12's role types. Deliberately NOT `BUYING_ROLES` from
 * `prospectIdentity/attributes.ts`, for two reasons that both point the same
 * way: §13 forbids extending `BUYING_ROLES` (it mirrors a database CHECK), and
 * the two describe different things — `buying_role` is an OBSERVED attribute of
 * a real person, while this is the archetype a PROPOSED target represents. The
 * overlap is intentional and the values are spelled identically where they
 * coincide, so a later reconciliation is a rename and not a re-modelling.
 */
export const ICP_TARGET_ROLE_TYPES = [
  'user', 'evaluator', 'economic_buyer', 'decision_maker', 'influencer', 'sponsor',
] as const;
export type IcpTargetRoleType = typeof ICP_TARGET_ROLE_TYPES[number];

/** §12. An inferred title is never presented as a directly observed fact. */
export const ICP_TARGET_DERIVATIONS = ['directly_evidenced', 'inferred'] as const;
export type IcpTargetDerivation = typeof ICP_TARGET_DERIVATIONS[number];

/**
 * The repository's existing categorical confidence vocabulary
 * (`'high' | 'medium' | 'low'`, used by `outcomeEvaluator`, the analytics
 * services and the campaign engines). Re-declared structurally rather than
 * imported, for exactly the reason recorded above `IcpProposal`: importing
 * `lib/campaigns/**` here would make the prospect spine depend on the campaign
 * module. The VALUES are identical on purpose.
 */
export const ICP_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type IcpConfidenceLevel = typeof ICP_CONFIDENCE_LEVELS[number];

/** §4's `ORG_STAGE`, normalised onto the existing employee bands. */
export const ICP_ORG_STAGES = ['micro', 'smb', 'structured'] as const;
export type IcpOrgStage = typeof ICP_ORG_STAGES[number];

/** §7's confidence multiplier, keyed by the same vocabulary. */
export const ICP_CONFIDENCE_MULTIPLIER: Readonly<Record<IcpConfidenceLevel, number>> = {
  high: 1, medium: 0.8, low: 0.5,
};

/**
 * §7's five additive factors plus the confidence multiplier. Each is 0–2 and
 * each traces to a named field; `rank_score = (e + p + b + f + r) x c`.
 *
 * `e` is typed `1 | 2` and not `0 | 1 | 2`: §7 makes `E = 0` a HARD EXCLUSION,
 * so a candidate scoring 0 there is not a target at all. The type says so.
 */
export type IcpFactorScore = 0 | 1 | 2;

export interface IcpTargetFactors {
  /** Evidence directness. 2 = named verbatim, 1 = implied. 0 excludes. */
  e: 1 | 2;
  /** Problem ownership. */
  p: IcpFactorScore;
  /** Buying authority at the assumed stage. */
  b: IcpFactorScore;
  /** Organizational fit — does the role exist at that stage. */
  f: IcpFactorScore;
  /** Product relevance. */
  r: IcpFactorScore;
  /** Confidence multiplier. Must agree with the target's `confidence`. */
  c: number;
}

/**
 * One recommended target. §8 calls the set a RANKED SHORTLIST, not five
 * filters — the whole set collapses into a single union criterion downstream.
 */
export interface IcpTarget {
  /** 1-based, unique and contiguous across the shortlist. */
  rank: number;
  /** The job title as it will appear in the union `one_of` criterion. */
  title: string;
  /**
   * §14 assigns SEVERAL role types to one target — a founder at micro scale is
   * decision maker, economic buyer and sponsor at once — so a scalar could not
   * round-trip the frozen worked example.
   */
  roleTypes: IcpTargetRoleType[];
  derivation: IcpTargetDerivation;
  confidence: IcpConfidenceLevel;
  /** Named source fields. Never empty — §5: no evidence, no candidate. */
  evidenceFields: string[];
  /** Verbatim quotes. Required when `derivation` is `directly_evidenced`. */
  evidenceQuotes: string[];
  /** The organizational assumption that put this role on the list. */
  orgAssumption: string;
  factors: IcpTargetFactors;
}

/** §8's alternates. A rejection with no reason is not auditable. */
export interface IcpRejected {
  /** The candidate that was considered and refused. */
  title: string;
  reason: string;
}

/** §4's `ORG_STAGE` conclusion, with the evidence it was read from. */
export interface IcpStageAssumption {
  stage: IcpOrgStage;
  evidenceFields: string[];
  rationale?: string | null;
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
