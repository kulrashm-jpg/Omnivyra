/**
 * selfHealingEffectivenessEvaluator.ts
 *
 * Phase 9.8 — Quantifies whether self-healing actions actually moved
 * the metrics they were meant to fix.
 *
 * Each `SelfHealingAction` declares a `trigger` (e.g.
 * "rising_timeout_cluster") and a `correctiveAction`. This module
 * captures a baseline sample BEFORE the action takes effect, then
 * compares post-action metrics to compute:
 *
 *   - delta_score              (-1..+1, signed improvement)
 *   - classification           ('effective' | 'neutral' | 'harmful')
 *   - confidence               ('low' | 'moderate' | 'high')
 *   - recommend_auto_disable   (true when the action class is harmful
 *                              with high confidence)
 *
 * Aggregate reports drive: (a) the retirement timeline (Phase 9.9) and
 * (b) the auto-disable registry that the coordinator reads BEFORE
 * dispatching a new action of the same kind.
 *
 * No external sampling — re-uses existing telemetry aggregators.
 */

import { reviewActionEffectiveness } from './selfHealingCoordinator';
import type { SelfHealingAction, SelfHealingTrigger, SelfHealingCorrectiveAction } from './selfHealingCoordinator';
import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';
import { getAggregateRecoveryCostReport } from './recoveryCostTelemetry';
import { getConvergenceAggregateReport } from './convergenceTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export type EffectivenessClass = 'effective' | 'neutral' | 'harmful';

export interface EffectivenessSample {
  recorded_at: string;
  overall_success_rate: number;       // planned engine success rate (0..1)
  overall_fallback_rate: number;      // 0..1
  retry_amplification: number;        // 1.0 = none, higher = worse
  convergence_rate: number;           // 0..1
  abort_rate: number;                 // 0..1
}

export interface EffectivenessEvaluation {
  action_id: string;
  trigger: SelfHealingTrigger;
  correctiveAction: SelfHealingCorrectiveAction;
  targetContentTypes: string[];
  baseline: EffectivenessSample | null;
  post_action: EffectivenessSample | null;
  delta_score: number;                // -1..+1
  classification: EffectivenessClass;
  confidence: 'low' | 'moderate' | 'high';
  reasoning: string[];
  /** True if the same {trigger,action} pair has been harmful repeatedly. */
  recommend_auto_disable: boolean;
}

export interface SelfHealingEffectivenessReport {
  total_evaluations: number;
  effective_count: number;
  neutral_count: number;
  harmful_count: number;
  by_action: Array<{
    correctiveAction: SelfHealingCorrectiveAction;
    evaluations: number;
    avg_delta_score: number;
    harmful_share: number;
    auto_disabled: boolean;
  }>;
  by_trigger: Array<{
    trigger: SelfHealingTrigger;
    evaluations: number;
    avg_delta_score: number;
    most_effective_action: SelfHealingCorrectiveAction | null;
  }>;
  auto_disabled_actions: SelfHealingCorrectiveAction[];
  recent_evaluations: EffectivenessEvaluation[];
}

// ── State ────────────────────────────────────────────────────────────────────

interface EvaluatorState {
  baselines: Map<string, EffectivenessSample>;          // action_id → baseline
  evaluations: EffectivenessEvaluation[];               // rolling buffer
  perActionStats: Map<SelfHealingCorrectiveAction, {
    evaluations: number;
    deltaSum: number;
    harmfulCount: number;
    consecutiveHarmful: number;
  }>;
  perTriggerStats: Map<SelfHealingTrigger, {
    evaluations: number;
    deltaSum: number;
    actionScores: Map<SelfHealingCorrectiveAction, number>;
  }>;
  autoDisabled: Set<SelfHealingCorrectiveAction>;
}

const state: EvaluatorState = {
  baselines: new Map(),
  evaluations: [],
  perActionStats: new Map(),
  perTriggerStats: new Map(),
  autoDisabled: new Set(),
};

const RECENT_CAP = 100;
const AUTO_DISABLE_HARMFUL_THRESHOLD = 3; // 3 consecutive harmful evaluations of the same action

// ── Sampling helpers ─────────────────────────────────────────────────────────

function takeSample(): EffectivenessSample {
  const usage = getCompatibilityCoreUsageReport();
  const cost = getAggregateRecoveryCostReport();
  const convergence = getConvergenceAggregateReport();
  const overallSuccess = usage.total_attempts_all_types > 0
    ? usage.total_planned_success / usage.total_attempts_all_types
    : 0;
  const overallFallback = usage.total_attempts_all_types > 0
    ? usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types
    : 0;
  return {
    recorded_at: new Date().toISOString(),
    overall_success_rate: Number(overallSuccess.toFixed(4)),
    overall_fallback_rate: Number(overallFallback.toFixed(4)),
    retry_amplification: Number((cost.averageRetryAmplification ?? 1).toFixed(3)),
    convergence_rate: convergence.convergenceRate,
    abort_rate: convergence.abortRate,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Call when a self-healing action is activated. Captures baseline. */
export function captureBaselineForAction(action: SelfHealingAction): EffectivenessSample {
  const sample = takeSample();
  state.baselines.set(action.action_id, sample);
  return sample;
}

/**
 * Call when a self-healing action expires or is reviewed. Compares the
 * current sample to the baseline and records an evaluation. Updates
 * per-action / per-trigger stats and may auto-disable a harmful action.
 */
export function evaluateActionEffectiveness(action: SelfHealingAction): EffectivenessEvaluation {
  const baseline = state.baselines.get(action.action_id) ?? null;
  const post = takeSample();

  const { delta, classification, reasoning, confidence } = scoreEffectiveness(baseline, post, action.trigger);

  const evalRecord: EffectivenessEvaluation = {
    action_id: action.action_id,
    trigger: action.trigger,
    correctiveAction: action.correctiveAction,
    targetContentTypes: action.targetContentTypes,
    baseline,
    post_action: post,
    delta_score: delta,
    classification,
    confidence,
    reasoning,
    recommend_auto_disable: false,
  };

  // Update per-action stats.
  const actionStats = state.perActionStats.get(action.correctiveAction) ?? {
    evaluations: 0, deltaSum: 0, harmfulCount: 0, consecutiveHarmful: 0,
  };
  actionStats.evaluations += 1;
  actionStats.deltaSum += delta;
  if (classification === 'harmful') {
    actionStats.harmfulCount += 1;
    actionStats.consecutiveHarmful += 1;
  } else {
    actionStats.consecutiveHarmful = 0;
  }
  state.perActionStats.set(action.correctiveAction, actionStats);

  // Update per-trigger stats.
  const triggerStats = state.perTriggerStats.get(action.trigger) ?? {
    evaluations: 0, deltaSum: 0, actionScores: new Map<SelfHealingCorrectiveAction, number>(),
  };
  triggerStats.evaluations += 1;
  triggerStats.deltaSum += delta;
  triggerStats.actionScores.set(
    action.correctiveAction,
    (triggerStats.actionScores.get(action.correctiveAction) ?? 0) + delta,
  );
  state.perTriggerStats.set(action.trigger, triggerStats);

  // Auto-disable rule: if the same action class has been harmful for
  // N consecutive evaluations at moderate+ confidence, disable it.
  if (
    actionStats.consecutiveHarmful >= AUTO_DISABLE_HARMFUL_THRESHOLD
    && confidence !== 'low'
  ) {
    state.autoDisabled.add(action.correctiveAction);
    evalRecord.recommend_auto_disable = true;
    evalRecord.reasoning.push(
      `Auto-disable recommended: ${actionStats.consecutiveHarmful} consecutive harmful evaluations of ${action.correctiveAction}.`,
    );
  }

  // Mark on the coordinator so the next active-actions snapshot reflects
  // the classification (effective/partial/ineffective ≈ effective/neutral/harmful).
  reviewActionEffectiveness(
    action.action_id,
    classification === 'effective' ? 'effective'
      : classification === 'harmful' ? 'ineffective'
      : 'partial',
  );

  // Telemetry.
  console.warn(`[longform-self-healing-effectiveness] ${JSON.stringify({
    event: 'LONGFORM_SELF_HEALING_EFFECTIVENESS_EVALUATION',
    action_id: evalRecord.action_id,
    trigger: evalRecord.trigger,
    correctiveAction: evalRecord.correctiveAction,
    classification: evalRecord.classification,
    delta_score: evalRecord.delta_score,
    confidence: evalRecord.confidence,
    recommend_auto_disable: evalRecord.recommend_auto_disable,
    timestamp: post.recorded_at,
  })}`);

  state.evaluations.push(evalRecord);
  while (state.evaluations.length > RECENT_CAP) state.evaluations.shift();
  state.baselines.delete(action.action_id);
  return evalRecord;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score in [-1..+1]. Positive = the metrics targeted by the trigger
 * improved after the action. We weight differently per trigger:
 *
 *   timeout_cluster / retry_amplification → success rate + recovery cost
 *   unstable_planner                       → convergence + success rate
 *   grounding_degradation                  → convergence
 *   fallback_regression                    → fallback rate
 *   repetition_surge                       → convergence (proxy for diversity)
 */
function scoreEffectiveness(
  baseline: EffectivenessSample | null,
  post: EffectivenessSample,
  trigger: SelfHealingTrigger,
): { delta: number; classification: EffectivenessClass; reasoning: string[]; confidence: 'low' | 'moderate' | 'high' } {
  const reasoning: string[] = [];
  if (!baseline) {
    reasoning.push('No baseline captured — confidence is low.');
    return { delta: 0, classification: 'neutral', reasoning, confidence: 'low' };
  }
  const deltaSuccess = post.overall_success_rate - baseline.overall_success_rate;
  const deltaFallback = baseline.overall_fallback_rate - post.overall_fallback_rate; // lower is better
  // Lower retry amplification = better; normalize so +1 means halving amplification.
  const deltaCost = (baseline.retry_amplification - post.retry_amplification) / Math.max(baseline.retry_amplification, 1);
  const deltaConvergence = post.convergence_rate - baseline.convergence_rate;
  const deltaAbort = baseline.abort_rate - post.abort_rate;

  let weighted = 0;
  switch (trigger) {
    case 'rising_timeout_cluster':
      weighted = 0.5 * deltaSuccess + 0.3 * deltaCost + 0.2 * deltaConvergence;
      reasoning.push(`Δsuccess=${pct(deltaSuccess)}, Δcost=${pct(deltaCost)}, Δconvergence=${pct(deltaConvergence)}.`);
      break;
    case 'retry_amplification_spike':
      weighted = 0.5 * deltaSuccess + 0.4 * deltaCost + 0.1 * deltaAbort;
      reasoning.push(`Δsuccess=${pct(deltaSuccess)}, Δcost=${pct(deltaCost)}, Δabort=${pct(deltaAbort)}.`);
      break;
    case 'unstable_planner':
      weighted = 0.6 * deltaConvergence + 0.4 * deltaSuccess;
      reasoning.push(`Δconvergence=${pct(deltaConvergence)}, Δsuccess=${pct(deltaSuccess)}.`);
      break;
    case 'grounding_degradation':
      weighted = 0.7 * deltaConvergence + 0.3 * deltaAbort;
      reasoning.push(`Δconvergence=${pct(deltaConvergence)}, Δabort=${pct(deltaAbort)}.`);
      break;
    case 'fallback_regression':
      weighted = 0.7 * deltaFallback + 0.3 * deltaSuccess;
      reasoning.push(`Δfallback=${pct(deltaFallback)}, Δsuccess=${pct(deltaSuccess)}.`);
      break;
    case 'repetition_surge':
      weighted = 0.6 * deltaConvergence + 0.4 * deltaAbort;
      reasoning.push(`Δconvergence=${pct(deltaConvergence)}, Δabort=${pct(deltaAbort)}.`);
      break;
  }

  // Clamp to [-1..+1].
  const delta = Math.max(-1, Math.min(1, weighted));

  let classification: EffectivenessClass;
  if (delta >= 0.05) classification = 'effective';
  else if (delta <= -0.05) classification = 'harmful';
  else classification = 'neutral';

  // Confidence is a function of (a) baseline sample size proxy and (b)
  // magnitude of the delta.
  let confidence: 'low' | 'moderate' | 'high';
  const magnitude = Math.abs(delta);
  if (magnitude >= 0.15) confidence = 'high';
  else if (magnitude >= 0.05) confidence = 'moderate';
  else confidence = 'low';

  reasoning.push(`Weighted delta=${delta.toFixed(3)} → ${classification} (${confidence}).`);
  return { delta: Number(delta.toFixed(4)), classification, reasoning, confidence };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// ── Aggregate report ─────────────────────────────────────────────────────────

export function getSelfHealingEffectivenessReport(): SelfHealingEffectivenessReport {
  const byAction = Array.from(state.perActionStats.entries()).map(([correctiveAction, s]) => ({
    correctiveAction,
    evaluations: s.evaluations,
    avg_delta_score: s.evaluations > 0 ? Number((s.deltaSum / s.evaluations).toFixed(4)) : 0,
    harmful_share: s.evaluations > 0 ? Number((s.harmfulCount / s.evaluations).toFixed(4)) : 0,
    auto_disabled: state.autoDisabled.has(correctiveAction),
  }));
  const byTrigger = Array.from(state.perTriggerStats.entries()).map(([trigger, s]) => {
    let best: SelfHealingCorrectiveAction | null = null;
    let bestScore = -Infinity;
    for (const [action, score] of s.actionScores.entries()) {
      if (score > bestScore) { bestScore = score; best = action; }
    }
    return {
      trigger,
      evaluations: s.evaluations,
      avg_delta_score: s.evaluations > 0 ? Number((s.deltaSum / s.evaluations).toFixed(4)) : 0,
      most_effective_action: best,
    };
  });
  let effective = 0, neutral = 0, harmful = 0;
  for (const e of state.evaluations) {
    if (e.classification === 'effective') effective += 1;
    else if (e.classification === 'harmful') harmful += 1;
    else neutral += 1;
  }
  return {
    total_evaluations: state.evaluations.length,
    effective_count: effective,
    neutral_count: neutral,
    harmful_count: harmful,
    by_action: byAction,
    by_trigger: byTrigger,
    auto_disabled_actions: Array.from(state.autoDisabled),
    recent_evaluations: state.evaluations.slice(-25),
  };
}

/**
 * Called by the self-healing coordinator BEFORE dispatching a new
 * action. Returns true if the given action class has been auto-disabled
 * by repeated harmful evaluations.
 */
export function isActionAutoDisabled(correctiveAction: SelfHealingCorrectiveAction): boolean {
  return state.autoDisabled.has(correctiveAction);
}

/** Allows operators to clear an auto-disable (after a code fix). */
export function clearAutoDisable(correctiveAction: SelfHealingCorrectiveAction): void {
  state.autoDisabled.delete(correctiveAction);
  const s = state.perActionStats.get(correctiveAction);
  if (s) s.consecutiveHarmful = 0;
}

export function __resetSelfHealingEffectivenessForTests(): void {
  state.baselines.clear();
  state.evaluations.length = 0;
  state.perActionStats.clear();
  state.perTriggerStats.clear();
  state.autoDisabled.clear();
}
