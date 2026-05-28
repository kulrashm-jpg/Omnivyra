/**
 * compatibilityCoreTrafficIsolation.ts
 *
 * Phase 8.7 — Separate telemetry channels for compatibility-core traffic
 * + per-category breakdown report.
 *
 * Before Phase 8, all compatibility-core traffic flowed through the
 * monolithic `LONGFORM_COMPATIBILITY_CORE_USAGE` event. That made it
 * impossible to distinguish "fallback was unavoidable (planner failure)"
 * from "fallback was triggered by a non-critical retry path" from "this
 * was a recovery cycle inside the compat engine".
 *
 * Three discrete events now flow:
 *   - LONGFORM_COMPATIBILITY_CORE_REQUEST   — a request was routed to compat
 *   - LONGFORM_COMPATIBILITY_CORE_RECOVERY  — compat engine ran its own recovery
 *   - LONGFORM_COMPATIBILITY_CORE_FAILURE   — compat engine itself failed
 *
 * The traffic report categorizes the request stream into:
 *   - unavoidable        : planned-engine threw with no available alternative
 *   - avoidable          : planned-engine could have succeeded with budget
 *   - unstable-type      : known-unstable content type that hasn't graduated
 *   - timeout-driven     : planned-engine hit timeout
 *   - planner-driven     : planner regeneration budget exhausted
 *   - mode-not-full      : caller's mode was not 'full'
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type CompatibilityCoreRequestCategory =
  | 'unavoidable'
  | 'avoidable'
  | 'unstable_type'
  | 'timeout_driven'
  | 'planner_driven'
  | 'mode_not_full';

export interface CompatibilityCoreRequestPayload {
  event: 'LONGFORM_COMPATIBILITY_CORE_REQUEST';
  company_id: string | null;
  content_type: string;
  topic: string;
  category: CompatibilityCoreRequestCategory;
  trigger_reason: string;
  failure_source: 'planner' | 'orchestrator' | 'section_generator' | 'mode_routing' | 'unknown';
  retirement_blocker_category: 'timeout' | 'output_format' | 'planning' | 'retry_exhaustion' | 'factual' | 'alignment' | 'repetition' | 'quality_validation' | 'other';
  timestamp: string;
}

export interface CompatibilityCoreRecoveryPayload {
  event: 'LONGFORM_COMPATIBILITY_CORE_RECOVERY';
  company_id: string | null;
  content_type: string;
  topic: string;
  recovery_outcome: 'recovered' | 'partial' | 'failed';
  retries_executed: number;
  duration_ms: number;
  timestamp: string;
}

export interface CompatibilityCoreFailurePayload {
  event: 'LONGFORM_COMPATIBILITY_CORE_FAILURE';
  company_id: string | null;
  content_type: string;
  topic: string;
  failure_reason: string;
  failure_source: 'planner' | 'orchestrator' | 'section_generator' | 'mode_routing' | 'unknown';
  duration_ms: number;
  timestamp: string;
}

// ── Counters ─────────────────────────────────────────────────────────────────

interface TrafficCounters {
  requests_total: number;
  recoveries_total: number;
  failures_total: number;
  by_category: Map<CompatibilityCoreRequestCategory, number>;
  by_content_type: Map<string, number>;
  by_blocker_category: Map<string, number>;
}

const counters: TrafficCounters = {
  requests_total: 0,
  recoveries_total: 0,
  failures_total: 0,
  by_category: new Map(),
  by_content_type: new Map(),
  by_blocker_category: new Map(),
};

// ── Emission helpers ─────────────────────────────────────────────────────────

export function emitCompatibilityCoreRequest(input: Omit<CompatibilityCoreRequestPayload, 'event' | 'timestamp'>): void {
  const payload: CompatibilityCoreRequestPayload = {
    event: 'LONGFORM_COMPATIBILITY_CORE_REQUEST',
    ...input,
    timestamp: new Date().toISOString(),
  };
  counters.requests_total += 1;
  counters.by_category.set(input.category, (counters.by_category.get(input.category) ?? 0) + 1);
  counters.by_content_type.set(input.content_type, (counters.by_content_type.get(input.content_type) ?? 0) + 1);
  counters.by_blocker_category.set(input.retirement_blocker_category, (counters.by_blocker_category.get(input.retirement_blocker_category) ?? 0) + 1);
  console.warn(`[longform-compat-request] ${JSON.stringify(payload)}`);
}

export function emitCompatibilityCoreRecovery(input: Omit<CompatibilityCoreRecoveryPayload, 'event' | 'timestamp'>): void {
  const payload: CompatibilityCoreRecoveryPayload = {
    event: 'LONGFORM_COMPATIBILITY_CORE_RECOVERY',
    ...input,
    timestamp: new Date().toISOString(),
  };
  counters.recoveries_total += 1;
  console.log(`[longform-compat-recovery] ${JSON.stringify(payload)}`);
}

export function emitCompatibilityCoreFailure(input: Omit<CompatibilityCoreFailurePayload, 'event' | 'timestamp'>): void {
  const payload: CompatibilityCoreFailurePayload = {
    event: 'LONGFORM_COMPATIBILITY_CORE_FAILURE',
    ...input,
    timestamp: new Date().toISOString(),
  };
  counters.failures_total += 1;
  console.error(`[longform-compat-failure] ${JSON.stringify(payload)}`);
}

// ── Categorization helper ────────────────────────────────────────────────────
//
// Given a planned-engine failure reason + mode + content type, return the
// canonical request category. The unified facade calls this when it
// decides to fall back so the LONGFORM_COMPATIBILITY_CORE_REQUEST event
// is correctly tagged.

const UNSTABLE_CONTENT_TYPES = new Set<string>(['whitepaper', 'newsletter', 'guide', 'story']);

export function categorizeCompatibilityCoreRequest(input: {
  contentType: string;
  mode: string;
  plannedEngineFailureReason: string | null;
}): {
  category: CompatibilityCoreRequestCategory;
  blockerCategory: CompatibilityCoreRequestPayload['retirement_blocker_category'];
  failureSource: CompatibilityCoreRequestPayload['failure_source'];
  trigger_reason: string;
} {
  if (input.mode !== 'full') {
    return {
      category: 'mode_not_full',
      blockerCategory: 'other',
      failureSource: 'mode_routing',
      trigger_reason: `mode=${input.mode} routes directly to compatibility-core by design`,
    };
  }
  if (!input.plannedEngineFailureReason) {
    return {
      category: 'unavoidable',
      blockerCategory: 'other',
      failureSource: 'unknown',
      trigger_reason: 'unknown planned-engine failure',
    };
  }
  const r = input.plannedEngineFailureReason.toLowerCase();
  if (/timeout|timed out|abort|deadline/i.test(r)) {
    return {
      category: 'timeout_driven',
      blockerCategory: 'timeout',
      failureSource: 'section_generator',
      trigger_reason: `timeout during section generation: ${input.plannedEngineFailureReason}`,
    };
  }
  if (/planner_stability|plan_rejected|plan_regen|plan returned 0/i.test(r)) {
    return {
      category: 'planner_driven',
      blockerCategory: 'planning',
      failureSource: 'planner',
      trigger_reason: `planner instability: ${input.plannedEngineFailureReason}`,
    };
  }
  if (UNSTABLE_CONTENT_TYPES.has(input.contentType)) {
    return {
      category: 'unstable_type',
      blockerCategory: 'other',
      failureSource: 'orchestrator',
      trigger_reason: `${input.contentType} is a known-unstable content type`,
    };
  }
  if (/parse|json|format/i.test(r)) {
    return {
      category: 'avoidable',
      blockerCategory: 'output_format',
      failureSource: 'section_generator',
      trigger_reason: `output format error: ${input.plannedEngineFailureReason}`,
    };
  }
  return {
    category: 'avoidable',
    blockerCategory: 'other',
    failureSource: 'orchestrator',
    trigger_reason: input.plannedEngineFailureReason,
  };
}

// ── Aggregate report ────────────────────────────────────────────────────────

export interface CompatibilityCoreTrafficReport {
  total_requests: number;
  total_recoveries: number;
  total_failures: number;
  by_category: Array<{
    category: CompatibilityCoreRequestCategory;
    count: number;
    share_pct: number;
  }>;
  by_content_type: Array<{ content_type: string; count: number }>;
  by_blocker_category: Array<{ category: string; count: number }>;
  unavoidable_count: number;
  avoidable_count: number;
  unavoidable_share_pct: number;
  avoidable_share_pct: number;
}

export function getCompatibilityCoreTrafficReport(): CompatibilityCoreTrafficReport {
  const total = counters.requests_total;
  const byCategory = Array.from(counters.by_category.entries())
    .map(([category, count]) => ({
      category,
      count,
      share_pct: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  const unavoidable_count = (counters.by_category.get('unavoidable') ?? 0)
    + (counters.by_category.get('planner_driven') ?? 0)
    + (counters.by_category.get('timeout_driven') ?? 0);
  const avoidable_count = (counters.by_category.get('avoidable') ?? 0)
    + (counters.by_category.get('unstable_type') ?? 0);
  return {
    total_requests: total,
    total_recoveries: counters.recoveries_total,
    total_failures: counters.failures_total,
    by_category: byCategory,
    by_content_type: Array.from(counters.by_content_type.entries())
      .map(([content_type, count]) => ({ content_type, count }))
      .sort((a, b) => b.count - a.count),
    by_blocker_category: Array.from(counters.by_blocker_category.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    unavoidable_count,
    avoidable_count,
    unavoidable_share_pct: total > 0 ? Number(((unavoidable_count / total) * 100).toFixed(2)) : 0,
    avoidable_share_pct: total > 0 ? Number(((avoidable_count / total) * 100).toFixed(2)) : 0,
  };
}

export function __resetTrafficIsolationCountersForTests(): void {
  counters.requests_total = 0;
  counters.recoveries_total = 0;
  counters.failures_total = 0;
  counters.by_category.clear();
  counters.by_content_type.clear();
  counters.by_blocker_category.clear();
}
