/**
 * compatibilityCoreShadowShutdown.ts
 *
 * Phase 9.7 — Shadow shutdown mode for the compatibility-core fallback.
 *
 * Phase 8.10's `compatibilityCoreCollapseSimulation` is PASSIVE: it
 * watches what WOULD fail if compatibility-core were unavailable.
 *
 * Phase 9.7 introduces an ACTIVE mode: under a probabilistic gate the
 * facade actually REFUSES to call the compatibility-core fallback for
 * the request, surfaces the planned-engine error, and records the
 * outcome. This is how we move from "would have been safe" to "has been
 * safe across N% of real traffic" — the final gate before physical
 * unlink.
 *
 * Resolution order:
 *   1. Per-request override
 *   2. COMPATIBILITY_CORE_SHADOW_SHUTDOWN env var
 *      - off | 0 | false  → disabled
 *      - on  | 1 | true   → 100% bypass (DANGEROUS — only after full collapse rehearsal)
 *      - sample:<0..1>    → probabilistic bypass at the given rate
 *      - percent:<0..100> → same, expressed as a percentage
 *   3. Default off
 *
 * Production safety:
 *   - default off
 *   - if NODE_ENV=production AND no explicit rate, mode is forced off
 *   - per-request override is allowed (for canary harnesses) but is
 *     reflected in the resolution reason so audits can spot it
 */

import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ShadowShutdownResolution {
  enabled: boolean;
  sample_rate: number;       // 0..1 (1 = always bypass)
  reason:
    | 'request_override'
    | 'env_on'
    | 'env_sample'
    | 'env_percent'
    | 'env_off'
    | 'production_safety_default_off'
    | 'default_off';
}

export interface ShadowShutdownOutcome {
  event: 'LONGFORM_COMPATIBILITY_CORE_SHADOW_SHUTDOWN_OUTCOME';
  company_id: string | null;
  content_type: string;
  topic: string;
  bypassed: boolean;                          // true = compatibility-core was NOT invoked
  planned_engine_succeeded: boolean;          // outcome of the planned-engine run
  outcome:
    | 'planned_engine_succeeded'              // ideal: no fallback was needed
    | 'planned_engine_failed_bypass_surfaced' // bypass produced a real failure (the canary)
    | 'planned_engine_failed_no_bypass'       // fallback would have been allowed but wasn't selected
    | 'planned_engine_failed_fallback_used';  // shadow off, fallback ran normally
  sample_rate: number;
  timestamp: string;
}

export interface ShadowShutdownReport {
  resolution: ShadowShutdownResolution;
  totals: {
    total_decisions: number;
    bypasses_applied: number;
    bypasses_resulted_in_failure: number;
    planned_engine_success_after_bypass: number;
  };
  bypass_success_rate: number;        // share of bypassed requests where planned engine still succeeded
  bypass_failure_rate: number;        // share of bypassed requests that surfaced as failures
  per_content_type: Array<{
    content_type: string;
    bypasses: number;
    successes: number;
    failures: number;
  }>;
  /**
   * Recommendation rolled up from the buffer — the facade / governance
   * snapshot reads this to decide whether to advance the unlink timeline.
   */
  recommendation:
    | 'safe_to_increase_rate'
    | 'maintain_current_rate'
    | 'reduce_rate'
    | 'disable_shadow_shutdown';
  recent_outcomes: ShadowShutdownOutcome[];
}

// ── State ────────────────────────────────────────────────────────────────────

interface ShadowState {
  total_decisions: number;
  bypasses_applied: number;
  bypasses_resulted_in_failure: number;
  planned_engine_success_after_bypass: number;
  per_content_type: Map<string, { bypasses: number; successes: number; failures: number }>;
  recent: ShadowShutdownOutcome[];
}

const state: ShadowState = {
  total_decisions: 0,
  bypasses_applied: 0,
  bypasses_resulted_in_failure: 0,
  planned_engine_success_after_bypass: 0,
  per_content_type: new Map(),
  recent: [],
};

const RECENT_CAP = 50;

// ── Env parsing ──────────────────────────────────────────────────────────────

function parseRate(token: string): number | null {
  // sample:0.1 or percent:5
  const sampleMatch = token.match(/^sample:(.+)$/);
  if (sampleMatch) {
    const n = parseFloat(sampleMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    return null;
  }
  const percentMatch = token.match(/^percent:(.+)$/);
  if (percentMatch) {
    const n = parseFloat(percentMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n / 100;
    return null;
  }
  return null;
}

// ── Resolution ──────────────────────────────────────────────────────────────

export function resolveShadowShutdown(perRequest?: boolean | number): ShadowShutdownResolution {
  if (typeof perRequest === 'boolean') {
    return {
      enabled: perRequest,
      sample_rate: perRequest ? 1 : 0,
      reason: 'request_override',
    };
  }
  if (typeof perRequest === 'number' && Number.isFinite(perRequest)) {
    const r = Math.max(0, Math.min(1, perRequest));
    return {
      enabled: r > 0,
      sample_rate: r,
      reason: 'request_override',
    };
  }
  const env = (process.env.COMPATIBILITY_CORE_SHADOW_SHUTDOWN ?? '').toLowerCase().trim();
  if (env === '' || env === 'off' || env === '0' || env === 'false') {
    return { enabled: false, sample_rate: 0, reason: env === '' ? 'default_off' : 'env_off' };
  }
  if (env === 'on' || env === '1' || env === 'true') {
    // Production safety: full bypass without an explicit rate is refused.
    if (process.env.NODE_ENV === 'production') {
      return { enabled: false, sample_rate: 0, reason: 'production_safety_default_off' };
    }
    return { enabled: true, sample_rate: 1, reason: 'env_on' };
  }
  const rate = parseRate(env);
  if (rate != null) {
    return {
      enabled: rate > 0,
      sample_rate: rate,
      reason: env.startsWith('percent:') ? 'env_percent' : 'env_sample',
    };
  }
  return { enabled: false, sample_rate: 0, reason: 'env_off' };
}

/**
 * Probabilistic per-request decision. Returns true when this request
 * SHOULD bypass the compatibility-core fallback.
 */
export function shouldBypassCompatibilityCoreForRequest(input?: {
  perRequest?: boolean | number;
}): { bypass: boolean; resolution: ShadowShutdownResolution } {
  const resolution = resolveShadowShutdown(input?.perRequest);
  if (!resolution.enabled || resolution.sample_rate <= 0) {
    return { bypass: false, resolution };
  }
  const bypass = resolution.sample_rate >= 1 || Math.random() < resolution.sample_rate;
  return { bypass, resolution };
}

// ── Outcome recording ────────────────────────────────────────────────────────

export interface RecordShadowShutdownOutcomeInput {
  company_id: string | null;
  content_type: string;
  topic: string;
  bypassed: boolean;
  planned_engine_succeeded: boolean;
  sample_rate: number;
}

export function recordShadowShutdownOutcome(input: RecordShadowShutdownOutcomeInput): ShadowShutdownOutcome {
  const outcome: ShadowShutdownOutcome['outcome'] = input.planned_engine_succeeded
    ? 'planned_engine_succeeded'
    : input.bypassed
      ? 'planned_engine_failed_bypass_surfaced'
      : 'planned_engine_failed_fallback_used';
  const payload: ShadowShutdownOutcome = {
    event: 'LONGFORM_COMPATIBILITY_CORE_SHADOW_SHUTDOWN_OUTCOME',
    company_id: input.company_id,
    content_type: input.content_type,
    topic: input.topic,
    bypassed: input.bypassed,
    planned_engine_succeeded: input.planned_engine_succeeded,
    outcome,
    sample_rate: input.sample_rate,
    timestamp: new Date().toISOString(),
  };
  state.total_decisions += 1;
  if (input.bypassed) {
    state.bypasses_applied += 1;
    if (input.planned_engine_succeeded) {
      state.planned_engine_success_after_bypass += 1;
    } else {
      state.bypasses_resulted_in_failure += 1;
    }
  }
  const ct = state.per_content_type.get(input.content_type) ?? { bypasses: 0, successes: 0, failures: 0 };
  if (input.bypassed) {
    ct.bypasses += 1;
    if (input.planned_engine_succeeded) ct.successes += 1;
    else ct.failures += 1;
  }
  state.per_content_type.set(input.content_type, ct);
  state.recent.push(payload);
  while (state.recent.length > RECENT_CAP) state.recent.shift();

  // Single structured log line so scrapers can build dashboards.
  if (input.bypassed) {
    console.warn(`[longform-shadow-shutdown] ${JSON.stringify(payload)}`);
  } else {
    console.log(`[longform-shadow-shutdown] ${JSON.stringify(payload)}`);
  }
  return payload;
}

// ── Aggregate report ─────────────────────────────────────────────────────────

export function getShadowShutdownReport(): ShadowShutdownReport {
  const resolution = resolveShadowShutdown();
  const bypassSuccessRate = state.bypasses_applied > 0
    ? Number((state.planned_engine_success_after_bypass / state.bypasses_applied).toFixed(4))
    : 0;
  const bypassFailureRate = state.bypasses_applied > 0
    ? Number((state.bypasses_resulted_in_failure / state.bypasses_applied).toFixed(4))
    : 0;

  let recommendation: ShadowShutdownReport['recommendation'];
  if (state.bypasses_applied < 25) {
    recommendation = 'maintain_current_rate';
  } else if (bypassFailureRate >= 0.05) {
    recommendation = 'disable_shadow_shutdown';
  } else if (bypassFailureRate >= 0.02) {
    recommendation = 'reduce_rate';
  } else if (bypassSuccessRate >= 0.98 && state.bypasses_applied >= 100) {
    recommendation = 'safe_to_increase_rate';
  } else {
    recommendation = 'maintain_current_rate';
  }

  return {
    resolution,
    totals: {
      total_decisions: state.total_decisions,
      bypasses_applied: state.bypasses_applied,
      bypasses_resulted_in_failure: state.bypasses_resulted_in_failure,
      planned_engine_success_after_bypass: state.planned_engine_success_after_bypass,
    },
    bypass_success_rate: bypassSuccessRate,
    bypass_failure_rate: bypassFailureRate,
    per_content_type: Array.from(state.per_content_type.entries()).map(([content_type, b]) => ({
      content_type,
      bypasses: b.bypasses,
      successes: b.successes,
      failures: b.failures,
    })),
    recommendation,
    recent_outcomes: state.recent.slice(-25),
  };
}

/**
 * Cross-checks shadow shutdown metrics against runtime usage so the
 * facade can refuse to ratchet up the rate when the underlying engine
 * is still leaning on compatibility-core.
 */
export function isShadowShutdownSafeToAdvance(): boolean {
  const report = getShadowShutdownReport();
  if (report.totals.bypasses_applied < 100) return false;
  if (report.bypass_failure_rate >= 0.02) return false;
  const usage = getCompatibilityCoreUsageReport();
  const fallbackRate = usage.total_attempts_all_types > 0
    ? usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types
    : 0;
  if (fallbackRate >= 0.02) return false;
  return true;
}

export function __resetShadowShutdownForTests(): void {
  state.total_decisions = 0;
  state.bypasses_applied = 0;
  state.bypasses_resulted_in_failure = 0;
  state.planned_engine_success_after_bypass = 0;
  state.per_content_type.clear();
  state.recent.length = 0;
}
