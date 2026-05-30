/**
 * Strategy Performance Aggregator.
 *
 * Aggregation layer over `strategyAnalyticsRecorder` that surfaces:
 *
 *   PHASE 4 — performance metrics per strategy across org / campaign /
 *             platform / creator scope (impressions, engagements,
 *             saves, shares, clicks, CTR, engagement rate,
 *             save rate, share rate).
 *
 *   PHASE 5 — top-N leaderboards per content type, supporting time
 *             windows: 7d, 30d, 90d, all-time.
 *
 *   PHASE 6 — pairwise comparisons (Educational vs Promotional,
 *             Quote vs Brand Focus, Story vs Framework, Comparison
 *             vs Timeline, Statistics vs Process). Returns
 *             performance delta + confidence + sample size.
 *
 * Pure functions over the recorder's in-memory ring buffer. No new
 * storage. No mutation. Sample-size-aware + confidence-aware so we
 * never report fabricated signals (PHASE 7 contract).
 */

import {
  type AnalyticsContentType,
  type AnalyticsStrategyFamily,
  type StrategyAnalyticsDimensions,
  listAllStrategyAnalyticsDimensions,
  resolveStrategyAnalyticsDimensions,
} from './strategyAnalyticsRegistry';
import {
  type EventQueryScope,
  type StrategyAnalyticsEvent,
  type StrategyEngagementType,
  getStrategyEventsForScope,
  STRATEGY_ANALYTICS_ROLLING_WINDOW_MS,
} from './strategyAnalyticsRecorder';

/* ── Time window vocabulary ─────────────────────────────────────── */

export type StrategyTimeWindow = '7d' | '30d' | '90d' | 'all_time';

const WINDOW_MS: Record<StrategyTimeWindow, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  // 'all_time' bounded by the recorder's rolling window — there is no
  // long-term store and we never claim to have one.
  all_time: STRATEGY_ANALYTICS_ROLLING_WINDOW_MS,
};

export function resolveWindowMs(window: StrategyTimeWindow): number {
  return WINDOW_MS[window];
}

/* ── Metric shape ───────────────────────────────────────────────── */

export type StrategyMetrics = {
  impressions: number;
  clicks: number;
  saves: number;
  shares: number;
  reactions: number;
  comments: number;
  engagements: number; // explicit `engagement` events (not derived)
  /** Sample size = SUM of all event weights for this strategy. */
  sampleSize: number;
  /** CTR = clicks / impressions. 0 when impressions == 0. */
  ctr: number;
  /** Engagement rate = (clicks + saves + shares + reactions + comments + engagements) / impressions. 0 when impressions == 0. */
  engagementRate: number;
  saveRate: number;
  shareRate: number;
};

export type StrategyPerformance = {
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily;
  content_type: AnalyticsContentType;
  metrics: StrategyMetrics;
};

/* ── Scope-aware filtering ──────────────────────────────────────── */

export type StrategyAggregationScope = Omit<EventQueryScope, 'windowMs'> & {
  window: StrategyTimeWindow;
};

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

function accumulate(metrics: StrategyMetrics, event: StrategyAnalyticsEvent): void {
  const w = event.weight > 0 ? event.weight : 1;
  metrics.sampleSize += w;
  switch (event.type) {
    case 'impression': metrics.impressions += w; break;
    case 'click':      metrics.clicks      += w; break;
    case 'save':       metrics.saves       += w; break;
    case 'share':      metrics.shares      += w; break;
    case 'reaction':   metrics.reactions   += w; break;
    case 'comment':    metrics.comments    += w; break;
    case 'engagement': metrics.engagements += w; break;
  }
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
  const engagementNumerator =
    metrics.clicks + metrics.saves + metrics.shares + metrics.reactions + metrics.comments + metrics.engagements;
  metrics.engagementRate = engagementNumerator / impressions;
  metrics.saveRate = metrics.saves / impressions;
  metrics.shareRate = metrics.shares / impressions;
}

/* ── PHASE 4: per-strategy aggregation ─────────────────────────── */

/**
 * Aggregates events into per-strategy performance buckets, scoped to
 * org / campaign / platform / creator + a time window. Returns a
 * stable, alphabetically-sorted array — callers may resort. Strategies
 * with zero events are NOT included (callers can union with
 * `listAllStrategyAnalyticsDimensions()` if they want full coverage).
 */
export function aggregateStrategyPerformance(scope: StrategyAggregationScope): StrategyPerformance[] {
  const windowMs = resolveWindowMs(scope.window);
  const events = getStrategyEventsForScope({
    companyId: scope.companyId,
    campaignId: scope.campaignId,
    platform: scope.platform,
    creatorId: scope.creatorId,
    windowMs,
    contentType: scope.contentType,
  });
  const buckets = new Map<string, StrategyPerformance>();
  for (const event of events) {
    const id = event.dimensions.strategy_id;
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        strategy_id: id,
        strategy_family: event.dimensions.strategy_family,
        content_type: event.dimensions.content_type,
        metrics: emptyMetrics(),
      };
      buckets.set(id, bucket);
    }
    accumulate(bucket.metrics, event);
  }
  for (const bucket of buckets.values()) finalizeRates(bucket.metrics);
  return Array.from(buckets.values()).sort((a, b) => a.strategy_id.localeCompare(b.strategy_id));
}

/* ── PHASE 5: leaderboards ──────────────────────────────────────── */

export type LeaderboardEntry = StrategyPerformance & {
  rank: number;
  /** The metric we ranked by (defaults to engagementRate). */
  rankedBy: keyof StrategyMetrics;
};

export type LeaderboardOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'> & {
  contentType: AnalyticsContentType;
  /** Metric to rank by. Defaults to engagementRate. */
  rankBy?: keyof StrategyMetrics;
  /** Minimum sample size required for an entry to qualify. Defaults
   *  to 10 — small enough to surface trends, large enough to avoid
   *  reporting a single-event-driven leader. */
  minSampleSize?: number;
  /** Hard cap on entries — defaults to 5 (top-5). */
  limit?: number;
};

export function buildStrategyLeaderboard(opts: LeaderboardOptions): LeaderboardEntry[] {
  const rankBy = opts.rankBy ?? 'engagementRate';
  const minSample = typeof opts.minSampleSize === 'number' ? opts.minSampleSize : 10;
  const limit = typeof opts.limit === 'number' ? opts.limit : 5;
  const all = aggregateStrategyPerformance({
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    window: opts.window,
    contentType: opts.contentType,
  });
  const qualifying = all
    .filter((p) => p.metrics.sampleSize >= minSample)
    .sort((a, b) => {
      const aVal = a.metrics[rankBy];
      const bVal = b.metrics[rankBy];
      if (bVal !== aVal) return bVal - aVal;
      // Tiebreak: larger sample size wins (more confidence).
      return b.metrics.sampleSize - a.metrics.sampleSize;
    })
    .slice(0, limit);
  return qualifying.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    rankedBy: rankBy,
  }));
}

/* ── PHASE 6: comparison engine ─────────────────────────────────── */

export type StrategyComparison = {
  strategyAId: string;
  strategyBId: string;
  metricsA: StrategyMetrics;
  metricsB: StrategyMetrics;
  /** Metric we compared on. Defaults to engagementRate. */
  metric: keyof StrategyMetrics;
  /** Relative delta: (metricsA[metric] - metricsB[metric]) / metricsB[metric].
   *  When metricsB has 0 on the chosen metric, delta is set to null. */
  delta: number | null;
  /** Total sample size (A.sampleSize + B.sampleSize). */
  sampleSize: number;
  /** "low" (<30), "medium" (30-100), "high" (>=100) — combined sample. */
  confidence: 'low' | 'medium' | 'high';
  /** Operator-readable summary. Null when sample size is too low to
   *  responsibly produce a comparison. */
  summary: string | null;
  /** True when sample size is below minimum threshold. */
  insufficientData: boolean;
};

const COMPARISON_MIN_SAMPLE = 20; // combined across A + B

export type CompareStrategiesOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'> & {
  strategyAId: string;
  strategyBId: string;
  metric?: keyof StrategyMetrics;
};

export function compareStrategies(opts: CompareStrategiesOptions): StrategyComparison {
  const metric = opts.metric ?? 'engagementRate';
  const dimsA = resolveStrategyAnalyticsDimensions(opts.strategyAId);
  const dimsB = resolveStrategyAnalyticsDimensions(opts.strategyBId);
  // If either id is invalid, return an explicit "insufficient data"
  // record rather than throwing — analytics surfaces should fail soft.
  const allA = dimsA
    ? aggregateStrategyPerformance({
        companyId: opts.companyId,
        campaignId: opts.campaignId,
        platform: opts.platform,
        creatorId: opts.creatorId,
        window: opts.window,
        contentType: dimsA.content_type,
      }).find((p) => p.strategy_id === opts.strategyAId) ?? null
    : null;
  const allB = dimsB
    ? aggregateStrategyPerformance({
        companyId: opts.companyId,
        campaignId: opts.campaignId,
        platform: opts.platform,
        creatorId: opts.creatorId,
        window: opts.window,
        contentType: dimsB.content_type,
      }).find((p) => p.strategy_id === opts.strategyBId) ?? null
    : null;
  const metricsA = allA?.metrics ?? emptyMetrics();
  const metricsB = allB?.metrics ?? emptyMetrics();
  const combinedSample = metricsA.sampleSize + metricsB.sampleSize;
  const confidence: 'low' | 'medium' | 'high' =
    combinedSample >= 100 ? 'high' : combinedSample >= 30 ? 'medium' : 'low';
  const insufficient = combinedSample < COMPARISON_MIN_SAMPLE;
  const aVal = metricsA[metric];
  const bVal = metricsB[metric];
  const delta = bVal > 0 ? (aVal - bVal) / bVal : null;
  let summary: string | null = null;
  if (!insufficient && delta !== null) {
    const pct = Math.abs(delta * 100);
    const direction = delta > 0 ? 'outperforms' : delta < 0 ? 'underperforms' : 'matches';
    if (Math.abs(delta) < 0.02) {
      summary = `${opts.strategyAId} and ${opts.strategyBId} perform comparably on ${metric}.`;
    } else {
      summary = `${opts.strategyAId} ${direction} ${opts.strategyBId} by ${pct.toFixed(1)}% on ${metric} (${confidence} confidence, n=${Math.round(combinedSample)}).`;
    }
  }
  return {
    strategyAId: opts.strategyAId,
    strategyBId: opts.strategyBId,
    metricsA,
    metricsB,
    metric,
    delta,
    sampleSize: combinedSample,
    confidence,
    summary,
    insufficientData: insufficient,
  };
}

/* ── Coverage helper ─────────────────────────────────────────────── */

/**
 * Returns the full strategy roster annotated with whichever metrics
 * exist in scope. Useful for dashboards that want to display ALL 16
 * strategies including the un-played ones (so operators can see what
 * they haven't tried).
 */
export function aggregateAllStrategiesWithCoverage(
  scope: StrategyAggregationScope,
): StrategyPerformance[] {
  const seen = new Map(aggregateStrategyPerformance(scope).map((p) => [p.strategy_id, p]));
  const out: StrategyPerformance[] = [];
  for (const dims of listAllStrategyAnalyticsDimensions()) {
    if (scope.contentType && dims.content_type !== scope.contentType) continue;
    const existing = seen.get(dims.strategy_id);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        strategy_id: dims.strategy_id,
        strategy_family: dims.strategy_family,
        content_type: dims.content_type,
        metrics: emptyMetrics(),
      });
    }
  }
  return out;
}

/* ── Family rollup ─────────────────────────────────────────────── */

/**
 * Roll up performance by `strategy_family` instead of `strategy_id`.
 * Enables cross-content questions like "does the 'product_showcase'
 * family perform better as an image or a carousel" by aggregating
 * within scope.contentType (or across all when contentType omitted).
 */
export function aggregateByStrategyFamily(scope: StrategyAggregationScope): Array<{
  strategy_family: AnalyticsStrategyFamily;
  metrics: StrategyMetrics;
}> {
  const all = aggregateStrategyPerformance(scope);
  const buckets = new Map<AnalyticsStrategyFamily, StrategyMetrics>();
  for (const entry of all) {
    let metrics = buckets.get(entry.strategy_family);
    if (!metrics) {
      metrics = emptyMetrics();
      buckets.set(entry.strategy_family, metrics);
    }
    metrics.impressions += entry.metrics.impressions;
    metrics.clicks += entry.metrics.clicks;
    metrics.saves += entry.metrics.saves;
    metrics.shares += entry.metrics.shares;
    metrics.reactions += entry.metrics.reactions;
    metrics.comments += entry.metrics.comments;
    metrics.engagements += entry.metrics.engagements;
    metrics.sampleSize += entry.metrics.sampleSize;
  }
  for (const metrics of buckets.values()) finalizeRates(metrics);
  return Array.from(buckets.entries())
    .map(([strategy_family, metrics]) => ({ strategy_family, metrics }))
    .sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
}

/* ── PHASE 6 + 7: variant aggregation ───────────────────────────── */

export type VariantPerformance = {
  variant_id: string;
  variant_family: string;
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily;
  content_type: AnalyticsContentType;
  metrics: StrategyMetrics;
};

/**
 * Per-variant aggregation. Events without a `variantId` are excluded
 * from variant aggregation (they roll up at strategy level via
 * `aggregateStrategyPerformance`). This keeps strategy + variant
 * leaderboards distinct — strategy-only events do not pollute
 * variant-level performance.
 */
export function aggregateVariantPerformance(scope: StrategyAggregationScope): VariantPerformance[] {
  const windowMs = resolveWindowMs(scope.window);
  const events = getStrategyEventsForScope({
    companyId: scope.companyId,
    campaignId: scope.campaignId,
    platform: scope.platform,
    creatorId: scope.creatorId,
    windowMs,
    contentType: scope.contentType,
  });
  const buckets = new Map<string, VariantPerformance>();
  for (const event of events) {
    const variantId = event.variantId;
    if (!variantId) continue;
    let bucket = buckets.get(variantId);
    if (!bucket) {
      bucket = {
        variant_id: variantId,
        variant_family: event.variantFamily ?? 'unknown',
        strategy_id: event.dimensions.strategy_id,
        strategy_family: event.dimensions.strategy_family,
        content_type: event.dimensions.content_type,
        metrics: emptyMetrics(),
      };
      buckets.set(variantId, bucket);
    }
    accumulate(bucket.metrics, event);
  }
  for (const bucket of buckets.values()) finalizeRates(bucket.metrics);
  return Array.from(buckets.values()).sort((a, b) => a.variant_id.localeCompare(b.variant_id));
}

/**
 * Per-variant leaderboard within a single strategy. Ranks the 3 (or
 * fewer) variants of one strategy by the chosen metric. Honors a
 * minimum-sample-size floor so single-event-driven leaders are not
 * surfaced (PHASE 8 — never fabricate a winner).
 */
export type VariantLeaderboardEntry = VariantPerformance & {
  rank: number;
  rankedBy: keyof StrategyMetrics;
};

export type VariantLeaderboardOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'> & {
  /** Restrict leaderboard to variants of a single strategy. */
  strategyId: string;
  rankBy?: keyof StrategyMetrics;
  minSampleSize?: number;
  limit?: number;
};

export function buildVariantLeaderboard(opts: VariantLeaderboardOptions): VariantLeaderboardEntry[] {
  const rankBy = opts.rankBy ?? 'engagementRate';
  const minSample = typeof opts.minSampleSize === 'number' ? opts.minSampleSize : 10;
  const limit = typeof opts.limit === 'number' ? opts.limit : 3;
  const all = aggregateVariantPerformance({
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    window: opts.window,
  }).filter((v) => v.strategy_id === opts.strategyId);
  const qualifying = all
    .filter((v) => v.metrics.sampleSize >= minSample)
    .sort((a, b) => {
      const aVal = a.metrics[rankBy];
      const bVal = b.metrics[rankBy];
      if (bVal !== aVal) return bVal - aVal;
      return b.metrics.sampleSize - a.metrics.sampleSize;
    })
    .slice(0, limit);
  return qualifying.map((entry, index) => ({ ...entry, rank: index + 1, rankedBy: rankBy }));
}

/* ── Re-exports for downstream consumers ─────────────────────────── */

export type { StrategyEngagementType, StrategyAnalyticsEvent };
