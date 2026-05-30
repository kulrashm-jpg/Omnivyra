/**
 * Variant Winner Detection Engine.
 *
 * Determines the winning variant (per strategy) given recorded
 * engagement events. Sample-size + confidence + delta thresholds
 * applied conservatively — the engine NEVER fabricates a winner. When
 * any threshold fails, it returns `insufficientData = true` and the
 * caller (campaign UI / dashboard) MUST treat the strategy as
 * "no decision yet" (PHASE 8 contract).
 *
 * Pure functions over the strategy performance aggregator. No I/O.
 */

import {
  type AnalyticsContentType,
  type AnalyticsStrategyFamily,
  describeStrategyAnalytics,
  listAllStrategyAnalyticsDimensions,
} from './strategyAnalyticsRegistry';
import {
  aggregateVariantPerformance,
  type StrategyAggregationScope,
  type StrategyMetrics,
  type StrategyTimeWindow,
  type VariantPerformance,
} from './strategyPerformanceAggregator';
import {
  resolveVariant,
  listVariantsForStrategy,
  type VariantDefinition,
} from './variantRegistry';

/* ── Thresholds (PHASE 8) ───────────────────────────────────────── */

const WINNER_MIN_SAMPLE_PER_VARIANT = 20;
const WINNER_MIN_COMBINED_SAMPLE = 60;
const WINNER_MIN_DELTA = 0.05;     // 5% relative over the runner-up

/* ── Winner shape ─────────────────────────────────────────────── */

export type VariantWinner = {
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily | null;
  content_type: AnalyticsContentType | null;
  /** Winning variant (null when insufficient data). */
  winner: VariantPerformance | null;
  /** Runner-up variant (null when insufficient data). */
  runner_up: VariantPerformance | null;
  /** Metric used to determine the winner. */
  metric: keyof StrategyMetrics;
  /** Relative delta: (winner - runner_up) / runner_up. Null when
   *  insufficient data OR runner_up is 0 on the chosen metric. */
  delta: number | null;
  /** 'low' | 'medium' | 'high' — derived from combined sample size. */
  confidence: 'low' | 'medium' | 'high';
  /** Total weighted sample backing the decision. */
  sampleSize: number;
  /** True when the decision cannot be made responsibly. */
  insufficientData: boolean;
  /** Operator-readable reason — populated when insufficient data so
   *  the dashboard can explain WHY no winner was selected. */
  insufficientReason: string | null;
};

export type DetectVariantWinnerOptions = Pick<StrategyAggregationScope, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window'> & {
  strategyId: string;
  metric?: keyof StrategyMetrics;
};

/**
 * Detect the winning variant for a single strategy. Conservative —
 * requires:
 *   - ≥ 2 variants present in the data
 *   - each variant ≥ WINNER_MIN_SAMPLE_PER_VARIANT samples
 *   - combined sample ≥ WINNER_MIN_COMBINED_SAMPLE
 *   - winner beats runner-up by ≥ WINNER_MIN_DELTA on `metric`
 */
export function detectVariantWinner(opts: DetectVariantWinnerOptions): VariantWinner {
  const metric = opts.metric ?? 'engagementRate';
  const strategyMeta = describeStrategyAnalytics(opts.strategyId);
  const all = aggregateVariantPerformance({
    companyId: opts.companyId,
    campaignId: opts.campaignId,
    platform: opts.platform,
    creatorId: opts.creatorId,
    window: opts.window,
  }).filter((v) => v.strategy_id === opts.strategyId);

  const empty: VariantWinner = {
    strategy_id: opts.strategyId,
    strategy_family: strategyMeta?.family ?? null,
    content_type: strategyMeta?.contentType ?? null,
    winner: null,
    runner_up: null,
    metric,
    delta: null,
    confidence: 'low',
    sampleSize: 0,
    insufficientData: true,
    insufficientReason: null,
  };

  if (all.length < 2) {
    return { ...empty, insufficientReason: 'fewer than 2 variants observed' };
  }
  const underThreshold = all.filter((v) => v.metrics.sampleSize < WINNER_MIN_SAMPLE_PER_VARIANT);
  if (underThreshold.length > 0) {
    return {
      ...empty,
      sampleSize: all.reduce((sum, v) => sum + v.metrics.sampleSize, 0),
      insufficientReason: `at least one variant below the ${WINNER_MIN_SAMPLE_PER_VARIANT}-sample floor`,
    };
  }
  const combined = all.reduce((sum, v) => sum + v.metrics.sampleSize, 0);
  if (combined < WINNER_MIN_COMBINED_SAMPLE) {
    return {
      ...empty,
      sampleSize: combined,
      insufficientReason: `combined sample (${Math.round(combined)}) below the ${WINNER_MIN_COMBINED_SAMPLE}-sample floor`,
    };
  }
  const sorted = [...all].sort((a, b) => {
    const aVal = a.metrics[metric];
    const bVal = b.metrics[metric];
    if (bVal !== aVal) return bVal - aVal;
    return b.metrics.sampleSize - a.metrics.sampleSize;
  });
  const winner = sorted[0];
  const runnerUp = sorted[1];
  const winnerRate = winner.metrics[metric];
  const runnerUpRate = runnerUp.metrics[metric];
  const delta = runnerUpRate > 0 ? (winnerRate - runnerUpRate) / runnerUpRate : null;
  if (delta === null) {
    return {
      ...empty,
      sampleSize: combined,
      winner,
      runner_up: runnerUp,
      insufficientReason: `runner-up has zero on '${metric}' — delta undefined`,
    };
  }
  if (delta < WINNER_MIN_DELTA) {
    return {
      ...empty,
      sampleSize: combined,
      winner,
      runner_up: runnerUp,
      delta,
      insufficientReason: `delta (${(delta * 100).toFixed(1)}%) below the ${(WINNER_MIN_DELTA * 100).toFixed(0)}% floor`,
    };
  }
  const confidence: 'low' | 'medium' | 'high' =
    combined >= 200 ? 'high' : combined >= 100 ? 'medium' : 'low';
  return {
    strategy_id: opts.strategyId,
    strategy_family: strategyMeta?.family ?? null,
    content_type: strategyMeta?.contentType ?? null,
    winner,
    runner_up: runnerUp,
    metric,
    delta,
    confidence,
    sampleSize: combined,
    insufficientData: false,
    insufficientReason: null,
  };
}

/**
 * Detect winners across every strategy in scope. Used by the
 * dashboard / campaign UI to populate the "Winning Variants" table.
 */
export function detectVariantWinnersForAllStrategies(
  opts: Pick<DetectVariantWinnerOptions, 'companyId' | 'campaignId' | 'platform' | 'creatorId' | 'window' | 'metric'>,
): VariantWinner[] {
  const out: VariantWinner[] = [];
  for (const strategy of listAllStrategyAnalyticsDimensions()) {
    out.push(detectVariantWinner({ ...opts, strategyId: strategy.strategy_id }));
  }
  return out;
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export type { VariantPerformance, StrategyMetrics, StrategyTimeWindow, VariantDefinition };
