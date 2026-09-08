// Canonical provider-adapter interfaces for Phase 3 (AI-Era Intelligence Layer).
//
// Every external integration (LLM visibility, knowledge graph, authority inflow,
// trust coherence, benchmark) implements ONE of these interfaces. The registry
// returns `unavailable` results when no adapter is configured for a given slot —
// no synthetic data, no fabricated benchmarks, no placeholder AI scores.

import type {
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
  ScoreState,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';
// D1 — the grounding vocabulary. Re-exported so a consumer of the probe contract
// never has to reach past it to name an outcome.
import type { ProbeObservationOutcome } from './aiVisibilityGrounding';

export type { ProbeObservationOutcome };

// ── AI Visibility ─────────────────────────────────────────────────────────────

export type AIProviderId = 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot';

export const AI_PROVIDERS: readonly AIProviderId[] = [
  'chatgpt',
  'gemini',
  'claude',
  'perplexity',
  'copilot',
] as const;

export type AIQueryClass = 'branded' | 'category' | 'competitive' | 'expertise';

export const AI_QUERY_CLASSES: readonly AIQueryClass[] = [
  'branded',
  'category',
  'competitive',
  'expertise',
] as const;

export type CitationMention = {
  provider: AIProviderId;
  query: string;
  query_class: AIQueryClass;
  // Whether the brand name appeared in the answer text at all.
  //
  // D1: this is a string match, NOT evidence of AI visibility on its own. The
  // probe queries contain the brand, so a model that confabulates a fluent
  // answer sets this to `true` by construction. Read it together with
  // `grounded_sources` / `citation_corroborated`; never alone.
  appeared: boolean;
  // 0-1: how prominent the mention was within the answer (e.g., headline citation
  // = 1.0, footnote = 0.3, bare URL = 0.15).
  prominence: number;
  // The verbatim citation string (URL or quoted phrase) for traceability.
  evidence_excerpt: string | null;
  // D1 — the source URLs the provider itself returned for this answer. Empty for
  // any provider that does not retrieve. This is the only field that can carry a
  // claim about the world rather than about the model.
  grounded_sources: string[];
  // D1 — the company's OWN domain is among `grounded_sources`: an answer engine
  // pointed a reader at the company's pages. Host equality or a true subdomain,
  // never substring.
  citation_corroborated: boolean;
  observed_at: string;
};

export type AIVisibilityProbe = {
  provider: AIProviderId;
  query_class: AIQueryClass;
  // The set of queries the orchestrator should ask. The provider decides nothing
  // about query content — that comes from the brand context.
  queries: string[];
};

export type AIVisibilityProbeResult = {
  provider: AIProviderId;
  query_class: AIQueryClass;
  // D1 — decided ONLY by `resolveProbeOutcome`, never written as a literal.
  //
  // The previous rule was "`measured` when the adapter actually queried the LLM",
  // and that sentence is the defect: querying a language model is not observing
  // the world. `measured` now additionally requires a retrieval-grounded provider
  // that returned source evidence. An ungrounded answer is `insufficient_signal`
  // — we looked, and what came back cannot support the claim.
  state: ScoreState;
  // D1 — what actually happened, at a finer grain than the four-value state
  // vocabulary can express: "we never asked" and "we asked and it broke" are
  // both `unavailable` but are different findings.
  observation_outcome: ProbeObservationOutcome;
  // D1 — null unless `state === 'measured'`. A rate computed from ungrounded
  // answers is a measurement of the model, not of the brand's visibility, and
  // publishing it is what produced "AI systems reliably identify the brand".
  citation_rate: number | null; // 0-1 fraction of grounded answers naming the brand
  mean_prominence: number | null; // 0-1 average prominence across mentions
  mentions: CitationMention[];
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface LLMVisibilityProvider {
  readonly id: AIProviderId;
  // D1 — whether this provider RETRIEVES from the live web (an answer engine)
  // rather than answering from model weights. A fixed property of the adapter,
  // never inferred from a response: a chat model that emits a URL has still
  // retrieved nothing. Only a grounded provider can reach `measured`.
  readonly retrieval_grounded: boolean;
  // True when an adapter is wired AND credentials/connectivity are healthy.
  isAvailable(): Promise<boolean>;
  // Run a probe against this provider. MUST return `state: 'unavailable'` when not
  // configured — never synthesize numbers.
  probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult>;
}

// ── Knowledge Graph & Entity Intelligence ─────────────────────────────────────

export type EntityRecord = {
  // Wikidata Q-ID, if present (e.g., "Q42").
  wikidata_qid: string | null;
  // Google KG MID, if present.
  google_kg_mid: string | null;
  // Schema.org Organization entity completeness (0-1) — what fraction of the
  // canonical Organization fields the brand has populated.
  schema_completeness: number | null;
  // sameAs link count to authoritative profiles (LinkedIn, Crunchbase, Wikipedia, etc.).
  sameAs_count: number;
  sameAs_targets: string[];
  // Entity description extracted from KG; null when not found.
  canonical_description: string | null;
};

export type EntityIntelligenceResult = {
  state: ScoreState;
  entity: EntityRecord | null;
  // 0-100 score derived from completeness + sameAs density when measured.
  score: number | null;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface KnowledgeGraphProvider {
  readonly id: 'wikidata' | 'google_kg' | 'schema_org' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: {
    brandName: string;
    domain: string | null;
  }): Promise<EntityIntelligenceResult>;
}

// ── Authority Inflow (backlinks, mentions) ────────────────────────────────────

export type BacklinkProfile = {
  referring_domains: number;
  total_backlinks: number;
  domain_authority: number | null; // provider-specific 0-100 metric
  topical_authority: number | null;
  trust_flow: number | null;
  spam_score: number | null;
  freshness: { last_observed_at: string | null; age_hours: number | null };
};

export type AuthorityInflowResult = {
  state: ScoreState;
  profile: BacklinkProfile | null;
  score: number | null; // 0-100, derived from profile when measured
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface AuthorityInflowProvider {
  readonly id: 'ahrefs' | 'moz' | 'majestic' | 'semrush' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: { domain: string }): Promise<AuthorityInflowResult>;
}

// ── Trust Coherence (NAP / review parity / expertise) ─────────────────────────

export type TrustCoherenceSignals = {
  nap_consistency: number | null; // 0-1: consistency of name/address/phone across sources
  brand_description_consistency: number | null; // 0-1
  review_parity: number | null; // 0-1: variance across review platforms
  review_source_count: number;
  expertise_signals: {
    author_bylines: number;
    credentialed_authors: number;
    organizational_about_completeness: number | null;
  } | null;
};

export type TrustCoherenceResult = {
  state: ScoreState;
  signals: TrustCoherenceSignals | null;
  score: number | null;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface TrustCoherenceProvider {
  readonly id: 'review_aggregator' | 'expertise_extractor' | 'consistency_checker' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: { brandName: string; domain: string | null }): Promise<TrustCoherenceResult>;
}

// ── Benchmark Intelligence ────────────────────────────────────────────────────

export type BenchmarkBand = {
  vertical: string;
  size_band: 'small' | 'mid' | 'enterprise' | 'unspecified';
  // Per-dimension benchmark values keyed by canonical dimension key.
  median: Record<string, number>;
  top_quartile: Record<string, number>;
  // The number of peer brands the benchmark was computed from.
  peer_count: number;
  observed_at: string;
};

export type BenchmarkResult = {
  state: ScoreState;
  band: BenchmarkBand | null;
  // Percentile position of the user's overall authority within the peer group.
  percentile: number | null;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface BenchmarkProvider {
  readonly id: 'curated_vertical' | 'crawler_peer_set' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: {
    vertical: string | null;
    sizeHint: 'small' | 'mid' | 'enterprise' | 'unspecified';
    userScore: number | null;
  }): Promise<BenchmarkResult>;
}

// ── Authority Trajectory ──────────────────────────────────────────────────────

export type TrajectorySnapshot = {
  observed_at: string; // ISO timestamp
  authority_score: CanonicalScore;
  maturity: SystemMaturityClass;
  ai_visibility_score: CanonicalScore;
  pillar_scores: Partial<Record<string, CanonicalScore>>;
};

export type AuthorityTrajectoryResult = {
  state: ScoreState;
  snapshots: TrajectorySnapshot[];
  // Velocity: change per unit time. Null when fewer than 2 snapshots exist.
  velocity: {
    authority_per_30d: number | null;
    ai_visibility_per_30d: number | null;
    classification:
      | 'temporary_spike'
      | 'sustained_growth'
      | 'stagnation'
      | 'decay'
      | 'insufficient_history';
  };
  // Forward-looking projection (architecture-only in Phase 3).
  forecast: { horizon_days: number; projected_score: CanonicalScore } | null;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface AuthorityTrajectoryProvider {
  readonly id: 'report_score_history' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: { companyId: string }): Promise<AuthorityTrajectoryResult>;
}

// ── Commercial Outcomes (revenue, conversions) ────────────────────────────────

export type CommercialResult = {
  state: ScoreState;
  /** A deterministic commercial quantity for ROI determinability — measured revenue or native units
   *  (conversions). NEVER a fabricated figure. Null when nothing is measured. */
  quantified: { value: number; unit: string } | null;
  /** True when the quantity is backed by MEASURED revenue / conversion-value evidence. */
  measuredRevenue: boolean;
  evidence: EvidenceTrace;
  reason_unavailable: string | null;
};

export interface CommercialProvider {
  readonly id: 'commercial' | string;
  isAvailable(): Promise<boolean>;
  lookup(params: { companyId: string }): Promise<CommercialResult>;
}

// ── Shared unavailable-result helpers ─────────────────────────────────────────

export function unavailableEvidence(reason: string): EvidenceTrace {
  return {
    count: 0,
    sources: [],
    freshness: { last_observed_at: null, age_hours: null },
    observations: [{ signal: reason, source: 'unspecified', observed_at: null }],
  };
}

export function unavailableResult<T extends { state: ScoreState; evidence: EvidenceTrace; reason_unavailable: string | null }>(
  shape: Omit<T, 'state' | 'evidence' | 'reason_unavailable'> & { reason: string },
): T {
  const { reason, ...rest } = shape as { reason: string } & Partial<T>;
  return {
    ...(rest as object),
    state: 'unavailable',
    evidence: unavailableEvidence(reason),
    reason_unavailable: reason,
  } as T;
}

export type ConfidenceBandFromCount = (count: number, hasStrong: boolean) => ConfidenceBand;
