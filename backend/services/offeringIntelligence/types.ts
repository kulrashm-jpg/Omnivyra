/**
 * OFFERING-INTELLIGENCE-PROGRAM-003 / Phase B — canonical Offering Understanding contracts.
 *
 * Offering Understanding is the 3rd canonical Understanding entity (with Lead + Company) on the
 * SHARED Product-Intelligence spine (`intelligence/canonical`) — it REUSES Program 1/2's Facet<T>,
 * EvidenceRef, ReasoningTrace, GraphNodeRef, and the dimension-generic scoring contract. It ADOPTS
 * the certified-shadow OFFERING-UNDERSTANDING-001 domain design (identity + offering_type
 * product|service|bundle + category + capabilities + evidence-first projection) — but expressed on
 * the shared Facet contracts instead of the shadow module's forked trivial `Facet` (OI-B202).
 */

import type { Facet, EvidenceRef, ReasoningTrace, ContradictionRef, GraphNodeRef, GraphEdge, ISOTimestamp } from '../intelligence/canonical';
import type { ScoreContribution, DimensionScore, CanonicalScore } from '../intelligence/canonical';

export type { EvidenceRef, ReasoningTrace, ContradictionRef, ISOTimestamp };

// ── Offering score dimensions (shared generic scoring specialized to offering) ──────────────────
export type OfferingScoreDimension = 'adoption' | 'market_fit' | 'differentiation' | 'maturity';
export const OFFERING_SCORE_DIMENSIONS: readonly OfferingScoreDimension[] = ['adoption', 'market_fit', 'differentiation', 'maturity'];
export type OfferingContribution = ScoreContribution<OfferingScoreDimension>;
export type OfferingDimensionScore = DimensionScore<OfferingScoreDimension>;
export type OfferingScore = CanonicalScore<OfferingScoreDimension>;

/** Open, extensible offering type (adopted from the shadow design). */
export type OfferingType = 'product' | 'service' | 'bundle' | (string & {});

// ── Offering facet domains (canonical ontology; every field abstains when unevidenced) ──────────
export interface IdentityValue { canonical_id?: string; name?: string; aliases?: string[]; }
export interface CategoryValue { category?: string; }
export interface PositioningValue { statement?: string; segment?: string; }
export interface ValuePropositionValue { statement?: string; }
export interface CustomerProblemsValue { problems?: string[]; }
export interface OutcomesValue { outcomes?: string[]; }
export interface DifferentiatorsValue { differentiators?: string[]; }
export interface CapabilitiesValue { capabilities?: string[]; }
export interface FeaturesValue { features?: string[]; }
export interface PricingValue { model?: string; plans?: string[]; }
export interface PackagingValue { packages?: string[]; }
export interface IndustriesValue { industries?: string[]; }
export interface PersonasValue { personas?: string[]; }
export interface IcpAlignmentValue { fit?: string; segments?: string[]; }
export interface DeploymentValue { models?: string[]; }
export interface IntegrationsValue { integrations?: string[]; }
export interface ComplianceValue { standards?: string[]; }
export interface LifecycleValue { stage?: string; }
export interface RoadmapValue { signals?: string[]; }
export interface AdoptionValue { level?: string; usage?: string[]; }
export interface EcosystemValue { partners?: string[]; }
export interface RecommendationsValue { positioningMove?: string; nextBestAction?: string; }
export interface EvidenceSummaryValue { totalEvidence?: number; freshestAt?: ISOTimestamp; }

export interface OfferingFacets {
  identity: Facet<IdentityValue>;
  offeringType: Facet<OfferingType>;
  category: Facet<CategoryValue>;
  positioning: Facet<PositioningValue>;
  valueProposition: Facet<ValuePropositionValue>;
  customerProblems: Facet<CustomerProblemsValue>;
  outcomes: Facet<OutcomesValue>;
  differentiators: Facet<DifferentiatorsValue>;
  capabilities: Facet<CapabilitiesValue>;
  features: Facet<FeaturesValue>;
  pricing: Facet<PricingValue>;
  packaging: Facet<PackagingValue>;
  industries: Facet<IndustriesValue>;
  personas: Facet<PersonasValue>;
  icpAlignment: Facet<IcpAlignmentValue>;
  deployment: Facet<DeploymentValue>;
  integrations: Facet<IntegrationsValue>;
  compliance: Facet<ComplianceValue>;
  lifecycle: Facet<LifecycleValue>;
  roadmap: Facet<RoadmapValue>;
  adoption: Facet<AdoptionValue>;
  ecosystem: Facet<EcosystemValue>;
  recommendations: Facet<RecommendationsValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
}
export type OfferingFacetName = keyof OfferingFacets;
export const OFFERING_FACET_NAMES: OfferingFacetName[] = [
  'identity', 'offeringType', 'category', 'positioning', 'valueProposition', 'customerProblems',
  'outcomes', 'differentiators', 'capabilities', 'features', 'pricing', 'packaging', 'industries',
  'personas', 'icpAlignment', 'deployment', 'integrations', 'compliance', 'lifecycle', 'roadmap',
  'adoption', 'ecosystem', 'recommendations', 'evidenceSummary',
];

export interface OfferingIdentityKey { companyId: string; offeringId: string; }

export interface OfferingUnderstanding {
  key: OfferingIdentityKey;
  facets: OfferingFacets;
  score: OfferingScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: { root: GraphNodeRef; edges: GraphEdge[] };
  version: number;
  builtAt: ISOTimestamp;      // passed in (deterministic — never Date.now)
}

export interface OfferingProjection {
  key: OfferingIdentityKey;
  version: number;
  identity: IdentityValue | null;
  offeringType: OfferingType | null;
  scores: Record<OfferingScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<OfferingFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

export interface OfferingUnderstandingShadowRecord {
  company_id: string;
  offering_id: string;
  version: number;
  understanding: OfferingUnderstanding;
  projection: OfferingProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}

export type OfferingEvidence = EvidenceRef;
