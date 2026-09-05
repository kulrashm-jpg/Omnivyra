/**
 * D1 — the tenant-owned Ideal Customer Profile. Public surface.
 *
 * ONE ICP (contract 14). One versioned document per tenant key; account fit and
 * person fit are two EVALUATIONS of it, produced by calling `evaluateIcpFit`
 * twice with different subjects. There is no account ICP and no person ICP, and
 * adding one would be the specific mistake this module exists to prevent.
 *
 * The layers, and who owns what:
 *
 *   types.ts        the contracts. No behaviour.
 *   criteria.ts     CONTRACT 17. The only place that knows which vocabularies
 *                   are closed and which predicates each attribute admits.
 *   evaluate.ts     CONTRACT 18. Pure, deterministic, abstains rather than
 *                   defaults, and never reads a database or a clock.
 *   persistence.ts  CONTRACT 15 + 16. The only writer. INSERT and catch 23505,
 *                   never ON CONFLICT.
 *
 * NOTHING CONSUMES THIS YET. `personaIcp.ts`, `SCORE_DIMENSIONS` and
 * `intelligence/canonical/scoring.ts` are untouched: wiring ICP fit into lead
 * scoring is a later phase with a different owner. The contribution this module
 * emits is already shaped for the frozen `combineDimension`, so that wiring is
 * a call site, not a redesign.
 */

export {
  ICP_CRITERION_KINDS, ICP_SUBJECTS, ICP_VERSION_STATUSES, RATIFIED_STATUS,
  IcpContractError,
  // ICP-SELECTION-CONTRACT-001 vocabularies. Proposal metadata only.
  ICP_CONFIDENCE_LEVELS, ICP_CONFIDENCE_MULTIPLIER, ICP_ORG_STAGES,
  ICP_TARGET_DERIVATIONS, ICP_TARGET_ROLE_TYPES,
} from './types';

export type {
  IcpContribution, IcpCriterion, IcpCriterionKind, IcpCriterionOutcome, IcpCriterionResult,
  IcpEvaluationReason, IcpFitEvaluation, IcpPredicate, IcpPredicateOp, IcpProposal,
  IcpScoreDimension, IcpSubject, IcpSubjectFacts, IcpVersionRecord, IcpVersionStatus,
  RatifiedIcp,
  // ICP-SELECTION-CONTRACT-001 §12/§13.
  IcpConfidenceLevel, IcpFactorScore, IcpOrgStage, IcpRejected, IcpStageAssumption,
  IcpTarget, IcpTargetDerivation, IcpTargetFactors, IcpTargetRoleType,
} from './types';

export { attributeKind, attributesFor, validateCriteria, validateCriterion, MAX_CRITERIA } from './criteria';

export { validateProposalTargets, withValidatedTargets, MAX_ICP_TARGETS } from './proposalTargets';
export type { ValidatedProposalTargets } from './proposalTargets';

export { evaluateIcpFit } from './evaluate';
export type { IcpEvaluationInput } from './evaluate';

export {
  createIcpVersion, ensureIcp, getIcpVersion, getRatifiedIcp,
  nextVersionNumber, ratifyIcpVersion, resolveIcpByKey,
} from './persistence';
export type {
  CreateVersionInput, CreateVersionResult, EnsureIcpResult, RatifyInput, RatifyResult,
} from './persistence';
