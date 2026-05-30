/**
 * Variant Insights Engine.
 *
 * Generates evidence-based insights, recommendation signals, and
 * trend classifications at the VARIANT level (per strategy).
 *
 * Phases addressed:
 *   - PHASE 9  — creative learning insights
 *   - PHASE 10 — variant recommendation signals (recommended /
 *                emerging / declining / experimental)
 *   - PHASE 14 — per-variant trend analysis (rising / declining /
 *                stable / insufficient_data)
 *   - PHASE 15 — campaign experiment-mode helpers
 *
 * Conservative — every output respects sample-size + confidence
 * thresholds. Empty array returned when no variant has enough data.
 */

import {
  type AnalyticsContentType,
  type AnalyticsStrategyFamily,
  describeStrategyAnalytics,
  listAllStrategyAnalyticsDimensions,
} from './strategyAnalyticsRegistry';
import {
  aggregateVariantPerformance,
  resolveWindowMs,
  type StrategyAggregationScope,
  type StrategyMetrics,
  type StrategyTimeWindow,
  type VariantPerformance,
} from './strategyPerformanceAggregator';
import {
  detectVariantWinner,
  type VariantWinner,
} from './variantWinnerEngine';
import {
  listAllVariants,
  listVariantsForStrategy,
  resolveVariant,
  type VariantDefinition,
} from './variantRegistry';
import { getStrategyEventsForScope, STRATEGY_ANALYTICS_ROLLING_WINDOW_MS } from './strategyAnalyticsRecorder';

/* ── Thresholds ────────────────────────────────────────────────── */

const INSIGHT_MIN_SAMPLE_PER_VARIANT = 30;
const INSIGHT_MIN_DELTA = 0.05;
const TREND_MIN_SAMPLE_PER_PERIOD = 15;
const TREND_RISING_THRESHOLD = 0.10;
const TREND_DECLINING_THRESHOLD = -0.10;
const EXPERIMENTAL_MIN_SAMPLE = 5;
const EXPERIMENTAL_MAX_SAMPLE = 30;
const EMERGING_MIN_SAMPLE = 30;
const EMERGING_MAX_SAMPLE = 100;

/* ── PHASE 9: variant insights ─────────────────────────────────── */

export type VariantInsight = {
  id: string;
  text: string;
  /** Strategy + variants the insight references. */
  strategy_id: string;
  variant_ids: string[];
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  metric: keyof StrategyMetrics;
  delta: number;
};

export type GenerateVariantInsightsOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'>;

export function generateVariantInsights(opts: GenerateVariantInsightsOptions): VariantInsight[] {
  const insights: VariantInsight[] = [];
  for (const strategy of listAllStrategyAnalyticsDimensions()) {
    const all = aggregateVariantPerformance({ ...opts }).filter((v) => v.strategy_id === strategy.strategy_id);
    const qualifying = all.filter((v) => v.metrics.sampleSize >= INSIGHT_MIN_SAMPLE_PER_VARIANT);
    if (qualifying.length < 2) continue;
    qualifying.sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
    const top = qualifying[0];
    const bottom = qualifying[qualifying.length - 1];
    if (top.variant_id === bottom.variant_id) continue;
    const topRate = top.metrics.engagementRate;
    const bottomRate = bottom.metrics.engagementRate;
    if (bottomRate <= 0) continue;
    const delta = (topRate - bottomRate) / bottomRate;
    if (delta < INSIGHT_MIN_DELTA) continue;
    const combined = top.metrics.sampleSize + bottom.metrics.sampleSize;
    const confidence: VariantInsight['confidence'] =
      combined >= 200 ? 'high' : combined >= 60 ? 'medium' : 'low';
    const topLabel = describeVariantLabel(top.variant_id);
    const bottomLabel = describeVariantLabel(bottom.variant_id);
    insights.push({
      id: `engagement:${top.variant_id}-vs-${bottom.variant_id}`,
      text: `${topLabel} outperforms ${bottomLabel} by ${(delta * 100).toFixed(1)}% on engagement rate.`,
      strategy_id: strategy.strategy_id,
      variant_ids: [top.variant_id, bottom.variant_id],
      confidence,
      sampleSize: combined,
      metric: 'engagementRate',
      delta,
    });

    // Save-rate cross-cut: report when save winner differs from
    // engagement winner.
    const saveSorted = [...qualifying].sort((a, b) => b.metrics.saveRate - a.metrics.saveRate);
    const saveTop = saveSorted[0];
    const saveBottom = saveSorted[saveSorted.length - 1];
    if (saveTop.variant_id !== top.variant_id && saveBottom.metrics.saveRate > 0) {
      const saveDelta = (saveTop.metrics.saveRate - saveBottom.metrics.saveRate) / saveBottom.metrics.saveRate;
      if (saveDelta >= INSIGHT_MIN_DELTA) {
        const saveCombined = saveTop.metrics.sampleSize + saveBottom.metrics.sampleSize;
        const saveConfidence: VariantInsight['confidence'] =
          saveCombined >= 200 ? 'high' : saveCombined >= 60 ? 'medium' : 'low';
        insights.push({
          id: `save:${saveTop.variant_id}-vs-${saveBottom.variant_id}`,
          text: `${describeVariantLabel(saveTop.variant_id)} drives ${(saveDelta * 100).toFixed(1)}% more saves than ${describeVariantLabel(saveBottom.variant_id)}.`,
          strategy_id: strategy.strategy_id,
          variant_ids: [saveTop.variant_id, saveBottom.variant_id],
          confidence: saveConfidence,
          sampleSize: saveCombined,
          metric: 'saveRate',
          delta: saveDelta,
        });
      }
    }
  }
  return insights;
}

/* ── PHASE 10: recommendation signals ──────────────────────────── */

export type VariantSignalKind =
  | 'recommended'
  | 'emerging'
  | 'declining'
  | 'experimental';

export type VariantSignal = {
  kind: VariantSignalKind;
  strategy_id: string;
  variant_id: string;
  variant_family: string;
  content_type: AnalyticsContentType | null;
  strategy_family: AnalyticsStrategyFamily | null;
  rationale: string;
  sampleSize: number;
  engagementRate: number;
};

export function computeVariantRecommendationSignals(
  opts: GenerateVariantInsightsOptions,
): VariantSignal[] {
  const signals: VariantSignal[] = [];
  for (const strategy of listAllStrategyAnalyticsDimensions()) {
    const all = aggregateVariantPerformance({ ...opts }).filter((v) => v.strategy_id === strategy.strategy_id);
    if (all.length === 0) continue;
    const sorted = [...all].sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
    // Recommended = top variant with sufficient sample.
    const top = sorted[0];
    if (top && top.metrics.sampleSize >= EMERGING_MAX_SAMPLE) {
      signals.push({
        kind: 'recommended',
        strategy_id: strategy.strategy_id,
        variant_id: top.variant_id,
        variant_family: top.variant_family,
        content_type: strategy.content_type,
        strategy_family: strategy.strategy_family,
        rationale: `${describeVariantLabel(top.variant_id)} is leading by engagement (${(top.metrics.engagementRate * 100).toFixed(1)}%) across ${Math.round(top.metrics.sampleSize)} samples.`,
        sampleSize: top.metrics.sampleSize,
        engagementRate: top.metrics.engagementRate,
      });
    }
    const median = sorted[Math.floor(sorted.length / 2)]?.metrics.engagementRate ?? 0;
    for (const entry of sorted) {
      const sample = entry.metrics.sampleSize;
      // Experimental — small sample; surface so operators can decide
      // whether to invest more deployments.
      if (sample >= EXPERIMENTAL_MIN_SAMPLE && sample < EXPERIMENTAL_MAX_SAMPLE) {
        signals.push({
          kind: 'experimental',
          strategy_id: strategy.strategy_id,
          variant_id: entry.variant_id,
          variant_family: entry.variant_family,
          content_type: strategy.content_type,
          strategy_family: strategy.strategy_family,
          rationale: `${describeVariantLabel(entry.variant_id)} is an experimental sample (${Math.round(sample)} events) — not enough data for a recommendation yet.`,
          sampleSize: sample,
          engagementRate: entry.metrics.engagementRate,
        });
        continue;
      }
      // Emerging — moderate sample, decent engagement, not the leader.
      if (
        sample >= EMERGING_MIN_SAMPLE
        && sample <= EMERGING_MAX_SAMPLE
        && entry.metrics.engagementRate >= median
        && entry.variant_id !== top.variant_id
      ) {
        signals.push({
          kind: 'emerging',
          strategy_id: strategy.strategy_id,
          variant_id: entry.variant_id,
          variant_family: entry.variant_family,
          content_type: strategy.content_type,
          strategy_family: strategy.strategy_family,
          rationale: `${describeVariantLabel(entry.variant_id)} is gaining traction (${Math.round(sample)} samples, ${(entry.metrics.engagementRate * 100).toFixed(1)}% engagement).`,
          sampleSize: sample,
          engagementRate: entry.metrics.engagementRate,
        });
      }
    }
    // Declining — bottom variant when it has substantial sample.
    const bottom = sorted[sorted.length - 1];
    if (sorted.length >= 2 && bottom && bottom.metrics.sampleSize > EMERGING_MAX_SAMPLE && bottom.variant_id !== top.variant_id) {
      signals.push({
        kind: 'declining',
        strategy_id: strategy.strategy_id,
        variant_id: bottom.variant_id,
        variant_family: bottom.variant_family,
        content_type: strategy.content_type,
        strategy_family: strategy.strategy_family,
        rationale: `${describeVariantLabel(bottom.variant_id)} is the lowest-performing variant for this strategy (${(bottom.metrics.engagementRate * 100).toFixed(1)}% engagement across ${Math.round(bottom.metrics.sampleSize)} samples).`,
        sampleSize: bottom.metrics.sampleSize,
        engagementRate: bottom.metrics.engagementRate,
      });
    }
  }
  return signals;
}

/* ── PHASE 14: variant trends ─────────────────────────────────── */

export type VariantTrendDirection = 'rising' | 'declining' | 'stable' | 'insufficient_data';

export type VariantTrend = {
  strategy_id: string;
  variant_id: string;
  variant_family: string;
  direction: VariantTrendDirection;
  currentRate: number;
  previousRate: number;
  delta: number | null;
  currentSample: number;
  previousSample: number;
};

export type VariantTrendAnalysisOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId'> & {
  window?: StrategyTimeWindow;
};

export function analyzeVariantTrends(opts: VariantTrendAnalysisOptions): VariantTrend[] {
  const window: StrategyTimeWindow = opts.window ?? '30d';
  const windowMs = resolveWindowMs(window);
  const totalSpan = Math.min(windowMs * 2, STRATEGY_ANALYTICS_ROLLING_WINDOW_MS);
  const events = getStrategyEventsForScope({
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    windowMs: totalSpan,
  });
  const now = Date.now();
  const cutoff = now - windowMs;
  type Bucket = { current: StrategyMetrics; previous: StrategyMetrics; variantFamily: string; strategyId: string };
  const buckets = new Map<string, Bucket>();
  for (const event of events) {
    if (!event.variantId) continue;
    const ts = Date.parse(event.occurredAt);
    if (!Number.isFinite(ts)) continue;
    const isCurrent = ts >= cutoff;
    let bucket = buckets.get(event.variantId);
    if (!bucket) {
      bucket = {
        current: emptyMetrics(),
        previous: emptyMetrics(),
        variantFamily: event.variantFamily ?? 'unknown',
        strategyId: event.dimensions.strategy_id,
      };
      buckets.set(event.variantId, bucket);
    }
    const target = isCurrent ? bucket.current : bucket.previous;
    const w = event.weight > 0 ? event.weight : 1;
    target.sampleSize += w;
    if (event.type === 'impression') target.impressions += w;
    else if (event.type === 'click') target.clicks += w;
    else if (event.type === 'save') target.saves += w;
    else if (event.type === 'share') target.shares += w;
    else if (event.type === 'reaction') target.reactions += w;
    else if (event.type === 'comment') target.comments += w;
    else if (event.type === 'engagement') target.engagements += w;
  }
  const trends: VariantTrend[] = [];
  for (const [variantId, bucket] of buckets.entries()) {
    finalizeRates(bucket.current);
    finalizeRates(bucket.previous);
    if (bucket.current.sampleSize < TREND_MIN_SAMPLE_PER_PERIOD || bucket.previous.sampleSize < TREND_MIN_SAMPLE_PER_PERIOD) {
      trends.push({
        strategy_id: bucket.strategyId,
        variant_id: variantId,
        variant_family: bucket.variantFamily,
        direction: 'insufficient_data',
        currentRate: bucket.current.engagementRate,
        previousRate: bucket.previous.engagementRate,
        delta: null,
        currentSample: bucket.current.sampleSize,
        previousSample: bucket.previous.sampleSize,
      });
      continue;
    }
    const delta = bucket.previous.engagementRate > 0
      ? (bucket.current.engagementRate - bucket.previous.engagementRate) / bucket.previous.engagementRate
      : null;
    let direction: VariantTrendDirection = 'stable';
    if (delta === null) direction = 'insufficient_data';
    else if (delta >= TREND_RISING_THRESHOLD) direction = 'rising';
    else if (delta <= TREND_DECLINING_THRESHOLD) direction = 'declining';
    trends.push({
      strategy_id: bucket.strategyId,
      variant_id: variantId,
      variant_family: bucket.variantFamily,
      direction,
      currentRate: bucket.current.engagementRate,
      previousRate: bucket.previous.engagementRate,
      delta,
      currentSample: bucket.current.sampleSize,
      previousSample: bucket.previous.sampleSize,
    });
  }
  return trends.sort((a, b) => {
    const ordA = trendOrder(a.direction);
    const ordB = trendOrder(b.direction);
    if (ordA !== ordB) return ordA - ordB;
    return a.variant_id.localeCompare(b.variant_id);
  });
}

function trendOrder(d: VariantTrendDirection): number {
  switch (d) {
    case 'rising': return 0;
    case 'declining': return 1;
    case 'stable': return 2;
    case 'insufficient_data': return 3;
  }
}

/* ── PHASE 15: experiment-mode helpers ─────────────────────────── */

export type ExperimentMode = 'best_variant' | 'top_3_variants';

export type ExperimentVariantPlan = {
  /** Operator-facing reason the variant is in the plan. */
  rationale: string;
  variant: VariantDefinition;
};

/**
 * Given a strategy + current performance scope, return the list of
 * variants the campaign should generate.
 *   - 'best_variant' → the winning variant if known, else V1 as
 *                       neutral baseline.
 *   - 'top_3_variants' → all 3 variants; rationale notes which is
 *                       the current winner / runner-up.
 *
 * The campaign UI uses the returned plan to brief generation. NEVER
 * auto-publishes (PHASE 15 contract).
 */
export function planVariantExperiment(opts: {
  strategyId: string;
  mode: ExperimentMode;
  companyId: string;
  campaignId?: string | null;
  platform?: string | null;
  creatorId?: string | null;
  window?: StrategyTimeWindow;
}): ExperimentVariantPlan[] {
  const variants = listVariantsForStrategy(opts.strategyId);
  if (variants.length === 0) return [];
  const winner: VariantWinner = detectVariantWinner({
    strategyId: opts.strategyId,
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    window: opts.window ?? '30d',
  });
  if (opts.mode === 'best_variant') {
    if (winner.winner) {
      const variant = resolveVariant(winner.winner.variant_id);
      if (variant) {
        return [{
          rationale: `Winning variant by engagement (Δ=${winner.delta !== null ? (winner.delta * 100).toFixed(1) : '?'}% over runner-up, confidence ${winner.confidence}).`,
          variant,
        }];
      }
    }
    // No winner yet — fall back to v1 baseline.
    const baseline = variants.find((v) => v.variant_family === 'v1') ?? variants[0];
    return [{
      rationale: 'No declared winner yet — using V1 baseline.',
      variant: baseline,
    }];
  }
  // top_3_variants
  return variants.map((variant) => {
    let rationale = `Variant ${variant.variant_family.toUpperCase()} — ${variant.display_name}.`;
    if (winner.winner && winner.winner.variant_id === variant.variant_id) {
      rationale += ' Current leader.';
    } else if (winner.runner_up && winner.runner_up.variant_id === variant.variant_id) {
      rationale += ' Current runner-up.';
    }
    return { rationale, variant };
  });
}

/* ── Internal helpers ──────────────────────────────────────────── */

function describeVariantLabel(variantId: string): string {
  const variant = resolveVariant(variantId);
  if (!variant) return variantId;
  const strategy = describeStrategyAnalytics(variant.strategy_id);
  const strategyLabel = strategy?.displayLabel ?? variant.strategy_id;
  return `${strategyLabel} (${variant.display_name})`;
}

function emptyMetrics(): StrategyMetrics {
  return {
    impressions: 0,
    clicks: 0,
    saves: 0,
    shares: 0,
    reactions: 0,
    comments: 0,
    engagements: 0,
    sampleSize: 0,
    ctr: 0,
    engagementRate: 0,
    saveRate: 0,
    shareRate: 0,
  };
}

function finalizeRates(metrics: StrategyMetrics): void {
  const impressions = metrics.impressions;
  if (impressions <= 0) {
    metrics.ctr = 0;
    metrics.engagementRate = 0;
    metrics.saveRate = 0;
    metrics.shareRate = 0;
    return;
  }
  metrics.ctr = metrics.clicks / impressions;
  const numerator = metrics.clicks + metrics.saves + metrics.shares + metrics.reactions + metrics.comments + metrics.engagements;
  metrics.engagementRate = numerator / impressions;
  metrics.saveRate = metrics.saves / impressions;
  metrics.shareRate = metrics.shares / impressions;
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export type { VariantPerformance };
