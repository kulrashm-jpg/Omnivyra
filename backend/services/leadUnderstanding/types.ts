/**
 * LEAD-INTELLIGENCE-PROGRAM-001 / Phase B — Canonical Lead Understanding contracts.
 *
 * The ONE type spine for Lead Intelligence: Facet<T> (mirrors the certified Company/Offering
 * Understanding facet contract, ready to converge to a shared generic), a unified evidence model,
 * one scoring contract, one reasoning contract, one projection, and the graph model. Foundation
 * only — no engine, no algorithm, no production wiring. Every field abstains (null) when evidence
 * is absent; nothing is fabricated.
 */

export type ISOTimestamp = string;

// ── Evidence (LI-B102) ────────────────────────────────────────────────────────────────────────
export type EvidenceKind = 'structured' | 'observed' | 'inferred' | 'external' | 'ai_generated';
export type EvidenceLifecycle = 'created' | 'refreshed' | 'superseded' | 'expired';

export interface SourceRef {
  system: string;              // 'website_capture' | 'lead_signals' | 'buyingIntent' | 'crm' | …
  ref?: string | null;         // opaque id within that system
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  label: string;
  value?: string | number | boolean | null;
  source: SourceRef;
  observedAt: ISOTimestamp;    // when the underlying fact occurred/was observed
  recordedAt: ISOTimestamp;    // when captured into the platform
  lifecycle: EvidenceLifecycle;
  supersededBy?: string | null;
  weight?: number;             // 0..1 relative contribution
}

// ── Contradiction (LI-B107) ─────────────────────────────────────────────────────────────────────
export type ContradictionKind = 'source_conflict' | 'stale_vs_fresh' | 'confidence_divergence' | 'stated_vs_observed' | 'ai_conflict';
export type ContradictionResolution = 'prefer_fresh' | 'prefer_higher_confidence' | 'prefer_structured' | 'flag_unresolved';

export interface ContradictionRef {
  id: string;
  kind: ContradictionKind;
  a: string;                   // evidence id
  b: string;                   // evidence id
  resolution: ContradictionResolution;
  resolved: boolean;
  note?: string;
}

// ── Facet spine (LI-B101) ───────────────────────────────────────────────────────────────────────
export interface Facet<T> {
  value: T | null;             // null = abstain (never fabricate)
  confidence: number;          // 0..1
  evidence: EvidenceRef[];
  provenance: SourceRef[];
  asOf: ISOTimestamp | null;   // freshness anchor
  contradictions: ContradictionRef[];
  unknowns: string[];          // explicit gaps
  assumptions: string[];
}

// Minimal facet value shapes (populated by Phase C engines; foundation leaves most abstaining).
export interface IdentityValue { person?: string; email?: string; role?: string; organization?: string; geography?: string; seniority?: string; department?: string; tenure?: string; }
export interface ProfessionalValue { responsibilities?: string[]; kpis?: string[]; decisionAuthority?: string; influence?: string; reportingChain?: string[]; buyingCommitteeRole?: string; }
export interface OrganizationValue { companyId?: string; name?: string; industry?: string; size?: string; }
export interface BuyingValue { painPoints?: string[]; initiatives?: string[]; urgency?: string; budgetLikelihood?: string; timing?: string; authority?: string; competitiveContext?: string[]; }
export interface IntentValue { explicitSignals?: string[]; implicitSignals?: string[]; aggregated?: number; decayApplied?: boolean; }
export interface EngagementValue { channelPreferences?: string[]; responsiveness?: string; communicationStyle?: string; contentAffinity?: string[]; }
export interface OpportunityValue { strategicValue?: string; revenuePotential?: string; expansion?: string; retentionRelevance?: string; }
export interface RelationshipValue { stakeholders?: string[]; mutualConnections?: string[]; buyingCommittee?: string[]; }
export interface RiskValue { blockers?: string[]; objections?: string[]; procurementRisk?: string; complianceConcerns?: string[]; orgInstability?: string; }
export interface QualificationValue { framework?: 'BANT' | 'MEDDIC' | 'hybrid'; fields?: Record<string, { value: string | null; known: boolean }>; }
export interface EvidenceSummaryValue { totalEvidence?: number; byKind?: Record<EvidenceKind, number>; freshestAt?: ISOTimestamp; }
export interface RecommendationsValue { nextAction?: string; nextMessage?: string; nextChannel?: string; nextTiming?: string; }

export interface LeadFacets {
  identity: Facet<IdentityValue>;
  professional: Facet<ProfessionalValue>;
  organization: Facet<OrganizationValue>;
  buying: Facet<BuyingValue>;
  intent: Facet<IntentValue>;
  engagement: Facet<EngagementValue>;
  opportunity: Facet<OpportunityValue>;
  relationship: Facet<RelationshipValue>;
  risk: Facet<RiskValue>;
  qualification: Facet<QualificationValue>;
  evidenceSummary: Facet<EvidenceSummaryValue>;
  recommendations: Facet<RecommendationsValue>;
}
export type LeadFacetName = keyof LeadFacets;
export const LEAD_FACET_NAMES: LeadFacetName[] = [
  'identity', 'professional', 'organization', 'buying', 'intent', 'engagement',
  'opportunity', 'relationship', 'risk', 'qualification', 'evidenceSummary', 'recommendations',
];

// ── Scoring contract (LI-B103) ──────────────────────────────────────────────────────────────────
export type ScoreDimension = 'intent' | 'icp' | 'urgency' | 'opportunity' | 'priority';
export const SCORE_DIMENSIONS: ScoreDimension[] = ['intent', 'icp', 'urgency', 'opportunity', 'priority'];
export type ScoringMethod = 'deterministic' | 'probabilistic' | 'ai_reasoned';

export interface ScoreContribution {
  dimension: ScoreDimension;
  contributor: string;         // engine name (buyingIntent, qualifyLead, …)
  method: ScoringMethod;
  value: number | null;        // 0..1, null = abstain
  confidence: number;          // 0..1
  evidence: EvidenceRef[];
  asOf: ISOTimestamp | null;
}
export interface DimensionScore {
  dimension: ScoreDimension;
  value: number | null;        // null = abstained (no contributor had evidence)
  confidence: number;
  method: ScoringMethod | 'blended';
  contributors: string[];
  calibrated: boolean;
  abstained: boolean;
}
export interface LeadScore {
  dimensions: Record<ScoreDimension, DimensionScore>;
  overall: number | null;
  confidence: number;
}

// ── Reasoning contract (LI-B104) ────────────────────────────────────────────────────────────────
export type ReasoningMethod = 'deterministic' | 'llm_grounded' | 'hybrid';
export interface ReasoningTrace {
  claim: string;
  conclusion: string | number | boolean | null;
  because: EvidenceRef[];
  confidence: number;
  contradictions: ContradictionRef[];
  unknowns: string[];
  assumptions: string[];
  freshness: ISOTimestamp | null;
  provenance: SourceRef[];
  method: ReasoningMethod;
}

// ── Graph (LI-B106) ─────────────────────────────────────────────────────────────────────────────
export type GraphNodeType = 'lead' | 'company' | 'offering' | 'competitor' | 'campaign' | 'content' | 'signal' | 'opportunity' | 'team' | 'organization'
  // Program 2 (Company Intelligence) additive extension — non-breaking union widening (references only).
  | 'executive' | 'customer' | 'partner' | 'product' | 'technology' | 'market'
  // Program 3 (Offering Intelligence) additive extension — non-breaking (references only).
  | 'feature' | 'pricing_plan' | 'persona' | 'industry' | 'integration'
  // Program 5 (Visitor Intelligence) additive extension — non-breaking (visitor is the only visitor-owned node; everything else referenced).
  | 'visitor';
export type GraphEdgeType = 'belongs_to' | 'engaged_with' | 'influences' | 'reports_to' | 'competes_with' | 'targets' | 'converted_from' | 'references' | 'member_of'
  // Program 3 additive offering relations — non-breaking.
  | 'has_feature' | 'priced_as' | 'serves_persona'
  // Program 5 additive visitor relations — non-breaking (references only).
  | 'identified_as' | 'acquired_via';
export interface GraphNodeRef { type: GraphNodeType; id: string; }   // reference ONLY — no duplicate entity ownership
export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  from: GraphNodeRef;
  to: GraphNodeRef;
  evidence: EvidenceRef[];
  confidence: number;
  asOf: ISOTimestamp | null;
}
export interface LeadGraph { root: GraphNodeRef; edges: GraphEdge[]; }

// ── Understanding + Projection (LI-B105) ────────────────────────────────────────────────────────
export interface LeadIdentityKey { leadKey: string; companyId: string; }

export interface LeadUnderstanding {
  key: LeadIdentityKey;
  facets: LeadFacets;
  score: LeadScore;
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  graph: LeadGraph;
  version: number;             // model/projection version
  builtAt: ISOTimestamp;       // passed in (deterministic — never Date.now)
}

export interface LeadProjection {
  key: LeadIdentityKey;
  version: number;
  identity: IdentityValue | null;
  scores: Record<ScoreDimension, number | null>;
  overallScore: number | null;
  confidence: number;
  facetConfidence: Record<LeadFacetName, number>;
  topContradictions: ContradictionRef[];
  projectedAt: ISOTimestamp;
}

// ── Persistence contract (LI-B108) ──────────────────────────────────────────────────────────────
export interface LeadUnderstandingShadowRecord {
  company_id: string;
  lead_key: string;
  version: number;
  understanding: LeadUnderstanding;
  projection: LeadProjection;
  parity: number | null;
  built_at: ISOTimestamp;
}
/** Compatibility adapter — maps canonical understanding to whatever a legacy consumer expects. */
export interface LeadCompatAdapter<TLegacy> { fromUnderstanding(u: LeadUnderstanding): TLegacy; }

// ── Shadow runtime (LI-B109) ────────────────────────────────────────────────────────────────────
export interface ShadowDivergence {
  dimension: ScoreDimension | 'overall';
  canonical: number | null;
  legacy: number | null;
  delta: number | null;        // abs diff (null if either abstains)
  agree: boolean;              // within tolerance (abstain-vs-abstain counts as agree)
}
export interface ShadowComparison {
  leadKey: string;
  divergences: ShadowDivergence[];
  facetCount: number;          // facets with a non-null value
  evidenceCount: number;
  contradictionCount: number;
  parity: number;              // 0..1 fraction of comparable dimensions in agreement
}
