/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase A — canonical Visitor Understanding contracts.
 *
 * Visitor Understanding is the 4th canonical Understanding entity (with Lead + Company + Offering) on
 * the SHARED Product-Intelligence spine (`intelligence/canonical`) — it REUSES the shared Facet<T>,
 * EvidenceRef, ReasoningTrace, GraphNodeRef, and the dimension-generic scoring contract, and PUBLISHES
 * references-only edges into the Program-4 graph. It OWNS ONLY visitor semantics (identity, device,
 * geo, referral, acquisition, session, behavioral + engagement summary, lifecycle); it owns NO Lead /
 * Company / Offering / Journey / Intent / graph / cross-entity / platform semantics. Every field
 * abstains (null) when unevidenced; nothing is fabricated. No identity resolution, no attribution
 * modelling, no intent inference (descriptive only).
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Visitor score dimensions (shared generic scoring specialized to visitor; behavioral, not intent) ──
export type VisitorScoreDimension = 'engagement' | 'recency' | 'loyalty' | 'reach';
export const VISITOR_SCORE_DIMENSIONS: readonly VisitorScoreDimension[] = ['engagement', 'recency', 'loyalty', 'reach'];
export type VisitorContribution = ScoreContribution<VisitorScoreDimension>;
export type VisitorDimensionScore = DimensionScore<VisitorScoreDimension>;
export type VisitorScore = CanonicalScore<VisitorScoreDimension>;

// ── Visitor identity (descriptive only — NO identity resolution performed) ──────────────────────
export type VisitorStatus = 'anonymous' | 'known' | 'identified' | 'merged';
export type VisitorLifecycleState = 'new' | 'returning' | 'active' | 'inactive' | 're_engaged' | 'converted';

// ── Visitor facet domains (canonical ontology; every field abstains when unevidenced) ───────────
export interface VisitorIdentityValue { canonical_id?: string; status?: VisitorStatus; aliases?: string[]; leadRef?: string | null; companyRef?: string | null; identityConfidence?: number; }
export interface DeviceValue { device?: string; browser?: string; os?: string; screen?: string; language?: string; timezone?: string; capabilities?: string[]; }
export interface GeoValue { country?: string; region?: string; city?: string; timezone?: string; }
export interface ReferralValue { referrer?: string; referrerDomain?: string; referrerType?: string; }
export interface AcquisitionValue { source?: string; medium?: string; campaign?: string; entryPage?: string; landingContext?: string; utm?: Record<string, string>; }
export interface SessionValue { sessionCount?: number; firstSeenAt?: ISOTimestamp; lastSeenAt?: ISOTimestamp; entryPage?: string; exitPage?: string; durationSeconds?: number; pageCount?: number; frequency?: string; bounce?: boolean; }
export interface BehavioralValue { pagesViewed?: string[]; contentConsumed?: string[]; searchActivity?: string[]; downloads?: string[]; engagementEvents?: string[]; interactionCategories?: string[]; }
export interface EngagementSummaryValue { level?: string; signals?: string[]; }
export interface LifecycleValue { state?: VisitorLifecycleState; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; }

export interface VisitorFacets {
  identity: Facet<VisitorIdentityValue>;
  device: Facet<DeviceValue>;
  geo: Facet<GeoValue>;
  referral: Facet<ReferralValue>;
  acquisition: Facet<AcquisitionValue>;
  session: Facet<SessionValue>;
  behavioral: Facet<BehavioralValue>;
  engagement: Facet<EngagementSummaryValue>;
  lifecycle: Facet<LifecycleValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type VisitorFacetName = keyof VisitorFacets;
export const VISITOR_FACET_NAMES: VisitorFacetName[] = [
  'identity', 'device', 'geo', 'referral', 'acquisition', 'session', 'behavioral', 'engagement', 'lifecycle', 'evidenceSummary',
];

export interface VisitorIdentityKey { companyId: string; visitorId: string; }

export interface VisitorUnderstanding {
  key: VisitorIdentityKey;
  facets: VisitorFacets;
  score: VisitorScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface VisitorProjection {
  key: VisitorIdentityKey;
  version: number;
  identity: VisitorIdentityValue | null;
  status: VisitorStatus | null;
  lifecycle: VisitorLifecycleState | null;
  scores: Record<VisitorScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<VisitorFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

export interface VisitorUnderstandingShadowRecord {
  company_id: string;
  visitor_id: string;
  version: number;
  understanding: VisitorUnderstanding;
  projection: VisitorProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type VisitorEvidence = EvidenceRef;
