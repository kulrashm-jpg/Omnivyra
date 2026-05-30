/**
 * Strategy Insights Engine.
 *
 * Generates evidence-based, sample-size-aware insights, recommendation
 * signals, and trend classifications from the strategy performance
 * aggregator.
 *
 * Phases addressed:
 *   - PHASE 7  — creator insights (e.g. "Story Carousels outperform
 *                Framework Carousels by 18%.")
 *   - PHASE 8  — recommendation signals (Recommended Strategies,
 *                Strong / Emerging / Under-performers)
 *   - PHASE 10 — trend analysis (rising / declining / stable)
 *   - PHASE 11 — explainability join: every insight + signal is
 *                tagged with the underlying strategy id so dashboards
 *                can pivot to media_bundle.metadata.applied_render_strategy
 *
 * STRICT contracts:
 *   - No fabricated insights — every insight has minimum sample
 *     thresholds and an explicit confidence band.
 *   - No auto-modification of campaigns / generation behavior.
 *   - Pure functions over the recorder + aggregator. No I/O.
 */

import {
  type AnalyticsContentType,
  type AnalyticsStrategyFamily,
  describeStrategyAnalytics,
  listAllStrategyAnalyticsDimensions,
} from './strategyAnalyticsRegistry';
import {
  aggregateStrategyPerformance,
  type LeaderboardOptions,
  resolveWindowMs,
  type StrategyAggregationScope,
  type StrategyMetrics,
  type StrategyPerformance,
  type StrategyTimeWindow,
} from './strategyPerformanceAggregator';
import { getStrategyEventsForScope, STRATEGY_ANALYTICS_ROLLING_WINDOW_MS } from './strategyAnalyticsRecorder';

/* ── Configurable thresholds ─────────────────────────────────────── */

const INSIGHT_MIN_SAMPLE_SIZE = 30; // per-strategy minimum for an insight
const INSIGHT_MIN_DELTA = 0.05;     // 5% relative diff to be reportable
const TREND_MIN_SAMPLE_PER_PERIOD = 15;
const TREND_RISING_THRESHOLD = 0.10;  // current > previous * 1.10
const TREND_DECLINING_THRESHOLD = -0.10;
const STRONG_PERFORMER_PCTL = 0.66;     // top third by engagement rate
const UNDERPERFORMER_PCTL = 0.25;       // bottom quartile
const EMERGING_MIN_SAMPLE = 15;         // small but real footprint
const EMERGING_MAX_SAMPLE = 100;        // not yet a strong performer

/* ── PHASE 7: insights ──────────────────────────────────────────── */

export type StrategyInsight = {
  id: string;
  /** Operator-readable text — safe to render verbatim. */
  text: string;
  /** Strategy ids referenced — enables click-through into preview
   *  explainability (PHASE 11). */
  referenceStrategyIds: string[];
  /** "high" | "medium" | "low" — derived from minimum sample size. */
  confidence: 'low' | 'medium' | 'high';
  /** Total sample size backing the insight. */
  sampleSize: number;
  /** The metric this insight is about. */
  metric: keyof StrategyMetrics;
  /** The numeric delta — same sign convention as the comparison engine. */
  delta: number;
};

export type GenerateInsightsOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'>;

/**
 * Generates insights by comparing the strongest and weakest performer
 * within each content type that meets the minimum sample threshold.
 * Conservative by design — returns empty array when no strategy has
 * enough data to be reportable.
 */
export function generateStrategyInsights(opts: GenerateInsightsOptions): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  for (const contentType of ['image', 'carousel', 'infographic'] as AnalyticsContentType[]) {
    const all = aggregateStrategyPerformance({ ...opts, contentType });
    const qualifying = all.filter((p) => p.metrics.sampleSize >= INSIGHT_MIN_SAMPLE_SIZE);
    if (qualifying.length < 2) continue;
    qualifying.sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
    const top = qualifying[0];
    const bottom = qualifying[qualifying.length - 1];
    if (top.strategy_id === bottom.strategy_id) continue;
    const topRate = top.metrics.engagementRate;
    const bottomRate = bottom.metrics.engagementRate;
    if (bottomRate <= 0) continue;
    const delta = (topRate - bottomRate) / bottomRate;
    if (delta < INSIGHT_MIN_DELTA) continue;
    const combined = top.metrics.sampleSize + bottom.metrics.sampleSize;
    const confidence: StrategyInsight['confidence'] =
      combined >= 200 ? 'high' : combined >= 60 ? 'medium' : 'low';
    const topLabel = describeStrategyAnalytics(top.strategy_id)?.displayLabel ?? top.strategy_id;
    const bottomLabel = describeStrategyAnalytics(bottom.strategy_id)?.displayLabel ?? bottom.strategy_id;
    insights.push({
      id: `engagement:${top.strategy_id}-vs-${bottom.strategy_id}`,
      text: `${topLabel} outperforms ${bottomLabel} by ${(delta * 100).toFixed(1)}% on engagement rate.`,
      referenceStrategyIds: [top.strategy_id, bottom.strategy_id],
      confidence,
      sampleSize: combined,
      metric: 'engagementRate',
      delta,
    });

    // Save-rate insight — Quote / Brand Focus often win on saves.
    const saveSorted = [...qualifying].sort((a, b) => b.metrics.saveRate - a.metrics.saveRate);
    const saveTop = saveSorted[0];
    const saveBottom = saveSorted[saveSorted.length - 1];
    if (saveTop.strategy_id !== top.strategy_id && saveBottom.metrics.saveRate > 0) {
      const saveDelta = (saveTop.metrics.saveRate - saveBottom.metrics.saveRate) / saveBottom.metrics.saveRate;
      if (saveDelta >= INSIGHT_MIN_DELTA) {
        const saveTopLabel = describeStrategyAnalytics(saveTop.strategy_id)?.displayLabel ?? saveTop.strategy_id;
        const saveBottomLabel = describeStrategyAnalytics(saveBottom.strategy_id)?.displayLabel ?? saveBottom.strategy_id;
        const saveCombined = saveTop.metrics.sampleSize + saveBottom.metrics.sampleSize;
        const saveConfidence: StrategyInsight['confidence'] =
          saveCombined >= 200 ? 'high' : saveCombined >= 60 ? 'medium' : 'low';
        insights.push({
          id: `save:${saveTop.strategy_id}-vs-${saveBottom.strategy_id}`,
          text: `${saveTopLabel} generates ${(saveDelta * 100).toFixed(1)}% more saves than ${saveBottomLabel}.`,
          referenceStrategyIds: [saveTop.strategy_id, saveBottom.strategy_id],
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

/* ── PHASE 8: recommendation signals ────────────────────────────── */

export type RecommendationSignalKind =
  | 'recommended'
  | 'strong_performer'
  | 'emerging_performer'
  | 'underperformer';

export type RecommendationSignal = {
  kind: RecommendationSignalKind;
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily;
  content_type: AnalyticsContentType;
  /** Operator-readable rationale. */
  rationale: string;
  /** Backing sample size. */
  sampleSize: number;
  /** Engagement rate at signal time. */
  engagementRate: number;
};

/**
 * Compute recommendation signals. Strict thresholds prevent emerging
 * from being claimed for under-sampled strategies, and prevent the
 * underperformer label from being slapped on a strategy that hasn't
 * had a fair chance.
 *
 * Signals are RECOMMENDATIONS — the caller (campaign UI / dashboard)
 * decides what to do with them. No automation triggers off these
 * signals (PHASE 8 strict non-goal).
 */
export function computeRecommendationSignals(
  opts: GenerateInsightsOptions,
): RecommendationSignal[] {
  const signals: RecommendationSignal[] = [];
  for (const contentType of ['image', 'carousel', 'infographic'] as AnalyticsContentType[]) {
    const all = aggregateStrategyPerformance({ ...opts, contentType });
    const sampled = all.filter((p) => p.metrics.sampleSize > 0);
    if (sampled.length === 0) continue;
    const sorted = [...sampled].sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
    const strongCount = Math.max(1, Math.floor(sorted.length * (1 - STRONG_PERFORMER_PCTL)));
    // Underperformer bucket — require at least 3 strategies in scope
    // before flagging anyone (any smaller and the bottom-quartile
    // label is meaningless). `Math.ceil` so a 3-strategy set still
    // surfaces 1 underperformer when warranted.
    const underCount = sorted.length >= 3
      ? Math.max(1, Math.ceil(sorted.length * UNDERPERFORMER_PCTL))
      : 0;
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const label = describeStrategyAnalytics(entry.strategy_id)?.displayLabel ?? entry.strategy_id;
      // Strong performer — top group, must clear sample-size floor.
      if (i < strongCount && entry.metrics.sampleSize > EMERGING_MAX_SAMPLE) {
        signals.push({
          kind: 'strong_performer',
          strategy_id: entry.strategy_id,
          strategy_family: entry.strategy_family,
          content_type: entry.content_type,
          rationale: `${label} has a high engagement rate (${(entry.metrics.engagementRate * 100).toFixed(1)}%) backed by ${Math.round(entry.metrics.sampleSize)} samples.`,
          sampleSize: entry.metrics.sampleSize,
          engagementRate: entry.metrics.engagementRate,
        });
        // Top of the top group also gets 'recommended'.
        if (i === 0) {
          signals.push({
            kind: 'recommended',
            strategy_id: entry.strategy_id,
            strategy_family: entry.strategy_family,
            content_type: entry.content_type,
            rationale: `${label} is the leading ${contentType} strategy by engagement in the current window.`,
            sampleSize: entry.metrics.sampleSize,
            engagementRate: entry.metrics.engagementRate,
          });
        }
      }
      // Emerging — moderate sample, decent but not top engagement.
      if (
        entry.metrics.sampleSize >= EMERGING_MIN_SAMPLE
        && entry.metrics.sampleSize <= EMERGING_MAX_SAMPLE
        && entry.metrics.engagementRate >= sorted[Math.floor(sorted.length / 2)].metrics.engagementRate
      ) {
        signals.push({
          kind: 'emerging_performer',
          strategy_id: entry.strategy_id,
          strategy_family: entry.strategy_family,
          content_type: entry.content_type,
          rationale: `${label} is gaining traction (${Math.round(entry.metrics.sampleSize)} samples, ${(entry.metrics.engagementRate * 100).toFixed(1)}% engagement) — worth more deployments to confirm.`,
          sampleSize: entry.metrics.sampleSize,
          engagementRate: entry.metrics.engagementRate,
        });
      }
      // Underperformer — bottom group AND a meaningful sample.
      if (
        i >= sorted.length - underCount
        && entry.metrics.sampleSize > EMERGING_MAX_SAMPLE
      ) {
        signals.push({
          kind: 'underperformer',
          strategy_id: entry.strategy_id,
          strategy_family: entry.strategy_family,
          content_type: entry.content_type,
          rationale: `${label} has consistently lower engagement (${(entry.metrics.engagementRate * 100).toFixed(1)}%) across ${Math.round(entry.metrics.sampleSize)} samples.`,
          sampleSize: entry.metrics.sampleSize,
          engagementRate: entry.metrics.engagementRate,
        });
      }
    }
  }
  return signals;
}

/* ── PHASE 10: trend analysis ───────────────────────────────────── */

export type TrendDirection = 'rising' | 'declining' | 'stable' | 'insufficient_data';

export type StrategyTrend = {
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily;
  content_type: AnalyticsContentType;
  direction: TrendDirection;
  /** Current-period engagement rate. */
  currentRate: number;
  /** Previous-period engagement rate. */
  previousRate: number;
  /** Relative change ((current - previous) / previous), null when
   *  previous is 0 or insufficient. */
  delta: number | null;
  currentSample: number;
  previousSample: number;
};

export type TrendAnalysisOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId'> & {
  /** The window that defines the "current" period — defaults to 30d. */
  window?: StrategyTimeWindow;
};

/**
 * Trend = compare current period engagement rate against previous
 * period of the same duration. Conservative thresholds avoid noisy
 * "rising"/"declining" calls.
 */
export function analyzeStrategyTrends(opts: TrendAnalysisOptions): StrategyTrend[] {
  const window: StrategyTimeWindow = opts.window ?? '30d';
  const windowMs = resolveWindowMs(window);
  // Pull all events in the LAST 2 windows. Slice them into [current]
  // and [previous] by occurredAt timestamp.
  const totalSpan = Math.min(windowMs * 2, STRATEGY_ANALYTICS_ROLLING_WINDOW_MS);
  const events = getStrategyEventsForScope({
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    windowMs: totalSpan,
  });
  const now = Date.now();
  const currentCutoff = now - windowMs;
  const buckets = new Map<string, { current: StrategyMetrics; previous: StrategyMetrics; meta: StrategyPerformance }>();
  for (const event of events) {
    const ts = Date.parse(event.occurredAt);
    if (!Number.isFinite(ts)) continue;
    const isCurrent = ts >= currentCutoff;
    let bucket = buckets.get(event.dimensions.strategy_id);
    if (!bucket) {
      bucket = {
        current: emptyMetricsLocal(),
        previous: emptyMetricsLocal(),
        meta: {
          strategy_id: event.dimensions.strategy_id,
          strategy_family: event.dimensions.strategy_family,
          content_type: event.dimensions.content_type,
          metrics: emptyMetricsLocal(),
        },
      };
      buckets.set(event.dimensions.strategy_id, bucket);
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
  const trends: StrategyTrend[] = [];
  for (const bucket of buckets.values()) {
    finalizeRatesLocal(bucket.current);
    finalizeRatesLocal(bucket.previous);
    const currentRate = bucket.current.engagementRate;
    const previousRate = bucket.previous.engagementRate;
    if (bucket.current.sampleSize < TREND_MIN_SAMPLE_PER_PERIOD || bucket.previous.sampleSize < TREND_MIN_SAMPLE_PER_PERIOD) {
      trends.push({
        strategy_id: bucket.meta.strategy_id,
        strategy_family: bucket.meta.strategy_family,
        content_type: bucket.meta.content_type,
        direction: 'insufficient_data',
        currentRate,
        previousRate,
        delta: null,
        currentSample: bucket.current.sampleSize,
        previousSample: bucket.previous.sampleSize,
      });
      continue;
    }
    const delta = previousRate > 0 ? (currentRate - previousRate) / previousRate : null;
    let direction: TrendDirection = 'stable';
    if (delta !== null) {
      if (delta >= TREND_RISING_THRESHOLD) direction = 'rising';
      else if (delta <= TREND_DECLINING_THRESHOLD) direction = 'declining';
    } else {
      direction = 'insufficient_data';
    }
    trends.push({
      strategy_id: bucket.meta.strategy_id,
      strategy_family: bucket.meta.strategy_family,
      content_type: bucket.meta.content_type,
      direction,
      currentRate,
      previousRate,
      delta,
      currentSample: bucket.current.sampleSize,
      previousSample: bucket.previous.sampleSize,
    });
  }
  return trends.sort((a, b) => {
    const orderA = directionOrder(a.direction);
    const orderB = directionOrder(b.direction);
    if (orderA !== orderB) return orderA - orderB;
    return a.strategy_id.localeCompare(b.strategy_id);
  });
}

function directionOrder(d: TrendDirection): number {
  switch (d) {
    case 'rising': return 0;
    case 'declining': return 1;
    case 'stable': return 2;
    case 'insufficient_data': return 3;
  }
}

function emptyMetricsLocal(): StrategyMetrics {
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

function finalizeRatesLocal(metrics: StrategyMetrics): void {
  const impressions = metrics.impressions;
  if (impressions <= 0) {
    metrics.ctr = 0;
    metrics.engagementRate = 0;
    metrics.saveRate = 0;
    metrics.shareRate = 0;
    return;
  }
  metrics.ctr = metrics.clicks / impressions;
  const engagementNumerator =
    metrics.clicks + metrics.saves + metrics.shares + metrics.reactions + metrics.comments + metrics.engagements;
  metrics.engagementRate = engagementNumerator / impressions;
  metrics.saveRate = metrics.saves / impressions;
  metrics.shareRate = metrics.shares / impressions;
}

/* ── PHASE 11: explainability dashboard payload ─────────────────── */

export type StrategyExplainabilityPayload = {
  strategy_id: string;
  /** Operator-readable strategy label. */
  displayLabel: string;
  /** Operator-readable family. */
  strategy_family: AnalyticsStrategyFamily;
  /** Content type. */
  content_type: AnalyticsContentType;
  /** Performance (engagement rate, save rate, etc.) over scope. */
  performance: StrategyMetrics | null;
  /** Trend direction within scope. */
  trend: TrendDirection;
  /** Active recommendation signals for this strategy. */
  signals: RecommendationSignalKind[];
};

/**
 * Joins aggregator + insights + trends into a single payload that the
 * preview / dashboard can match against
 * `media_bundle.metadata.applied_render_strategy.id`. This is the
 * surface that answers operator questions:
 *
 *   - Which strategy was used?         (joined via strategy_id)
 *   - How did it perform?              (performance)
 *   - Why is it (or not) recommended?  (signals + trend)
 *
 * PHASE 11 — explainability integration.
 */
export function buildStrategyExplainabilityPayloads(
  opts: GenerateInsightsOptions,
): StrategyExplainabilityPayload[] {
  const perfByStrategy = new Map<string, StrategyMetrics>();
  for (const contentType of ['image', 'carousel', 'infographic'] as AnalyticsContentType[]) {
    const aggregated = aggregateStrategyPerformance({ ...opts, contentType });
    for (const entry of aggregated) perfByStrategy.set(entry.strategy_id, entry.metrics);
  }
  const trends = analyzeStrategyTrends(opts);
  const trendByStrategy = new Map(trends.map((t) => [t.strategy_id, t.direction]));
  const signals = computeRecommendationSignals(opts);
  const signalsByStrategy = new Map<string, RecommendationSignalKind[]>();
  for (const sig of signals) {
    const arr = signalsByStrategy.get(sig.strategy_id) ?? [];
    arr.push(sig.kind);
    signalsByStrategy.set(sig.strategy_id, arr);
  }
  const out: StrategyExplainabilityPayload[] = [];
  for (const dims of listAllStrategyAnalyticsDimensions()) {
    const desc = describeStrategyAnalytics(dims.strategy_id);
    out.push({
      strategy_id: dims.strategy_id,
      displayLabel: desc?.displayLabel ?? dims.strategy_id,
      strategy_family: dims.strategy_family,
      content_type: dims.content_type,
      performance: perfByStrategy.get(dims.strategy_id) ?? null,
      trend: trendByStrategy.get(dims.strategy_id) ?? 'insufficient_data',
      signals: signalsByStrategy.get(dims.strategy_id) ?? [],
    });
  }
  return out;
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export type { LeaderboardOptions };
