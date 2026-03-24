/**
 * Cost projection engine.
 *
 * Analyses the cost trend in a series of SlimSnapshots (typically 24h or 7d)
 * and produces a forward-looking monthly cost projection using linear regression.
 *
 * Linear regression is chosen over exponential smoothing because infrastructure
 * costs typically change linearly (gradual user growth, constant background cost).
 * R² is returned so callers can decide whether to surface the projection.
 *
 * Projection methodology:
 *   1. Extract (ts, cost) pairs from snapshot history
 *   2. Fit y = slope × x + intercept via ordinary least squares
 *   3. Project the fitted line to "30 days from now"
 *   4. Compute weekly delta % to classify trend direction
 *   5. Use R² as a confidence signal
 */

import type { SlimSnapshot } from './metricsPersistence';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CostProjection {
  /** Estimated total monthly cost 30 days from now, in USD. null if insufficient data. */
  projectedMonthlyCost: number | null;
  /** Direction of cost trend over the analysis window. */
  trend:                'rising' | 'stable' | 'falling';
  /** Estimated cost change per week as a percentage of current cost. */
  weeklyDeltaPct:       number | null;
  /** How well the linear model fits the data (0–1). */
  r2:                   number | null;
  /** Confidence in the projection. */
  confidence:           'high' | 'medium' | 'low';
  /** Number of cost-bearing snapshots used. */
  basedOnSamples:       number;
  /** Window of snapshots used (ms). */
  windowMs:             number;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

interface RegressionResult {
  slope:     number;
  intercept: number;
  r2:        number;
}

/**
 * Ordinary least squares regression on (x, y) pairs.
 * x values are normalised to avoid floating-point precision loss with epoch ms.
 */
function ols(points: Array<[number, number]>): RegressionResult {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, r2: 0 };

  // Normalise x to [0, 1] to keep numbers manageable
  const x0   = points[0][0];
  const xMax = points[n - 1][0] - x0 || 1;
  const pts  = points.map(([x, y]) => [(x - x0) / xMax, y] as [number, number]);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const [x, y] of pts) { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; }

  const denom    = n * sumX2 - sumX * sumX;
  const slope_n  = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept_n = (sumY - slope_n * sumX) / n;

  // Convert slope back to per-ms units
  const slope_ms = slope_n / xMax;

  // R² = 1 - SS_res / SS_tot
  const yMean  = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const [x, y] of pts) {
    ssTot += (y - yMean) ** 2;
    ssRes += (y - (slope_n * x + intercept_n)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  // Rebuild intercept in original x scale: y = slope_ms * x + intercept_ms
  const intercept_ms = intercept_n - slope_ms * x0;

  return { slope: slope_ms, intercept: intercept_ms, r2 };
}

// ── Main export ────────────────────────────────────────────────────────────────

const MS_PER_WEEK  = 7  * 24 * 60 * 60 * 1_000;
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1_000;
const MIN_SAMPLES  = 3;

/**
 * Project future monthly cost from a set of historical snapshots.
 * Caller should pass 24h or 7d snapshots depending on desired projection horizon.
 */
export function projectCost(snapshots: SlimSnapshot[]): CostProjection {
  const points = snapshots
    .filter(s => s.cost?.total != null && s.cost.total >= 0)
    .map(s => [s.ts, s.cost!.total] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const windowMs = points.length >= 2
    ? points[points.length - 1][0] - points[0][0]
    : 0;

  if (points.length < MIN_SAMPLES) {
    return {
      projectedMonthlyCost: points[0]?.[1] ?? null,
      trend:          'stable',
      weeklyDeltaPct: null,
      r2:             null,
      confidence:     'low',
      basedOnSamples: points.length,
      windowMs,
    };
  }

  const { slope, intercept, r2 } = ols(points);

  // Project cost 30 days from now
  const futureTs   = Date.now() + MS_PER_MONTH;
  const projected  = Math.max(0, slope * futureTs + intercept);

  // Weekly delta relative to current (last observed) cost
  const currentCost  = points[points.length - 1][1];
  const weeklyDelta  = slope * MS_PER_WEEK;
  const weeklyDeltaPct = currentCost > 0
    ? Math.round((weeklyDelta / currentCost) * 1_000) / 10   // 1 decimal place
    : 0;

  const trend: CostProjection['trend'] =
    weeklyDeltaPct >  5 ? 'rising'
    : weeklyDeltaPct < -5 ? 'falling'
    : 'stable';

  const confidence: CostProjection['confidence'] =
    r2 >= 0.80 && points.length >= 12 ? 'high'
    : r2 >= 0.50 || points.length >= 6 ? 'medium'
    : 'low';

  return {
    projectedMonthlyCost: Math.round(projected * 100) / 100,
    trend,
    weeklyDeltaPct,
    r2:             Math.round(r2 * 1_000) / 1_000,
    confidence,
    basedOnSamples: points.length,
    windowMs,
  };
}
