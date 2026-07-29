/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase B — canonical Intent Understanding contracts.
 *
 * Intent Understanding is the 6th canonical Understanding entity (with Lead/Company/Offering/Visitor/
 * Journey) on the SHARED Product-Intelligence spine (`intelligence/canonical`). It OWNS ONLY the
 * canonical INTERPRETATION of observed evidence (inferred objective + competing intents + confidence +
 * uncertainty + abstention + evidence summary). It owns NO visitor/journey/lead/company/offering
 * semantics, NO evidence, NO chronology (it READS `observedAt`), NO graph semantics, and NO prediction/
 * recommendation/decision. It REUSES the shared Facet<T>/EvidenceRef/ReasoningTrace/validateReasoning/
 * fuseEvidence/detectEvidenceContradictions/scoring/explain and PUBLISHES references-only edges into
 * the Program-4 graph (intent is its only owned node; NO reasoning edges). Descriptive interpretation
 * of OBSERVED evidence — never a forecast. Abstains when evidence is insufficient.
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Intent score dimensions (shared generic scoring specialized to interpretation; NOT prediction) ──
export type IntentScoreDimension = 'strength' | 'clarity' | 'recency' | 'breadth';
export const INTENT_SCORE_DIMENSIONS: readonly IntentScoreDimension[] = ['strength', 'clarity', 'recency', 'breadth'];
export type IntentContribution = ScoreContribution<IntentScoreDimension>;
export type IntentDimensionScore = DimensionScore<IntentScoreDimension>;
export type IntentScore = CanonicalScore<IntentScoreDimension>;

/** Open, extensible observed objective (descriptive interpretation — never a probability). */
export type IntentObjective =
  | 'research' | 'evaluation' | 'comparison' | 'purchase' | 'onboarding' | 'adoption'
  | 'renewal' | 'expansion' | 'support' | 'retention' | (string & {});
export type IntentActorType = 'visitor' | 'lead';

// ── Intent facet value shapes ───────────────────────────────────────────────────────────────────
export interface IntentIdentityValue { canonical_id?: string; actorRef?: string | null; actorType?: IntentActorType; objectRef?: string | null; objectType?: string; }
export interface PrimaryIntentValue { objective?: IntentObjective; rationale?: string; }
export interface CompetingIntentEntry { objective: IntentObjective; confidence: number; evidenceCount: number; }
export interface CompetingIntentsValue { candidates?: CompetingIntentEntry[]; }
export interface ConfidenceValue { confidence?: number; uncertainty?: number; abstained?: boolean; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; distinctObjectives?: number; }

export interface IntentFacets {
  identity: Facet<IntentIdentityValue>;
  primaryIntent: Facet<PrimaryIntentValue>;
  competingIntents: Facet<CompetingIntentsValue>;
  confidence: Facet<ConfidenceValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type IntentFacetName = keyof IntentFacets;
export const INTENT_FACET_NAMES: IntentFacetName[] = ['identity', 'primaryIntent', 'competingIntents', 'confidence', 'evidenceSummary'];

export interface IntentIdentityKey { companyId: string; intentId: string; }

export interface IntentUnderstanding {
  key: IntentIdentityKey;
  facets: IntentFacets;
  score: IntentScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface IntentProjection {
  key: IntentIdentityKey;
  version: number;
  identity: IntentIdentityValue | null;
  primaryObjective: IntentObjective | null;
  competingObjectives: IntentObjective[];
  abstained: boolean;
  scores: Record<IntentScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  uncertainty: number;
  facetConfidence: Record<IntentFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

export interface IntentUnderstandingShadowRecord {
  company_id: string;
  intent_id: string;
  version: number;
  understanding: IntentUnderstanding;
  projection: IntentProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type IntentEvidence = EvidenceRef;
