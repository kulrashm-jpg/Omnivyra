/**
 * compatibilityCoreCollapseSimulation.ts
 *
 * Phase 8.10 — Safe pre-collapse rehearsal: disable the compatibility-
 * core fallback INTERNALLY for the duration of the simulation, observe
 * what WOULD have failed, and return projected metrics.
 *
 * Unlike Phase 5.6's retirement simulation (which inspects historical
 * snapshots), this module runs a live, per-request internal disable —
 * the system pretends compatibility-core has been removed and records
 * each request that would have failed. Production users do NOT see
 * failures: the actual compatibility-core fallback still runs;
 * simulation lives in a parallel observation channel.
 *
 * Resolution order for activation:
 *   1. Per-request override
 *   2. COMPATIBILITY_CORE_COLLAPSE_SIMULATION env var
 *   3. Default off
 */

import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export type CollapseSimulationMode = 'on' | 'sample' | 'off';

export interface CollapseSimulationResolution {
  enabled: boolean;
  sample_rate?: number;
  reason:
    | 'request_override'
    | 'env_on'
    | 'env_sample'
    | 'env_off'
    | 'default_off';
}

export interface CollapseSimulationPayload {
  event: 'LONGFORM_COMPATIBILITY_CORE_COLLAPSE_PROJECTED_FAILURE';
  company_id: string | null;
  content_type: string;
  topic: string;
  failure_kind: 'hard_failure' | 'degraded_output' | 'timeout_escalation' | 'retry_storm' | 'unstable_type_failure';
  trigger_reason: string;
  fallback_would_have_recovered: boolean;
  timestamp: string;
}

// ── State ────────────────────────────────────────────────────────────────────

interface SimulationState {
  total_observations: number;
  total_projected_failures: number;
  by_kind: Map<CollapseSimulationPayload['failure_kind'], number>;
  by_content_type: Map<string, { observations: number; projected_failures: number }>;
  fallback_would_recover_count: number;
}

const state: SimulationState = {
  total_observations: 0,
  total_projected_failures: 0,
  by_kind: new Map(),
  by_content_type: new Map(),
  fallback_would_recover_count: 0,
};

// ── Resolution ──────────────────────────────────────────────────────────────

function parseSampleRate(env: string): number | null {
  // Accept `sample:0.1` form.
  const m = env.match(/^sample:(.+)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

export function resolveCollapseSimulationMode(perRequest?: boolean): CollapseSimulationResolution {
  if (typeof perRequest === 'boolean') {
    return { enabled: perRequest, reason: 'request_override' };
  }
  const env = (process.env.COMPATIBILITY_CORE_COLLAPSE_SIMULATION ?? '').toLowerCase().trim();
  if (env === '' || env === 'off' || env === '0' || env === 'false') {
    return { enabled: false, reason: 'default_off' };
  }
  if (env === 'on' || env === 'true' || env === '1') {
    return { enabled: true, reason: 'env_on' };
  }
  const rate = parseSampleRate(env);
  if (rate != null) {
    const enabled = Math.random() < rate;
    return { enabled, sample_rate: rate, reason: 'env_sample' };
  }
  return { enabled: false, reason: 'env_off' };
}

// ── Observation API ─────────────────────────────────────────────────────────

export interface ObserveCollapseInput {
  company_id: string | null;
  content_type: string;
  topic: string;
  trigger_reason: string;
  failure_kind?: CollapseSimulationPayload['failure_kind'];
  fallback_would_have_recovered: boolean;
}

/**
 * Called from the unified facade's catch block whenever it falls back to
 * compatibility-core AND simulation is on. Records what a strict
 * no-compatibility-core run would have looked like.
 */
export function observeCollapseProjectedFailure(input: ObserveCollapseInput): CollapseSimulationPayload {
  const kind = input.failure_kind ?? classifyFailureKind(input.trigger_reason);
  const payload: CollapseSimulationPayload = {
    event: 'LONGFORM_COMPATIBILITY_CORE_COLLAPSE_PROJECTED_FAILURE',
    company_id: input.company_id,
    content_type: input.content_type,
    topic: input.topic,
    failure_kind: kind,
    trigger_reason: input.trigger_reason,
    fallback_would_have_recovered: input.fallback_would_have_recovered,
    timestamp: new Date().toISOString(),
  };
  state.total_observations += 1;
  state.total_projected_failures += 1;
  state.by_kind.set(kind, (state.by_kind.get(kind) ?? 0) + 1);
  const byCt = state.by_content_type.get(input.content_type) ?? { observations: 0, projected_failures: 0 };
  byCt.observations += 1;
  byCt.projected_failures += 1;
  state.by_content_type.set(input.content_type, byCt);
  if (input.fallback_would_have_recovered) state.fallback_would_recover_count += 1;
  console.warn(`[longform-collapse-sim] ${JSON.stringify(payload)}`);
  return payload;
}

function classifyFailureKind(reason: string): CollapseSimulationPayload['failure_kind'] {
  const r = reason.toLowerCase();
  if (/timeout|deadline|abort/.test(r)) return 'timeout_escalation';
  if (/retry|amplification|exhausted/.test(r)) return 'retry_storm';
  if (/planner_stability|plan_rejected|plan returned 0/.test(r)) return 'unstable_type_failure';
  if (/parse|format|json/.test(r)) return 'degraded_output';
  return 'hard_failure';
}

// ── Aggregate report ────────────────────────────────────────────────────────

export interface CollapseSimulationReport {
  projectedOutageRate: number;
  projectedQualityImpact: {
    degraded_output_rate: number;
    timeout_escalation_rate: number;
    retry_storm_rate: number;
  };
  unstableFailureClusters: Array<{ content_type: string; projected_failures: number; share_pct: number }>;
  recoveryCapacity: {
    fallback_would_recover_rate: number;
    fallback_would_have_recovered_count: number;
  };
  collapseReadiness: 'not_ready' | 'limited' | 'staged' | 'ready';
  totals: {
    total_observations: number;
    total_projected_failures: number;
  };
  reasoning: string[];
}

const READINESS_OUTAGE_READY = 0.005;     // ≤ 0.5%
const READINESS_OUTAGE_STAGED = 0.02;     // ≤ 2%
const READINESS_OUTAGE_LIMITED = 0.05;    // ≤ 5%

export function getCollapseSimulationReport(): CollapseSimulationReport {
  const usage = getCompatibilityCoreUsageReport();
  // Observation-based projected outage: of the requests that fell back
  // during simulation, all would have been outages without fallback.
  const projectedOutageRate = usage.total_attempts_all_types > 0
    ? Number((state.total_projected_failures / usage.total_attempts_all_types).toFixed(4))
    : 0;
  const reasoning: string[] = [];

  const observed = state.total_observations || 1;
  const degraded = (state.by_kind.get('degraded_output') ?? 0) / observed;
  const timeoutEsc = (state.by_kind.get('timeout_escalation') ?? 0) / observed;
  const retryStorm = (state.by_kind.get('retry_storm') ?? 0) / observed;
  const fallbackRecoverRate = state.total_observations > 0
    ? Number((state.fallback_would_recover_count / state.total_observations).toFixed(4))
    : 0;

  const unstableFailureClusters = Array.from(state.by_content_type.entries())
    .map(([content_type, b]) => ({
      content_type,
      projected_failures: b.projected_failures,
      share_pct: state.total_projected_failures > 0
        ? Number(((b.projected_failures / state.total_projected_failures) * 100).toFixed(2))
        : 0,
    }))
    .sort((a, b) => b.projected_failures - a.projected_failures);

  let collapseReadiness: CollapseSimulationReport['collapseReadiness'];
  if (projectedOutageRate <= READINESS_OUTAGE_READY) {
    collapseReadiness = 'ready';
    reasoning.push(`Projected outage rate ${(projectedOutageRate * 100).toFixed(3)}% ≤ ${(READINESS_OUTAGE_READY * 100)}%; READY.`);
  } else if (projectedOutageRate <= READINESS_OUTAGE_STAGED) {
    collapseReadiness = 'staged';
    reasoning.push(`Projected outage rate ${(projectedOutageRate * 100).toFixed(3)}% within staged tolerance ${(READINESS_OUTAGE_STAGED * 100)}%.`);
  } else if (projectedOutageRate <= READINESS_OUTAGE_LIMITED) {
    collapseReadiness = 'limited';
    reasoning.push(`Projected outage rate ${(projectedOutageRate * 100).toFixed(3)}% within limited tolerance ${(READINESS_OUTAGE_LIMITED * 100)}%.`);
  } else {
    collapseReadiness = 'not_ready';
    reasoning.push(`Projected outage rate ${(projectedOutageRate * 100).toFixed(3)}% exceeds limited tolerance; NOT_READY.`);
  }

  if (unstableFailureClusters.length > 0) {
    const top = unstableFailureClusters[0];
    reasoning.push(`Dominant failure cluster: ${top.content_type} (${top.share_pct}%).`);
  }
  if (fallbackRecoverRate >= 0.7) {
    reasoning.push(`Fallback would recover ${(fallbackRecoverRate * 100).toFixed(1)}% of failures; compatibility-core still provides meaningful safety net.`);
  }

  return {
    projectedOutageRate,
    projectedQualityImpact: {
      degraded_output_rate: Number(degraded.toFixed(4)),
      timeout_escalation_rate: Number(timeoutEsc.toFixed(4)),
      retry_storm_rate: Number(retryStorm.toFixed(4)),
    },
    unstableFailureClusters,
    recoveryCapacity: {
      fallback_would_recover_rate: fallbackRecoverRate,
      fallback_would_have_recovered_count: state.fallback_would_recover_count,
    },
    collapseReadiness,
    totals: {
      total_observations: state.total_observations,
      total_projected_failures: state.total_projected_failures,
    },
    reasoning,
  };
}

export function __resetCollapseSimulationStateForTests(): void {
  state.total_observations = 0;
  state.total_projected_failures = 0;
  state.by_kind.clear();
  state.by_content_type.clear();
  state.fallback_would_recover_count = 0;
}
