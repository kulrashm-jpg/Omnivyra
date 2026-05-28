/**
 * decommissionTrendAnalyzer.ts
 *
 * Phase 7.9 — Trend analysis layered on top of the snapshot-based
 * decommission gate.
 *
 * The gate (Phase 6.7) tells operators "where we are right now".
 * The trend analyzer tells them "are we moving toward retirement, and
 * how fast?" by comparing the current snapshot against recent samples
 * of the same metrics.
 *
 * Trends are computed in-process from a rolling buffer of recent
 * decommission-gate evaluations. Operators can ALSO seed it from
 * durable persistence (Phase 7.8) — `seedTrendSamples()` takes a list
 * of historical snapshots to bootstrap the trend.
 */

import { evaluateDecommissionGate, type DecommissionGateResult } from './compatibilityCoreDecommissionGate';
import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export type TrendDirection =
  | 'improving_rapidly'
  | 'improving'
  | 'stable'
  | 'regressing'
  | 'regressing_rapidly'
  | 'insufficient_data';

export interface BlockerTrajectory {
  metric: string;
  current_value: number;
  baseline_value: number;
  delta: number;
  trend: TrendDirection;
  projected_clear_at: string | null;
}

export interface DecommissionTrendReport {
  trendDirection: TrendDirection;
  projectedRetirementDate: string | null;
  confidence: 'low' | 'moderate' | 'high';
  improvingAreas: string[];
  regressingAreas: string[];
  blockerTrajectory: BlockerTrajectory[];
  samples_analyzed: number;
  baseline_sample_at: string | null;
  current_sample_at: string;
  reasoning: string[];
}

interface TrendSample {
  recorded_at: string;
  fallback_rate: number;
  timeout_rate: number;
  unstable_type_count: number;
  retry_amplification_estimate: number;
  total_attempts: number;
}

// ── Rolling buffer ──────────────────────────────────────────────────────────

const RING_CAPACITY = 200;
const samples: TrendSample[] = [];

function appendSample(sample: TrendSample): void {
  samples.push(sample);
  while (samples.length > RING_CAPACITY) samples.shift();
}

/**
 * Seed the trend buffer from a list of historical snapshots — useful
 * after a process restart when the durable persistence layer can replay
 * recent records.
 */
export function seedTrendSamples(historicalSamples: TrendSample[]): void {
  for (const s of historicalSamples) appendSample(s);
}

/**
 * Capture a sample from the current snapshot — called automatically by
 * `analyzeDecommissionTrend()`. Exposed for tests + replay scripts.
 */
export function captureCurrentSample(): TrendSample {
  const snapshot = getCompatibilityCoreUsageReport();
  const totalAttempts = snapshot.total_attempts_all_types;
  const fallbackTotal = snapshot.total_fallback_to_compatibility_core;

  let timeoutTotal = 0;
  for (const entry of snapshot.per_content_type) {
    for (const reason of entry.common_failure_reasons) {
      if (/timeout|timed out|abort|deadline/i.test(reason.reason)) {
        timeoutTotal += reason.count;
      }
    }
  }
  // Unstable type count — types with fallback_rate >= 5%.
  const unstableTypeCount = snapshot.per_content_type.filter((e) => e.fallback_rate >= 0.05 && e.attempts >= 15).length;
  // Retry amplification approximation — failure / success ratio.
  const retryAmplificationEstimate = snapshot.total_planned_success > 0
    ? Number((snapshot.total_planned_failure / snapshot.total_planned_success).toFixed(3))
    : 0;

  const sample: TrendSample = {
    recorded_at: new Date().toISOString(),
    fallback_rate: totalAttempts > 0 ? Number((fallbackTotal / totalAttempts).toFixed(4)) : 1,
    timeout_rate: totalAttempts > 0 ? Number((timeoutTotal / totalAttempts).toFixed(4)) : 1,
    unstable_type_count: unstableTypeCount,
    retry_amplification_estimate: retryAmplificationEstimate,
    total_attempts: totalAttempts,
  };
  appendSample(sample);
  return sample;
}

// ── Trend math ───────────────────────────────────────────────────────────────

function classifyTrend(deltaPct: number, direction: 'lower_is_better' | 'higher_is_better'): TrendDirection {
  // Normalize: improving means moving toward better.
  const improvement = direction === 'lower_is_better' ? -deltaPct : deltaPct;
  if (improvement >= 50) return 'improving_rapidly';
  if (improvement >= 15) return 'improving';
  if (improvement >= -15) return 'stable';
  if (improvement >= -50) return 'regressing';
  return 'regressing_rapidly';
}

function projectClearTimestamp(
  current: number,
  baseline: number,
  baselineAt: string,
  target: number,
  direction: 'lower_is_better' | 'higher_is_better',
): string | null {
  // Linear extrapolation: rate per ms = (current - baseline) / (now - baselineAt).
  // Project when we hit `target`.
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  const nowMs = Date.now();
  const baselineMs = Date.parse(baselineAt);
  if (!Number.isFinite(baselineMs) || nowMs <= baselineMs) return null;
  const ratePerMs = (current - baseline) / (nowMs - baselineMs);
  // If we're already past target in the desired direction, done.
  const alreadyClear = direction === 'lower_is_better' ? current <= target : current >= target;
  if (alreadyClear) return new Date().toISOString();
  // If rate is moving the wrong way, no projection.
  if (direction === 'lower_is_better' && ratePerMs >= 0) return null;
  if (direction === 'higher_is_better' && ratePerMs <= 0) return null;
  const msToTarget = (target - current) / ratePerMs;
  if (!Number.isFinite(msToTarget) || msToTarget <= 0) return null;
  return new Date(nowMs + msToTarget).toISOString();
}

// ── Main API ────────────────────────────────────────────────────────────────

export interface AnalyzeDecommissionTrendInput {
  /** Override capture (e.g. don't append a fresh sample to the buffer). */
  skipCapture?: boolean;
  /** How many oldest samples to compare against. Default: 1 (earliest). */
  baselineSamples?: number;
  /** Provide the current gate result (default: re-evaluate). */
  gateResult?: DecommissionGateResult;
}

export function analyzeDecommissionTrend(
  input: AnalyzeDecommissionTrendInput = {},
): DecommissionTrendReport {
  if (!input.skipCapture) captureCurrentSample();
  const gateResult = input.gateResult ?? evaluateDecommissionGate();
  const reasoning: string[] = [];

  if (samples.length < 2) {
    return {
      trendDirection: 'insufficient_data',
      projectedRetirementDate: null,
      confidence: 'low',
      improvingAreas: [],
      regressingAreas: [],
      blockerTrajectory: [],
      samples_analyzed: samples.length,
      baseline_sample_at: samples[0]?.recorded_at ?? null,
      current_sample_at: new Date().toISOString(),
      reasoning: ['Insufficient samples for trend analysis (need ≥ 2).'],
    };
  }

  const baselineCount = Math.max(1, input.baselineSamples ?? 1);
  const baselineWindow = samples.slice(0, baselineCount);
  const currentWindow = samples.slice(-Math.max(1, Math.min(baselineCount, samples.length - baselineCount)));
  if (currentWindow.length === 0) {
    return {
      trendDirection: 'insufficient_data',
      projectedRetirementDate: null,
      confidence: 'low',
      improvingAreas: [],
      regressingAreas: [],
      blockerTrajectory: [],
      samples_analyzed: samples.length,
      baseline_sample_at: baselineWindow[0]?.recorded_at ?? null,
      current_sample_at: new Date().toISOString(),
      reasoning: ['No current window after baseline.'],
    };
  }

  const avgFallbackBaseline = mean(baselineWindow.map((s) => s.fallback_rate));
  const avgFallbackCurrent = mean(currentWindow.map((s) => s.fallback_rate));
  const avgTimeoutBaseline = mean(baselineWindow.map((s) => s.timeout_rate));
  const avgTimeoutCurrent = mean(currentWindow.map((s) => s.timeout_rate));
  const avgUnstableBaseline = mean(baselineWindow.map((s) => s.unstable_type_count));
  const avgUnstableCurrent = mean(currentWindow.map((s) => s.unstable_type_count));
  const avgAmpBaseline = mean(baselineWindow.map((s) => s.retry_amplification_estimate));
  const avgAmpCurrent = mean(currentWindow.map((s) => s.retry_amplification_estimate));

  function deltaPct(curr: number, base: number): number {
    if (base === 0 && curr === 0) return 0;
    if (base === 0) return curr > 0 ? 100 : -100;
    return Number((((curr - base) / Math.abs(base)) * 100).toFixed(1));
  }

  const baselineLatest = baselineWindow[baselineWindow.length - 1].recorded_at;
  const blockerTrajectory: BlockerTrajectory[] = [
    {
      metric: 'fallback_rate',
      current_value: avgFallbackCurrent,
      baseline_value: avgFallbackBaseline,
      delta: deltaPct(avgFallbackCurrent, avgFallbackBaseline),
      trend: classifyTrend(deltaPct(avgFallbackCurrent, avgFallbackBaseline), 'lower_is_better'),
      projected_clear_at: projectClearTimestamp(
        avgFallbackCurrent,
        avgFallbackBaseline,
        baselineLatest,
        0.02,
        'lower_is_better',
      ),
    },
    {
      metric: 'timeout_rate',
      current_value: avgTimeoutCurrent,
      baseline_value: avgTimeoutBaseline,
      delta: deltaPct(avgTimeoutCurrent, avgTimeoutBaseline),
      trend: classifyTrend(deltaPct(avgTimeoutCurrent, avgTimeoutBaseline), 'lower_is_better'),
      projected_clear_at: projectClearTimestamp(
        avgTimeoutCurrent,
        avgTimeoutBaseline,
        baselineLatest,
        0.01,
        'lower_is_better',
      ),
    },
    {
      metric: 'unstable_type_count',
      current_value: avgUnstableCurrent,
      baseline_value: avgUnstableBaseline,
      delta: deltaPct(avgUnstableCurrent, avgUnstableBaseline),
      trend: classifyTrend(deltaPct(avgUnstableCurrent, avgUnstableBaseline), 'lower_is_better'),
      projected_clear_at: projectClearTimestamp(
        avgUnstableCurrent,
        avgUnstableBaseline,
        baselineLatest,
        0,
        'lower_is_better',
      ),
    },
    {
      metric: 'retry_amplification',
      current_value: avgAmpCurrent,
      baseline_value: avgAmpBaseline,
      delta: deltaPct(avgAmpCurrent, avgAmpBaseline),
      trend: classifyTrend(deltaPct(avgAmpCurrent, avgAmpBaseline), 'lower_is_better'),
      projected_clear_at: projectClearTimestamp(
        avgAmpCurrent,
        avgAmpBaseline,
        baselineLatest,
        0.2,
        'lower_is_better',
      ),
    },
  ];

  // Overall trend direction = consensus of blockers' classifications.
  const trendScores: Record<TrendDirection, number> = {
    improving_rapidly: 0,
    improving: 0,
    stable: 0,
    regressing: 0,
    regressing_rapidly: 0,
    insufficient_data: 0,
  };
  for (const b of blockerTrajectory) trendScores[b.trend] += 1;
  const consensusTrend = Object.entries(trendScores).reduce<[TrendDirection, number]>(
    (best, [dir, n]) => (n > best[1] ? [dir as TrendDirection, n] : best),
    ['stable', 0],
  )[0];

  // Confidence = sample volume / consistency.
  const totalSamples = samples.length;
  let confidence: 'low' | 'moderate' | 'high';
  if (totalSamples >= 20 && trendScores[consensusTrend] >= 3) confidence = 'high';
  else if (totalSamples >= 8) confidence = 'moderate';
  else confidence = 'low';

  // Projected retirement date — latest projected_clear_at across blockers,
  // OR null if any blocker is still trending the wrong way.
  let projectedRetirementDate: string | null = null;
  const allHaveProjections = blockerTrajectory.every((b) => b.projected_clear_at !== null);
  if (allHaveProjections) {
    projectedRetirementDate = blockerTrajectory
      .map((b) => b.projected_clear_at!)
      .sort()
      .pop() ?? null;
  }

  const improvingAreas = blockerTrajectory
    .filter((b) => b.trend === 'improving' || b.trend === 'improving_rapidly')
    .map((b) => b.metric);
  const regressingAreas = blockerTrajectory
    .filter((b) => b.trend === 'regressing' || b.trend === 'regressing_rapidly')
    .map((b) => b.metric);

  reasoning.push(`Trend direction: ${consensusTrend}.`);
  if (projectedRetirementDate) {
    reasoning.push(`Projected retirement-ready date: ${projectedRetirementDate}.`);
  } else {
    reasoning.push('No retirement date projected (at least one blocker regressing or static).');
  }
  if (improvingAreas.length > 0) reasoning.push(`Improving: ${improvingAreas.join(', ')}.`);
  if (regressingAreas.length > 0) reasoning.push(`Regressing: ${regressingAreas.join(', ')}.`);
  reasoning.push(`Current gate mode: ${gateResult.mode}.`);

  return {
    trendDirection: consensusTrend,
    projectedRetirementDate,
    confidence,
    improvingAreas,
    regressingAreas,
    blockerTrajectory,
    samples_analyzed: totalSamples,
    baseline_sample_at: baselineLatest,
    current_sample_at: new Date().toISOString(),
    reasoning,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function __resetTrendBufferForTests(): void {
  samples.length = 0;
}
