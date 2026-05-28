/**
 * canonicalRecoveryEnforcement.ts
 *
 * Phase 8.2 — Hard-enforce that all retry / lifecycle / abandonment
 * decisions route through `UnifiedRecoveryGraph`.
 *
 * Behavior tiered by environment:
 *   - development   → assertion throws
 *   - staging       → assertion throws + LONGFORM_NON_CANONICAL_RECOVERY telemetry
 *   - production    → telemetry-only initially; soft warning only
 *
 * Override: `STRICT_CANONICAL_RECOVERY=force_throw` makes assertion throw
 * everywhere; `STRICT_CANONICAL_RECOVERY=telemetry_only` silences throws
 * in dev (used for migrating legacy call sites).
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type CanonicalRecoveryEnforcementMode =
  | 'throw'
  | 'throw_and_telemetry'
  | 'telemetry_only'
  | 'off';

export interface NonCanonicalRecoveryDetection {
  offendingModule: string;
  offendingMethod: string;
  detectedBehavior:
    | 'direct_lifecycle_transition'
    | 'local_retry_counter'
    | 'local_abandonment_heuristic'
    | 'non_graph_retry_sequencing'
    | 'non_graph_escalation'
    | 'other';
  bypassRisk: 'low' | 'moderate' | 'high';
  detail?: string;
}

export interface CanonicalRecoveryViolationPayload extends NonCanonicalRecoveryDetection {
  event: 'LONGFORM_NON_CANONICAL_RECOVERY';
  timestamp: string;
}

// ── In-process counters ────────────────────────────────────────────────────

interface ViolationBucket {
  total: number;
  byModule: Map<string, number>;
  byBehavior: Map<NonCanonicalRecoveryDetection['detectedBehavior'], number>;
  recentSample: CanonicalRecoveryViolationPayload[];
}

const counters: ViolationBucket = {
  total: 0,
  byModule: new Map(),
  byBehavior: new Map(),
  recentSample: [],
};

const RECENT_SAMPLE_CAP = 50;

// ── Resolution ──────────────────────────────────────────────────────────────

export function resolveCanonicalRecoveryEnforcement(): {
  mode: CanonicalRecoveryEnforcementMode;
  reason: 'env_force_throw' | 'env_telemetry_only' | 'env_off' | 'env_development' | 'env_staging' | 'env_production';
} {
  const env = (process.env.STRICT_CANONICAL_RECOVERY ?? '').toLowerCase().trim();
  if (env === 'force_throw' || env === 'throw') {
    return { mode: 'throw', reason: 'env_force_throw' };
  }
  if (env === 'telemetry_only' || env === 'telemetry') {
    return { mode: 'telemetry_only', reason: 'env_telemetry_only' };
  }
  if (env === 'off' || env === '0' || env === 'false') {
    return { mode: 'off', reason: 'env_off' };
  }
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
  if (nodeEnv === 'production') {
    return { mode: 'telemetry_only', reason: 'env_production' };
  }
  if (nodeEnv === 'staging' || nodeEnv === 'test') {
    return { mode: 'throw_and_telemetry', reason: 'env_staging' };
  }
  return { mode: 'throw', reason: 'env_development' };
}

// ── Emission ──────────────────────────────────────────────────────────────

function emitViolation(detection: NonCanonicalRecoveryDetection): CanonicalRecoveryViolationPayload {
  const payload: CanonicalRecoveryViolationPayload = {
    event: 'LONGFORM_NON_CANONICAL_RECOVERY',
    ...detection,
    timestamp: new Date().toISOString(),
  };
  counters.total += 1;
  counters.byModule.set(detection.offendingModule, (counters.byModule.get(detection.offendingModule) ?? 0) + 1);
  counters.byBehavior.set(detection.detectedBehavior, (counters.byBehavior.get(detection.detectedBehavior) ?? 0) + 1);
  counters.recentSample.push(payload);
  while (counters.recentSample.length > RECENT_SAMPLE_CAP) counters.recentSample.shift();
  console.warn(`[longform-canonical-violation] ${JSON.stringify(payload)}`);
  return payload;
}

// ── Public assertion API ──────────────────────────────────────────────────

/**
 * Canonical-ownership assertion. Call from any module that should NEVER
 * be reached via the legacy direct-lifecycle path. In `throw` mode the
 * caller's request fails fast; in `telemetry_only` mode the violation
 * is logged but execution continues.
 */
export function assertCanonicalRecoveryOwnership(detection: NonCanonicalRecoveryDetection): void {
  const enforcement = resolveCanonicalRecoveryEnforcement();
  if (enforcement.mode === 'off') return;

  emitViolation(detection);

  if (enforcement.mode === 'throw' || enforcement.mode === 'throw_and_telemetry') {
    throw new Error(
      `[canonicalRecoveryEnforcement] Non-canonical recovery detected in ` +
      `${detection.offendingModule}.${detection.offendingMethod}: ` +
      `${detection.detectedBehavior} (risk=${detection.bypassRisk}). ` +
      `Detail: ${detection.detail ?? '(none)'}. ` +
      `Resolve by routing through UnifiedRecoveryGraph.executeRecoveryCycle.`,
    );
  }
}

/**
 * Soft variant — never throws. Use at call sites where the legacy path
 * is still load-bearing but we want visibility into bypass rate during
 * migration.
 */
export function reportNonCanonicalRecovery(detection: NonCanonicalRecoveryDetection): CanonicalRecoveryViolationPayload {
  return emitViolation(detection);
}

// ── Aggregate reporting ──────────────────────────────────────────────────

export interface CanonicalRecoveryViolationReport {
  total_violations: number;
  by_module: Array<{ module: string; count: number }>;
  by_behavior: Array<{ behavior: string; count: number }>;
  recent_samples: CanonicalRecoveryViolationPayload[];
  enforcement_mode: CanonicalRecoveryEnforcementMode;
  enforcement_reason: string;
}

export function getCanonicalRecoveryViolationReport(): CanonicalRecoveryViolationReport {
  const enforcement = resolveCanonicalRecoveryEnforcement();
  return {
    total_violations: counters.total,
    by_module: Array.from(counters.byModule.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([module, count]) => ({ module, count })),
    by_behavior: Array.from(counters.byBehavior.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([behavior, count]) => ({ behavior, count })),
    recent_samples: [...counters.recentSample],
    enforcement_mode: enforcement.mode,
    enforcement_reason: enforcement.reason,
  };
}

export function __resetCanonicalViolationCountersForTests(): void {
  counters.total = 0;
  counters.byModule.clear();
  counters.byBehavior.clear();
  counters.recentSample.length = 0;
}
