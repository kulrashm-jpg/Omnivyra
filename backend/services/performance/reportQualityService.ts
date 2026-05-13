/**
 * Performance Intelligence — Report Quality Service.
 *
 * Pre-drill calibration: produces a single 0..100 quality score plus a
 * structured breakdown so evaluators can see WHY a report scored what it
 * did. Used by:
 *
 *   - performanceReportEvaluationService — the existing evaluator gates
 *     "ready_for_real_user_review" on this score.
 *   - performance HTML renderer — renders a quality badge + breakdown chip.
 *
 * Six factors, weighted:
 *
 *     provider_completeness  20%   — GA + GSC connected and reading?
 *     freshness              15%   — recency of the analytics window
 *     signal_strength        20%   — sample size + non-empty sections
 *     confidence_distribution 20%  — % of recommendations at confirmed/directional tier
 *     coverage_quality       15%   — funnel + sources + pages + drop-offs all present
 *     recommendation_reliability 10% — % of recommendations that survived dedup
 *
 * No DB writes. Pure derivation from the existing report response.
 */

import type { PerformanceReportMappedData } from '../performanceReportMapper';

export type QualityFactorKey =
  | 'provider_completeness'
  | 'freshness'
  | 'signal_strength'
  | 'confidence_distribution'
  | 'coverage_quality'
  | 'recommendation_reliability';

export interface QualityFactor {
  key: QualityFactorKey;
  label: string;
  score: number;       // 0..100
  weight: number;      // 0..1
  rationale: string;
}

export interface ReportQualityScore {
  overall: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: QualityFactor[];
  premium: {
    usefulness: number;
    signal_to_noise: number;
    actionability: number;
    substance: number;
    clutter_risk: 'low' | 'medium' | 'high';
  };
  /**
   * Top reasons the report would not yet pass first-drill evaluation.
   * Empty when the report is in good shape.
   */
  blockers: string[];
  /**
   * Lower-priority observations evaluators should keep an eye on.
   */
  watchouts: string[];
}

const WEIGHTS: Record<QualityFactorKey, number> = {
  provider_completeness:    0.20,
  freshness:                0.15,
  signal_strength:          0.20,
  confidence_distribution:  0.20,
  coverage_quality:         0.15,
  recommendation_reliability: 0.10,
};

const FACTOR_LABEL: Record<QualityFactorKey, string> = {
  provider_completeness:    'Provider completeness',
  freshness:                'Data freshness',
  signal_strength:          'Signal strength',
  confidence_distribution:  'Confidence distribution',
  coverage_quality:         'Section coverage',
  recommendation_reliability: 'Recommendation reliability',
};

export interface ScoreReportQualityInput {
  /** From getGoogleProviderReadiness — at least the connected booleans. */
  providerReadiness?: {
    google_analytics?:      { connected?: boolean | null } | null;
    google_search_console?: { connected?: boolean | null } | null;
  } | null;
  /** Report status — 'ready' is a positive signal, 'partial' is medium. */
  reportStatus: 'ready' | 'partial' | 'no_data' | 'low_data';
  /** Generation timestamp — used for the freshness factor. */
  generatedAt?: string | null;
  /** Behavior data window in days — short windows are weaker. */
  windowDays?: number | null;
  /** Total sessions across the window (from session_metrics or sources). */
  totalSessions?: number | null;
  /** Total conversions across the window. */
  totalConversions?: number | null;
  /** From the consolidator: how many recommendations remained after dedup. */
  consolidatedRecommendationCount: number;
  /** Raw recommendation count BEFORE dedup. */
  rawRecommendationCount: number;
  /** Distribution of confidence tiers across visible recommendations. */
  confidenceDistribution: {
    confirmed: number;
    directional: number;
    hypothesis: number;
    weak_data: number;
  };
  /** Mapped data — used for coverage checks. */
  mapped: PerformanceReportMappedData;
}

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function scoreProviderCompleteness(input: ScoreReportQualityInput): QualityFactor {
  const ga = !!input.providerReadiness?.google_analytics?.connected;
  const gsc = !!input.providerReadiness?.google_search_console?.connected;
  let score = 0;
  let rationale = '';
  if (ga && gsc) { score = 100; rationale = 'GA and GSC both connected.'; }
  else if (ga)   { score = 65;  rationale = 'GA connected; GSC missing — search intelligence unavailable.'; }
  else if (gsc)  { score = 50;  rationale = 'GSC connected; GA missing — behavior intelligence unavailable.'; }
  else           { score = 10;  rationale = 'Neither GA nor GSC is connected.'; }
  return {
    key: 'provider_completeness',
    label: FACTOR_LABEL.provider_completeness,
    score, weight: WEIGHTS.provider_completeness, rationale,
  };
}

function scoreFreshness(input: ScoreReportQualityInput): QualityFactor {
  const generated = input.generatedAt ? new Date(input.generatedAt).getTime() : NaN;
  const ageHours = Number.isFinite(generated) ? (Date.now() - generated) / (60 * 60 * 1000) : Infinity;
  let score = 0;
  let rationale = '';
  if (ageHours <= 1)  { score = 100; rationale = 'Generated within the last hour.'; }
  else if (ageHours <= 24)  { score = 90; rationale = 'Generated within the last day.'; }
  else if (ageHours <= 72)  { score = 70; rationale = `Generated ~${Math.round(ageHours / 24)} days ago.`; }
  else if (ageHours <= 168) { score = 50; rationale = 'Older than 3 days; rerun recommended.'; }
  else                       { score = 25; rationale = 'Older than a week; treat as historical context only.'; }
  // Window-length sub-penalty.
  const window = Number(input.windowDays ?? 30);
  if (window < 14) { score = clamp(score - 20); rationale += ' Window is shorter than 14 days — fewer comparable patterns.'; }
  return {
    key: 'freshness',
    label: FACTOR_LABEL.freshness,
    score: clamp(score), weight: WEIGHTS.freshness, rationale,
  };
}

function scoreSignalStrength(input: ScoreReportQualityInput): QualityFactor {
  const sessions = Number(input.totalSessions ?? 0);
  const conversions = Number(input.totalConversions ?? 0);
  let score = 0;
  let rationale = '';
  if (sessions >= 5_000 && conversions >= 50) { score = 100; rationale = `${sessions.toLocaleString('en-US')} sessions and ${conversions} conversions support strong inference.`; }
  else if (sessions >= 1_000 && conversions >= 10) { score = 80; rationale = `${sessions.toLocaleString('en-US')} sessions support most findings.`; }
  else if (sessions >= 200) { score = 55; rationale = `${sessions.toLocaleString('en-US')} sessions — directional only.`; }
  else if (sessions >= 50)  { score = 30; rationale = `${sessions} sessions — hypothesis tier most findings.`; }
  else                       { score = 10; rationale = `Sample size (${sessions} sessions) is below the safe execution floor.`; }
  return {
    key: 'signal_strength',
    label: FACTOR_LABEL.signal_strength,
    score, weight: WEIGHTS.signal_strength, rationale,
  };
}

function scoreConfidenceDistribution(input: ScoreReportQualityInput): QualityFactor {
  const dist = input.confidenceDistribution;
  const total = dist.confirmed + dist.directional + dist.hypothesis + dist.weak_data;
  if (total === 0) {
    return {
      key: 'confidence_distribution',
      label: FACTOR_LABEL.confidence_distribution,
      score: 30, weight: WEIGHTS.confidence_distribution,
      rationale: 'No tiered recommendations to evaluate.',
    };
  }
  // 100 = all confirmed; 0 = all weak_data.
  const score =
    (dist.confirmed * 100 + dist.directional * 75 + dist.hypothesis * 40 + dist.weak_data * 10) / total;
  let rationale = '';
  if (dist.weak_data / total > 0.3) {
    rationale = `${Math.round((dist.weak_data / total) * 100)}% of recommendations are weak-data — calibrate before drilling.`;
  } else if (dist.confirmed / total >= 0.5) {
    rationale = `${Math.round((dist.confirmed / total) * 100)}% confirmed — strong recommendation distribution.`;
  } else {
    rationale = `${dist.confirmed} confirmed / ${dist.directional} directional / ${dist.hypothesis} hypothesis / ${dist.weak_data} weak-data.`;
  }
  return {
    key: 'confidence_distribution',
    label: FACTOR_LABEL.confidence_distribution,
    score: clamp(score), weight: WEIGHTS.confidence_distribution, rationale,
  };
}

function scoreCoverageQuality(input: ScoreReportQualityInput): QualityFactor {
  const mapped = input.mapped;
  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: mapped.sources.length > 0, label: 'traffic sources' },
    { ok: mapped.leakage.funnel_steps.length > 0, label: 'funnel steps' },
    { ok: mapped.content.top_converting_pages.length > 0 || mapped.content.high_traffic_low_conversion_pages.length > 0, label: 'page-level content data' },
    { ok: mapped.leakage.top_drop_off_pages.length > 0, label: 'drop-off pages' },
    { ok: mapped.behavior_quality.engagement_confidence !== 'none', label: 'GA engagement confidence' },
    { ok: mapped.organic_search.data_confidence !== 'none', label: 'GSC data confidence' },
  ];
  const present = checks.filter((c) => c.ok).length;
  const score = (present / checks.length) * 100;
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  const rationale = missing.length === 0
    ? 'All expected report sections have data.'
    : `Missing data for: ${missing.join(', ')}.`;
  return {
    key: 'coverage_quality',
    label: FACTOR_LABEL.coverage_quality,
    score: clamp(score), weight: WEIGHTS.coverage_quality, rationale,
  };
}

function scoreRecommendationReliability(input: ScoreReportQualityInput): QualityFactor {
  if (input.rawRecommendationCount === 0) {
    return {
      key: 'recommendation_reliability',
      label: FACTOR_LABEL.recommendation_reliability,
      score: 30, weight: WEIGHTS.recommendation_reliability,
      rationale: 'No recommendations were generated.',
    };
  }
  const dedupKept = input.consolidatedRecommendationCount / input.rawRecommendationCount;
  // Sweet spot: kept 0.4-0.7 (good consolidation). Below 0.3 = noisy raw set.
  // Above 0.85 = no overlap detected (could be too sparse to consolidate).
  let score = 0;
  let rationale = '';
  if (dedupKept >= 0.4 && dedupKept <= 0.7) {
    score = 100;
    rationale = `${input.consolidatedRecommendationCount} of ${input.rawRecommendationCount} recommendations retained after consolidation — healthy distribution.`;
  } else if (dedupKept > 0.7) {
    score = 70;
    rationale = `Little overlap detected between recommendations (${Math.round(dedupKept * 100)}% retained) — review whether items are actually distinct.`;
  } else if (dedupKept >= 0.2) {
    score = 50;
    rationale = `Heavy consolidation (${input.rawRecommendationCount} → ${input.consolidatedRecommendationCount}); raw output was noisy.`;
  } else {
    score = 25;
    rationale = `Severe consolidation (${input.rawRecommendationCount} → ${input.consolidatedRecommendationCount}); generator is over-producing duplicates.`;
  }
  return {
    key: 'recommendation_reliability',
    label: FACTOR_LABEL.recommendation_reliability,
    score: clamp(score), weight: WEIGHTS.recommendation_reliability, rationale,
  };
}

function gradeFromScore(score: number): ReportQualityScore['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function scorePremiumReadiness(input: ScoreReportQualityInput): ReportQualityScore['premium'] {
  const mapped = input.mapped;
  const totalTiered =
    input.confidenceDistribution.confirmed +
    input.confidenceDistribution.directional +
    input.confidenceDistribution.hypothesis +
    input.confidenceDistribution.weak_data;
  const strongTiered = input.confidenceDistribution.confirmed + input.confidenceDistribution.directional;
  const strongRatio = totalTiered > 0 ? strongTiered / totalTiered : 0;
  const nextMoveCount = mapped.next_moves.length;
  const themeCount = mapped.organic_search.opportunity_themes.length;
  const pageSpecificCount = mapped.next_moves.filter((item) => item.page_url).length +
    mapped.organic_search.opportunities.filter((item) => item.page_url).length;
  const filledSections = [
    mapped.what_matters_most && (
      mapped.what_matters_most.risks.length +
      mapped.what_matters_most.opportunities.length +
      mapped.what_matters_most.next_steps.length
    ) > 0,
    mapped.snapshot_foundation !== null,
    mapped.sources.length > 0,
    mapped.behavior_quality.current !== null || mapped.behavior_quality.landing_page_insights.length > 0,
    mapped.organic_search.opportunities.length > 0 || mapped.organic_search.keyword_opportunities.length > 0,
    mapped.content.top_converting_pages.length > 0 || mapped.content.high_traffic_low_conversion_pages.length > 0,
  ].filter(Boolean).length;

  const usefulness = clamp(
    35 +
    Math.min(25, nextMoveCount * 6) +
    Math.min(20, themeCount * 5) +
    Math.min(20, filledSections * 4),
  );
  const signalToNoise = clamp(35 + strongRatio * 55 - Math.min(25, input.confidenceDistribution.weak_data * 6));
  const actionability = clamp(30 + Math.min(35, pageSpecificCount * 5) + Math.min(25, nextMoveCount * 5) + Math.min(10, input.totalConversions ?? 0));
  const substance = clamp(25 + filledSections * 10 + Math.min(20, Math.log10(Number(input.totalSessions ?? 0) + 1) * 8));
  const clutterRatio = input.rawRecommendationCount > 0
    ? input.rawRecommendationCount / Math.max(1, input.consolidatedRecommendationCount)
    : 1;
  const clutterRisk = clutterRatio >= 3 || input.confidenceDistribution.weak_data >= 4
    ? 'high'
    : clutterRatio >= 1.8 || input.confidenceDistribution.weak_data >= 2
      ? 'medium'
      : 'low';

  return {
    usefulness,
    signal_to_noise: signalToNoise,
    actionability,
    substance,
    clutter_risk: clutterRisk,
  };
}

export function scoreReportQuality(input: ScoreReportQualityInput): ReportQualityScore {
  const factors: QualityFactor[] = [
    scoreProviderCompleteness(input),
    scoreFreshness(input),
    scoreSignalStrength(input),
    scoreConfidenceDistribution(input),
    scoreCoverageQuality(input),
    scoreRecommendationReliability(input),
  ];
  const overall = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const premium = scorePremiumReadiness(input);
  const blockers: string[] = [];
  const watchouts: string[] = [];

  for (const f of factors) {
    if (f.score < 35) blockers.push(`${f.label}: ${f.rationale}`);
    else if (f.score < 60) watchouts.push(`${f.label}: ${f.rationale}`);
  }
  if (input.reportStatus === 'no_data' || input.reportStatus === 'low_data') {
    blockers.unshift('Analytics has no usable data yet.');
  }
  if (premium.actionability < 55) watchouts.push('Premium actionability is weak: recommendations need more page/query/conversion specificity.');
  if (premium.signal_to_noise < 55) watchouts.push('Signal-to-noise is weak: suppress low-confidence or duplicate recommendations before user review.');
  if (premium.clutter_risk === 'high') watchouts.push('Clutter risk is high: raw recommendations are over-producing relative to consolidated actions.');

  return {
    overall: clamp(overall),
    grade: gradeFromScore(overall),
    factors,
    premium,
    blockers,
    watchouts,
  };
}
