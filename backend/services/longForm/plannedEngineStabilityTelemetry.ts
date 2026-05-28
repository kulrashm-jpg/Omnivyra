/**
 * plannedEngineStabilityTelemetry.ts
 *
 * Phase 3.7 — Structured stability telemetry for the planned-sectionwise
 * engine.
 *
 * Emits machine-parseable events so operators can finally answer:
 *   - what is the planned-engine success rate?
 *   - which gates fail most often (alignment / continuity / genericity /
 *     repetition / factual / assignment-consumption)?
 *   - average retries per section?
 *   - average time-to-pass?
 *   - which content types still rely on the compatibility-core fallback?
 *
 * Zero dependencies beyond `console` — downstream log scrapers can grep
 * the `[longform-stability]` tag.
 */

export type LongFormGovernanceFailureReason =
  | 'continuity'
  | 'genericity'
  | 'factual'
  | 'company_alignment'
  | 'strategic_assignment_consumption'
  | 'semantic_repetition'
  | 'timeout'
  | 'unknown';

export interface SectionGovernancePayload {
  event: 'LONGFORM_SECTION_GOVERNANCE';
  company_id: string | null;
  content_type: string;
  section_index: number;
  section_title: string;
  attempt_number: number;
  passes: boolean;
  failure_reasons: LongFormGovernanceFailureReason[];
  scores: {
    continuity?: number;
    strategic_integrity?: number;
    operational_integrity?: number;
    genericity_pressure?: number;
    alignment?: number;
    differentiation_strength?: number;
    strategic_presence?: number;
    assignment_consumption?: number;
    factual_authority_inflation?: number;
    factual_operational_realism?: number;
  };
  timestamp: string;
}

export interface SectionRetryPayload {
  event: 'LONGFORM_SECTION_RETRY';
  company_id: string | null;
  content_type: string;
  section_index: number;
  attempt_number: number;
  recovery_action: string;
  driving_failure: LongFormGovernanceFailureReason;
  improved_from_previous: boolean;
  timestamp: string;
}

export interface PlannedEngineSuccessPayload {
  event: 'LONGFORM_PLANNED_ENGINE_SUCCESS';
  company_id: string | null;
  content_type: string;
  topic: string;
  total_sections: number;
  sections_passed: number;
  sections_failed: number;
  total_retries: number;
  avg_retries_per_section: number;
  duration_ms: number;
  final_lifecycle_state: string;
  timestamp: string;
}

export interface PlannedEngineFailurePayload {
  event: 'LONGFORM_PLANNED_ENGINE_FAILURE';
  company_id: string | null;
  content_type: string;
  topic: string;
  failure_phase: 'planning' | 'section_generation' | 'quality_validation' | 'post_integrity' | 'unknown';
  reason: string;
  reason_stack?: string;
  partial_sections_completed: number;
  duration_ms: number;
  timestamp: string;
}

export interface CompatibilityCoreUsagePayload {
  event: 'LONGFORM_COMPATIBILITY_CORE_USAGE';
  company_id: string | null;
  content_type: string;
  topic: string;
  reason: 'planned_engine_failed' | 'mode_not_full' | 'strict_mode_override';
  fallback_reason?: string;
  timestamp: string;
}

function emit(level: 'log' | 'warn' | 'error', payload: Record<string, unknown>): void {
  const line = `[longform-stability] ${JSON.stringify(payload)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function emitSectionGovernance(input: Omit<SectionGovernancePayload, 'event' | 'timestamp'>): void {
  emit(input.passes ? 'log' : 'warn', {
    event: 'LONGFORM_SECTION_GOVERNANCE',
    ...input,
    timestamp: new Date().toISOString(),
  });
}

export function emitSectionRetry(input: Omit<SectionRetryPayload, 'event' | 'timestamp'>): void {
  emit('warn', {
    event: 'LONGFORM_SECTION_RETRY',
    ...input,
    timestamp: new Date().toISOString(),
  });
}

export function emitPlannedEngineSuccess(input: Omit<PlannedEngineSuccessPayload, 'event' | 'timestamp'>): void {
  emit('log', {
    event: 'LONGFORM_PLANNED_ENGINE_SUCCESS',
    ...input,
    timestamp: new Date().toISOString(),
  });
}

export function emitPlannedEngineFailure(input: Omit<PlannedEngineFailurePayload, 'event' | 'timestamp'>): void {
  emit('error', {
    event: 'LONGFORM_PLANNED_ENGINE_FAILURE',
    ...input,
    timestamp: new Date().toISOString(),
  });
}

export function emitCompatibilityCoreUsage(input: Omit<CompatibilityCoreUsagePayload, 'event' | 'timestamp'>): void {
  emit('warn', {
    event: 'LONGFORM_COMPATIBILITY_CORE_USAGE',
    ...input,
    timestamp: new Date().toISOString(),
  });
}

// ── Aggregator: in-memory ring buffer for run-summary stats ──────────────────
//
// Lightweight in-process counters that downstream stability dashboards can
// poll via `getCompatibilityCoreUsageReport()`. This is observability only;
// truth lives in the structured log stream above.

interface CounterBucket {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  fallbackReasons: Map<string, number>;
}

const buckets = new Map<string, CounterBucket>();

function bucket(contentType: string): CounterBucket {
  let b = buckets.get(contentType);
  if (!b) {
    b = { totalAttempts: 0, successCount: 0, failureCount: 0, fallbackCount: 0, fallbackReasons: new Map() };
    buckets.set(contentType, b);
  }
  return b;
}

export function recordPlannedEngineAttempt(contentType: string): void {
  bucket(contentType).totalAttempts += 1;
}

export function recordPlannedEngineSuccess(contentType: string): void {
  bucket(contentType).successCount += 1;
}

export function recordPlannedEngineFailure(contentType: string, reason: string): void {
  const b = bucket(contentType);
  b.failureCount += 1;
  b.fallbackCount += 1;
  b.fallbackReasons.set(reason, (b.fallbackReasons.get(reason) ?? 0) + 1);
}

export interface CompatibilityCoreUsageReport {
  total_attempts_all_types: number;
  total_planned_success: number;
  total_planned_failure: number;
  total_fallback_to_compatibility_core: number;
  per_content_type: Array<{
    content_type: string;
    attempts: number;
    success: number;
    failure: number;
    fallback: number;
    fallback_rate: number;
    common_failure_reasons: Array<{ reason: string; count: number }>;
  }>;
}

/**
 * Phase 3.8 — Per-process snapshot of which content types still rely on
 * the compatibility-core fallback path. Reset on process restart; for
 * durable analytics rely on the structured log events.
 */
export function getCompatibilityCoreUsageReport(): CompatibilityCoreUsageReport {
  let totalAttempts = 0;
  let totalSuccess = 0;
  let totalFailure = 0;
  let totalFallback = 0;
  const perType: CompatibilityCoreUsageReport['per_content_type'] = [];

  for (const [contentType, b] of buckets.entries()) {
    totalAttempts += b.totalAttempts;
    totalSuccess += b.successCount;
    totalFailure += b.failureCount;
    totalFallback += b.fallbackCount;
    perType.push({
      content_type: contentType,
      attempts: b.totalAttempts,
      success: b.successCount,
      failure: b.failureCount,
      fallback: b.fallbackCount,
      fallback_rate: b.totalAttempts > 0 ? Number((b.fallbackCount / b.totalAttempts).toFixed(3)) : 0,
      common_failure_reasons: Array.from(b.fallbackReasons.entries())
        .sort((a, c) => c[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    });
  }

  return {
    total_attempts_all_types: totalAttempts,
    total_planned_success: totalSuccess,
    total_planned_failure: totalFailure,
    total_fallback_to_compatibility_core: totalFallback,
    per_content_type: perType,
  };
}

/** Test-only — reset all in-memory counters. */
export function __resetStabilityBucketsForTests(): void {
  buckets.clear();
}
