/**
 * plannedEngineBurnInMode.ts
 *
 * Phase 4.9 — Burn-in shadow mode for safe transition off compatibility-core.
 *
 * Behavior:
 *   1. Run the planned engine first (as today).
 *   2. If burn-in is ON, optionally also run the compatibility-core engine
 *      as a SHADOW (telemetry-only — never returned to the user).
 *   3. Compare governance, retries, alignment, structure, completion
 *      quality, and duration.
 *   4. Store a comparison telemetry event. User receives ONLY the planned
 *      engine output.
 *
 * Resolution order (highest precedence first):
 *   1. Per-request override (`plannedEngineBurnIn: true | false`)
 *   2. `PLANNED_ENGINE_BURN_IN_MODE` env (`always` / `sample:<rate>` / `off`)
 *   3. Default: off
 *
 * Burn-in is temporary stabilization infrastructure. It is not user-facing.
 */

export type BurnInModeSetting = 'always' | 'off' | string; // sample:<rate>

export interface BurnInResolution {
  enabled: boolean;
  reason:
    | 'request_override'
    | 'env_always'
    | 'env_sampled'
    | 'env_not_sampled'
    | 'default_off';
  sample_rate?: number;
}

function parseSampleRate(value: string): number | null {
  if (!value.startsWith('sample:')) return null;
  const raw = value.slice('sample:'.length);
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

export function resolveBurnInMode(perRequest?: boolean): BurnInResolution {
  if (typeof perRequest === 'boolean') {
    return { enabled: perRequest, reason: 'request_override' };
  }
  const env = (process.env.PLANNED_ENGINE_BURN_IN_MODE ?? 'off').toLowerCase().trim();
  if (env === 'always') return { enabled: true, reason: 'env_always' };
  if (env === 'off' || env === '') return { enabled: false, reason: 'default_off' };
  const rate = parseSampleRate(env);
  if (rate != null) {
    const enabled = Math.random() < rate;
    return {
      enabled,
      reason: enabled ? 'env_sampled' : 'env_not_sampled',
      sample_rate: rate,
    };
  }
  return { enabled: false, reason: 'default_off' };
}

// ── Comparison payload ─────────────────────────────────────────────────────

export interface BurnInComparisonSnapshot {
  /** Identity of the section/article being compared. */
  topic: string;
  content_type: string;
  /** Planned-engine metrics. */
  planned: BurnInEngineMetrics;
  /** Compatibility-core shadow metrics. */
  compatibility: BurnInEngineMetrics;
  /** Side-by-side deltas. */
  deltas: {
    duration_ms: number;
    section_count: number;
    sections_passed: number;
    avg_retries_per_section: number;
    /** Set when one engine completed and the other failed. */
    completion_only_in?: 'planned' | 'compatibility';
  };
  /** Diagnostic summary for telemetry. */
  observations: string[];
}

export interface BurnInEngineMetrics {
  engine: 'planned-sectionwise-v1' | 'compatibility-core';
  completed: boolean;
  duration_ms: number;
  total_sections?: number;
  sections_passed?: number;
  total_retries?: number;
  avg_retries_per_section?: number;
  failure_reason?: string;
}

export function recordBurnInComparison(snapshot: BurnInComparisonSnapshot): void {
  const payload = {
    event: 'LONGFORM_BURN_IN_COMPARISON',
    ...snapshot,
    timestamp: new Date().toISOString(),
  };
  console.log(`[longform-burn-in] ${JSON.stringify(payload)}`);
}

export function summarizeBurnInDelta(snapshot: BurnInComparisonSnapshot): string {
  const lines: string[] = [];
  lines.push(`planned: ${snapshot.planned.completed ? 'OK' : 'FAIL'} (${snapshot.planned.duration_ms}ms)`);
  lines.push(`compat:  ${snapshot.compatibility.completed ? 'OK' : 'FAIL'} (${snapshot.compatibility.duration_ms}ms)`);
  if (snapshot.deltas.completion_only_in) {
    lines.push(`⚠️  only ${snapshot.deltas.completion_only_in} completed`);
  }
  return lines.join(' | ');
}

// ── In-process aggregator (snapshot endpoint) ──────────────────────────────

interface BurnInAggregator {
  total_comparisons: number;
  planned_completion_count: number;
  compatibility_completion_count: number;
  planned_only_completion_count: number;
  compatibility_only_completion_count: number;
  both_completion_count: number;
  duration_delta_sum_ms: number;
  duration_delta_count: number;
  retry_delta_sum: number;
  retry_delta_count: number;
}

const burnInState: BurnInAggregator = {
  total_comparisons: 0,
  planned_completion_count: 0,
  compatibility_completion_count: 0,
  planned_only_completion_count: 0,
  compatibility_only_completion_count: 0,
  both_completion_count: 0,
  duration_delta_sum_ms: 0,
  duration_delta_count: 0,
  retry_delta_sum: 0,
  retry_delta_count: 0,
};

export function accumulateBurnInComparison(snapshot: BurnInComparisonSnapshot): void {
  burnInState.total_comparisons += 1;
  const plannedOk = snapshot.planned.completed;
  const compatOk = snapshot.compatibility.completed;
  if (plannedOk) burnInState.planned_completion_count += 1;
  if (compatOk) burnInState.compatibility_completion_count += 1;
  if (plannedOk && !compatOk) burnInState.planned_only_completion_count += 1;
  if (!plannedOk && compatOk) burnInState.compatibility_only_completion_count += 1;
  if (plannedOk && compatOk) {
    burnInState.both_completion_count += 1;
    burnInState.duration_delta_sum_ms += snapshot.deltas.duration_ms;
    burnInState.duration_delta_count += 1;
    burnInState.retry_delta_sum += snapshot.deltas.avg_retries_per_section;
    burnInState.retry_delta_count += 1;
  }
}

export interface BurnInAggregateReport {
  total_comparisons: number;
  planned_completion_rate: number;
  compatibility_completion_rate: number;
  planned_only_completion_count: number;
  compatibility_only_completion_count: number;
  both_completion_count: number;
  avg_duration_delta_ms: number;
  avg_retry_delta_per_section: number;
}

export function getBurnInAggregateReport(): BurnInAggregateReport {
  const a = burnInState;
  return {
    total_comparisons: a.total_comparisons,
    planned_completion_rate: a.total_comparisons > 0 ? Number((a.planned_completion_count / a.total_comparisons).toFixed(3)) : 0,
    compatibility_completion_rate: a.total_comparisons > 0 ? Number((a.compatibility_completion_count / a.total_comparisons).toFixed(3)) : 0,
    planned_only_completion_count: a.planned_only_completion_count,
    compatibility_only_completion_count: a.compatibility_only_completion_count,
    both_completion_count: a.both_completion_count,
    avg_duration_delta_ms: a.duration_delta_count > 0 ? Math.round(a.duration_delta_sum_ms / a.duration_delta_count) : 0,
    avg_retry_delta_per_section: a.retry_delta_count > 0 ? Number((a.retry_delta_sum / a.retry_delta_count).toFixed(3)) : 0,
  };
}

export function __resetBurnInAggregatorForTests(): void {
  Object.assign(burnInState, {
    total_comparisons: 0,
    planned_completion_count: 0,
    compatibility_completion_count: 0,
    planned_only_completion_count: 0,
    compatibility_only_completion_count: 0,
    both_completion_count: 0,
    duration_delta_sum_ms: 0,
    duration_delta_count: 0,
    retry_delta_sum: 0,
    retry_delta_count: 0,
  });
}
