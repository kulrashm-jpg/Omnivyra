/**
 * compatibilityCoreDecommissionGate.ts
 *
 * Phase 6.7 — Decommission readiness gates.
 *
 * Phase 4.7 produced a readiness *score*; this module turns score plus
 * structural thresholds into a *gate decision* operators can use to
 * actually flip env flags safely.
 *
 * Thresholds (per Phase 6 spec):
 *   - fallback_rate         < 2%
 *   - timeout_rate          < 1%
 *   - quality_delta_positive
 *   - no_critical_unstable_types
 *
 * Modes:
 *   NOT_READY           — at least one hard threshold breached
 *   LIMITED_NON_PROD    — soft thresholds clear; flip STRICT in dev/staging
 *   STAGED_PRODUCTION   — quality+stability proven; flip STRICT in prod with monitoring
 *   READY_FOR_RETIREMENT — all thresholds clear; safe to delete compatibility-core
 */

import {
  getCompatibilityCoreUsageReport,
  type CompatibilityCoreUsageReport,
} from './plannedEngineStabilityTelemetry';
import {
  compareEngineBenchmarks,
} from './qualityBenchmarkSuite';
import {
  computeCompatibilityCoreRetirementReport,
  type CompatibilityCoreRetirementReport,
} from './compatibilityCoreRetirementReport';

// ── Public types ─────────────────────────────────────────────────────────────

export type DecommissionMode =
  | 'NOT_READY'
  | 'LIMITED_NON_PROD'
  | 'STAGED_PRODUCTION'
  | 'READY_FOR_RETIREMENT';

export interface DecommissionGateCheck {
  name: string;
  threshold: string;
  observed: string;
  passes: boolean;
}

export interface DecommissionGateResult {
  mode: DecommissionMode;
  checks: DecommissionGateCheck[];
  blockers: string[];
  recommendedNextActions: string[];
  reasoning: string[];
  basedOn: {
    snapshot_at: string;
    total_attempts: number;
  };
}

export interface DecommissionGateInput {
  /** Override the snapshot — defaults to in-process. */
  snapshot?: CompatibilityCoreUsageReport;
  /** Override the retirement report — defaults to computed from snapshot. */
  retirementReport?: CompatibilityCoreRetirementReport;
  /** Content types to compare engine benchmarks across. Default: all observed in snapshot. */
  contentTypes?: string[];
  /** Min total attempts for the gate to even consider anything beyond NOT_READY. Default: 100. */
  minimumTotalAttempts?: number;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const FALLBACK_RATE_HARD = 0.02;        // < 2%
const TIMEOUT_RATE_HARD = 0.01;         // < 1%
const QUALITY_DELTA_HARD = 0;           // planned ≥ compatibility
const MINIMUM_BENCHMARK_SAMPLES = 5;

// Stability-cliff thresholds for the staged tiers.
const LIMITED_NON_PROD_FALLBACK_CEILING = 0.10;  // ≤ 10% lets us flip STRICT in non-prod
const LIMITED_NON_PROD_TIMEOUT_CEILING = 0.05;
const STAGED_PRODUCTION_FALLBACK_CEILING = 0.05;
const STAGED_PRODUCTION_TIMEOUT_CEILING = 0.025;

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyFailureReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('timeout') || r.includes('timed out') || r.includes('abort') || r.includes('deadline')) return 'timeout';
  return 'other';
}

function countTimeoutFailures(snapshot: CompatibilityCoreUsageReport): number {
  let n = 0;
  for (const entry of snapshot.per_content_type) {
    for (const reason of entry.common_failure_reasons) {
      if (classifyFailureReason(reason.reason) === 'timeout') n += reason.count;
    }
  }
  return n;
}

function distinctContentTypes(snapshot: CompatibilityCoreUsageReport): string[] {
  return snapshot.per_content_type.map((e) => e.content_type);
}

// ── Gate evaluation ──────────────────────────────────────────────────────────

export function evaluateDecommissionGate(input: DecommissionGateInput = {}): DecommissionGateResult {
  const snapshot = input.snapshot ?? getCompatibilityCoreUsageReport();
  const retirementReport = input.retirementReport ?? computeCompatibilityCoreRetirementReport({ snapshot });
  const minimumAttempts = input.minimumTotalAttempts ?? 100;
  const contentTypes = input.contentTypes ?? distinctContentTypes(snapshot);
  const reasoning: string[] = [];

  const totalAttempts = snapshot.total_attempts_all_types;
  const fallbackTotal = snapshot.total_fallback_to_compatibility_core;
  const fallbackRate = totalAttempts > 0 ? fallbackTotal / totalAttempts : 1;
  const timeoutTotal = countTimeoutFailures(snapshot);
  const timeoutRate = totalAttempts > 0 ? timeoutTotal / totalAttempts : 1;

  // ── Quality delta check (across observed content types) ─────────────
  let qualityDeltaPositive = true;
  let qualityDeltaSamples = 0;
  let qualityDeltaSum = 0;
  for (const ct of contentTypes) {
    const cmp = compareEngineBenchmarks(ct);
    if (cmp.planned && cmp.compatibility
        && cmp.planned.samples >= MINIMUM_BENCHMARK_SAMPLES
        && cmp.compatibility.samples >= MINIMUM_BENCHMARK_SAMPLES) {
      qualityDeltaSamples += 1;
      const delta = (cmp.delta.qualityScore ?? 0);
      qualityDeltaSum += delta;
      if (delta < QUALITY_DELTA_HARD) qualityDeltaPositive = false;
    }
  }
  const averageQualityDelta = qualityDeltaSamples > 0
    ? Number((qualityDeltaSum / qualityDeltaSamples).toFixed(1))
    : null;

  // ── Per-check evaluation ────────────────────────────────────────────
  const checks: DecommissionGateCheck[] = [
    {
      name: 'fallback_rate',
      threshold: `< ${(FALLBACK_RATE_HARD * 100).toFixed(1)}%`,
      observed: `${(fallbackRate * 100).toFixed(2)}%`,
      passes: fallbackRate < FALLBACK_RATE_HARD,
    },
    {
      name: 'timeout_rate',
      threshold: `< ${(TIMEOUT_RATE_HARD * 100).toFixed(1)}%`,
      observed: `${(timeoutRate * 100).toFixed(2)}%`,
      passes: timeoutRate < TIMEOUT_RATE_HARD,
    },
    {
      name: 'quality_delta_positive',
      threshold: `delta ≥ 0 across all benchmark types`,
      observed: averageQualityDelta == null
        ? `no benchmark samples (need ≥ ${MINIMUM_BENCHMARK_SAMPLES} per type)`
        : `avg delta ${averageQualityDelta} over ${qualityDeltaSamples} types`,
      passes: averageQualityDelta != null && qualityDeltaPositive,
    },
    {
      name: 'no_critical_unstable_types',
      threshold: '0 critical unstable types',
      observed: `${retirementReport.unstableContentTypes.length} unstable type(s): ${retirementReport.unstableContentTypes.map((t) => t.content_type).join(', ') || 'none'}`,
      passes: retirementReport.unstableContentTypes.length === 0,
    },
    {
      name: 'minimum_traffic',
      threshold: `≥ ${minimumAttempts} total attempts`,
      observed: `${totalAttempts} total attempts`,
      passes: totalAttempts >= minimumAttempts,
    },
  ];

  const blockers = checks.filter((c) => !c.passes).map((c) => `${c.name}: ${c.observed} (need ${c.threshold})`);

  // ── Mode decision ───────────────────────────────────────────────────
  let mode: DecommissionMode;

  if (totalAttempts < minimumAttempts) {
    mode = 'NOT_READY';
    reasoning.push(`Insufficient traffic (${totalAttempts} < ${minimumAttempts}). Collect more data before gating.`);
  } else if (
    fallbackRate < FALLBACK_RATE_HARD
    && timeoutRate < TIMEOUT_RATE_HARD
    && qualityDeltaPositive
    && retirementReport.unstableContentTypes.length === 0
  ) {
    mode = 'READY_FOR_RETIREMENT';
    reasoning.push(`All hard thresholds clear. Safe to delete compatibility-core.`);
  } else if (
    fallbackRate < STAGED_PRODUCTION_FALLBACK_CEILING
    && timeoutRate < STAGED_PRODUCTION_TIMEOUT_CEILING
    && qualityDeltaPositive
    && retirementReport.unstableContentTypes.length <= 1
  ) {
    mode = 'STAGED_PRODUCTION';
    reasoning.push(`Soft thresholds clear with ≤1 unstable type. Flip STRICT_PLANNED_ENGINE_MODE=always with monitoring.`);
  } else if (
    fallbackRate < LIMITED_NON_PROD_FALLBACK_CEILING
    && timeoutRate < LIMITED_NON_PROD_TIMEOUT_CEILING
  ) {
    mode = 'LIMITED_NON_PROD';
    reasoning.push(`Above hard thresholds but stable enough for staging. Flip STRICT_PLANNED_ENGINE_MODE=non_prod.`);
  } else {
    mode = 'NOT_READY';
    reasoning.push(`Hard thresholds breached. Do not promote.`);
  }

  // ── Recommended next actions ────────────────────────────────────────
  const recommendedNextActions: string[] = [];
  if (fallbackRate >= FALLBACK_RATE_HARD) {
    recommendedNextActions.push(`Reduce fallback rate from ${(fallbackRate * 100).toFixed(2)}% to under 2%.`);
  }
  if (timeoutRate >= TIMEOUT_RATE_HARD) {
    recommendedNextActions.push(`Reduce timeout rate from ${(timeoutRate * 100).toFixed(2)}% to under 1%. Tune section sizing + execution strategy.`);
  }
  if (!qualityDeltaPositive) {
    recommendedNextActions.push(`Quality delta below zero on some types — investigate planned-engine output regressions.`);
  }
  if (retirementReport.unstableContentTypes.length > 0) {
    recommendedNextActions.push(`Stabilize content types: ${retirementReport.unstableContentTypes.map((t) => t.content_type).join(', ')}.`);
  }
  if (mode === 'LIMITED_NON_PROD') {
    recommendedNextActions.push(`Set STRICT_PLANNED_ENGINE_MODE=non_prod and soak two weeks before promoting.`);
  }
  if (mode === 'STAGED_PRODUCTION') {
    recommendedNextActions.push(`Set STRICT_PLANNED_ENGINE_MODE=always; monitor LONGFORM_RETIREMENT_SIMULATED_FAILURE telemetry; revert if rate exceeds 0.5%.`);
  }
  if (mode === 'READY_FOR_RETIREMENT') {
    recommendedNextActions.push(`Schedule compatibility-core code removal in the next release.`);
  }

  return {
    mode,
    checks,
    blockers,
    recommendedNextActions,
    reasoning,
    basedOn: {
      snapshot_at: new Date().toISOString(),
      total_attempts: totalAttempts,
    },
  };
}
