import type {
  ConfidenceBand,
  ScoreState,
  SystemMaturityClass,
} from '../snapshotReport/canonicalScoreState';
// BETA-EXEC-003: canonical band cutoffs from the scoring-governance registry.
import { CANONICAL_SCORE_BANDS } from './scoringGovernance';

export type {
  ConfidenceBand,
  ScoreState,
  SystemMaturityClass,
};

// ── Pillar architecture ───────────────────────────────────────────────────────
//
// Canonical 5-pillar structure. Every metric in the report maps to exactly ONE pillar.
// The maturity narrative (Phase 1) classifies foundation vs authority. Phase 2 extends
// that into the full pillar grid.

export type PillarKey =
  | 'foundation'
  | 'authority'
  | 'discoverability'
  | 'trust'
  | 'momentum';

export const PILLAR_KEYS: readonly PillarKey[] = [
  'foundation',
  'authority',
  'discoverability',
  'trust',
  'momentum',
] as const;

export type PillarMeta = {
  key: PillarKey;
  label: string;
  purpose: string;
  accent: string;
};

export const PILLAR_META: Record<PillarKey, PillarMeta> = {
  foundation: {
    key: 'foundation',
    label: 'Foundation',
    purpose: 'Technical and structural integrity — crawl health, schema, extraction readiness.',
    accent: 'sky',
  },
  authority: {
    key: 'authority',
    label: 'Authority',
    purpose: 'Off-site corroboration — backlinks, mentions, entity strength. Estimated from on-site signals until external authority providers are connected; not a verified market-authority ranking.',
    accent: 'indigo',
  },
  discoverability: {
    key: 'discoverability',
    label: 'Discoverability',
    purpose: 'Search and AI discoverability — structure, visibility, answer extraction. AI-surface presence is measured only when AI providers are connected; otherwise based on on-site extractability.',
    accent: 'emerald',
  },
  trust: {
    key: 'trust',
    label: 'Trust',
    purpose: 'Consistency, expertise, and reputation signals. Measured from on-site brand-health evidence until review and reputation sources are connected.',
    accent: 'amber',
  },
  momentum: {
    key: 'momentum',
    label: 'Momentum',
    purpose: 'Growth velocity — publishing cadence, freshness, authority acceleration.',
    accent: 'rose',
  },
};

// ── Evidence trace primitive ──────────────────────────────────────────────────
//
// Every score / recommendation / narrative carries an EvidenceTrace so the source
// of any number is one click from the user. Phase 2 establishes the architecture;
// the drill-down UI lands in Phase 3.

// GAP-07 — the provenance vocabulary is owned by `evidenceProvenance.ts`. Imported as a type so
// the canonical evidence contract and the policy can never drift into two different taxonomies.
import type { EvidenceProvenanceClass } from '../evidenceProvenance';

export type EvidenceSourceKind =
  | 'crawler'
  | 'gsc'
  | 'decisions'
  | 'public_audit'
  | 'competitor_intelligence'
  /** GAP-06/07 — public search-results evidence (own-domain SERP rows). Public-domain. */
  | 'serp'
  | 'social_links'
  | 'heuristic'
  | 'wikidata'
  | 'google_kg'
  | 'schema_org'
  | 'llm_probe'
  | 'backlink_api'
  | 'review_aggregator'
  | 'expertise_extractor'
  | 'benchmark_dataset'
  | 'trajectory_history'
  | 'unspecified';

export type EvidenceObservation = {
  signal: string;
  source: EvidenceSourceKind;
  observed_at: string | null;
};

export type EvidenceTrace = {
  count: number;
  sources: EvidenceSourceKind[];
  freshness: { last_observed_at: string | null; age_hours: number | null };
  observations: EvidenceObservation[];
  /**
   * GAP-07 — the provenance verdict for this trace, stamped where the trace is built.
   *
   * `count`, `sources` and `observations` describe evidence Report 1 is PERMITTED to assert on.
   * Anything outside that boundary — connected private analytics, company-declared facts,
   * Omnivyra's own prior history — is moved to `excluded` rather than dropped, so a reader (and
   * GAP-08) can tell "we had no evidence" apart from "we had evidence we may not use here".
   *
   * Optional so every pre-existing construction site stays valid. Absent means the trace was
   * built outside the enforcement boundary and carries no verdict — not that it is clean.
   */
  provenance?: {
    /** Distinct provenance classes among the RETAINED observations. */
    classes: EvidenceProvenanceClass[];
    /** Out-of-boundary observations, kept with their true source so nothing vanishes silently. */
    excluded: EvidenceObservation[];
    excludedSources: EvidenceSourceKind[];
    /** True when nothing had to be excluded. */
    report1Clean: boolean;
  };
};

export function emptyEvidenceTrace(): EvidenceTrace {
  return {
    count: 0,
    sources: [],
    freshness: { last_observed_at: null, age_hours: null },
    observations: [],
    // GAP-07 — an empty trace is trivially clean, and saying so keeps every trace in the report
    // self-describing. Without this, a dimension or pillar that abstained would be indistinguishable
    // from one built outside the enforcement boundary: both would simply have no verdict.
    provenance: { classes: [], excluded: [], excludedSources: [], report1Clean: true },
  };
}

// ── Canonical score primitive ─────────────────────────────────────────────────
//
// A CanonicalScore is the universal score envelope used by every score-bearing
// surface (pillars, axes, overall). It replaces ad-hoc { value, confidence,
// data_source_strength, source_tags } shapes scattered across the legacy types.

export type CanonicalScore = {
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  band: 'foundational' | 'developing' | 'operational' | 'leading' | 'insufficient';
  evidence: EvidenceTrace;
  benchmark: { value: number | null; label: string | null };
};

export function emptyCanonicalScore(state: ScoreState = 'insufficient_signal'): CanonicalScore {
  return {
    value: null,
    state,
    confidence: 'low',
    band: 'insufficient',
    evidence: emptyEvidenceTrace(),
    benchmark: { value: null, label: null },
  };
}

export function canonicalBandFromValue(
  value: number | null,
  state: ScoreState,
): CanonicalScore['band'] {
  if (state === 'insufficient_signal' || state === 'unavailable' || value == null) return 'insufficient';
  if (value >= CANONICAL_SCORE_BANDS.leading) return 'leading';
  if (value >= CANONICAL_SCORE_BANDS.operational) return 'operational';
  if (value >= CANONICAL_SCORE_BANDS.developing) return 'developing';
  return 'foundational';
}

// ── Canonical pillar score ────────────────────────────────────────────────────
//
// Each pillar carries a score plus the dimensions (axes) that compose it. Every
// dimension on the canonical radar is owned by exactly one pillar.

export type CanonicalDimensionKey =
  // Foundation
  | 'index_integrity'
  | 'extraction_readiness'
  | 'accessibility'
  // Authority
  | 'authority_inflow'
  | 'entity_graph_strength'
  // Discoverability
  | 'topical_authority'
  | 'ai_surface_presence'
  // Trust
  | 'trust_coherence'
  // Momentum
  | 'authority_velocity';

export type CanonicalDimension = {
  key: CanonicalDimensionKey;
  label: string;
  pillar: PillarKey;
  score: CanonicalScore;
  rationale: string;
};

export const CANONICAL_DIMENSIONS: ReadonlyArray<{
  key: CanonicalDimensionKey;
  label: string;
  pillar: PillarKey;
  rationale: string;
}> = [
  {
    key: 'index_integrity',
    label: 'Index Integrity',
    pillar: 'foundation',
    rationale: 'Crawl health, indexability, metadata coverage, internal-link support.',
  },
  {
    key: 'extraction_readiness',
    label: 'Extraction Readiness',
    pillar: 'foundation',
    rationale: 'Page structure, summary blocks, and schema density that make answers extractable.',
  },
  {
    // BETA-EXEC-002: Accessibility Intelligence engine surfaced as a Foundation dimension.
    key: 'accessibility',
    label: 'Accessibility',
    pillar: 'foundation',
    rationale: 'WCAG conformance, semantic structure, and accessible markup that underpin a healthy foundation.',
  },
  {
    key: 'authority_inflow',
    label: 'Authority Inflow',
    pillar: 'authority',
    rationale: 'Inbound authority signals — backlinks and brand mention reinforcement.',
  },
  {
    key: 'entity_graph_strength',
    label: 'Entity Graph Strength',
    pillar: 'authority',
    rationale: 'Knowledge-graph entity clarity, sameAs linkage, topical entity coverage.',
  },
  {
    key: 'topical_authority',
    label: 'Topical Authority',
    pillar: 'discoverability',
    rationale: 'Depth and breadth of coverage across the brand\'s topic cluster.',
  },
  {
    key: 'ai_surface_presence',
    label: 'AI Surface Presence',
    pillar: 'discoverability',
    rationale: 'How surfaceable the site is for AI answers and citation-driven discovery.',
  },
  {
    key: 'trust_coherence',
    label: 'Trust Coherence',
    pillar: 'trust',
    rationale: 'Consistency of brand description, proof, and reputation signals across sources.',
  },
  {
    // BR-C-001 truth correction: this dimension's value is a content-freshness signal, NOT a measured
    // authority growth rate. Labeled for what it actually measures. Real velocity (rate + classification)
    // is exposed separately in the authority trajectory when snapshot history exists.
    key: 'authority_velocity',
    label: 'Content Freshness',
    pillar: 'momentum',
    rationale: 'How recently the site\'s content was published or updated — a publishing-momentum proxy. This is not a measured authority growth rate; see the authority trajectory when snapshot history exists.',
  },
];

export type CanonicalPillarScore = {
  pillar: PillarKey;
  label: string;
  purpose: string;
  score: CanonicalScore;
  dimensions: CanonicalDimension[];
  // Top-1 signal that's currently limiting this pillar (or unlocking it).
  primary_signal: string | null;
};

// ── Canonical action ──────────────────────────────────────────────────────────
//
// Replaces the 5 fragmented action arrays. Every recommendation is one action
// with explicit pillar, severity, confidence, leverage, evidence, and dependencies.

export type CanonicalActionSeverity = 'critical' | 'moderate' | 'low';
export type CanonicalActionEffort = 'low' | 'medium' | 'high';
export type CanonicalActionImpactBand = 'high' | 'medium' | 'low';
export type CanonicalActionMaturityImplication =
  | 'unblocks_foundation'
  | 'compounds_authority'
  | 'extends_discoverability'
  | 'reinforces_trust'
  | 'accelerates_momentum'
  | 'shifts_tier';

export type CanonicalAction = {
  id: string;
  title: string;
  pillar: PillarKey;
  severity: CanonicalActionSeverity;
  confidence: ConfidenceBand;
  // Leverage = expected_tier_shift × confidence × (1 / max(dependency_depth, 1)).
  // Used as the canonical ranking key across all surfaces.
  leverage_score: number;
  expected_impact: CanonicalActionImpactBand;
  effort: CanonicalActionEffort;
  evidence: EvidenceTrace;
  dependencies: string[]; // Action ids this action depends on.
  timeline: { short: string; mid: string; long: string };
  owner_area: 'content' | 'engineering' | 'marketing_ops' | 'pr' | 'product' | 'cross_functional';
  maturity_implication: CanonicalActionMaturityImplication;
  reasoning: string;
  expected_outcome: string;
};

// ── Quantified improvement to-do ──────────────────────────────────────────────
//
// For each measurably weak dimension, a concrete WHAT/HOW to-do plus the EXACT
// projected point gain — computed by re-running the real aggregation (pillar =
// average of its measured dimensions; overall = geometric mean of the pillars)
// with the dimension raised to its target. Not a linear estimate: the gain is
// the true delta the scoring engine would produce, so it never overstates.

export type CanonicalDimensionTodo = {
  dimension: CanonicalDimensionKey;
  dimension_label: string;
  pillar: PillarKey;
  pillar_label: string;
  // Current measured dimension value and the realistic target this to-do aims for.
  current_score: number;
  target_score: number;
  // WHAT to do (one-line objective) and HOW (ordered, concrete steps).
  what: string;
  how: string[];
  // Projected gains from lifting this one dimension to target, recomputed from the
  // real aggregation. pillar gain = its pillar's new average − current; overall gain
  // = new overall geometric mean − current. Rounded to whole points.
  projected_pillar_gain: number;
  projected_overall_gain: number;
  effort: CanonicalActionEffort;
  confidence: ConfidenceBand;
  owner_area: CanonicalAction['owner_area'];
};

// ── Phase 3 intelligence summary shapes ───────────────────────────────────────
//
// Compact projections of the AI / KG / authority / trust / benchmark adapter
// outputs. Adapter detail (full mention list, full sameAs target list, full
// backlink profile) lives in the Evidence Trace drawer rather than the section
// header so the report surface stays scannable.

export type AICitationMatrixSummary = {
  state: ScoreState;
  overall_score: CanonicalScore;
  cells: Array<{
    provider: 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot';
    query_class: 'branded' | 'category' | 'competitive' | 'expertise';
    state: ScoreState;
    citation_rate: number | null;
    mean_prominence: number | null;
    observed_count: number;
    reason_unavailable: string | null;
  }>;
  by_provider: Array<{
    provider: 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot';
    state: ScoreState;
    citation_rate: number | null;
    mean_prominence: number | null;
  }>;
  by_query_class: Array<{
    query_class: 'branded' | 'category' | 'competitive' | 'expertise';
    state: ScoreState;
    citation_rate: number | null;
    mean_prominence: number | null;
  }>;
  coverage: { measured_cells: number; unavailable_cells: number; total_cells: number };
};

export type EntityIntelligenceSummary = {
  state: ScoreState;
  wikidata_qid: string | null;
  google_kg_mid: string | null;
  schema_completeness: number | null;
  sameAs_count: number;
  sameAs_targets: string[];
  canonical_description: string | null;
  reason_unavailable: string | null;
};

export type AuthorityInflowSummary = {
  state: ScoreState;
  referring_domains: number | null;
  total_backlinks: number | null;
  domain_authority: number | null;
  topical_authority: number | null;
  trust_flow: number | null;
  reason_unavailable: string | null;
};

export type TrustCoherenceSummary = {
  state: ScoreState;
  nap_consistency: number | null;
  brand_description_consistency: number | null;
  review_parity: number | null;
  review_source_count: number;
  expertise_score: number | null;
  reason_unavailable: string | null;
};

export type BenchmarkOverlaySummary = {
  state: ScoreState;
  vertical: string | null;
  size_band: 'small' | 'mid' | 'enterprise' | 'unspecified';
  median: Record<string, number>;
  top_quartile: Record<string, number>;
  peer_count: number | null;
  percentile: number | null;
  reason_unavailable: string | null;
};

// ── Canonical narrative envelope ──────────────────────────────────────────────
//
// Wraps any narrative output with confidence + evidence + maturity context so the
// reader can never see a paragraph without knowing how trustworthy it is.

export type CanonicalNarrative = {
  text: string;
  confidence: ConfidenceBand;
  evidence: EvidenceTrace;
  maturity: SystemMaturityClass;
};

// ── Canonical report shape ────────────────────────────────────────────────────
//
// Single source of truth that replaces the seo_executive_summary,
// geo_aeo_executive_summary, competitor_intelligence_summary,
// unified_intelligence_summary, decision_snapshot, and top_priorities fields.

// ── Declared (non-scored) evidence ────────────────────────────────────────────
//
// BETA-EVIDENCE-EXEC-003: a presentation-only evidence surface. Carries measured on-site evidence
// that INTENTIONALLY has NO score, NO band, NO confidence, NO maturity, and NO recommendation — it
// exists solely to make already-extracted evidence visible to customers with honest provenance.
export type CanonicalDeclaredEvidence = {
  same_as: {
    count: number;
    domains: string[];
    destination_types: Record<string, number>;
    source: EvidenceSourceKind;
  };
  declared_certifications: {
    count: number;
    items: string[];
    source: EvidenceSourceKind;
  };
  legal_transparency: {
    items: Array<{ key: string; label: string; present: boolean }>;
    present_count: number;
    source: EvidenceSourceKind;
  };
};

export type CanonicalReport = {
  // Section 1 — Authority Overview (the single executive surface).
  authority_overview: {
    headline: CanonicalNarrative;
    overall_score: CanonicalScore;
    maturity: SystemMaturityClass;
    primary_constraint: CanonicalNarrative;
    next_unlock: CanonicalNarrative;
  };

  // Section 1b — Declared Evidence (BETA-EVIDENCE-EXEC-003): non-scored, presentation-only.
  // Optional/additive; null when no crawl evidence is available. Never feeds any score/aggregation.
  declared_evidence?: CanonicalDeclaredEvidence | null;

  // Section 2 — Discoverability Authority Radar (single canonical radar).
  // 8 axes mapped one-to-one to CANONICAL_DIMENSIONS, each carrying its own state.
  discoverability_authority_radar: {
    axes: CanonicalDimension[];
    overall_confidence: ConfidenceBand;
    benchmark_label: string | null;
    competitor_overlay: Array<{
      label: string;
      values: Partial<Record<CanonicalDimensionKey, number>>;
    }>;
  };

  // Section 3 — Pillar Cards (Foundation / Authority / Discoverability / Trust / Momentum).
  pillars: CanonicalPillarScore[];

  // Section 4 — AI Surface Presence (Phase 3: real adapter architecture, with the
  // canonical AI Citation Matrix when LLM providers are configured).
  ai_surface_presence: {
    score: CanonicalScore;
    rationale: CanonicalNarrative;
    citation_matrix: AICitationMatrixSummary | null;
  };

  // Section 5 — Knowledge Graph & Entity Strength (Phase 3: real Wikidata adapter
  // when WIKIDATA_ENABLED=true; honest unavailable state otherwise).
  knowledge_graph: {
    score: CanonicalScore;
    rationale: CanonicalNarrative;
    entity: EntityIntelligenceSummary | null;
  };

  // Section 4b — Authority Inflow (Phase 3: real backlink adapter when configured).
  authority_inflow: {
    score: CanonicalScore;
    rationale: CanonicalNarrative;
    profile: AuthorityInflowSummary | null;
  };

  // Section 4c — Trust Coherence (Phase 3: real review/expertise adapters when configured).
  trust_coherence: {
    score: CanonicalScore;
    rationale: CanonicalNarrative;
    signals: TrustCoherenceSummary | null;
  };

  // Section 4d — Benchmark Intelligence (Phase 3: vertical / peer / percentile).
  benchmark: {
    state: ScoreState;
    overlay: BenchmarkOverlaySummary | null;
    rationale: CanonicalNarrative;
  };

  // Section 7b — Maturity stage classification (Phase 3: 6-stage canonical model).
  maturity_stage: {
    stage:
      | 'insufficient_signal'
      | 'foundational'
      | 'emerging'
      | 'developing'
      | 'operational'
      | 'advanced'
      | 'leading';
    label: string;
    next_stage: string | null;
    why_this_stage: string;
    blocker: { pillar: PillarKey | null; explanation: string };
    unlock: { pillar: PillarKey | null; explanation: string };
    confidence: ConfidenceBand;
    evidence: EvidenceTrace;
  };

  // Section 6 — Competitive Surface Share.
  competitive_surface_share: {
    user: Partial<Record<CanonicalDimensionKey, number>>;
    competitor_average: Partial<Record<CanonicalDimensionKey, number>>;
    competitors: Array<{
      name: string;
      values: Partial<Record<CanonicalDimensionKey, number>>;
    }>;
    confidence: ConfidenceBand;
    summary: CanonicalNarrative;
    /** BR-H-003 — honest provenance of competitor observations (crawl-derived, not a market panel).
     *  Optional for backward compatibility. */
    provenance?: import('./reportProvenance').CompetitorProvenance;
  };

  // Section 7 — Authority Trajectory (architecture only — populated in Phase 3+).
  authority_trajectory: {
    snapshots: Array<{
      observed_at: string;
      score: CanonicalScore;
      maturity: SystemMaturityClass;
    }>;
    forecast: { horizon_days: number; projected_score: CanonicalScore } | null;
    available: boolean;
    /** BR-H-002 — explicit distinction of measured history vs projected forecast vs unavailable (reuses the
     *  provider's own state + velocity classification). Optional for backward compatibility. */
    provenance?: import('./reportProvenance').TrajectoryProvenance;
  };

  // Section 8 — Action Playbook (the single canonical recommendation surface).
  action_playbook: {
    actions: CanonicalAction[];
    summary: CanonicalNarrative;
  };

  // Section 8c — Quantified Improvement Plan: score-anchored to-do list. One entry
  // per measurably weak dimension, each with a concrete WHAT/HOW and the exact
  // projected point gain (recomputed from the real aggregation). Ordered by
  // projected overall gain, highest-leverage first. Empty when nothing is weak.
  improvement_todos: CanonicalDimensionTodo[];

  // Section 8b — Strategic Playbook (Phase 4): sequenced authority playbook with
  // dependency resolution and per-pillar impact projection.
  strategic_playbook: {
    actions: Array<CanonicalAction & {
      sequence_position: number;
      resolved_dependencies: string[];
      pillar_impact: Record<PillarKey, number>;
      ai_visibility_impact: number;
      discoverability_impact: number;
      trust_impact: number;
      authority_impact: number;
      expected_maturity_shift: 'no' | 'possible' | 'yes';
      classification:
        | 'tactical_fix'
        | 'strategic_unlock'
        | 'foundational_blocker'
        | 'compounding_authority';
    }>;
    critical_path_ids: string[];
    parallel_track_ids: string[];
    sequence_narrative: string;
  };

  // Section 0 — Executive Insights (Phase 4): the six canonical artifacts that
  // the executive insight engine produces. Renders above the radar.
  executive_insights: {
    headline_thesis: CanonicalNarrative;
    primary_constraint: CanonicalNarrative;
    next_unlock: CanonicalNarrative;
    strategic_opportunity: CanonicalNarrative;
    authority_risk: CanonicalNarrative;
    momentum_interpretation: CanonicalNarrative;
  };

  // Phase 5 — historical / operational sections.
  change_intelligence: {
    state: 'measured' | 'insufficient_history';
    observed_at: string;
    comparison_baseline_at: string | null;
    authority_delta: { current: number | null; previous: number | null; delta: number | null; direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation'; significant: boolean };
    ai_visibility_delta: { current: number | null; previous: number | null; delta: number | null; direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation'; significant: boolean };
    pillar_deltas: Array<{
      pillar: PillarKey;
      delta: { current: number | null; previous: number | null; delta: number | null; direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation'; significant: boolean };
    }>;
    notable_changes: string[];
    reason_unavailable: string | null;
  };

  forecast: {
    state: 'measured' | 'unavailable';
    horizon_days: number;
    projected_score: CanonicalScore | null;
    confidence_band: { lower: number; upper: number } | null;
    trajectory: 'sustained_growth' | 'sustained_decay' | 'stagnation' | 'volatile' | 'temporary_spike' | 'insufficient_history';
    history_count: number;
    reason_unavailable: string | null;
  };

  provider_observability: {
    observed_at: string;
    window_hours: number;
    providers: Array<{
      provider_id: string;
      state: 'healthy' | 'degraded' | 'down' | 'no_data';
      uptime_pct: number | null;
      total_calls: number;
      cache_hit_ratio: number | null;
      mean_latency_ms: number | null;
      p95_latency_ms: number | null;
      freshness_lag_hours: number | null;
      circuit_breaker_state: 'closed' | 'open' | 'half_open' | 'unknown';
    }>;
  };

  scan_metadata: {
    scan_profile: 'lightweight' | 'standard' | 'deep' | 'manual_refresh' | 'delta_only';
    persisted: boolean;
    persisted_at: string | null;
    cost_summary: {
      total_requests: number;
      total_cost_usd: number;
      cost_known_count: number;
      cost_unknown_count: number;
      per_provider: Record<string, { requests: number; cost_usd: number; cache_hit_ratio: number }>;
    } | null;
  };

  /** BR-H-004 — honest ROI determinability (reuses the ENGINE-012 ROIStatus vocabulary). `not_determinable`
   *  ("Not Quantifiable") when no commercial evidence is connected — the current live state, since Pipeline A
   *  has no commercial provider. Never a fabricated revenue figure. Optional for backward compatibility. */
  commercial_roi?: import('./reportRoiDeterminability').ReportRoiDeterminability;

  // ── Phase 6 governance / explainability / collaboration sections ────────────
  governance: {
    tenant_id: string;
    plan_tier: 'starter' | 'standard' | 'professional' | 'enterprise';
    policy_revision: string;
    enabled_providers: string[];
    excluded_providers: string[];
    external_calls_forbidden: boolean;
    allowed_scan_profiles: string[];
  };

  active_overrides: Array<{
    id: string;
    kind: string;
    target_summary: string;
    reason: string;
    created_at: string;
    created_by: { id: string; kind: string; label: string };
  }>;

  /** BR-H-005 — executive disclosure of any MATERIAL analyst/governance override that changed customer-visible
   *  output (reuses `active_overrides` + `governance`). Empty when none. Optional for backward compatibility. */
  override_disclosure?: import('./reportOverrideTransparency').OverrideTransparency;

  /** BETA-EVIDENCE-EXEC-002 — governance readiness ("have we measured enough?"), composed from existing
   *  signals; distinct from the Authority Index. Optional for backward compatibility. */
  evidence_readiness?: import('./reportEvidenceReadiness').EvidenceReadiness;

  explanations: {
    authority_overall: import('../intelligence/explainabilityEngine').Explanation;
    pillars: Array<{ pillar: PillarKey; explanation: import('../intelligence/explainabilityEngine').Explanation }>;
    dimensions: Array<{ key: string; explanation: import('../intelligence/explainabilityEngine').Explanation }>;
    recommendations: Array<{ id: string; explanation: import('../intelligence/explainabilityEngine').Explanation }>;
    maturity_stage: import('../intelligence/explainabilityEngine').Explanation;
    forecast: import('../intelligence/explainabilityEngine').Explanation;
    benchmark: import('../intelligence/explainabilityEngine').Explanation;
    change: import('../intelligence/explainabilityEngine').Explanation;
  };

  comparison: import('../intelligence/comparisonEngine').ComparisonView;

  collaboration: {
    annotations: import('../intelligence/collaboration').AnnotationRecord[];
    assignments: import('../intelligence/collaboration').AssignmentRecord[];
    pinned_findings: import('../intelligence/collaboration').PinnedFindingRecord[];
    recommendation_statuses: import('../intelligence/collaboration').RecommendationStatusOverrideRecord[];
  };

  // Section 9 — Evidence Trace (drawer/drill-down primitive).
  evidence_trace: {
    by_dimension: Partial<Record<CanonicalDimensionKey, EvidenceTrace>>;
    by_pillar: Partial<Record<PillarKey, EvidenceTrace>>;
    overall: EvidenceTrace;
  };
};
