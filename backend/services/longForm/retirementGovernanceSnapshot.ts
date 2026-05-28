/**
 * retirementGovernanceSnapshot.ts
 *
 * Phase 8.9 — Single canonical dashboard payload for retirement
 * governance. Aggregates everything operators / governance / SRE / admin
 * dashboards need to see at a glance:
 *
 *   - current enforcement mode
 *   - decommission gate status
 *   - rate metrics (fallback / timeout / convergence)
 *   - unstable content types
 *   - projected retirement date
 *   - promotion recommendation
 *   - rollback risk
 *   - active self-healing actions
 *   - blocker trajectory
 *
 * Sourced from existing reports — this module contains NO new
 * sampling. It's a pure aggregator.
 */

import { resolveEnforcementMode } from './plannedEngineEnforcementMode';
import { computeCompatibilityCoreRetirementReport } from './compatibilityCoreRetirementReport';
import { evaluateDecommissionGate } from './compatibilityCoreDecommissionGate';
import { analyzeDecommissionTrend, type BlockerTrajectory } from './decommissionTrendAnalyzer';
import { evaluatePromotionEngine, getEnforcementPromotionEngineState } from './enforcementPromotionEngine';
import { getRollbackGuardState } from './enforcementRollbackGuard';
import { getSelfHealingState, type SelfHealingAction } from './selfHealingCoordinator';
import { getCompatibilityCoreTrafficReport } from './compatibilityCoreTrafficIsolation';
// Phase 9.3 — Real convergence rate from the in-process aggregator.
import { getConvergenceRate } from './convergenceTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export interface RetirementGovernanceSnapshot {
  generated_at: string;
  currentMode: string;
  modeResolutionReason: string;
  retirementReadiness: {
    score: number;
    risk: 'low' | 'moderate' | 'high' | 'critical';
    gateMode: 'NOT_READY' | 'LIMITED_NON_PROD' | 'STAGED_PRODUCTION' | 'READY_FOR_RETIREMENT';
  };
  fallbackRate: number;
  timeoutRate: number;
  convergenceRate: number;
  unstableContentTypes: string[];
  projectedRetirementDate: string | null;
  promotionRecommendation: {
    decision: 'promote' | 'hold' | 'demote';
    fromMode: string;
    toMode: string;
    confidence: 'low' | 'moderate' | 'high';
    shouldApply: boolean;
    reasoning: string[];
    blockers: string[];
  };
  rollbackRisk: {
    isFrozen: boolean;
    promotionFreezeUntil: string | null;
    recentRollbackCount: number;
    lastTriggers: string[];
  };
  activeSelfHealingActions: Array<{
    action_id: string;
    trigger: string;
    correctiveAction: string;
    targetContentTypes: string[];
    expiresAt: string;
  }>;
  blockerTrajectory: BlockerTrajectory[];
  compatibilityCoreTraffic: {
    unavoidable_share_pct: number;
    avoidable_share_pct: number;
    total_requests: number;
  };
}

// ── Sourcing ─────────────────────────────────────────────────────────────────

function computeConvergenceRateApprox(): number {
  // Phase 9.3 — Now sourced from the real convergence aggregator. Falls
  // back to 0 when no samples have been recorded yet (first-boot state).
  return getConvergenceRate();
}

// ── Public API ──────────────────────────────────────────────────────────────

export function buildRetirementGovernanceSnapshot(): RetirementGovernanceSnapshot {
  const enforcement = resolveEnforcementMode();
  const retirementReport = computeCompatibilityCoreRetirementReport();
  const gate = evaluateDecommissionGate({ retirementReport });
  const trend = analyzeDecommissionTrend({ skipCapture: false, gateResult: gate });
  const promotion = evaluatePromotionEngine({ currentMode: enforcement.mode, gateResult: gate, trendReport: trend });
  const rollback = getRollbackGuardState();
  const healing = getSelfHealingState();
  const traffic = getCompatibilityCoreTrafficReport();

  // Extract observed rates from gate checks (string form like "14.90%").
  const fallbackCheck = gate.checks.find((c) => c.name === 'fallback_rate');
  const timeoutCheck = gate.checks.find((c) => c.name === 'timeout_rate');
  const fallbackRate = parseFloat((fallbackCheck?.observed ?? '0%').replace('%', '')) / 100;
  const timeoutRate = parseFloat((timeoutCheck?.observed ?? '0%').replace('%', '')) / 100;

  const lastTriggers = rollback.recent_rollbacks.flatMap((r) => r.triggers);

  return {
    generated_at: new Date().toISOString(),
    currentMode: enforcement.mode,
    modeResolutionReason: enforcement.reason,
    retirementReadiness: {
      score: retirementReport.retirementReadinessScore,
      risk: retirementReport.estimatedRetirementRisk,
      gateMode: gate.mode,
    },
    fallbackRate,
    timeoutRate,
    convergenceRate: computeConvergenceRateApprox(),
    unstableContentTypes: retirementReport.unstableContentTypes.map((t) => t.content_type),
    projectedRetirementDate: trend.projectedRetirementDate,
    promotionRecommendation: {
      decision: promotion.report.decision,
      fromMode: promotion.report.fromMode,
      toMode: promotion.report.toMode,
      confidence: promotion.report.confidence,
      shouldApply: promotion.shouldApply,
      reasoning: promotion.report.reasoning,
      blockers: promotion.report.blockers,
    },
    rollbackRisk: {
      isFrozen: rollback.is_frozen,
      promotionFreezeUntil: rollback.promotion_freeze_until,
      recentRollbackCount: rollback.rollback_history_count,
      lastTriggers,
    },
    activeSelfHealingActions: healing.active_actions.map((a: SelfHealingAction) => ({
      action_id: a.action_id,
      trigger: a.trigger,
      correctiveAction: a.correctiveAction,
      targetContentTypes: a.targetContentTypes,
      expiresAt: a.expiresAt,
    })),
    blockerTrajectory: trend.blockerTrajectory,
    compatibilityCoreTraffic: {
      unavoidable_share_pct: traffic.unavoidable_share_pct,
      avoidable_share_pct: traffic.avoidable_share_pct,
      total_requests: traffic.total_requests,
    },
  };
}
