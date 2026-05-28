/**
 * enforcementPromotionEngine.ts
 *
 * Phase 8.5 — Automated promotion / hold / demote engine for the
 * planned-engine enforcement ladder.
 *
 * Phase 6.7's gate told operators "where you are now."
 * Phase 7.10's recommendation said "where you should be."
 * Phase 8.5 ACTUALLY EXECUTES the promotion (or holds / demotes) with
 * gating + rollback protection + telemetry.
 *
 * Execution model: this module never writes env files. It produces an
 * `PromotionExecutionResult` that an outer admin job / scheduled task
 * can apply — flip the env var, restart the service, etc. The engine
 * tracks its own state machine in-process so back-to-back calls don't
 * thrash the recommendation.
 */

import {
  evaluateDecommissionGate,
  type DecommissionGateResult,
} from './compatibilityCoreDecommissionGate';
import {
  analyzeDecommissionTrend,
  type DecommissionTrendReport,
} from './decommissionTrendAnalyzer';
import {
  evaluateEnforcementPromotion,
  resolveEnforcementMode,
  type PlannedEngineEnforcementMode,
  type EnforcementPromotionRecommendation,
} from './plannedEngineEnforcementMode';

// ── Public types ─────────────────────────────────────────────────────────────

export type PromotionDirection = 'promote' | 'hold' | 'demote';

export interface PromotionGateCheck {
  gate: 'fallback_rate' | 'timeout_rate' | 'convergence_rate' | 'quality_delta' | 'retry_amplification' | 'unstable_content_types' | 'trend_confidence' | 'cooldown';
  passed: boolean;
  detail: string;
}

export interface PromotionDecisionReport {
  decision: PromotionDirection;
  fromMode: PlannedEngineEnforcementMode;
  toMode: PlannedEngineEnforcementMode;
  confidence: 'low' | 'moderate' | 'high';
  gates: PromotionGateCheck[];
  blockers: string[];
  rollbackRisks: string[];
  projectedImpact: {
    additional_traffic_to_planned_pct: number;
    additional_throws_expected_pct: number;
    estimated_user_visible_failures_per_1000: number;
  };
  reasoning: string[];
  whyPromoted?: string;
  whyBlocked?: string;
  whyDemoted?: string;
}

export interface PromotionExecutionResult {
  report: PromotionDecisionReport;
  shouldApply: boolean;
  envVarToSet?: { name: string; value: string };
  appliedAtTimestamp?: string;
  cooldownUntilTimestamp?: string;
}

// ── Per-process state ────────────────────────────────────────────────────────

interface EngineState {
  lastAppliedMode: PlannedEngineEnforcementMode | null;
  lastAppliedAt: string | null;
  cooldownUntil: string | null;
  promotionHistory: Array<{
    timestamp: string;
    fromMode: PlannedEngineEnforcementMode;
    toMode: PlannedEngineEnforcementMode;
    direction: PromotionDirection;
    confidence: 'low' | 'moderate' | 'high';
  }>;
}

const engineState: EngineState = {
  lastAppliedMode: null,
  lastAppliedAt: null,
  cooldownUntil: null,
  promotionHistory: [],
};

// ── Configuration ────────────────────────────────────────────────────────────

const COOLDOWN_MS_AFTER_PROMOTE = 24 * 60 * 60 * 1000; // 24h
const COOLDOWN_MS_AFTER_DEMOTE  = 6  * 60 * 60 * 1000; // 6h

const GATE_THRESHOLDS = {
  fallback_rate_max: 0.05,        // 5% — generous gate (vs final 2% threshold)
  timeout_rate_max:  0.03,
  retry_amplification_max: 1.5,
  unstable_content_types_max: 1,
  quality_delta_min: 0,
  convergence_rate_min: 75,
  trend_confidence_min: 'moderate' as 'low' | 'moderate' | 'high',
};

// ── Telemetry ────────────────────────────────────────────────────────────────

function emitPromotionDecisionTelemetry(payload: {
  event: 'LONGFORM_ENFORCEMENT_PROMOTION_DECISION';
  decision: PromotionDirection;
  fromMode: PlannedEngineEnforcementMode;
  toMode: PlannedEngineEnforcementMode;
  confidence: string;
  shouldApply: boolean;
}): void {
  console.log(`[longform-promotion] ${JSON.stringify({
    ...payload,
    timestamp: new Date().toISOString(),
  })}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function nowMs(): number { return Date.now(); }

function isInCooldown(): boolean {
  if (!engineState.cooldownUntil) return false;
  return nowMs() < Date.parse(engineState.cooldownUntil);
}

// ── Gate evaluation ──────────────────────────────────────────────────────────

function evaluateGates(input: {
  gate: DecommissionGateResult;
  trend: DecommissionTrendReport;
  direction: PromotionDirection;
}): { checks: PromotionGateCheck[]; allPassed: boolean } {
  const checks: PromotionGateCheck[] = [];

  // Cooldown check (only applies to promote / demote)
  if (input.direction !== 'hold') {
    checks.push({
      gate: 'cooldown',
      passed: !isInCooldown(),
      detail: isInCooldown()
        ? `In cooldown until ${engineState.cooldownUntil}`
        : 'No active cooldown',
    });
  }

  // Fallback rate
  const fallbackCheckFromGate = input.gate.checks.find((c) => c.name === 'fallback_rate');
  const fallbackObservedRate = parseFloat((fallbackCheckFromGate?.observed ?? '0%').replace('%', '')) / 100;
  checks.push({
    gate: 'fallback_rate',
    passed: fallbackObservedRate <= GATE_THRESHOLDS.fallback_rate_max,
    detail: `observed ${pct(fallbackObservedRate)} ≤ ${pct(GATE_THRESHOLDS.fallback_rate_max)}`,
  });

  // Timeout rate
  const timeoutCheckFromGate = input.gate.checks.find((c) => c.name === 'timeout_rate');
  const timeoutObservedRate = parseFloat((timeoutCheckFromGate?.observed ?? '0%').replace('%', '')) / 100;
  checks.push({
    gate: 'timeout_rate',
    passed: timeoutObservedRate <= GATE_THRESHOLDS.timeout_rate_max,
    detail: `observed ${pct(timeoutObservedRate)} ≤ ${pct(GATE_THRESHOLDS.timeout_rate_max)}`,
  });

  // Unstable content types
  const unstableCount = input.gate.checks.find((c) => c.name === 'no_critical_unstable_types')?.observed.match(/^(\d+) unstable/)?.[1];
  const unstableCountNum = unstableCount ? parseInt(unstableCount, 10) : 0;
  checks.push({
    gate: 'unstable_content_types',
    passed: unstableCountNum <= GATE_THRESHOLDS.unstable_content_types_max,
    detail: `${unstableCountNum} unstable type(s) ≤ ${GATE_THRESHOLDS.unstable_content_types_max}`,
  });

  // Quality delta — passes if gate said quality_delta_positive=true
  const qualityCheckPassed = input.gate.checks.find((c) => c.name === 'quality_delta_positive')?.passes ?? false;
  checks.push({
    gate: 'quality_delta',
    passed: qualityCheckPassed,
    detail: input.gate.checks.find((c) => c.name === 'quality_delta_positive')?.observed ?? 'no quality data',
  });

  // Retry amplification — derived from trend
  const ampMetric = input.trend.blockerTrajectory.find((b) => b.metric === 'retry_amplification');
  const ampValue = ampMetric?.current_value ?? 1;
  checks.push({
    gate: 'retry_amplification',
    passed: ampValue <= GATE_THRESHOLDS.retry_amplification_max,
    detail: `current ${ampValue.toFixed(3)} ≤ ${GATE_THRESHOLDS.retry_amplification_max}`,
  });

  // Trend confidence
  const order = { low: 0, moderate: 1, high: 2 };
  checks.push({
    gate: 'trend_confidence',
    passed: order[input.trend.confidence] >= order[GATE_THRESHOLDS.trend_confidence_min],
    detail: `trend confidence ${input.trend.confidence} ≥ ${GATE_THRESHOLDS.trend_confidence_min}`,
  });

  return {
    checks,
    allPassed: checks.every((c) => c.passed),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface EvaluatePromotionEngineInput {
  /** Override the current resolved mode (defaults to env-resolved). */
  currentMode?: PlannedEngineEnforcementMode;
  /** Override the gate result. */
  gateResult?: DecommissionGateResult;
  /** Override the trend report. */
  trendReport?: DecommissionTrendReport;
  /** Override the base recommendation. */
  baseRecommendation?: EnforcementPromotionRecommendation;
  /** Force-apply: bypass cooldown (operator-driven manual promotion). */
  forceApply?: boolean;
}

export function evaluatePromotionEngine(
  input: EvaluatePromotionEngineInput = {},
): PromotionExecutionResult {
  const currentMode = input.currentMode ?? resolveEnforcementMode().mode;
  const gate = input.gateResult ?? evaluateDecommissionGate();
  const trend = input.trendReport ?? analyzeDecommissionTrend({ skipCapture: true, gateResult: gate });
  const baseRec = input.baseRecommendation
    ?? evaluateEnforcementPromotion({ currentMode, gateResult: gate, trendReport: trend });
  const reasoning: string[] = [];

  // ── Gate evaluation ──────────────────────────────────────────────────
  const gateEval = evaluateGates({ gate, trend, direction: baseRec.direction });

  // ── Direction resolution ─────────────────────────────────────────────
  let direction: PromotionDirection = baseRec.direction;
  let toMode: PlannedEngineEnforcementMode = baseRec.recommendedMode;
  const blockers: string[] = [];
  const rollbackRisks: string[] = [];

  // Cooldown override (unless forced)
  if (isInCooldown() && !input.forceApply && direction !== 'hold') {
    reasoning.push(`In cooldown until ${engineState.cooldownUntil}; hold.`);
    direction = 'hold';
    toMode = currentMode;
    blockers.push(`Cooldown active until ${engineState.cooldownUntil}.`);
  }

  // If direction is promote but gates failed → demote to hold
  if (direction === 'promote' && !gateEval.allPassed) {
    reasoning.push(`Promotion blocked by gates: ${gateEval.checks.filter((c) => !c.passed).map((c) => c.gate).join(', ')}.`);
    const failedGates = gateEval.checks.filter((c) => !c.passed);
    for (const c of failedGates) blockers.push(`${c.gate} (${c.detail})`);
    direction = 'hold';
    toMode = currentMode;
  }

  // If trend is regressing_rapidly → demote regardless of gate
  if (trend.trendDirection === 'regressing_rapidly') {
    reasoning.push(`Trend regressing_rapidly → demote.`);
    direction = 'demote';
    toMode = baseRec.recommendedMode;
    rollbackRisks.push('Rapid regression detected — automated demotion engaged.');
  }

  // ── Projected impact estimation ──────────────────────────────────────
  const additionalTrafficPct = direction === 'promote' ? estimatePromotionTrafficShift(currentMode, toMode) : 0;
  const additionalThrowsPct  = direction === 'promote' ? estimatePromotionThrowsShift(currentMode, toMode, gate) : 0;
  const userVisibleFailuresPer1000 = Math.round(additionalThrowsPct * 10);

  // ── Confidence ───────────────────────────────────────────────────────
  const confidence: 'low' | 'moderate' | 'high' = baseRec.confidence;

  const report: PromotionDecisionReport = {
    decision: direction,
    fromMode: currentMode,
    toMode,
    confidence,
    gates: gateEval.checks,
    blockers,
    rollbackRisks,
    projectedImpact: {
      additional_traffic_to_planned_pct: additionalTrafficPct,
      additional_throws_expected_pct: additionalThrowsPct,
      estimated_user_visible_failures_per_1000: userVisibleFailuresPer1000,
    },
    reasoning,
  };

  if (direction === 'promote') {
    report.whyPromoted = `${gateEval.checks.filter((c) => c.passed).map((c) => c.gate).join(', ')} all pass; trend ${trend.trendDirection}.`;
  }
  if (direction === 'hold') {
    report.whyBlocked = blockers.join('; ') || `Trend ${trend.trendDirection} with current mode ${currentMode}; hold.`;
  }
  if (direction === 'demote') {
    report.whyDemoted = `Trend ${trend.trendDirection}; demote to ${toMode}.`;
  }

  // ── Execution result ─────────────────────────────────────────────────
  const shouldApply = direction !== 'hold' && (input.forceApply || gateEval.allPassed);
  const result: PromotionExecutionResult = {
    report,
    shouldApply,
    envVarToSet: shouldApply ? { name: 'PLANNED_ENGINE_ENFORCEMENT_MODE', value: toMode } : undefined,
    appliedAtTimestamp: shouldApply ? new Date().toISOString() : undefined,
    cooldownUntilTimestamp: shouldApply
      ? new Date(nowMs() + (direction === 'promote' ? COOLDOWN_MS_AFTER_PROMOTE : COOLDOWN_MS_AFTER_DEMOTE)).toISOString()
      : undefined,
  };

  emitPromotionDecisionTelemetry({
    event: 'LONGFORM_ENFORCEMENT_PROMOTION_DECISION',
    decision: direction,
    fromMode: currentMode,
    toMode,
    confidence,
    shouldApply,
  });

  return result;
}

// ── Apply a promotion result to the engine state ────────────────────────────
//
// The outer admin job calls this AFTER it has actually flipped the env
// var and the new mode is live. We track timing + cooldown so the next
// evaluation respects it.

export function applyPromotionResult(result: PromotionExecutionResult): void {
  if (!result.shouldApply) return;
  engineState.lastAppliedMode = result.report.toMode;
  engineState.lastAppliedAt = result.appliedAtTimestamp ?? new Date().toISOString();
  engineState.cooldownUntil = result.cooldownUntilTimestamp ?? null;
  engineState.promotionHistory.push({
    timestamp: engineState.lastAppliedAt,
    fromMode: result.report.fromMode,
    toMode: result.report.toMode,
    direction: result.report.decision,
    confidence: result.report.confidence,
  });
  while (engineState.promotionHistory.length > 100) engineState.promotionHistory.shift();
}

export interface EnforcementPromotionEngineState {
  last_applied_mode: PlannedEngineEnforcementMode | null;
  last_applied_at: string | null;
  cooldown_until: string | null;
  in_cooldown: boolean;
  promotion_history_count: number;
  recent_history: EngineState['promotionHistory'];
}

export function getEnforcementPromotionEngineState(): EnforcementPromotionEngineState {
  return {
    last_applied_mode: engineState.lastAppliedMode,
    last_applied_at: engineState.lastAppliedAt,
    cooldown_until: engineState.cooldownUntil,
    in_cooldown: isInCooldown(),
    promotion_history_count: engineState.promotionHistory.length,
    recent_history: [...engineState.promotionHistory].slice(-10),
  };
}

// ── Helpers: projected-impact estimation ────────────────────────────────────

function estimatePromotionTrafficShift(
  from: PlannedEngineEnforcementMode,
  to: PlannedEngineEnforcementMode,
): number {
  // Rough: each ladder step routes more critical-type fallback traffic
  // to throw rather than fall back. Estimate the delta.
  const order: Record<PlannedEngineEnforcementMode, number> = {
    OBSERVE_ONLY: 0,
    PREFER_PLANNED: 5,
    PLANNED_REQUIRED_NON_CRITICAL: 30,
    PLANNED_REQUIRED_ALL: 60,
    NO_COMPATIBILITY_CORE: 100,
  };
  return Math.max(0, order[to] - order[from]);
}

function estimatePromotionThrowsShift(
  from: PlannedEngineEnforcementMode,
  to: PlannedEngineEnforcementMode,
  gate: DecommissionGateResult,
): number {
  const fallbackRateCheck = gate.checks.find((c) => c.name === 'fallback_rate');
  const observedRate = parseFloat((fallbackRateCheck?.observed ?? '0%').replace('%', '')) / 100;
  const traffic = estimatePromotionTrafficShift(from, to);
  return Number((traffic * observedRate / 100).toFixed(2)) * 100;
}

export function __resetPromotionEngineStateForTests(): void {
  engineState.lastAppliedMode = null;
  engineState.lastAppliedAt = null;
  engineState.cooldownUntil = null;
  engineState.promotionHistory.length = 0;
}
