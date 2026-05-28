/**
 * plannedEngineEnforcementMode.ts
 *
 * Phase 7.10 — Replace the binary `STRICT_PLANNED_ENGINE_MODE` with a
 * 5-tier ladder that operators can promote/demote based on observed
 * stability trends.
 *
 * Modes:
 *   OBSERVE_ONLY                   default — compatibility-core is the
 *                                   safety net, planned engine runs first,
 *                                   any failure silently falls back
 *   PREFER_PLANNED                 same routing as today, but fallback
 *                                   events trigger LONGFORM_RETIREMENT_SIMULATED_FAILURE
 *                                   plus an explicit "this would have
 *                                   failed in stricter mode" tag
 *   PLANNED_REQUIRED_NON_CRITICAL  only `blog` + `newsletter` can fall back;
 *                                   `article` + `whitepaper` + `guide` must
 *                                   succeed on the planned engine
 *   PLANNED_REQUIRED_ALL           every content type must succeed on the
 *                                   planned engine; fallback throws
 *   NO_COMPATIBILITY_CORE          terminal state — compatibility-core
 *                                   code path is no longer linked in;
 *                                   fallback throws unconditionally
 *
 * Per-request override is preserved via `strictPlannedEngine: true`
 * (back-compat with Phase 3.8).
 *
 * `evaluateEnforcementPromotion()` recommends moving up or down the
 * ladder based on the decommission gate + trend report.
 */

import { evaluateDecommissionGate, type DecommissionGateResult } from './compatibilityCoreDecommissionGate';
import { analyzeDecommissionTrend, type DecommissionTrendReport } from './decommissionTrendAnalyzer';

// ── Public types ─────────────────────────────────────────────────────────────

export type PlannedEngineEnforcementMode =
  | 'OBSERVE_ONLY'
  | 'PREFER_PLANNED'
  | 'PLANNED_REQUIRED_NON_CRITICAL'
  | 'PLANNED_REQUIRED_ALL'
  | 'NO_COMPATIBILITY_CORE';

export interface EnforcementResolution {
  mode: PlannedEngineEnforcementMode;
  reason:
    | 'request_override'
    | 'env_set'
    | 'env_legacy_strict_alias'
    | 'env_legacy_strict_non_prod'
    | 'default_observe_only';
}

export interface EnforcementDecision {
  /** Whether the call site MUST fall back to compatibility-core on planned failure. */
  shouldFallback: boolean;
  /** Whether the call site MUST throw on planned failure. */
  shouldThrowOnFailure: boolean;
  /** Whether this content type is allowed to fall back even under strict modes. */
  contentTypeAllowedToFallback: boolean;
  /** Human-readable reason. */
  reason: string;
}

export interface EnforcementPromotionRecommendation {
  currentMode: PlannedEngineEnforcementMode;
  recommendedMode: PlannedEngineEnforcementMode;
  direction: 'promote' | 'hold' | 'demote';
  confidence: 'low' | 'moderate' | 'high';
  reasoning: string[];
  gateMode: DecommissionGateResult['mode'];
  trendDirection: DecommissionTrendReport['trendDirection'];
  blockers: string[];
}

// ── Content-type criticality ─────────────────────────────────────────────────

const NON_CRITICAL_TYPES = new Set<string>(['blog', 'newsletter', 'story']);

function isContentTypeCritical(contentType: string): boolean {
  return !NON_CRITICAL_TYPES.has(contentType);
}

// ── Mode resolution ──────────────────────────────────────────────────────────

const VALID_MODES = new Set<PlannedEngineEnforcementMode>([
  'OBSERVE_ONLY',
  'PREFER_PLANNED',
  'PLANNED_REQUIRED_NON_CRITICAL',
  'PLANNED_REQUIRED_ALL',
  'NO_COMPATIBILITY_CORE',
]);

export function resolveEnforcementMode(perRequest?: boolean | PlannedEngineEnforcementMode): EnforcementResolution {
  // Per-request override (boolean true ≡ PLANNED_REQUIRED_ALL for back-compat).
  if (typeof perRequest === 'boolean') {
    return {
      mode: perRequest ? 'PLANNED_REQUIRED_ALL' : 'OBSERVE_ONLY',
      reason: 'request_override',
    };
  }
  if (typeof perRequest === 'string' && VALID_MODES.has(perRequest as PlannedEngineEnforcementMode)) {
    return { mode: perRequest as PlannedEngineEnforcementMode, reason: 'request_override' };
  }

  // New env (Phase 7.10).
  const newEnv = (process.env.PLANNED_ENGINE_ENFORCEMENT_MODE ?? '').toUpperCase();
  if (newEnv && VALID_MODES.has(newEnv as PlannedEngineEnforcementMode)) {
    return { mode: newEnv as PlannedEngineEnforcementMode, reason: 'env_set' };
  }

  // Legacy env (Phase 3.8) — map onto the new ladder.
  const legacy = (process.env.STRICT_PLANNED_ENGINE_MODE ?? 'off').toLowerCase();
  if (legacy === 'always') {
    return { mode: 'PLANNED_REQUIRED_ALL', reason: 'env_legacy_strict_alias' };
  }
  if (legacy === 'non_prod') {
    return {
      mode: process.env.NODE_ENV !== 'production' ? 'PLANNED_REQUIRED_ALL' : 'OBSERVE_ONLY',
      reason: 'env_legacy_strict_non_prod',
    };
  }
  return { mode: 'OBSERVE_ONLY', reason: 'default_observe_only' };
}

// ── Decision per request ─────────────────────────────────────────────────────

export function applyEnforcementToFallback(input: {
  mode: PlannedEngineEnforcementMode;
  contentType: string;
}): EnforcementDecision {
  const critical = isContentTypeCritical(input.contentType);
  switch (input.mode) {
    case 'OBSERVE_ONLY':
      return {
        shouldFallback: true,
        shouldThrowOnFailure: false,
        contentTypeAllowedToFallback: true,
        reason: `OBSERVE_ONLY: fallback allowed for all content types (including ${input.contentType}).`,
      };
    case 'PREFER_PLANNED':
      return {
        shouldFallback: true,
        shouldThrowOnFailure: false,
        contentTypeAllowedToFallback: true,
        reason: `PREFER_PLANNED: fallback allowed but tagged as a retirement-simulated failure.`,
      };
    case 'PLANNED_REQUIRED_NON_CRITICAL':
      return {
        shouldFallback: !critical,
        shouldThrowOnFailure: critical,
        contentTypeAllowedToFallback: !critical,
        reason: critical
          ? `PLANNED_REQUIRED_NON_CRITICAL: ${input.contentType} is critical; throw on planned failure.`
          : `PLANNED_REQUIRED_NON_CRITICAL: ${input.contentType} is non-critical; fallback allowed.`,
      };
    case 'PLANNED_REQUIRED_ALL':
      return {
        shouldFallback: false,
        shouldThrowOnFailure: true,
        contentTypeAllowedToFallback: false,
        reason: 'PLANNED_REQUIRED_ALL: planned engine must succeed; throw on failure.',
      };
    case 'NO_COMPATIBILITY_CORE':
      return {
        shouldFallback: false,
        shouldThrowOnFailure: true,
        contentTypeAllowedToFallback: false,
        reason: 'NO_COMPATIBILITY_CORE: compatibility-core has been decommissioned.',
      };
  }
}

// ── Promotion / demotion recommendation ─────────────────────────────────────

const MODE_ORDER: PlannedEngineEnforcementMode[] = [
  'OBSERVE_ONLY',
  'PREFER_PLANNED',
  'PLANNED_REQUIRED_NON_CRITICAL',
  'PLANNED_REQUIRED_ALL',
  'NO_COMPATIBILITY_CORE',
];

function nextMode(current: PlannedEngineEnforcementMode, delta: number): PlannedEngineEnforcementMode {
  const idx = MODE_ORDER.indexOf(current);
  const next = Math.max(0, Math.min(MODE_ORDER.length - 1, idx + delta));
  return MODE_ORDER[next];
}

export interface EvaluatePromotionInput {
  currentMode?: PlannedEngineEnforcementMode;
  /** Override the gate result (default: re-evaluate). */
  gateResult?: DecommissionGateResult;
  /** Override the trend report (default: re-evaluate). */
  trendReport?: DecommissionTrendReport;
}

export function evaluateEnforcementPromotion(
  input: EvaluatePromotionInput = {},
): EnforcementPromotionRecommendation {
  const currentMode = input.currentMode ?? resolveEnforcementMode().mode;
  const gate = input.gateResult ?? evaluateDecommissionGate();
  const trend = input.trendReport ?? analyzeDecommissionTrend({ skipCapture: true, gateResult: gate });
  const reasoning: string[] = [];

  // Map gate mode → recommended ladder position.
  const baselineByGate: Record<DecommissionGateResult['mode'], PlannedEngineEnforcementMode> = {
    NOT_READY: 'OBSERVE_ONLY',
    LIMITED_NON_PROD: 'PREFER_PLANNED',
    STAGED_PRODUCTION: 'PLANNED_REQUIRED_NON_CRITICAL',
    READY_FOR_RETIREMENT: 'PLANNED_REQUIRED_ALL',
  };
  let target = baselineByGate[gate.mode];
  reasoning.push(`Gate mode ${gate.mode} → baseline recommendation ${target}.`);

  // Trend overlay: rapid improvement promotes one level; rapid regression demotes one.
  if (trend.trendDirection === 'improving_rapidly' && gate.mode !== 'NOT_READY') {
    const promoted = nextMode(target, 1);
    reasoning.push(`Trend improving_rapidly → promote ${target} → ${promoted}.`);
    target = promoted;
  } else if (trend.trendDirection === 'regressing_rapidly') {
    const demoted = nextMode(target, -1);
    reasoning.push(`Trend regressing_rapidly → demote ${target} → ${demoted}.`);
    target = demoted;
  } else if (trend.trendDirection === 'regressing' && currentMode !== 'OBSERVE_ONLY') {
    reasoning.push(`Trend regressing → hold at most at current mode.`);
    const currIdx = MODE_ORDER.indexOf(currentMode);
    const targetIdx = MODE_ORDER.indexOf(target);
    if (targetIdx > currIdx) target = currentMode;
  }

  // Determine direction (relative to currentMode).
  const currIdx = MODE_ORDER.indexOf(currentMode);
  const targetIdx = MODE_ORDER.indexOf(target);
  const direction: EnforcementPromotionRecommendation['direction'] =
    targetIdx > currIdx ? 'promote' :
    targetIdx < currIdx ? 'demote' : 'hold';

  // Confidence — gate + trend confidence combined.
  let confidence: 'low' | 'moderate' | 'high';
  if (trend.confidence === 'high' && gate.blockers.length === 0) confidence = 'high';
  else if (trend.confidence === 'low' || gate.blockers.length >= 3) confidence = 'low';
  else confidence = 'moderate';

  return {
    currentMode,
    recommendedMode: target,
    direction,
    confidence,
    reasoning,
    gateMode: gate.mode,
    trendDirection: trend.trendDirection,
    blockers: gate.blockers,
  };
}
