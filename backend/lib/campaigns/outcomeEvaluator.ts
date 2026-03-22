/**
 * Outcome Evaluator — deterministic, rule-based, no AI, no async, no external deps.
 *
 * Answers: Did this campaign hit its goals? By how much?
 *
 * Decision hierarchy:
 *   1. Map goal_type → metric weights (which KPIs matter most for this goal)
 *   2. For each benchmark metric: compute ratio = actual / benchmark
 *   3. Convert ratio → 0–100 component score (linear with clamps)
 *   4. Weighted average → final score
 *   5. Threshold score → status: exceeded | met | underperformed
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoalType = 'awareness' | 'engagement' | 'authority' | 'lead_gen' | 'conversion';

export interface CampaignGoal {
  goal_type: GoalType;
  benchmarks: {
    engagement_rate?: number;  // decimal e.g. 0.042 = 4.2 %
    avg_likes?: number;
    comments?: number;
    reach?: number;
    clicks?: number;
  };
}

export interface CampaignActuals {
  total_reach?: number | null;
  engagement_rate?: number | null;
  avg_likes?: number | null;
  total_comments?: number | null;
  total_clicks?: number | null;
}

export type EvaluationStatus = 'exceeded' | 'met' | 'underperformed';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceRating {
  level: ConfidenceLevel;
  /** 0–100 internal score used to derive level. */
  score: number;
  reason: string;
}

export interface MetricBreakdown {
  metric: string;
  benchmark: number;
  actual: number;
  ratio: number;
  status: EvaluationStatus;
}

export interface EvaluationResult {
  status: EvaluationStatus;
  /** 0–100. Values above 100 are capped; use status field to detect exceeded. */
  score: number;
  summary: string;
  metric_breakdown: MetricBreakdown[];
  confidence: ConfidenceRating;
}

// ---------------------------------------------------------------------------
// Internal config
// ---------------------------------------------------------------------------

/**
 * Per goal type: which metrics matter and how much.
 * Weights sum to 1.0 within each goal type.
 * Metrics not in the map are ignored during evaluation.
 */
const GOAL_METRIC_WEIGHTS: Record<GoalType, Partial<Record<keyof CampaignActuals, number>>> = {
  awareness:  { total_reach: 0.50, engagement_rate: 0.30, avg_likes: 0.20 },
  engagement: { engagement_rate: 0.50, avg_likes: 0.30, total_comments: 0.20 },
  authority:  { avg_likes: 0.25, total_comments: 0.40, engagement_rate: 0.35 },
  lead_gen:   { total_clicks: 0.55, total_reach: 0.25, engagement_rate: 0.20 },
  conversion: { total_clicks: 0.60, engagement_rate: 0.25, total_reach: 0.15 },
};

/** Benchmarks key → actuals key mapping (normalization). */
const BENCHMARK_TO_ACTUAL: Record<string, keyof CampaignActuals> = {
  reach:           'total_reach',
  engagement_rate: 'engagement_rate',
  avg_likes:       'avg_likes',
  comments:        'total_comments',
  clicks:          'total_clicks',
};

// Scoring thresholds
const SCORE_EXCEEDED   = 85; // score ≥ 85 → exceeded
const SCORE_MET        = 60; // score ≥ 60 → met
// < 60 → underperformed

// Component score mapping: ratio → 0–100
// ratio ≥ 1.15 → 100 (exceeded ceiling)
// ratio = 1.0  → 80 (fully met)
// ratio = 0.85 → 60 (lower bound of met)
// ratio = 0.5  → 30 (underperformed)
// ratio = 0    → 0
function ratioToScore(ratio: number): number {
  if (ratio >= 1.15) return 100;
  if (ratio >= 1.0)  return 80 + ((ratio - 1.0) / 0.15) * 20;   // 80–100
  if (ratio >= 0.85) return 60 + ((ratio - 0.85) / 0.15) * 20;  // 60–80
  return Math.max(0, (ratio / 0.85) * 60);                        // 0–60
}

function metricStatus(ratio: number): EvaluationStatus {
  if (ratio >= 1.10) return 'exceeded';
  if (ratio >= 0.85) return 'met';
  return 'underperformed';
}

// ---------------------------------------------------------------------------
// Confidence rating
// ---------------------------------------------------------------------------

/**
 * Confidence answers: "How much should we trust this evaluation?"
 *
 * Factors:
 *   1. Data coverage  — how many of the goal's key metrics were provided? (0–40 pts)
 *   2. Sample signal  — does reach/likes suggest a meaningful sample size? (0–30 pts)
 *   3. Score clarity  — is the score far from decision thresholds? (0–30 pts)
 *      Borderline scores (near 60 or 85) are less trustworthy.
 */
function computeConfidence(
  breakdown: MetricBreakdown[],
  score: number,
  actuals: CampaignActuals,
  goalType: GoalType
): ConfidenceRating {
  const expectedMetrics = Object.keys(GOAL_METRIC_WEIGHTS[goalType]).length;
  const providedMetrics = breakdown.length;

  // 1. Coverage: what fraction of expected metrics were filled?
  const coverageScore = expectedMetrics > 0
    ? Math.round((providedMetrics / expectedMetrics) * 40)
    : 0;

  // 2. Sample signal: reach > 2000 or likes > 50 = meaningful volume
  const reach  = actuals.total_reach    ?? 0;
  const likes  = actuals.avg_likes      ?? actuals.total_comments ?? 0;
  const clicks = actuals.total_clicks   ?? 0;
  const sampleScore =
    reach  > 5000 || likes > 100 || clicks > 500 ? 30 :
    reach  > 2000 || likes >  50 || clicks > 100 ? 20 :
    reach  >  500 || likes >  10 || clicks >  20 ? 10 : 0;

  // 3. Clarity: penalise borderline decisions (within 8 pts of a threshold)
  const distFromMet      = Math.abs(score - SCORE_MET);      // 60
  const distFromExceeded = Math.abs(score - SCORE_EXCEEDED);  // 85
  const minDist = Math.min(distFromMet, distFromExceeded);
  const clarityScore =
    minDist >= 20 ? 30 :
    minDist >= 10 ? 20 :
    minDist >=  5 ? 10 : 0;

  const total = coverageScore + sampleScore + clarityScore;

  const level: ConfidenceLevel =
    total >= 70 ? 'high'   :
    total >= 40 ? 'medium' : 'low';

  const reasons: string[] = [];
  if (providedMetrics === 0) {
    reasons.push('no metric data recorded yet');
  } else {
    reasons.push(`${providedMetrics} of ${expectedMetrics} metrics tracked`);
  }
  if (sampleScore >= 20) reasons.push('strong sample volume');
  else if (sampleScore === 0) reasons.push('low sample volume — collect more data');
  if (clarityScore === 0) reasons.push('score is near a decision boundary');
  else if (clarityScore === 30) reasons.push('consistent engagement trends');

  return {
    level,
    score: total,
    reason: reasons.join(', '),
  };
}

// ---------------------------------------------------------------------------
// Core evaluator
// ---------------------------------------------------------------------------

export function evaluateOutcome(goal: CampaignGoal, actuals: CampaignActuals): EvaluationResult {
  const weights = GOAL_METRIC_WEIGHTS[goal.goal_type];
  const breakdown: MetricBreakdown[] = [];
  let weightedScore = 0;
  let usedWeight = 0;

  for (const [actualKey, weight] of Object.entries(weights) as [keyof CampaignActuals, number][]) {
    // Find matching benchmark key
    const benchmarkKey = Object.entries(BENCHMARK_TO_ACTUAL).find(([, v]) => v === actualKey)?.[0];
    const benchmark = benchmarkKey ? goal.benchmarks[benchmarkKey as keyof typeof goal.benchmarks] : undefined;
    const actual = actuals[actualKey];

    if (benchmark == null || benchmark <= 0 || actual == null) continue;

    const ratio = actual / benchmark;
    const componentScore = ratioToScore(ratio);
    weightedScore += componentScore * weight;
    usedWeight += weight;

    breakdown.push({
      metric: actualKey,
      benchmark,
      actual,
      ratio: Math.round(ratio * 1000) / 1000,
      status: metricStatus(ratio),
    });
  }

  // No matching metrics — return neutral with low confidence
  if (usedWeight === 0 || breakdown.length === 0) {
    return {
      status: 'met',
      score: 50,
      summary: 'No benchmark metrics recorded yet. Add performance data to evaluate this campaign.',
      metric_breakdown: [],
      confidence: { level: 'low', score: 0, reason: 'no metric data recorded yet' },
    };
  }

  const normalizedScore = Math.round((weightedScore / usedWeight) * 10) / 10;
  const status: EvaluationStatus =
    normalizedScore >= SCORE_EXCEEDED ? 'exceeded' :
    normalizedScore >= SCORE_MET      ? 'met'       :
    'underperformed';

  const summary = buildSummary(status, goal.goal_type, normalizedScore, breakdown);
  const confidence = computeConfidence(breakdown, normalizedScore, actuals, goal.goal_type);

  return { status, score: normalizedScore, summary, metric_breakdown: breakdown, confidence };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  status: EvaluationStatus,
  goalType: GoalType,
  score: number,
  breakdown: MetricBreakdown[]
): string {
  const goalLabel: Record<GoalType, string> = {
    awareness:  'awareness',
    engagement: 'engagement',
    authority:  'authority building',
    lead_gen:   'lead generation',
    conversion: 'conversion',
  };

  const topMetric = breakdown.sort((a, b) => b.ratio - a.ratio)[0];
  const worstMetric = breakdown.sort((a, b) => a.ratio - b.ratio)[0];

  if (status === 'exceeded') {
    return `Campaign ${goalLabel[goalType]} goal exceeded with a score of ${score}/100. ` +
      `${topMetric ? `${topMetric.metric.replace(/_/g, ' ')} delivered ${Math.round(topMetric.ratio * 100)}% of benchmark.` : ''}`;
  }
  if (status === 'met') {
    return `Campaign met its ${goalLabel[goalType]} benchmarks (score: ${score}/100). ` +
      (worstMetric && worstMetric.ratio < 0.95
        ? `${worstMetric.metric.replace(/_/g, ' ')} has room for improvement at ${Math.round(worstMetric.ratio * 100)}%.`
        : 'Performance is on track across measured metrics.');
  }
  return `Campaign underperformed on ${goalLabel[goalType]} goals (score: ${score}/100). ` +
    `${worstMetric ? `${worstMetric.metric.replace(/_/g, ' ')} reached only ${Math.round(worstMetric.ratio * 100)}% of benchmark.` : 'Key metrics fell short of targets.'}`;
}

// ---------------------------------------------------------------------------
// Default benchmark generator (when user hasn't set explicit benchmarks)
// ---------------------------------------------------------------------------

const DEFAULT_BENCHMARKS: Record<GoalType, CampaignGoal['benchmarks']> = {
  awareness:  { reach: 5000, engagement_rate: 0.03, avg_likes: 30 },
  engagement: { engagement_rate: 0.05, avg_likes: 60, comments: 15 },
  authority:  { avg_likes: 80, comments: 25, engagement_rate: 0.06 },
  lead_gen:   { clicks: 200, reach: 3000, engagement_rate: 0.04 },
  conversion: { clicks: 300, engagement_rate: 0.05, reach: 4000 },
};

export function getDefaultBenchmarks(goalType: GoalType): CampaignGoal['benchmarks'] {
  return { ...DEFAULT_BENCHMARKS[goalType] };
}
