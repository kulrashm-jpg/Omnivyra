import type { ContentPlan, SectionGenerationResult } from './longFormPlanningEngine';
import type { ContentPositioning, ContentPositioningType, DifferentiationStrategy } from './longFormDifferentiationIntelligence';

export interface ContentPerformance {
  content_id: string;
  impressions: number;
  clicks: number;
  avg_position: number | null;
  dwell_time: number | null;
  bounce_rate: number | null;
  conversions: number;
  content_age_days?: number | null;
  traffic_source?: 'organic' | 'paid' | 'social' | 'email' | 'direct' | 'referral' | 'unknown' | string | null;
  seasonality_index?: number | null;
  observed_at?: string | null;
}

export interface ContentPerformanceFeatureSnapshot {
  content_id: string;
  sectionTypes: string[];
  frameworks: string[];
  positioning: ContentPositioningType[];
  structures: string[];
  weakSections?: string[];
  observed_at?: string | null;
}

export interface NormalizedPerformanceMetric {
  content_id: string;
  rawScore: number;
  normalizedScore: number;
  excludedOutlier: boolean;
  adjustments: {
    age: number;
    trafficSource: number;
    seasonality: number;
    volatility: number;
  };
}

export interface PatternDecayStatus {
  decayedPatterns: string[];
  reinforcedPatterns: string[];
  stalePatterns: string[];
}

export interface PerformanceInsights {
  highPerformingPatterns: string[];
  weakPatterns: string[];
  winningSectionTypes: string[];
  winningFrameworks: string[];
  winningPositioning: ContentPositioningType[];
  underperformingPositioning: ContentPositioningType[];
  scoringWeightAdjustments: {
    seo: number;
    aeo: number;
    geo: number;
    differentiation: number;
    readability: number;
  };
  reoptimizationCandidates: Array<{
    content_id: string;
    reason: string;
    performanceScore: number;
  }>;
  confidence: 'none' | 'low' | 'medium' | 'high';
  confidenceWeight: number;
  normalizedMetrics: NormalizedPerformanceMetric[];
  explorationRate: number;
  patternDecayStatus: PatternDecayStatus;
}

export interface PerformanceLearningInput {
  performance: ContentPerformance[];
  featureSnapshots?: ContentPerformanceFeatureSnapshot[];
}

const DEFAULT_WEIGHTS = {
  seo: 0,
  aeo: 0,
  geo: 0,
  differentiation: 0,
  readability: 0,
};

const DEFAULT_EXPLORATION_RATE = 0.2;
const POSITIONING_DOMINANCE_CAP = 0.7;
const FRAMEWORK_DOMINANCE_CAP = 0.7;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }
  return output;
}

function confidenceToWeight(confidence: PerformanceInsights['confidence']): number {
  if (confidence === 'high') return 1;
  if (confidence === 'medium') return 0.55;
  if (confidence === 'low') return 0.18;
  return 0;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 1;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function trafficSourceAdjustment(source?: ContentPerformance['traffic_source']): number {
  const normalized = String(source || 'unknown').toLowerCase();
  if (normalized === 'organic') return 1;
  if (normalized === 'email' || normalized === 'direct' || normalized === 'referral') return 0.94;
  if (normalized === 'social') return 0.86;
  if (normalized === 'paid') return 0.78;
  return 0.9;
}

function ageAdjustment(days?: number | null): number {
  if (days == null) return 0.92;
  if (days < 7) return 0.55;
  if (days < 21) return 0.78;
  if (days > 540) return 0.72;
  if (days > 365) return 0.84;
  return 1;
}

function seasonalityAdjustment(index?: number | null): number {
  if (index == null || index <= 0) return 1;
  return clamp(1 / index, 0.65, 1.25);
}

export function normalizePerformanceSignals(performance: ContentPerformance[]): NormalizedPerformanceMetric[] {
  const rawScores = performance.map(scoreContentPerformance);
  const upper = percentile(rawScores, 0.95);
  const lower = percentile(rawScores, 0.05);
  const volatility = coefficientOfVariation(rawScores);
  const volatilityAdjustment = volatility > 0.8 ? 0.7 : volatility > 0.45 ? 0.85 : 1;

  return performance.map((item, index) => {
    const rawScore = rawScores[index];
    const excludedOutlier = performance.length >= 8 && (rawScore > upper || rawScore < lower);
    const adjustments = {
      age: ageAdjustment(item.content_age_days),
      trafficSource: trafficSourceAdjustment(item.traffic_source),
      seasonality: seasonalityAdjustment(item.seasonality_index),
      volatility: volatilityAdjustment,
    };
    const normalizedScore = excludedOutlier
      ? Math.round(((rawScore + (rawScore > upper ? upper : lower)) / 2) * 0.5)
      : Math.round(rawScore * adjustments.age * adjustments.trafficSource * adjustments.seasonality * adjustments.volatility);

    return {
      content_id: item.content_id,
      rawScore,
      normalizedScore: Math.max(0, Math.min(100, normalizedScore)),
      excludedOutlier,
      adjustments,
    };
  });
}

export function scoreContentPerformance(performance: ContentPerformance): number {
  const ctr = performance.impressions > 0 ? performance.clicks / performance.impressions : 0;
  const ctrScore = clamp(ctr / 0.08);
  const positionScore = performance.avg_position == null
    ? 0.5
    : clamp((30 - performance.avg_position) / 29);
  const dwellScore = performance.dwell_time == null
    ? 0.5
    : clamp(performance.dwell_time / 180);
  const bounceScore = performance.bounce_rate == null
    ? 0.5
    : clamp(1 - performance.bounce_rate);
  const conversionRate = performance.clicks > 0 ? performance.conversions / performance.clicks : 0;
  const conversionScore = clamp(conversionRate / 0.06);

  return Math.round((
    ctrScore * 0.25
    + positionScore * 0.22
    + dwellScore * 0.2
    + bounceScore * 0.15
    + conversionScore * 0.18
  ) * 100);
}

function bucketByPerformance(input: PerformanceLearningInput): {
  high: ContentPerformanceFeatureSnapshot[];
  weak: ContentPerformanceFeatureSnapshot[];
  scores: Map<string, number>;
  normalizedMetrics: NormalizedPerformanceMetric[];
} {
  const normalizedMetrics = normalizePerformanceSignals(input.performance);
  const scores = new Map(normalizedMetrics.map((item) => [item.content_id, item.normalizedScore]));
  const snapshots = input.featureSnapshots || [];
  return {
    high: snapshots.filter((snapshot) => (scores.get(snapshot.content_id) || 0) >= 70),
    weak: snapshots.filter((snapshot) => (scores.get(snapshot.content_id) || 0) > 0 && (scores.get(snapshot.content_id) || 0) < 50),
    scores,
    normalizedMetrics,
  };
}

function countPatterns(snapshots: ContentPerformanceFeatureSnapshot[], selector: (snapshot: ContentPerformanceFeatureSnapshot) => string[]): string[] {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    for (const value of selector(snapshot)) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([value]) => value);
}

function capDominantPatterns<T extends string>(patterns: T[], cap = POSITIONING_DOMINANCE_CAP): T[] {
  if (patterns.length <= 1) return patterns;
  const counts = new Map<T, number>();
  for (const pattern of patterns) counts.set(pattern, (counts.get(pattern) || 0) + 1);
  const total = patterns.length;
  return patterns.filter((pattern) => ((counts.get(pattern) || 0) / total) <= cap);
}

function buildPatternDecayStatus(input: PerformanceLearningInput, high: ContentPerformanceFeatureSnapshot[]): PatternDecayStatus {
  const now = Date.now();
  const reinforcedPatterns = unique(high.flatMap((snapshot) => [
    ...snapshot.positioning,
    ...snapshot.frameworks,
    ...snapshot.sectionTypes,
  ]));
  const stalePatterns = unique((input.featureSnapshots || [])
    .filter((snapshot) => {
      const observed = snapshot.observed_at ? Date.parse(snapshot.observed_at) : NaN;
      return Number.isFinite(observed) && (now - observed) > 1000 * 60 * 60 * 24 * 180;
    })
    .flatMap((snapshot) => [
      ...snapshot.positioning,
      ...snapshot.frameworks,
      ...snapshot.sectionTypes,
    ]));
  const decayedPatterns = stalePatterns.filter((pattern) => !reinforcedPatterns.includes(pattern));
  return {
    decayedPatterns,
    reinforcedPatterns,
    stalePatterns,
  };
}

function deriveConfidence(metrics: NormalizedPerformanceMetric[]): PerformanceInsights['confidence'] {
  if (metrics.length === 0) return 'none';
  const scores = metrics.filter((metric) => !metric.excludedOutlier).map((metric) => metric.normalizedScore);
  const volatility = coefficientOfVariation(scores);
  const usableSamples = scores.length;
  if (usableSamples >= 20 && volatility <= 0.35) return 'high';
  if (usableSamples >= 8 && volatility <= 0.55) return 'medium';
  return 'low';
}

function explorationRateForConfidence(confidence: PerformanceInsights['confidence']): number {
  if (confidence === 'high') return DEFAULT_EXPLORATION_RATE;
  if (confidence === 'medium') return 0.28;
  if (confidence === 'low') return 0.4;
  return 0.5;
}

function applyConfidenceToAdjustments(
  adjustments: PerformanceInsights['scoringWeightAdjustments'],
  confidence: PerformanceInsights['confidence'],
): PerformanceInsights['scoringWeightAdjustments'] {
  const weight = confidenceToWeight(confidence);
  return {
    seo: Number((adjustments.seo * weight).toFixed(3)),
    aeo: Number((adjustments.aeo * weight).toFixed(3)),
    geo: Number((adjustments.geo * weight).toFixed(3)),
    differentiation: Number((adjustments.differentiation * weight).toFixed(3)),
    readability: Number((adjustments.readability * weight).toFixed(3)),
  };
}

export function derivePerformanceInsights(input: PerformanceLearningInput): PerformanceInsights {
  if (input.performance.length === 0) {
    return {
      highPerformingPatterns: [],
      weakPatterns: [],
      winningSectionTypes: [],
      winningFrameworks: [],
      winningPositioning: [],
      underperformingPositioning: [],
      scoringWeightAdjustments: { ...DEFAULT_WEIGHTS },
      reoptimizationCandidates: [],
      confidence: 'none',
      confidenceWeight: 0,
      normalizedMetrics: [],
      explorationRate: 0.5,
      patternDecayStatus: { decayedPatterns: [], reinforcedPatterns: [], stalePatterns: [] },
    };
  }

  const { high, weak, scores, normalizedMetrics } = bucketByPerformance(input);
  const highStructures = countPatterns(high, (snapshot) => snapshot.structures);
  const weakStructures = countPatterns(weak, (snapshot) => snapshot.structures);
  const winningSectionTypes = countPatterns(high, (snapshot) => snapshot.sectionTypes);
  const winningFrameworks = capDominantPatterns(countPatterns(high, (snapshot) => snapshot.frameworks), FRAMEWORK_DOMINANCE_CAP);
  const winningPositioning = capDominantPatterns(countPatterns(high, (snapshot) => snapshot.positioning) as ContentPositioningType[], POSITIONING_DOMINANCE_CAP);
  const underperformingPositioning = countPatterns(weak, (snapshot) => snapshot.positioning) as ContentPositioningType[];
  const highPerformingPatterns = unique([
    ...winningPositioning,
    ...winningFrameworks,
    ...winningSectionTypes,
    ...highStructures,
  ]);
  const weakPatterns = unique([
    ...underperformingPositioning,
    ...weakStructures,
    ...weak.flatMap((snapshot) => snapshot.weakSections || []),
  ]);

  const rawScoringWeightAdjustments = { ...DEFAULT_WEIGHTS };
  if (winningSectionTypes.some((type) => /faq|answer/i.test(type))) rawScoringWeightAdjustments.aeo += 0.08;
  if (winningFrameworks.length > 0 || winningSectionTypes.some((type) => /framework|model/i.test(type))) rawScoringWeightAdjustments.geo += 0.08;
  if (winningPositioning.some((item) => item === 'contrarian' || item === 'comparison_heavy' || item === 'framework_first')) {
    rawScoringWeightAdjustments.differentiation += 0.08;
  }
  if (highStructures.some((item) => /step|guide|how/i.test(item))) rawScoringWeightAdjustments.readability += 0.04;
  if (highStructures.some((item) => /entity|keyword|search/i.test(item))) rawScoringWeightAdjustments.seo += 0.05;

  const reoptimizationCandidates = input.performance
    .map((item) => ({
      content_id: item.content_id,
      performanceScore: scores.get(item.content_id) || scoreContentPerformance(item),
      reason: buildReoptimizationReason(item),
    }))
    .filter((item) => item.performanceScore < 50)
    .sort((left, right) => left.performanceScore - right.performanceScore)
    .slice(0, 10);

  const confidence = deriveConfidence(normalizedMetrics);
  const scoringWeightAdjustments = applyConfidenceToAdjustments(rawScoringWeightAdjustments, confidence);
  const patternDecayStatus = buildPatternDecayStatus(input, high);
  return {
    highPerformingPatterns,
    weakPatterns,
    winningSectionTypes: unique(winningSectionTypes),
    winningFrameworks: unique(winningFrameworks),
    winningPositioning: unique(winningPositioning) as ContentPositioningType[],
    underperformingPositioning: unique(underperformingPositioning) as ContentPositioningType[],
    scoringWeightAdjustments,
    reoptimizationCandidates,
    confidence,
    confidenceWeight: confidenceToWeight(confidence),
    normalizedMetrics,
    explorationRate: explorationRateForConfidence(confidence),
    patternDecayStatus,
  };
}

function buildReoptimizationReason(performance: ContentPerformance): string {
  const reasons: string[] = [];
  const ctr = performance.impressions > 0 ? performance.clicks / performance.impressions : 0;
  if (performance.impressions >= 100 && ctr < 0.01) reasons.push('low CTR');
  if (performance.avg_position != null && performance.avg_position > 20) reasons.push('weak search position');
  if (performance.dwell_time != null && performance.dwell_time < 45) reasons.push('low dwell time');
  if (performance.bounce_rate != null && performance.bounce_rate > 0.75) reasons.push('high bounce rate');
  if (performance.clicks >= 20 && performance.conversions === 0) reasons.push('no conversions');
  return reasons.length > 0 ? reasons.join(', ') : 'overall performance below threshold';
}

export function applyPerformanceToPositioning(
  positioning: ContentPositioning,
  insights: PerformanceInsights,
): ContentPositioning {
  if (insights.confidence === 'none' || insights.confidence === 'low' || insights.winningPositioning.length === 0) return positioning;
  const preferred = insights.winningPositioning.find((item) => !insights.underperformingPositioning.includes(item));
  if (!preferred || preferred === positioning.primary) return positioning;
  if (insights.confidence === 'medium') {
    return {
      primary: positioning.primary,
      secondary: preferred,
      rationale: `${positioning.rationale} Performance learning added ${preferred} as secondary because confidence is medium, not dominant enough to override primary positioning.`,
    };
  }
  return {
    primary: preferred,
    secondary: positioning.primary,
    rationale: `${positioning.rationale} Performance learning promoted ${preferred} because it has stronger historical engagement.`,
  };
}

export function applyPerformanceToDifferentiationStrategy(
  strategy: DifferentiationStrategy,
  insights: PerformanceInsights,
): DifferentiationStrategy {
  if (insights.confidence === 'none') return strategy;
  const highPerformingPatterns = insights.confidence === 'low'
    ? insights.highPerformingPatterns.slice(0, 1)
    : insights.highPerformingPatterns;
  const weakPatterns = insights.confidence === 'low'
    ? insights.weakPatterns.slice(0, 1)
    : insights.weakPatterns;
  return {
    avoid: unique([...strategy.avoid, ...weakPatterns]),
    emphasize: unique([...highPerformingPatterns, ...strategy.emphasize]),
    uniqueHookStrategy: highPerformingPatterns.length > 0
      ? `${strategy.uniqueHookStrategy} Favor historically strong patterns cautiously: ${highPerformingPatterns.slice(0, 3).join(', ')}.`
      : strategy.uniqueHookStrategy,
  };
}

export function buildPerformancePlanningDirectives(insights: PerformanceInsights): string[] {
  if (insights.confidence === 'none') return [];
  return [
    `Performance confidence: ${insights.confidence}; apply learning at ${(insights.confidenceWeight * 100).toFixed(0)}% influence.`,
    `Exploration rate: ${(insights.explorationRate * 100).toFixed(0)}%; preserve alternative positioning, frameworks, and section-type diversity.`,
    insights.highPerformingPatterns.length
      ? `Prefer historically strong patterns: ${insights.highPerformingPatterns.join(', ')}.`
      : '',
    insights.weakPatterns.length
      ? `Avoid historically weak patterns: ${insights.weakPatterns.join(', ')}.`
      : '',
    insights.winningSectionTypes.length
      ? `Prioritize winning section types: ${insights.winningSectionTypes.join(', ')}.`
      : '',
    insights.winningFrameworks.length
      ? `Use framework styles that have driven engagement, without letting one framework type dominate: ${insights.winningFrameworks.join(', ')}.`
      : '',
    insights.patternDecayStatus.decayedPatterns.length
      ? `Do not over-rely on stale patterns unless new evidence reinforces them: ${insights.patternDecayStatus.decayedPatterns.join(', ')}.`
      : '',
  ].filter(Boolean);
}

export function shouldTriggerPerformanceReoptimization(
  performance: ContentPerformance,
  threshold = 50,
): { shouldReoptimize: boolean; reason: string; performanceScore: number } {
  const performanceScore = scoreContentPerformance(performance);
  return {
    shouldReoptimize: performanceScore < threshold,
    reason: buildReoptimizationReason(performance),
    performanceScore,
  };
}

export function extractFeatureSnapshot(input: {
  content_id: string;
  plan: ContentPlan;
  sections: SectionGenerationResult[];
  positioning: ContentPositioning;
}): ContentPerformanceFeatureSnapshot {
  return {
    content_id: input.content_id,
    sectionTypes: unique(input.plan.sections.map((section) => String(section.content_type))),
    frameworks: unique([input.plan.framework.name, input.plan.framework.model_type]),
    positioning: unique([input.positioning.primary, input.positioning.secondary]) as ContentPositioningType[],
    structures: unique([
      ...input.plan.sections.map((section) => section.section_title),
      ...input.sections.map((section) => section.section_title),
    ]),
    weakSections: input.plan.sections
      .filter((section) => section.requires_opinionated_insight && !/insight|miss|mistake|contrarian|verdict/i.test(section.section_title))
      .map((section) => section.section_title),
  };
}
