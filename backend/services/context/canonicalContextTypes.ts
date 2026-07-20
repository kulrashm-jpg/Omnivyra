/**
 * canonicalContextTypes.ts — CONTENT-INTELLIGENCE-002
 *
 * The single canonical model that every AI content workflow grounds on. It
 * MERGES all available business knowledge into one deterministic object. Each
 * field carries its own provenance, confidence, and freshness so consumers can
 * be transparent about what grounded a recommendation — and so weak grounding
 * is never hidden.
 *
 * This file is types + constants only (no I/O). Assembly lives in
 * contextAssimilationEngine.ts; scoring/transparency/evidence are pure modules.
 */

/** Where a fact came from. Ordered loosely by authority for conflict resolution. */
export type ContextOrigin =
  | 'website'          // live crawl / website snapshot — authoritative, current
  | 'profile'          // company_profiles — authoritative, refined
  | 'content_history'  // published blogs/posts/newsletters
  | 'campaign'         // campaign history + performance learnings
  | 'analytics'        // GA / Search Console
  | 'seo'              // SEO intelligence
  | 'competitive'      // competitor/market intelligence
  | 'derived'          // computed from other signals
  | 'unknown';

/** Trust weight per origin — higher wins on conflict (facts merge, never blind-overwrite). */
export const ORIGIN_TRUST: Readonly<Record<ContextOrigin, number>> = {
  website: 0.95,
  profile: 0.9,
  content_history: 0.75,
  campaign: 0.7,
  analytics: 0.65,
  seo: 0.6,
  competitive: 0.55,
  derived: 0.4,
  unknown: 0.2,
};

export type FreshnessLabel = 'today' | 'recent' | 'aging' | 'stale' | 'unknown';

export interface Freshness {
  /** Age in whole days, or null when unknown. */
  ageDays: number | null;
  label: FreshnessLabel;
}

/** Every canonical field is a Fact: a value plus where/how-sure/how-fresh. */
export interface Fact<T> {
  value: T;
  origin: ContextOrigin;
  /** 0..1 — how reliable this value is. */
  confidence: number;
  freshness: Freshness;
}

// ── Context Quality ────────────────────────────────────────────────────────────

export type QualityTier = 'excellent' | 'strong' | 'moderate' | 'weak' | 'insufficient';

export type QualityDimension =
  | 'website'
  | 'products'
  | 'services'
  | 'differentiation'
  | 'audience'
  | 'evidence'
  | 'campaignHistory'
  | 'contentHistory'
  | 'competitive'
  | 'market'
  | 'brandPositioning'
  | 'proof'
  | 'freshness';

export interface DimensionScore {
  /** 0..1 */
  score: number;
  /** 0..1 — how sure we are of the score itself. */
  confidence: number;
  reason: string;
}

export interface ContextQuality {
  overall: QualityTier;
  /** 0..1 blended score. */
  score: number;
  dimensions: Record<QualityDimension, DimensionScore>;
}

// ── Grounding Transparency ─────────────────────────────────────────────────────

export interface GroundedSource {
  /** Human label, e.g. "Website", "Products", "Case Studies". */
  source: string;
  present: boolean;
}

export interface GroundingTransparency {
  /** ✓/✗ per source — what actually grounded this. */
  groundedFrom: GroundedSource[];
  /** 0..100. */
  confidence: number;
  /** Freshest contributing signal, e.g. "3 days" / "unknown". */
  freshnessLabel: string;
  freshestDays: number | null;
  evidenceAvailable: boolean;
  /** Human labels of what is absent (drives "Missing Context"). */
  missingContext: string[];
}

// ── Evidence Intelligence ──────────────────────────────────────────────────────

export interface EvidenceItem {
  text: string;
  origin: ContextOrigin;
}

export interface EvidenceIntelligence {
  /** Company achievements, products, customers, capabilities, differentiators. */
  internal: EvidenceItem[];
  /** Industry reports, market observations, standards, research, public trends. */
  external: EvidenceItem[];
  /** Examples, comparisons, scenarios, logical arguments. */
  reasoning: EvidenceItem[];
  /** Honest note when a group is empty — never fabricate. */
  note: string;
}

// ── Canonical Context ──────────────────────────────────────────────────────────

export interface CanonicalContext {
  companyId: string;

  // Business identity
  businessIdentity: Fact<string> | null;
  offerings: Fact<string[]> | null;         // products / services / solutions / features
  differentiators: Fact<string[]> | null;
  icp: Fact<string> | null;
  personas: Fact<string[]> | null;
  painPoints: Fact<string[]> | null;
  customerGoals: Fact<string[]> | null;
  industry: Fact<string> | null;
  marketPosition: Fact<string> | null;
  brandPositioning: Fact<string> | null;    // voice / personality / positioning

  // Evidence + history
  evidence: Fact<string[]> | null;          // success stories, testimonials, case studies
  contentHistory: Fact<string[]> | null;    // published titles / themes
  strategicDirection: Fact<string[]> | null;
  campaignHistory: Fact<string[]> | null;
  performanceLearnings: Fact<string[]> | null;
  currentInitiatives: Fact<string[]> | null;

  // External intelligence
  websiteIntelligence: Fact<string> | null;
  competitiveObservations: Fact<string[]> | null;
  seoObservations: Fact<string[]> | null;
  marketSignals: Fact<string[]> | null;

  // Meta
  knownGaps: string[];
  quality: ContextQuality;
  transparency: GroundingTransparency;
  /** WAVE-2-001 — enforced grounding decision (floor + freshness-adjusted confidence).
   *  Additive/optional; computed from `transparency` at assembly. */
  grounding?: import('../ai/grounding/groundingPolicy').GroundingDecision;
  evidenceIntelligence: EvidenceIntelligence;
  /** ISO timestamp of assembly (stamped by caller; excluded from determinism checks). */
  assembledAt: string | null;
}

/** The scalar/list fields that carry Facts (used by scoring + transparency). */
export const CONTEXT_FACT_FIELDS: ReadonlyArray<keyof CanonicalContext> = [
  'businessIdentity', 'offerings', 'differentiators', 'icp', 'personas',
  'painPoints', 'customerGoals', 'industry', 'marketPosition', 'brandPositioning',
  'evidence', 'contentHistory', 'strategicDirection', 'campaignHistory',
  'performanceLearnings', 'currentInitiatives', 'websiteIntelligence',
  'competitiveObservations', 'seoObservations', 'marketSignals',
];

/** Human labels for transparency "Grounded From" / "Missing Context". */
export const FIELD_LABELS: Readonly<Partial<Record<keyof CanonicalContext, string>>> = {
  websiteIntelligence: 'Website',
  offerings: 'Products & Services',
  differentiators: 'Differentiation',
  icp: 'ICP',
  personas: 'Personas',
  painPoints: 'Pain Points',
  brandPositioning: 'Brand Positioning',
  industry: 'Industry',
  marketPosition: 'Market Position',
  evidence: 'Case Studies & Proof',
  contentHistory: 'Content History',
  campaignHistory: 'Campaign History',
  performanceLearnings: 'Performance Learnings',
  competitiveObservations: 'Competitor Analysis',
  seoObservations: 'SEO',
  marketSignals: 'Market Signals',
  strategicDirection: 'Strategic Direction',
};
