/**
 * Market Pulse — Composite Trust Scoring.
 *
 * Phase 1B replacement for the Phase 1A "confidence_score = job confidence_index"
 * approach (which produced one identical confidence number for every finding in
 * a run). The composite scores each finding individually using:
 *
 *   - source_diversity_score   : how many distinct origins agree
 *   - freshness_factor          : age of the run vs the finding
 *   - recurrence_factor         : market_pulse_memory.times_seen — has this
 *                                 event been independently observed before?
 *   - region_consistency_factor : breadth of regional agreement (1 region OK,
 *                                 ≥3 regions stronger evidence)
 *   - contradiction_factor      : reserved for cross-finding contradiction
 *                                 detection (default 1.0 = no contradictions
 *                                 — populated by correlation pass)
 *
 * BACKWARD COMPATIBILITY:
 *   - Existing `confidence_score` column is still produced by `scoreFinding`
 *     in scoringService.ts (Phase 1A). Trust composite is additive and lives
 *     in `evidence_strength` (0..1), with the per-factor breakdown stored in
 *     `confidence_breakdown` JSONB. UI can present either; ranking can begin
 *     using evidence_strength incrementally without forcing a UI rewrite.
 */

export interface TrustScoreInputs {
  /** Number of distinct upstream sources that produced this finding. */
  sourceCount: number;
  /** Set of distinct source kinds (e.g. 'llm', 'db_signal_clusters', 'lead_signals'). */
  sourceKinds: string[];
  /** Regions where the topic was seen in this run. */
  regions: string[];
  /** market_pulse_memory.times_seen at the moment of this insertion (0 if first time). */
  timesSeenPrior: number;
  /** Run.started_at ISO. Used for freshness — older runs lose freshness credit. */
  runStartedAt?: string | null;
  /**
   * Hint from the correlation pass: how many findings in the same run
   * directly contradict this one (e.g., same competitor, opposite direction).
   * Default 0 = no contradictions detected.
   */
  contradictingFindingCount?: number;
}

export interface TrustScoreBreakdown {
  source_diversity_score: number;
  freshness_factor: number;
  recurrence_factor: number;
  region_consistency_factor: number;
  contradiction_factor: number;
  components: {
    source_count: number;
    distinct_source_kinds: number;
    regions_count: number;
    times_seen_prior: number;
    contradicting_findings: number;
  };
}

export interface TrustComposite {
  /** Headline composite. 0..1 — higher = better trust. */
  evidence_strength: number;
  source_diversity_score: number;
  freshness_factor: number;
  recurrence_factor: number;
  region_consistency_factor: number;
  contradiction_factor: number;
  /** Audit-ready breakdown — persisted as JSONB on the finding. */
  breakdown: TrustScoreBreakdown;
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * source_diversity_score — saturating curve over distinct source kinds.
 *   1 source kind → 0.50
 *   2            → 0.70
 *   3            → 0.85
 *   4+           → 1.00
 * source_count adds a small uplift (more raw signals from the same kind is
 * weak diversity but still positive).
 */
function computeSourceDiversity(sourceCount: number, sourceKinds: string[]): number {
  const distinctKinds = new Set(sourceKinds.map((s) => String(s).toLowerCase().trim())).size;
  const kindBase = distinctKinds <= 0 ? 0.4
    : distinctKinds === 1 ? 0.5
    : distinctKinds === 2 ? 0.7
    : distinctKinds === 3 ? 0.85
    : 1.0;
  const countUplift = Math.min(0.15, Math.max(0, sourceCount - 1) * 0.03);
  return clamp01(kindBase + countUplift);
}

/**
 * freshness_factor — step function on run age. Mirrors the curve in
 * `marketPulseAggregationService.computeRecencyScore` so trust + relevance
 * decay together.
 */
function computeFreshness(runStartedAt: string | null | undefined): number {
  if (!runStartedAt) return 0.75; // Phase 1A default — preserves prior behavior
  const startedAt = new Date(runStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0.75;
  const hours = (Date.now() - startedAt) / (60 * 60 * 1000);
  if (hours <= 6) return 1.0;
  if (hours <= 24) return 0.9;
  if (hours <= 48) return 0.75;
  if (hours <= 72) return 0.6;
  if (hours <= 120) return 0.45;
  return 0.3;
}

/**
 * recurrence_factor — log curve on memory.times_seen. First-time evidence
 * gets a neutral 0.5 (we have no prior to corroborate); each subsequent
 * sighting adds diminishing returns up to 1.0. After ~6 sightings this
 * saturates.
 */
function computeRecurrence(timesSeenPrior: number): number {
  if (timesSeenPrior <= 0) return 0.5;
  if (timesSeenPrior === 1) return 0.65;
  if (timesSeenPrior === 2) return 0.75;
  if (timesSeenPrior === 3) return 0.83;
  if (timesSeenPrior === 4) return 0.9;
  if (timesSeenPrior === 5) return 0.95;
  return 1.0;
}

/**
 * region_consistency_factor — 1 region → neutral 0.5; ≥3 regions → 1.0
 * (strong consensus the signal is real). Tuned so that single-region
 * findings are not penalized harshly (they may legitimately be local).
 */
function computeRegionConsistency(regions: string[]): number {
  const distinct = new Set(regions.map((r) => String(r).toUpperCase().trim()).filter(Boolean)).size;
  if (distinct <= 0) return 0.4;
  if (distinct === 1) return 0.55;
  if (distinct === 2) return 0.75;
  if (distinct === 3) return 0.9;
  return 1.0;
}

/**
 * contradiction_factor — neutral 1.0 when no contradictions detected.
 * Each contradicting finding peer subtracts 0.15, floored at 0.4 so a
 * heavily-contested finding still surfaces (just with reduced trust).
 */
function computeContradictionFactor(contradictingFindingCount: number): number {
  if (contradictingFindingCount <= 0) return 1.0;
  return clamp01(1.0 - contradictingFindingCount * 0.15);
}

/**
 * Composite weights. Sum to 1.0.
 *   diversity   30% — multiple independent sources are the strongest signal
 *   freshness   25% — stale runs lose trust quickly
 *   recurrence  20% — historical recurrence is a moderate signal
 *   region      15% — multi-region agreement is helpful but optional
 *   contradiction 10% — cap on any single factor's impact
 */
const WEIGHTS = {
  diversity: 0.30,
  freshness: 0.25,
  recurrence: 0.20,
  region: 0.15,
  contradiction: 0.10,
};

export function computeTrust(input: TrustScoreInputs): TrustComposite {
  const sourceCount = Math.max(0, Math.floor(input.sourceCount ?? 0));
  const sourceKinds = Array.isArray(input.sourceKinds) ? input.sourceKinds : [];
  const regions = Array.isArray(input.regions) ? input.regions : [];
  const timesSeenPrior = Math.max(0, Math.floor(input.timesSeenPrior ?? 0));
  const contradictingFindingCount = Math.max(0, Math.floor(input.contradictingFindingCount ?? 0));

  const source_diversity_score = computeSourceDiversity(sourceCount, sourceKinds);
  const freshness_factor = computeFreshness(input.runStartedAt);
  const recurrence_factor = computeRecurrence(timesSeenPrior);
  const region_consistency_factor = computeRegionConsistency(regions);
  const contradiction_factor = computeContradictionFactor(contradictingFindingCount);

  const evidence_strength = clamp01(
    source_diversity_score * WEIGHTS.diversity +
    freshness_factor * WEIGHTS.freshness +
    recurrence_factor * WEIGHTS.recurrence +
    region_consistency_factor * WEIGHTS.region +
    contradiction_factor * WEIGHTS.contradiction,
  );

  return {
    evidence_strength,
    source_diversity_score,
    freshness_factor,
    recurrence_factor,
    region_consistency_factor,
    contradiction_factor,
    breakdown: {
      source_diversity_score,
      freshness_factor,
      recurrence_factor,
      region_consistency_factor,
      contradiction_factor,
      components: {
        source_count: sourceCount,
        distinct_source_kinds: new Set(sourceKinds.map((s) => String(s).toLowerCase().trim())).size,
        regions_count: new Set(regions.map((r) => String(r).toUpperCase().trim())).size,
        times_seen_prior: timesSeenPrior,
        contradicting_findings: contradictingFindingCount,
      },
    },
  };
}
