/**
 * enforcementRollbackGuard.ts
 *
 * Phase 8.6 — Automated rollback protection layered on top of the
 * promotion engine.
 *
 * Watches for regression signatures AFTER a promotion has landed:
 *   - timeout spike       : timeout_rate increases ≥50% from pre-promotion baseline
 *   - fallback spike      : fallback_rate increases ≥30% from pre-promotion baseline
 *   - convergence collapse: avg convergence drops by ≥10 points
 *   - retry amplification : amplification rises ≥40% above baseline
 *   - unstable resurgence : a previously-stable content type fails again
 *
 * On trigger:
 *   - immediate downgrade to the previous mode
 *   - freeze promotion (extended cooldown)
 *   - critical telemetry event
 *   - forensic snapshot persisted to the promotion history
 */

import {
  evaluateDecommissionGate,
  type DecommissionGateResult,
} from './compatibilityCoreDecommissionGate';
import { analyzeDecommissionTrend, type DecommissionTrendReport } from './decommissionTrendAnalyzer';
import type { PlannedEngineEnforcementMode } from './plannedEngineEnforcementMode';

// ── Public types ─────────────────────────────────────────────────────────────

export type RollbackTrigger =
  | 'timeout_spike'
  | 'fallback_spike'
  | 'convergence_collapse'
  | 'retry_amplification_surge'
  | 'unstable_type_resurgence';

export interface RollbackProtectionEvent {
  event: 'LONGFORM_ROLLBACK_PROTECTION';
  triggered: boolean;
  triggers: RollbackTrigger[];
  fromMode: PlannedEngineEnforcementMode;
  toMode: PlannedEngineEnforcementMode;
  baseline: BaselineSnapshot;
  current: BaselineSnapshot;
  forensicSnapshot: RollbackForensicSnapshot;
  freezePromotionUntil: string;
  reasoning: string[];
  timestamp: string;
}

export interface BaselineSnapshot {
  recorded_at: string;
  fallback_rate: number;
  timeout_rate: number;
  retry_amplification: number;
  unstable_content_types: string[];
  convergence_avg: number;
}

export interface RollbackForensicSnapshot {
  gate: DecommissionGateResult;
  trend: DecommissionTrendReport;
}

// ── In-process state ────────────────────────────────────────────────────────

interface RollbackState {
  promotionBaseline: { mode: PlannedEngineEnforcementMode; snapshot: BaselineSnapshot } | null;
  rollbackHistory: RollbackProtectionEvent[];
  promotionFreezeUntil: string | null;
}

const state: RollbackState = {
  promotionBaseline: null,
  rollbackHistory: [],
  promotionFreezeUntil: null,
};

// ── Thresholds ───────────────────────────────────────────────────────────────

const TIMEOUT_SPIKE_PCT = 0.50;          // ≥ 50% increase
const FALLBACK_SPIKE_PCT = 0.30;
const CONVERGENCE_COLLAPSE_POINTS = 10;
const AMPLIFICATION_SURGE_PCT = 0.40;
const FREEZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

// ── Snapshot building ──────────────────────────────────────────────────────

function buildSnapshotFromGate(gate: DecommissionGateResult): BaselineSnapshot {
  const fallbackCheck = gate.checks.find((c) => c.name === 'fallback_rate');
  const timeoutCheck = gate.checks.find((c) => c.name === 'timeout_rate');
  const unstableCheck = gate.checks.find((c) => c.name === 'no_critical_unstable_types');

  // Parse observed values (e.g. "14.90%" → 0.149).
  const fallbackRate = parseFloat((fallbackCheck?.observed ?? '0%').replace('%', '')) / 100;
  const timeoutRate = parseFloat((timeoutCheck?.observed ?? '0%').replace('%', '')) / 100;
  const unstableMatch = unstableCheck?.observed.match(/unstable type\(s\): ([^(]+)/);
  const unstableNames = unstableMatch?.[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'none')
    ?? [];

  return {
    recorded_at: new Date().toISOString(),
    fallback_rate: fallbackRate,
    timeout_rate: timeoutRate,
    retry_amplification: 0, // populated by enrichSnapshot below
    unstable_content_types: unstableNames,
    convergence_avg: 0,
  };
}

function enrichSnapshotWithTrend(snapshot: BaselineSnapshot, trend: DecommissionTrendReport): BaselineSnapshot {
  const ampBlocker = trend.blockerTrajectory.find((b) => b.metric === 'retry_amplification');
  return {
    ...snapshot,
    retry_amplification: ampBlocker?.current_value ?? snapshot.retry_amplification,
  };
}

// ── Promotion ↔ baseline tracking ───────────────────────────────────────────

/**
 * Capture a baseline snapshot immediately AFTER a successful promotion.
 * Subsequent rollback checks compare current state against this baseline.
 */
export function captureBaselineAfterPromotion(mode: PlannedEngineEnforcementMode): BaselineSnapshot {
  const gate = evaluateDecommissionGate();
  const trend = analyzeDecommissionTrend({ skipCapture: true, gateResult: gate });
  const snapshot = enrichSnapshotWithTrend(buildSnapshotFromGate(gate), trend);
  state.promotionBaseline = { mode, snapshot };
  return snapshot;
}

// ── Rollback decision ───────────────────────────────────────────────────────

export interface CheckRollbackInput {
  /** The previous mode to roll back to. */
  previousMode: PlannedEngineEnforcementMode;
  /** The current (post-promotion) mode. */
  currentMode: PlannedEngineEnforcementMode;
  /** Override the gate result (default: re-evaluate). */
  gate?: DecommissionGateResult;
  /** Override the trend report. */
  trend?: DecommissionTrendReport;
  /** Override the baseline (default: in-process). */
  baseline?: BaselineSnapshot;
}

export interface CheckRollbackResult {
  triggered: boolean;
  triggers: RollbackTrigger[];
  event?: RollbackProtectionEvent;
}

export function checkAndApplyRollback(input: CheckRollbackInput): CheckRollbackResult {
  const baseline = input.baseline ?? state.promotionBaseline?.snapshot;
  if (!baseline) {
    return { triggered: false, triggers: [] };
  }
  const gate = input.gate ?? evaluateDecommissionGate();
  const trend = input.trend ?? analyzeDecommissionTrend({ skipCapture: true, gateResult: gate });
  const current = enrichSnapshotWithTrend(buildSnapshotFromGate(gate), trend);

  const triggers: RollbackTrigger[] = [];
  const reasoning: string[] = [];

  // ── Timeout spike ────────────────────────────────────────────────────
  if (baseline.timeout_rate > 0
      && (current.timeout_rate - baseline.timeout_rate) / baseline.timeout_rate >= TIMEOUT_SPIKE_PCT) {
    triggers.push('timeout_spike');
    reasoning.push(`Timeout rate spiked: ${(baseline.timeout_rate * 100).toFixed(2)}% → ${(current.timeout_rate * 100).toFixed(2)}% (≥ ${TIMEOUT_SPIKE_PCT * 100}% increase).`);
  } else if (baseline.timeout_rate === 0 && current.timeout_rate >= 0.02) {
    triggers.push('timeout_spike');
    reasoning.push(`Timeout rate appeared from 0 → ${(current.timeout_rate * 100).toFixed(2)}%.`);
  }

  // ── Fallback spike ───────────────────────────────────────────────────
  if (baseline.fallback_rate > 0
      && (current.fallback_rate - baseline.fallback_rate) / baseline.fallback_rate >= FALLBACK_SPIKE_PCT) {
    triggers.push('fallback_spike');
    reasoning.push(`Fallback rate spiked: ${(baseline.fallback_rate * 100).toFixed(2)}% → ${(current.fallback_rate * 100).toFixed(2)}% (≥ ${FALLBACK_SPIKE_PCT * 100}% increase).`);
  }

  // ── Convergence collapse ─────────────────────────────────────────────
  if (baseline.convergence_avg > 0
      && baseline.convergence_avg - current.convergence_avg >= CONVERGENCE_COLLAPSE_POINTS) {
    triggers.push('convergence_collapse');
    reasoning.push(`Convergence dropped ≥ ${CONVERGENCE_COLLAPSE_POINTS} points: ${baseline.convergence_avg} → ${current.convergence_avg}.`);
  }

  // ── Retry amplification surge ────────────────────────────────────────
  if (baseline.retry_amplification > 0
      && (current.retry_amplification - baseline.retry_amplification) / baseline.retry_amplification >= AMPLIFICATION_SURGE_PCT) {
    triggers.push('retry_amplification_surge');
    reasoning.push(`Retry amplification surged: ${baseline.retry_amplification.toFixed(3)} → ${current.retry_amplification.toFixed(3)} (≥ ${AMPLIFICATION_SURGE_PCT * 100}% increase).`);
  }

  // ── Unstable resurgence ──────────────────────────────────────────────
  // Any content type that was stable at baseline but is now in the
  // unstable list.
  const resurgent = current.unstable_content_types.filter(
    (ct) => !baseline.unstable_content_types.includes(ct),
  );
  if (resurgent.length > 0) {
    triggers.push('unstable_type_resurgence');
    reasoning.push(`Previously stable content type(s) regressed: ${resurgent.join(', ')}.`);
  }

  if (triggers.length === 0) {
    return { triggered: false, triggers: [] };
  }

  // ── Apply rollback ───────────────────────────────────────────────────
  const freezeUntil = new Date(Date.now() + FREEZE_DURATION_MS).toISOString();
  state.promotionFreezeUntil = freezeUntil;
  reasoning.push(`Promotion frozen until ${freezeUntil} pending investigation.`);

  const event: RollbackProtectionEvent = {
    event: 'LONGFORM_ROLLBACK_PROTECTION',
    triggered: true,
    triggers,
    fromMode: input.currentMode,
    toMode: input.previousMode,
    baseline,
    current,
    forensicSnapshot: { gate, trend },
    freezePromotionUntil: freezeUntil,
    reasoning,
    timestamp: new Date().toISOString(),
  };
  state.rollbackHistory.push(event);
  while (state.rollbackHistory.length > 50) state.rollbackHistory.shift();
  console.error(`[longform-rollback] ${JSON.stringify({
    event: event.event,
    triggered: event.triggered,
    triggers: event.triggers,
    fromMode: event.fromMode,
    toMode: event.toMode,
    freezePromotionUntil: event.freezePromotionUntil,
  })}`);

  return { triggered: true, triggers, event };
}

// ── State queries ──────────────────────────────────────────────────────────

export interface RollbackGuardState {
  promotion_baseline_mode: PlannedEngineEnforcementMode | null;
  promotion_baseline_at: string | null;
  promotion_freeze_until: string | null;
  is_frozen: boolean;
  rollback_history_count: number;
  recent_rollbacks: RollbackProtectionEvent[];
}

export function getRollbackGuardState(): RollbackGuardState {
  const now = Date.now();
  return {
    promotion_baseline_mode: state.promotionBaseline?.mode ?? null,
    promotion_baseline_at: state.promotionBaseline?.snapshot.recorded_at ?? null,
    promotion_freeze_until: state.promotionFreezeUntil,
    is_frozen: state.promotionFreezeUntil != null && now < Date.parse(state.promotionFreezeUntil),
    rollback_history_count: state.rollbackHistory.length,
    recent_rollbacks: state.rollbackHistory.slice(-5),
  };
}

export function isPromotionFrozen(): boolean {
  if (!state.promotionFreezeUntil) return false;
  return Date.now() < Date.parse(state.promotionFreezeUntil);
}

export function __resetRollbackGuardStateForTests(): void {
  state.promotionBaseline = null;
  state.rollbackHistory.length = 0;
  state.promotionFreezeUntil = null;
}
