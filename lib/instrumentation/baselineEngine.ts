/**
 * Dynamic baseline engine.
 *
 * Replaces hard-coded thresholds with learned baselines derived from
 * historical SlimSnapshot data (ideally 7 days).
 *
 * For each trackable metric, computes:
 *   - mean   : average over the sample window
 *   - stddev : population standard deviation
 *   - p95    : 95th percentile (used for latency baselines)
 *
 * Thresholds are then:
 *   warn     = mean × WARN_MULTIPLIER     (1.5×)
 *   critical = mean × CRITICAL_MULTIPLIER (2.5×)
 *
 * When fewer than MIN_SAMPLES are available, baselines are null and callers
 * fall back to static thresholds.
 */

import type { SlimSnapshot } from './metricsPersistence';

// ── Constants ──────────────────────────────────────────────────────────────────

export const WARN_MULTIPLIER     = 1.5;
export const CRITICAL_MULTIPLIER = 2.5;

/** Minimum snapshots before baselines are considered reliable (≈ 1 hour). */
const MIN_SAMPLES = 12;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Baseline {
  mean:    number;
  stddev:  number;
  p95:     number;
  samples: number;
  warnAt:     number;   // mean × WARN_MULTIPLIER
  criticalAt: number;   // mean × CRITICAL_MULTIPLIER
}

export interface SystemBaselines {
  redisOpsPerMin:  Baseline | null;
  supabaseQpm:     Baseline | null;
  apiCpm:          Baseline | null;
  apiErrorRate:    Baseline | null;
  apiP95Ms:        Baseline | null;
  externalCalls:   Baseline | null;
  authVerifyPerMin: Baseline | null;
  monthlyCost:     Baseline | null;
}

export interface AnomalyCheck {
  metric:   string;
  current:  number;
  baseline: number;
  ratio:    number;   // current / baseline.mean
  level:    'warn' | 'critical';
}

// ── Statistics helpers ─────────────────────────────────────────────────────────

function buildBaseline(values: number[]): Baseline | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length < MIN_SAMPLES) return null;

  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  const stddev   = Math.sqrt(variance);

  const sorted = [...clean].sort((a, b) => a - b);
  const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
  const p95    = sorted[Math.max(0, p95Idx)];

  return {
    mean:    Math.round(mean * 100) / 100,
    stddev:  Math.round(stddev * 100) / 100,
    p95:     Math.round(p95),
    samples: clean.length,
    warnAt:     Math.round(mean * WARN_MULTIPLIER * 100) / 100,
    criticalAt: Math.round(mean * CRITICAL_MULTIPLIER * 100) / 100,
  };
}

function pluck(snapshots: SlimSnapshot[], fn: (s: SlimSnapshot) => number | null | undefined): number[] {
  return snapshots.map(fn).filter((v): v is number => v != null && Number.isFinite(v));
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Compute baselines from a historical snapshot window.
 * Pass 7-day snapshots for best accuracy; degrades gracefully with fewer samples.
 */
export function computeBaselines(snapshots: SlimSnapshot[]): SystemBaselines {
  return {
    redisOpsPerMin:   buildBaseline(pluck(snapshots, s => s.redis?.opsPerMin)),
    supabaseQpm:      buildBaseline(pluck(snapshots, s => s.supabase?.qpm)),
    apiCpm:           buildBaseline(pluck(snapshots, s => s.api?.cpm)),
    apiErrorRate:     buildBaseline(pluck(snapshots, s => s.api?.errRate)),
    apiP95Ms:         buildBaseline(pluck(snapshots, s => s.api?.p95Ms)),
    externalCalls:    buildBaseline(pluck(snapshots, s => s.external?.totalCalls)),
    authVerifyPerMin: buildBaseline([]), // firebase removed — Supabase auth has no equivalent metric
    monthlyCost:      buildBaseline(pluck(snapshots, s => s.cost?.total)),
  };
}

/**
 * Check a set of current values against computed baselines.
 * Returns only the metrics that breach warn or critical thresholds.
 * Ignores metrics whose baseline is null (insufficient history).
 */
export function detectAnomalies(
  current: Partial<Record<keyof SystemBaselines, number>>,
  baselines: SystemBaselines,
): AnomalyCheck[] {
  const anomalies: AnomalyCheck[] = [];

  for (const [key, value] of Object.entries(current) as [keyof SystemBaselines, number][]) {
    if (value == null) continue;
    const bl = baselines[key];
    if (!bl || bl.mean === 0) continue;

    const ratio = value / bl.mean;
    if (ratio >= CRITICAL_MULTIPLIER) {
      anomalies.push({ metric: key, current: value, baseline: bl.mean, ratio, level: 'critical' });
    } else if (ratio >= WARN_MULTIPLIER) {
      anomalies.push({ metric: key, current: value, baseline: bl.mean, ratio, level: 'warn' });
    }
  }

  return anomalies.sort((a, b) => b.ratio - a.ratio);
}

/** True if the system has enough history to provide meaningful baselines. */
export function hasReliableBaselines(baselines: SystemBaselines): boolean {
  return Object.values(baselines).some(b => b !== null && b.samples >= MIN_SAMPLES);
}
