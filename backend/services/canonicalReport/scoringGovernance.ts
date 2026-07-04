/**
 * Canonical Scoring Governance Registry  (BETA-EXEC-003)
 *
 * Single source of truth for every scoring FORMULA, BAND threshold, and WEIGHT constant
 * used across the Authority Intelligence report. This is a CONSOLIDATION artifact — every
 * value here is IDENTICAL to the inline literal it replaces (behaviour-preserving; the
 * snapshot + score-model tests assert this).
 *
 * Where two previously-inline thresholds genuinely CONFLICTED (e.g. the executive impact
 * scale uses 72/48 while action-priority uses 70/60/45), both are retained here as distinct,
 * named, documented constants rather than silently unified — unifying would change displayed
 * classifications. Those discrepancies are called out as GOVERNANCE DEBT for a future
 * product decision.
 *
 * Leaf module: imports nothing from the report pipeline (no circular dependencies).
 */

// ── Aggregation formulas ──────────────────────────────────────────────────────

/**
 * Geometric mean of non-negative scores: `exp(mean(log(max(1, v))))`.
 * A single weak input drags the total down (honest signal; no clamp here).
 * Owner: scoring-governance.
 * Usage: overall snapshot score + projected-score-improvement (reportScoreModelService),
 *        canonical overall + pillar aggregation (canonicalReportBuilder).
 * Consolidates two previously-identical inline implementations.
 */
export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const logs = values.map((v) => Math.log(Math.max(1, v)));
  return Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
}

// ── Confidence (evidence-count) ────────────────────────────────────────────────

/**
 * Evidence-count thresholds for the confidence band.
 * Owner: scoring-governance. Usage: bandFromCount (with strong-source gate) and the
 * per-provider count-only confidence in canonicalReportBuilder.
 */
export const CONFIDENCE_EVIDENCE = { HIGH_COUNT: 4, MEDIUM_COUNT: 2 } as const;

/**
 * Count-only confidence band (no strong-source requirement). Consolidates the three
 * inline duplicates in canonicalReportBuilder (per-provider confidence). NOTE: distinct
 * from `bandFromCount`, which additionally requires a strong evidence source for 'high'.
 */
export function confidenceBandFromCount(count: number): 'high' | 'medium' | 'low' {
  if (count >= CONFIDENCE_EVIDENCE.HIGH_COUNT) return 'high';
  if (count >= CONFIDENCE_EVIDENCE.MEDIUM_COUNT) return 'medium';
  return 'low';
}

// ── Score bands ────────────────────────────────────────────────────────────────

/**
 * Canonical pillar/dimension band cutoffs (foundational / developing / operational / leading).
 * Owner: scoring-governance. Usage: canonicalBandFromValue (canonicalReportTypes).
 */
export const CANONICAL_SCORE_BANDS = { leading: 75, operational: 50, developing: 25 } as const;

/**
 * Market-position label band cutoffs. Owner: scoring-governance. Usage: levelLabel /
 * nextLevel (reportScoreModelService). Intentionally DISTINCT from CANONICAL_SCORE_BANDS —
 * a different concept (market-position narrative) with finer granularity.
 */
export const MARKET_POSITION_BANDS = { strong: 75, competitive: 60, developing: 45, foundational: 25 } as const;

// ── Weights ────────────────────────────────────────────────────────────────────

/**
 * Decision severity = impact*0.65 + confidence*0.35. Owner: reportScoreModelService.
 * Impact-weighted because realized business impact is the stronger signal than model
 * self-confidence.
 */
export const SEVERITY_WEIGHTS = { impact: 0.65, confidence: 0.35 } as const;

/**
 * Action top-priority ranking = impact*0.58 + confidence*0.42. Owner: summaryDecisionHelpers.
 * Used only for ordering actions; not surfaced as a score.
 */
export const PRIORITY_RANK_WEIGHTS = { impact: 0.58, confidence: 0.42 } as const;

/**
 * SEO capability-radar axis weights, in axis order [technical_seo, rank_tracking,
 * content_quality, backlinks]. Renormalized by the count of measured axes.
 * Owner: seoExecutiveSummaryHelpers.
 */
export const SEO_AXIS_WEIGHTS = [0.28, 0.30, 0.24, 0.18] as const;

/**
 * Competitor standing = clamp(round(parity - avgDelta*slope), 0, 100). Owner:
 * visualIntelligenceHelpers (introduced in BETA-EXEC-001 to replace fixed 35/80/60 buckets).
 * parity 60, slope 3.2 preserves the prior anchor points (+8→~35, -6→~80).
 */
export const COMPETITOR_STANDING = { parity: 60, slope: 3.2 } as const;

/**
 * Social supporting-signal saturation: N distinct social links → full (1.0) supporting signal
 * (`min(socialCount / N, 1)`). Owner: reportScoreModelService. N=6 preserves the prior inline
 * divisor — 6 profiles is treated as a complete social footprint.
 */
export const SOCIAL_SATURATION_LINKS = 6 as const;

/**
 * Per-gap penalty applied to the competitor-coverage supporting signal
 * (`max(0, 1 - competitorGapCount * PENALTY)`). Owner: reportScoreModelService. 0.12 preserves
 * the prior inline factor — ~8 uncovered gaps fully erodes the supporting signal.
 */
export const COVERAGE_GAP_PENALTY = 0.12 as const;

// ── Priority / maturity thresholds ──────────────────────────────────────────────

/** Executive impact-scale thresholds. Owner: summaryDecisionHelpers. */
export const IMPACT_SCALE = { high: 72, medium: 48 } as const;

/**
 * Action priority-type thresholds. Owner: actionPriorityService.
 * GOVERNANCE DEBT: high=70 differs from IMPACT_SCALE.high=72, and mid=60 has no analogue
 * elsewhere. Retained distinct pending a product decision — unifying would change how
 * individual actions are labelled (quick_win / high_impact / strategic).
 */
export const ACTION_PRIORITY = { quick_win_impact: 45, high_impact: 70, mid_impact: 60 } as const;

/** System-maturity thresholds. Owner: canonicalScoreState. */
export const MATURITY_THRESHOLDS = { strongFoundation: 65, strongAuthority: 60, weakAuthority: 40 } as const;
