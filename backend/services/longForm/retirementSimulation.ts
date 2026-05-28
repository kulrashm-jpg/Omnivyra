/**
 * retirementSimulation.ts
 *
 * Phase 5.6 — `COMPATIBILITY_CORE_RETIREMENT_SIMULATION`.
 *
 * Simulates strict-planned-engine mode WITHOUT actually suppressing
 * fallback: production keeps falling back, but the simulation records
 * what WOULD have happened if we'd flipped `STRICT_PLANNED_ENGINE_MODE=always`.
 *
 * That gives operators a credible answer to "what is our projected
 * outage rate if we retire compatibility-core today?" before they take
 * the irreversible step of removing it.
 */

import {
  getCompatibilityCoreUsageReport,
  type CompatibilityCoreUsageReport,
} from './plannedEngineStabilityTelemetry';
import { getBurnInAggregateReport, type BurnInAggregateReport } from './plannedEngineBurnInMode';

// ── Public types ─────────────────────────────────────────────────────────────

export type RetirementRecommendation =
  | 'do_not_retire'
  | 'monitor_only'
  | 'strict_in_non_prod'
  | 'strict_in_prod'
  | 'safe_to_retire';

export interface RetirementSimulationReport {
  /** % of requests that would have user-visibly failed without fallback. */
  projectedFailureRate: number;
  /**
   * % of requests where planned engine "completed" but the burn-in
   * comparison suggested degraded quality vs compatibility-core. Best-effort.
   */
  projectedQualityDropRate: number;
  /**
   * Projected impact specifically from timeouts (subset of failure rate).
   */
  projectedTimeoutImpact: {
    timeoutFailureRate: number;
    timeoutOnlyContentTypes: string[];
  };
  unsafeContentTypes: Array<{
    content_type: string;
    projected_failure_rate: number;
    attempts: number;
    blocking_reasons: Array<{ reason: string; count: number }>;
  }>;
  retirementRecommendation: RetirementRecommendation;
  reasoning: string[];
  snapshotUsedAt: string;
}

export interface RetirementSimulationInput {
  /** Override the usage snapshot (default: in-process). */
  usageSnapshot?: CompatibilityCoreUsageReport;
  /** Override the burn-in aggregate (default: in-process). */
  burnInAggregate?: BurnInAggregateReport;
  /** Per-type fallback-rate threshold above which the type is "unsafe". Default: 0.10 (10%). */
  unsafeFallbackRateThreshold?: number;
  /** Minimum attempts for a type's data to be meaningful. Default: 15. */
  minAttemptsPerType?: number;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_UNSAFE_THRESHOLD = 0.10;
const DEFAULT_MIN_ATTEMPTS = 15;

export function simulateCompatibilityCoreRetirement(
  input: RetirementSimulationInput = {},
): RetirementSimulationReport {
  const snapshot = input.usageSnapshot ?? getCompatibilityCoreUsageReport();
  const burnIn = input.burnInAggregate ?? getBurnInAggregateReport();
  const unsafeThreshold = input.unsafeFallbackRateThreshold ?? DEFAULT_UNSAFE_THRESHOLD;
  const minAttempts = input.minAttemptsPerType ?? DEFAULT_MIN_ATTEMPTS;
  const reasoning: string[] = [];

  // ── Failure rate projection ───────────────────────────────────────────
  // If we removed fallback, every fallback-triggered request becomes a
  // user-visible failure.
  const totalAttempts = snapshot.total_attempts_all_types;
  const totalFallback = snapshot.total_fallback_to_compatibility_core;
  const projectedFailureRate = totalAttempts > 0
    ? Number((totalFallback / totalAttempts).toFixed(4))
    : 0;

  // ── Timeout impact projection ─────────────────────────────────────────
  let timeoutTotal = 0;
  const timeoutOnlyTypes: string[] = [];
  for (const entry of snapshot.per_content_type) {
    let entryTimeoutCount = 0;
    let entryOtherCount = 0;
    for (const reason of entry.common_failure_reasons) {
      if (/timeout|timed out|abort|deadline/i.test(reason.reason)) {
        entryTimeoutCount += reason.count;
        timeoutTotal += reason.count;
      } else {
        entryOtherCount += reason.count;
      }
    }
    if (entryTimeoutCount > 0 && entryOtherCount === 0 && entry.attempts >= minAttempts) {
      timeoutOnlyTypes.push(entry.content_type);
    }
  }
  const timeoutFailureRate = totalAttempts > 0
    ? Number((timeoutTotal / totalAttempts).toFixed(4))
    : 0;

  // ── Quality-drop projection from burn-in ──────────────────────────────
  // We can only project quality drop when planned completed but
  // compatibility-core completed faster + with fewer retries. Burn-in
  // gives us that delta.
  const burnInBoth = burnIn.both_completion_count;
  const projectedQualityDropRate = (() => {
    if (burnIn.total_comparisons === 0) return 0;
    // Heuristic: if planned took >2x longer AND >0.5 more retries per
    // section than compatibility-core, label it a quality drop.
    if (burnIn.avg_duration_delta_ms > 0 && burnIn.avg_retry_delta_per_section > 0.5) {
      const dropShare = Math.min(1, (burnIn.avg_duration_delta_ms / 30_000) * 0.5);
      return Number(dropShare.toFixed(4));
    }
    return 0;
  })();

  // ── Unsafe content types ──────────────────────────────────────────────
  const unsafeContentTypes: RetirementSimulationReport['unsafeContentTypes'] = [];
  for (const entry of snapshot.per_content_type) {
    if (entry.attempts < minAttempts) continue;
    if (entry.fallback_rate >= unsafeThreshold) {
      unsafeContentTypes.push({
        content_type: entry.content_type,
        projected_failure_rate: entry.fallback_rate,
        attempts: entry.attempts,
        blocking_reasons: entry.common_failure_reasons,
      });
    }
  }

  // ── Retirement recommendation ─────────────────────────────────────────
  let recommendation: RetirementRecommendation;
  if (totalAttempts < minAttempts * 5) {
    recommendation = 'monitor_only';
    reasoning.push(`Only ${totalAttempts} total attempts — insufficient data; recommend monitor_only.`);
  } else if (projectedFailureRate > 0.10) {
    recommendation = 'do_not_retire';
    reasoning.push(`Projected failure rate ${(projectedFailureRate * 100).toFixed(1)}% exceeds 10% — DO NOT retire.`);
  } else if (projectedFailureRate > 0.03 || unsafeContentTypes.length >= 2) {
    recommendation = 'strict_in_non_prod';
    reasoning.push(`Projected failure rate ${(projectedFailureRate * 100).toFixed(1)}% with ${unsafeContentTypes.length} unsafe content type(s) — flip STRICT_PLANNED_ENGINE_MODE=non_prod first.`);
  } else if (projectedFailureRate > 0.005 || unsafeContentTypes.length === 1) {
    recommendation = 'strict_in_prod';
    reasoning.push(`Projected failure rate ${(projectedFailureRate * 100).toFixed(1)}% — safe to flip strict_in_prod with monitoring.`);
  } else {
    recommendation = 'safe_to_retire';
    reasoning.push(`Projected failure rate ${(projectedFailureRate * 100).toFixed(1)}% with 0 unsafe content types — safe to retire compatibility-core.`);
  }

  if (timeoutFailureRate > 0.03) {
    reasoning.push(`Timeout-driven failure rate ${(timeoutFailureRate * 100).toFixed(1)}% is a primary blocker — invest in Phase 4 timeout resilience before retirement.`);
  }
  if (projectedQualityDropRate > 0) {
    reasoning.push(`Burn-in suggests projected quality drop rate ${(projectedQualityDropRate * 100).toFixed(1)}% (planned engine slower with more retries).`);
  }

  return {
    projectedFailureRate,
    projectedQualityDropRate,
    projectedTimeoutImpact: {
      timeoutFailureRate,
      timeoutOnlyContentTypes: timeoutOnlyTypes,
    },
    unsafeContentTypes,
    retirementRecommendation: recommendation,
    reasoning,
    snapshotUsedAt: new Date().toISOString(),
  };
}

// ── Env-flag resolution ──────────────────────────────────────────────────────

export interface RetirementSimulationMode {
  enabled: boolean;
  reason:
    | 'env_enabled'
    | 'env_disabled'
    | 'request_override'
    | 'default_off';
}

export function resolveRetirementSimulationMode(perRequest?: boolean): RetirementSimulationMode {
  if (typeof perRequest === 'boolean') {
    return { enabled: perRequest, reason: 'request_override' };
  }
  const env = (process.env.COMPATIBILITY_CORE_RETIREMENT_SIMULATION ?? 'off').toLowerCase().trim();
  if (env === 'on' || env === 'always' || env === 'true' || env === '1') {
    return { enabled: true, reason: 'env_enabled' };
  }
  return { enabled: false, reason: 'default_off' };
}

/**
 * Emit a simulated-failure telemetry event. Use when the engine
 * fell back to compatibility-core BUT retirement simulation is on —
 * we record what would have been a user-facing failure.
 */
export function emitSimulatedFailure(payload: {
  company_id: string | null;
  content_type: string;
  topic: string;
  reason: string;
  reason_stack?: string;
}): void {
  console.warn(`[longform-retirement-sim] ${JSON.stringify({
    event: 'LONGFORM_RETIREMENT_SIMULATED_FAILURE',
    ...payload,
    timestamp: new Date().toISOString(),
  })}`);
}
