/**
 * selfHealingCoordinator.ts
 *
 * Phase 8.8 — Detects regression signatures and applies transient
 * corrective actions without operator intervention.
 *
 * Detections are pure functions over the existing telemetry aggregators
 * (no new sampling required). Actions are recorded as
 * `SelfHealingAction` records that other subsystems consult before
 * generation runs (e.g. "tighten the planner for this content type for
 * the next 30 minutes").
 *
 * The coordinator never changes env vars or persistent config — it
 * applies SOFT, time-bounded overlays.
 */

import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';
import { getAggregateRecoveryCostReport } from './recoveryCostTelemetry';
import { getAggregateRuntimeEfficiencyReport } from './runtimeEfficiencyOptimizer';
import { getCompatibilityCoreTrafficReport } from './compatibilityCoreTrafficIsolation';
import { freezePromotionFromSelfHealing } from './selfHealingPromotionBridge';

// ── Public types ─────────────────────────────────────────────────────────────

export type SelfHealingTrigger =
  | 'rising_timeout_cluster'
  | 'retry_amplification_spike'
  | 'unstable_planner'
  | 'grounding_degradation'
  | 'repetition_surge'
  | 'fallback_regression';

export type SelfHealingCorrectiveAction =
  | 'tighten_planner'
  | 'reduce_section_sizing'
  | 'increase_compression_bias'
  | 'increase_grounding_strictness'
  | 'freeze_promotion'
  | 'stabilize_content_type';

export interface SelfHealingAction {
  action_id: string;
  trigger: SelfHealingTrigger;
  correctiveAction: SelfHealingCorrectiveAction;
  /** Content type(s) the action applies to ('*' for global). */
  targetContentTypes: string[];
  /** When the action started. */
  activatedAt: string;
  /** When the action automatically expires. */
  expiresAt: string;
  /** Free-text justification for the action. */
  triggerDetail: string;
  /** Effectiveness measurement once the action expires (null while active). */
  effectiveness: 'effective' | 'partial' | 'ineffective' | null;
  /** Rollback condition — when met, the action ends immediately. */
  rollbackCondition: string;
}

// ── Active actions ledger ───────────────────────────────────────────────────

interface ActionsState {
  active: Map<string, SelfHealingAction>;
  history: SelfHealingAction[];
}

const state: ActionsState = {
  active: new Map(),
  history: [],
};

const DEFAULT_ACTION_DURATION_MS = 30 * 60 * 1000;     // 30 minutes
const FALLBACK_REGRESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour for fallback regressions

function stableActionId(trigger: SelfHealingTrigger, target: string): string {
  return `heal_${trigger}_${target}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isActionExpired(action: SelfHealingAction): boolean {
  return Date.now() >= Date.parse(action.expiresAt);
}

function ageOutExpiredActions(): void {
  for (const [id, action] of state.active.entries()) {
    if (isActionExpired(action)) {
      // Mark as effective by default — operator can override later via
      // reviewActionEffectiveness().
      const completed: SelfHealingAction = { ...action, effectiveness: action.effectiveness ?? 'partial' };
      state.active.delete(id);
      state.history.push(completed);
      while (state.history.length > 200) state.history.shift();
    }
  }
}

function recordAction(action: SelfHealingAction): void {
  state.active.set(action.action_id, action);
  emitSelfHealingTelemetry(action);
}

function emitSelfHealingTelemetry(action: SelfHealingAction): void {
  console.warn(`[longform-self-healing] ${JSON.stringify({
    event: 'LONGFORM_SELF_HEALING_ACTION',
    action_id: action.action_id,
    trigger: action.trigger,
    correctiveAction: action.correctiveAction,
    targetContentTypes: action.targetContentTypes,
    expiresAt: action.expiresAt,
    triggerDetail: action.triggerDetail,
    timestamp: action.activatedAt,
  })}`);
}

// ── Detection rules ─────────────────────────────────────────────────────────

interface DetectionOutcome {
  triggered: boolean;
  detail?: string;
  targetContentTypes?: string[];
}

function detectRisingTimeoutCluster(): DetectionOutcome {
  const traffic = getCompatibilityCoreTrafficReport();
  const timeoutCategory = traffic.by_category.find((c) => c.category === 'timeout_driven');
  if (!timeoutCategory) return { triggered: false };
  if (timeoutCategory.count >= 5 && timeoutCategory.share_pct >= 20) {
    // Which content types are driving it?
    return {
      triggered: true,
      detail: `${timeoutCategory.count} timeout-driven compat-core requests (${timeoutCategory.share_pct}% of total).`,
      targetContentTypes: traffic.by_content_type.slice(0, 3).map((t) => t.content_type),
    };
  }
  return { triggered: false };
}

function detectRetryAmplificationSpike(): DetectionOutcome {
  const cost = getAggregateRecoveryCostReport();
  if (cost.averageRetryAmplification >= 1.8) {
    return {
      triggered: true,
      detail: `Retry amplification avg ${cost.averageRetryAmplification} ≥ 1.8.`,
      targetContentTypes: cost.perContentType
        .filter((t) => t.average_amplification >= 1.8)
        .map((t) => t.content_type),
    };
  }
  return { triggered: false };
}

function detectUnstablePlanner(): DetectionOutcome {
  const traffic = getCompatibilityCoreTrafficReport();
  const plannerCategory = traffic.by_category.find((c) => c.category === 'planner_driven');
  if (!plannerCategory) return { triggered: false };
  if (plannerCategory.count >= 3) {
    return {
      triggered: true,
      detail: `${plannerCategory.count} planner-driven compat-core requests detected.`,
      targetContentTypes: traffic.by_content_type.slice(0, 5).map((t) => t.content_type),
    };
  }
  return { triggered: false };
}

function detectGroundingDegradation(): DetectionOutcome {
  const efficiency = getAggregateRuntimeEfficiencyReport();
  if (efficiency.total_articles >= 10 && efficiency.overall_cache_hit_rate < 0.4) {
    return {
      triggered: true,
      detail: `Cache hit rate ${efficiency.overall_cache_hit_rate} is unusually low — likely grounding fragment churn.`,
      targetContentTypes: ['*'],
    };
  }
  return { triggered: false };
}

function detectFallbackRegression(): DetectionOutcome {
  const usage = getCompatibilityCoreUsageReport();
  if (usage.total_attempts_all_types >= 50) {
    const fallbackRate = usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types;
    if (fallbackRate >= 0.20) {
      return {
        triggered: true,
        detail: `Fallback rate ${(fallbackRate * 100).toFixed(2)}% ≥ 20%.`,
        targetContentTypes: usage.per_content_type
          .filter((t) => t.fallback_rate >= 0.30)
          .map((t) => t.content_type),
      };
    }
  }
  return { triggered: false };
}

// ── Action selection ────────────────────────────────────────────────────────

function correctiveActionFor(trigger: SelfHealingTrigger): SelfHealingCorrectiveAction {
  switch (trigger) {
    case 'rising_timeout_cluster': return 'reduce_section_sizing';
    case 'retry_amplification_spike': return 'increase_compression_bias';
    case 'unstable_planner': return 'tighten_planner';
    case 'grounding_degradation': return 'increase_grounding_strictness';
    case 'repetition_surge': return 'stabilize_content_type';
    case 'fallback_regression': return 'freeze_promotion';
  }
}

function rollbackConditionFor(trigger: SelfHealingTrigger): string {
  switch (trigger) {
    case 'rising_timeout_cluster': return 'timeout-driven compat-core requests drop below 5 OR action expires';
    case 'retry_amplification_spike': return 'retry amplification avg drops below 1.5 OR action expires';
    case 'unstable_planner': return 'planner-driven compat-core requests drop to 0 OR action expires';
    case 'grounding_degradation': return 'cache hit rate rises above 0.6 OR action expires';
    case 'repetition_surge': return 'repetition score drops below 30 OR action expires';
    case 'fallback_regression': return 'fallback rate drops below 5% OR action expires';
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RunSelfHealingResult {
  detections: Array<{ trigger: SelfHealingTrigger; detection: DetectionOutcome }>;
  actionsApplied: SelfHealingAction[];
  activeActionsAfter: SelfHealingAction[];
}

export function runSelfHealingCycle(): RunSelfHealingResult {
  ageOutExpiredActions();
  const detectors: Array<{ trigger: SelfHealingTrigger; run: () => DetectionOutcome }> = [
    { trigger: 'rising_timeout_cluster', run: detectRisingTimeoutCluster },
    { trigger: 'retry_amplification_spike', run: detectRetryAmplificationSpike },
    { trigger: 'unstable_planner', run: detectUnstablePlanner },
    { trigger: 'grounding_degradation', run: detectGroundingDegradation },
    { trigger: 'fallback_regression', run: detectFallbackRegression },
  ];
  const detections: RunSelfHealingResult['detections'] = [];
  const actionsApplied: SelfHealingAction[] = [];

  for (const { trigger, run } of detectors) {
    const detection = run();
    detections.push({ trigger, detection });
    if (!detection.triggered) continue;

    // Don't double-apply an action of the same kind on the same target.
    const targets = detection.targetContentTypes && detection.targetContentTypes.length > 0
      ? detection.targetContentTypes
      : ['*'];
    const targetKey = targets.sort().join(',');
    const alreadyActive = Array.from(state.active.values())
      .some((a) => a.trigger === trigger && a.targetContentTypes.sort().join(',') === targetKey);
    if (alreadyActive) continue;

    const correctiveAction = correctiveActionFor(trigger);
    const duration = trigger === 'fallback_regression' ? FALLBACK_REGRESSION_DURATION_MS : DEFAULT_ACTION_DURATION_MS;
    const action: SelfHealingAction = {
      action_id: stableActionId(trigger, targetKey),
      trigger,
      correctiveAction,
      targetContentTypes: targets,
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + duration).toISOString(),
      triggerDetail: detection.detail ?? '',
      effectiveness: null,
      rollbackCondition: rollbackConditionFor(trigger),
    };
    recordAction(action);
    actionsApplied.push(action);

    // freeze_promotion side-effect: notify rollback guard.
    if (correctiveAction === 'freeze_promotion') {
      freezePromotionFromSelfHealing(action.expiresAt, action.triggerDetail);
    }
  }

  return {
    detections,
    actionsApplied,
    activeActionsAfter: Array.from(state.active.values()),
  };
}

// ── Query API used by other subsystems ──────────────────────────────────────

/** Currently-active healing actions for the given content type (plus '*'). */
export function getActiveHealingActionsForContentType(contentType: string): SelfHealingAction[] {
  ageOutExpiredActions();
  return Array.from(state.active.values()).filter(
    (a) => a.targetContentTypes.includes(contentType) || a.targetContentTypes.includes('*'),
  );
}

export function hasActiveAction(action: SelfHealingCorrectiveAction, contentType: string): boolean {
  return getActiveHealingActionsForContentType(contentType).some((a) => a.correctiveAction === action);
}

export interface SelfHealingState {
  active_count: number;
  active_actions: SelfHealingAction[];
  history_count: number;
  recent_history: SelfHealingAction[];
}

export function getSelfHealingState(): SelfHealingState {
  ageOutExpiredActions();
  return {
    active_count: state.active.size,
    active_actions: Array.from(state.active.values()),
    history_count: state.history.length,
    recent_history: state.history.slice(-20),
  };
}

export function reviewActionEffectiveness(actionId: string, effectiveness: 'effective' | 'partial' | 'ineffective'): void {
  const active = state.active.get(actionId);
  if (active) {
    active.effectiveness = effectiveness;
    state.active.set(actionId, active);
    return;
  }
  const idx = state.history.findIndex((a) => a.action_id === actionId);
  if (idx >= 0) state.history[idx].effectiveness = effectiveness;
}

export function __resetSelfHealingStateForTests(): void {
  state.active.clear();
  state.history.length = 0;
}
