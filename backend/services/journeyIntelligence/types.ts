/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase B — canonical Journey Understanding contracts.
 *
 * Journey Understanding is the 5th canonical Understanding entity (with Lead/Company/Offering/Visitor)
 * on the SHARED Product-Intelligence spine (`intelligence/canonical`). It OWNS ONLY temporal
 * PROGRESSION semantics (ordered touchpoints, stages, milestones, transitions, continuity, completion/
 * abandonment state, summaries); it owns NO visitor/lead/company/offering/graph semantics, NO evidence
 * timestamps (it READS them), NO scoring/explainability primitives. Ordering is DETERMINISTIC and
 * derives from EVIDENCE CHRONOLOGY (`observedAt`) — NOT from graph ordering. It REUSES the shared
 * Facet<T>/EvidenceRef/ReasoningTrace/scoring/explain and PUBLISHES references-only edges into the
 * Program-4 graph (journey is its only owned node). Descriptive only — no prediction, no intent.
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Journey score dimensions (shared generic scoring specialized to progression; NOT prediction) ──
export type JourneyScoreDimension = 'progression' | 'momentum' | 'completion' | 'continuity';
export const JOURNEY_SCORE_DIMENSIONS: readonly JourneyScoreDimension[] = ['progression', 'momentum', 'completion', 'continuity'];
export type JourneyContribution = ScoreContribution<JourneyScoreDimension>;
export type JourneyDimensionScore = DimensionScore<JourneyScoreDimension>;
export type JourneyScore = CanonicalScore<JourneyScoreDimension>;

// ── Journey state (descriptive summary — no prediction) ─────────────────────────────────────────
export type JourneyStatus = 'active' | 'completed' | 'abandoned' | 'paused' | 'branching' | 'merged';
export type JourneyActorType = 'visitor' | 'lead';

// ── Progression value shapes (ordered by evidence chronology) ───────────────────────────────────
export interface JourneyIdentityValue { canonical_id?: string; actorRef?: string | null; actorType?: JourneyActorType; companyRef?: string | null; }
export interface TouchpointEntry { id: string; entityType?: string; entityId?: string; label?: string; at: ISOTimestamp; }
export interface TouchpointsValue { ordered?: TouchpointEntry[]; count?: number; }
export interface StagesValue { current?: string | null; previous?: string | null; completed?: string[]; pending?: string[]; }
export interface MilestoneEntry { name: string; at: ISOTimestamp; }
export interface MilestonesValue { achieved?: MilestoneEntry[]; }
export interface TransitionEntry { from: string; to: string; at: ISOTimestamp; }
export interface TransitionsValue { transitions?: TransitionEntry[]; }
export interface ContinuityValue { continuous?: boolean; spanDays?: number; gaps?: number; firstAt?: ISOTimestamp; lastAt?: ISOTimestamp; }
export interface StateValue { status?: JourneyStatus; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; }

export interface JourneyFacets {
  identity: Facet<JourneyIdentityValue>;
  touchpoints: Facet<TouchpointsValue>;
  stages: Facet<StagesValue>;
  milestones: Facet<MilestonesValue>;
  transitions: Facet<TransitionsValue>;
  continuity: Facet<ContinuityValue>;
  state: Facet<StateValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type JourneyFacetName = keyof JourneyFacets;
export const JOURNEY_FACET_NAMES: JourneyFacetName[] = [
  'identity', 'touchpoints', 'stages', 'milestones', 'transitions', 'continuity', 'state', 'evidenceSummary',
];

export interface JourneyIdentityKey { companyId: string; journeyId: string; }

export interface JourneyUnderstanding {
  key: JourneyIdentityKey;
  facets: JourneyFacets;
  score: JourneyScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface JourneyProjection {
  key: JourneyIdentityKey;
  version: number;
  identity: JourneyIdentityValue | null;
  status: JourneyStatus | null;
  currentStage: string | null;
  touchpointCount: number | null;
  scores: Record<JourneyScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<JourneyFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

export interface JourneyUnderstandingShadowRecord {
  company_id: string;
  journey_id: string;
  version: number;
  understanding: JourneyUnderstanding;
  projection: JourneyProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type JourneyEvidence = EvidenceRef;
