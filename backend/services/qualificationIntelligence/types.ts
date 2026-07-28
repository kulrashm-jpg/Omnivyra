/**
 * QUALIFICATION-INTELLIGENCE-PROGRAM-008 / Phase B — canonical Qualification Understanding contracts.
 *
 * Qualification Understanding is the 7th canonical Understanding entity (with Lead/Company/Offering/
 * Visitor/Journey/Intent) on the SHARED Product-Intelligence spine (`intelligence/canonical`). It OWNS
 * ONLY the canonical EVALUATION of qualification policy (qualification state + rationale + per-criterion
 * evaluation + confidence + uncertainty + abstention + policy provenance). It owns NO upstream semantics,
 * NO evidence, NO chronology (it READS `observedAt`), NO graph semantics, and NO workflow/recommendation/
 * decision/prediction. A POLICY is a versioned, typed, IMMUTABLE INPUT (declarative criteria) — the
 * builder evaluates it; the policy owns nothing and is not infrastructure. It REUSES the shared Facet<T>/
 * EvidenceRef/ReasoningTrace/validateReasoning/scoring/explain and PUBLISHES references-only edges into
 * the Program-4 graph (qualification is its only owned node; NO reasoning/policy edges). Deterministic;
 * abstains when criteria are unevaluable. Descriptive evaluation of current facts — never prescriptive.
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Qualification score dimensions (shared generic scoring; evaluation quality, NOT prediction) ──
export type QualificationScoreDimension = 'fit' | 'readiness' | 'completeness';
export const QUALIFICATION_SCORE_DIMENSIONS: readonly QualificationScoreDimension[] = ['fit', 'readiness', 'completeness'];
export type QualificationContribution = ScoreContribution<QualificationScoreDimension>;
export type QualificationDimensionScore = DimensionScore<QualificationScoreDimension>;
export type QualificationScore = CanonicalScore<QualificationScoreDimension>;

// ── Qualification state (descriptive; NO prescription) ──────────────────────────────────────────
export type QualificationStatus = 'qualified' | 'disqualified' | 'nurture' | 'review' | 'unqualified' | (string & {});
export type QualificationActorType = 'lead' | 'visitor';

// ── Policy = versioned, typed, IMMUTABLE INPUT (declarative criteria; owns nothing) ─────────────
export type CriterionKind = 'mandatory' | 'required' | 'optional';
export interface QualificationCriterion { id: string; kind: CriterionKind; description?: string; }
export interface QualificationPolicy { policyId: string; policyVersion: number; criteria: QualificationCriterion[]; }

// ── Facet value shapes ──────────────────────────────────────────────────────────────────────────
export interface QualificationIdentityValue { canonical_id?: string; actorRef?: string | null; actorType?: QualificationActorType; objectRef?: string | null; objectType?: string; policyId?: string; }
export interface StateValue { status?: QualificationStatus; rationale?: string; }
export interface PolicyValue { policyId?: string; policyVersion?: number; criteriaCount?: number; }
export interface EvaluationValue { satisfied?: string[]; unsatisfied?: string[]; unknown?: string[]; completeness?: number; }
export interface ConfidenceValue { confidence?: number; uncertainty?: number; abstained?: boolean; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; }

export interface QualificationFacets {
  identity: Facet<QualificationIdentityValue>;
  state: Facet<StateValue>;
  policy: Facet<PolicyValue>;
  evaluation: Facet<EvaluationValue>;
  confidence: Facet<ConfidenceValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type QualificationFacetName = keyof QualificationFacets;
export const QUALIFICATION_FACET_NAMES: QualificationFacetName[] = ['identity', 'state', 'policy', 'evaluation', 'confidence', 'evidenceSummary'];

export interface QualificationIdentityKey { companyId: string; qualificationId: string; }

export interface QualificationUnderstanding {
  key: QualificationIdentityKey;
  facets: QualificationFacets;
  score: QualificationScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface QualificationProjection {
  key: QualificationIdentityKey;
  version: number;
  identity: QualificationIdentityValue | null;
  status: QualificationStatus | null;
  policyVersion: number | null;
  satisfied: string[];
  unsatisfied: string[];
  unknown: string[];
  abstained: boolean;
  scores: Record<QualificationScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  uncertainty: number;
  facetConfidence: Record<QualificationFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

export interface QualificationUnderstandingShadowRecord {
  company_id: string;
  qualification_id: string;
  version: number;
  understanding: QualificationUnderstanding;
  projection: QualificationProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type QualificationEvidence = EvidenceRef;
