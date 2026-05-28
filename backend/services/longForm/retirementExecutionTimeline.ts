/**
 * retirementExecutionTimeline.ts
 *
 * Phase 9.9 — Six-stage retirement execution timeline.
 *
 * The decommission gate (Phase 6.7) tells us the structural readiness
 * level. The unlink analyzer (Phase 9.6) tells us the code-level
 * deletion readiness. The shadow shutdown report (Phase 9.7) tells us
 * how well the engine survives without the fallback at request time.
 *
 * This module folds all three (plus self-healing effectiveness from
 * Phase 9.8) into a single SIX-stage timeline so operators have a
 * concrete plan, not just a score.
 *
 * Stages, in order:
 *   1. PHASED_STAGING           — observe-only / prefer planned in non-prod
 *   2. LIMITED_PRODUCTION        — planned required for safe content types
 *   3. NON_CRITICAL_FULL         — planned required for all non-critical types
 *   4. CRITICAL_GRADUAL          — planned required for critical types under canary
 *   5. FULL_RETIREMENT_READY     — no compatibility-core traffic, ready to unlink
 *   6. COMPATIBILITY_CORE_UNLINK — code physically removed
 *
 * Each stage carries its entrance criteria, current status, blockers,
 * and what the operator needs to do to advance.
 */

import { evaluateDecommissionGate } from './compatibilityCoreDecommissionGate';
import {
  analyzeCompatibilityCoreUnlinkReadiness,
  makeUnknownUnlinkReport,
  type CompatibilityCoreCodeMap,
  type CompatibilityCoreUnlinkReadinessReport,
} from './compatibilityCoreUnlinkAnalyzer';
import { getShadowShutdownReport, isShadowShutdownSafeToAdvance } from './compatibilityCoreShadowShutdown';
import { getSelfHealingEffectivenessReport } from './selfHealingEffectivenessEvaluator';
import { resolveEnforcementMode } from './plannedEngineEnforcementMode';
import { getCompatibilityCoreUsageReport } from './plannedEngineStabilityTelemetry';
import { getConvergenceAggregateReport } from './convergenceTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export type RetirementStageId =
  | 'PHASED_STAGING'
  | 'LIMITED_PRODUCTION'
  | 'NON_CRITICAL_FULL'
  | 'CRITICAL_GRADUAL'
  | 'FULL_RETIREMENT_READY'
  | 'COMPATIBILITY_CORE_UNLINK';

export type RetirementStageStatus = 'achieved' | 'in_progress' | 'pending' | 'blocked';

export interface RetirementStageEntry {
  stage: RetirementStageId;
  order: number;
  status: RetirementStageStatus;
  entranceCriteria: string[];
  blockers: string[];
  metricsObserved: Record<string, string | number>;
  recommendedActions: string[];
}

export interface RetirementExecutionTimelineSnapshot {
  current_stage: RetirementStageId;
  next_stage: RetirementStageId | null;
  overall_completion_pct: number;
  stages: RetirementStageEntry[];
  generated_at: string;
  inputs: {
    enforcement_mode: string;
    fallback_rate: number;
    convergence_rate: number;
    shadow_shutdown_safe_to_advance: boolean;
    unlink_readiness_score: number;
  };
}

export interface ComputeRetirementTimelineOptions {
  /** Optional offline code-map for the unlink analyzer. */
  codeMap?: CompatibilityCoreCodeMap;
  /** Override the unlink report (e.g. for what-if simulations). */
  unlinkReport?: CompatibilityCoreUnlinkReadinessReport;
}

// ── Stage definitions ────────────────────────────────────────────────────────

const STAGE_ORDER: RetirementStageId[] = [
  'PHASED_STAGING',
  'LIMITED_PRODUCTION',
  'NON_CRITICAL_FULL',
  'CRITICAL_GRADUAL',
  'FULL_RETIREMENT_READY',
  'COMPATIBILITY_CORE_UNLINK',
];

const STAGE_DEFINITIONS: Record<RetirementStageId, { entranceCriteria: string[] }> = {
  PHASED_STAGING: {
    entranceCriteria: [
      'Planned engine deployed and observing traffic.',
      'Compatibility-core fallback runs normally; no behavior change.',
    ],
  },
  LIMITED_PRODUCTION: {
    entranceCriteria: [
      'Decommission gate ≥ LIMITED_NON_PROD.',
      'Convergence rate ≥ 60%.',
      'Fallback rate ≤ 5%.',
    ],
  },
  NON_CRITICAL_FULL: {
    entranceCriteria: [
      'Decommission gate ≥ STAGED_PRODUCTION.',
      'Per-content-type ladder shows all non-critical types at PLANNED_REQUIRED_NON_CRITICAL or higher.',
      'Fallback rate ≤ 2%.',
    ],
  },
  CRITICAL_GRADUAL: {
    entranceCriteria: [
      'Enforcement mode ≥ PLANNED_REQUIRED_ALL.',
      'Shadow shutdown bypass failure rate < 2%.',
      'Self-healing actions effective or auto-disabled (no consecutive harmful).',
    ],
  },
  FULL_RETIREMENT_READY: {
    entranceCriteria: [
      'Decommission gate = READY_FOR_RETIREMENT.',
      'Shadow shutdown safe-to-advance (≥ 100 bypasses, < 2% failure).',
      'Enforcement mode = NO_COMPATIBILITY_CORE.',
      'Fallback rate ≤ 0.5%.',
    ],
  },
  COMPATIBILITY_CORE_UNLINK: {
    entranceCriteria: [
      'Unlink readiness score ≥ 90.',
      'No blocking dependencies in the code map.',
      'All compatibility-core modules classified as fallback-only / test-only / dead.',
    ],
  },
};

// ── Stage status computation ─────────────────────────────────────────────────

interface StageInputs {
  enforcementMode: string;
  fallbackRate: number;
  convergenceRate: number;
  shadowSafe: boolean;
  shadowReportFailureRate: number;
  decommissionMode: string;
  unlinkReadinessScore: number;
  unlinkBlockingCount: number;
  selfHealingHarmfulShare: number;
  selfHealingAutoDisabled: number;
}

function evalPhasedStaging(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  // This is the floor — always achieved unless something is catastrophically wrong.
  if (i.fallbackRate >= 0.5 || i.convergenceRate < 0.1) {
    return { status: 'blocked', blockers: ['Planned engine has not produced stable traffic yet.'] };
  }
  return { status: 'achieved', blockers: [] };
}

function evalLimitedProduction(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (i.decommissionMode === 'NOT_READY') blockers.push('Decommission gate = NOT_READY.');
  if (i.convergenceRate < 0.6) blockers.push(`Convergence rate ${(i.convergenceRate * 100).toFixed(1)}% < 60%.`);
  if (i.fallbackRate > 0.05) blockers.push(`Fallback rate ${(i.fallbackRate * 100).toFixed(1)}% > 5%.`);
  if (blockers.length > 0) return { status: 'pending', blockers };
  return { status: 'achieved', blockers: [] };
}

function evalNonCriticalFull(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (i.decommissionMode === 'NOT_READY' || i.decommissionMode === 'LIMITED_NON_PROD') {
    blockers.push(`Decommission gate = ${i.decommissionMode} (need ≥ STAGED_PRODUCTION).`);
  }
  if (i.fallbackRate > 0.02) blockers.push(`Fallback rate ${(i.fallbackRate * 100).toFixed(1)}% > 2%.`);
  if (i.enforcementMode === 'OBSERVE_ONLY' || i.enforcementMode === 'PREFER_PLANNED') {
    blockers.push(`Enforcement mode = ${i.enforcementMode} (need PLANNED_REQUIRED_* family).`);
  }
  if (blockers.length > 0) return { status: 'pending', blockers };
  return { status: 'achieved', blockers: [] };
}

function evalCriticalGradual(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (i.enforcementMode !== 'PLANNED_REQUIRED_ALL' && i.enforcementMode !== 'NO_COMPATIBILITY_CORE') {
    blockers.push(`Enforcement mode = ${i.enforcementMode} (need PLANNED_REQUIRED_ALL or higher).`);
  }
  if (i.shadowReportFailureRate >= 0.02) {
    blockers.push(`Shadow bypass failure rate ${(i.shadowReportFailureRate * 100).toFixed(1)}% ≥ 2%.`);
  }
  if (i.selfHealingHarmfulShare > 0.2) {
    blockers.push(`Self-healing harmful share ${(i.selfHealingHarmfulShare * 100).toFixed(1)}% > 20%.`);
  }
  if (blockers.length > 0) return { status: 'pending', blockers };
  return { status: 'achieved', blockers: [] };
}

function evalFullRetirementReady(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (i.decommissionMode !== 'READY_FOR_RETIREMENT') {
    blockers.push(`Decommission gate = ${i.decommissionMode} (need READY_FOR_RETIREMENT).`);
  }
  if (!i.shadowSafe) blockers.push('Shadow shutdown not yet safe-to-advance.');
  if (i.enforcementMode !== 'NO_COMPATIBILITY_CORE') {
    blockers.push(`Enforcement mode = ${i.enforcementMode} (need NO_COMPATIBILITY_CORE).`);
  }
  if (i.fallbackRate > 0.005) {
    blockers.push(`Fallback rate ${(i.fallbackRate * 100).toFixed(2)}% > 0.5%.`);
  }
  if (blockers.length > 0) return { status: 'pending', blockers };
  return { status: 'achieved', blockers: [] };
}

function evalCompatibilityCoreUnlink(i: StageInputs): { status: RetirementStageStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (i.unlinkReadinessScore < 90) {
    blockers.push(`Unlink readiness score ${i.unlinkReadinessScore} < 90.`);
  }
  if (i.unlinkBlockingCount > 0) {
    blockers.push(`${i.unlinkBlockingCount} blocking code dependencies remain.`);
  }
  if (blockers.length > 0) return { status: 'pending', blockers };
  return { status: 'achieved', blockers: [] };
}

const EVALUATORS: Record<RetirementStageId, (i: StageInputs) => { status: RetirementStageStatus; blockers: string[] }> = {
  PHASED_STAGING: evalPhasedStaging,
  LIMITED_PRODUCTION: evalLimitedProduction,
  NON_CRITICAL_FULL: evalNonCriticalFull,
  CRITICAL_GRADUAL: evalCriticalGradual,
  FULL_RETIREMENT_READY: evalFullRetirementReady,
  COMPATIBILITY_CORE_UNLINK: evalCompatibilityCoreUnlink,
};

// ── Public computation ───────────────────────────────────────────────────────

export function computeRetirementExecutionTimeline(
  options: ComputeRetirementTimelineOptions = {},
): RetirementExecutionTimelineSnapshot {
  const enforcement = resolveEnforcementMode().mode;
  const usage = getCompatibilityCoreUsageReport();
  const fallbackRate = usage.total_attempts_all_types > 0
    ? usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types
    : 0;
  const convergence = getConvergenceAggregateReport();
  const shadowReport = getShadowShutdownReport();
  const shadowSafe = isShadowShutdownSafeToAdvance();
  const decommission = evaluateDecommissionGate();
  const healing = getSelfHealingEffectivenessReport();
  const unlinkReport = options.unlinkReport
    ?? (options.codeMap
      ? analyzeCompatibilityCoreUnlinkReadiness({ codeMap: options.codeMap })
      : makeUnknownUnlinkReport());

  const harmfulShare = healing.total_evaluations > 0
    ? healing.harmful_count / healing.total_evaluations
    : 0;

  const inputs: StageInputs = {
    enforcementMode: enforcement,
    fallbackRate,
    convergenceRate: convergence.convergenceRate,
    shadowSafe,
    shadowReportFailureRate: shadowReport.bypass_failure_rate,
    decommissionMode: decommission.mode,
    unlinkReadinessScore: unlinkReport.unlinkReadinessScore,
    unlinkBlockingCount: unlinkReport.blockingDependencies.length,
    selfHealingHarmfulShare: harmfulShare,
    selfHealingAutoDisabled: healing.auto_disabled_actions.length,
  };

  // Evaluate each stage; once one is not achieved, subsequent stages are
  // marked 'pending' regardless of their own status (we don't skip).
  const stages: RetirementStageEntry[] = [];
  let firstUnachievedIdx = -1;
  for (let i = 0; i < STAGE_ORDER.length; i += 1) {
    const id = STAGE_ORDER[i];
    const { status, blockers } = EVALUATORS[id](inputs);
    const finalStatus: RetirementStageStatus =
      firstUnachievedIdx === -1 || i === firstUnachievedIdx
        ? status
        : 'pending';
    if (firstUnachievedIdx === -1 && status !== 'achieved') firstUnachievedIdx = i;

    stages.push({
      stage: id,
      order: i + 1,
      status: firstUnachievedIdx >= 0 && i === firstUnachievedIdx
        ? (status === 'achieved' ? 'achieved' : 'in_progress')
        : finalStatus,
      entranceCriteria: STAGE_DEFINITIONS[id].entranceCriteria,
      blockers,
      metricsObserved: metricsForStage(id, inputs),
      recommendedActions: recommendationsForStage(id, blockers),
    });
  }

  const lastAchievedIdx = stages.findLastIndex
    ? stages.findLastIndex((s) => s.status === 'achieved')
    : (() => {
      let idx = -1;
      for (let i = 0; i < stages.length; i += 1) {
        if (stages[i].status === 'achieved') idx = i;
      }
      return idx;
    })();
  const current: RetirementStageId = lastAchievedIdx >= 0
    ? STAGE_ORDER[lastAchievedIdx]
    : 'PHASED_STAGING';
  const nextIdx = lastAchievedIdx + 1;
  const next: RetirementStageId | null = nextIdx < STAGE_ORDER.length
    ? STAGE_ORDER[nextIdx]
    : null;

  const overallCompletionPct = Math.round(((lastAchievedIdx + 1) / STAGE_ORDER.length) * 100);

  return {
    current_stage: current,
    next_stage: next,
    overall_completion_pct: overallCompletionPct,
    stages,
    generated_at: new Date().toISOString(),
    inputs: {
      enforcement_mode: enforcement,
      fallback_rate: Number(fallbackRate.toFixed(4)),
      convergence_rate: convergence.convergenceRate,
      shadow_shutdown_safe_to_advance: shadowSafe,
      unlink_readiness_score: unlinkReport.unlinkReadinessScore,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function metricsForStage(id: RetirementStageId, i: StageInputs): Record<string, string | number> {
  switch (id) {
    case 'PHASED_STAGING':
      return {
        enforcement_mode: i.enforcementMode,
        fallback_rate: pctStr(i.fallbackRate),
        convergence_rate: pctStr(i.convergenceRate),
      };
    case 'LIMITED_PRODUCTION':
      return {
        decommission_mode: i.decommissionMode,
        convergence_rate: pctStr(i.convergenceRate),
        fallback_rate: pctStr(i.fallbackRate),
      };
    case 'NON_CRITICAL_FULL':
      return {
        decommission_mode: i.decommissionMode,
        fallback_rate: pctStr(i.fallbackRate),
        enforcement_mode: i.enforcementMode,
      };
    case 'CRITICAL_GRADUAL':
      return {
        enforcement_mode: i.enforcementMode,
        shadow_failure_rate: pctStr(i.shadowReportFailureRate),
        self_healing_harmful_share: pctStr(i.selfHealingHarmfulShare),
        self_healing_auto_disabled: i.selfHealingAutoDisabled,
      };
    case 'FULL_RETIREMENT_READY':
      return {
        decommission_mode: i.decommissionMode,
        shadow_safe_to_advance: i.shadowSafe ? 'yes' : 'no',
        enforcement_mode: i.enforcementMode,
        fallback_rate: pctStr(i.fallbackRate),
      };
    case 'COMPATIBILITY_CORE_UNLINK':
      return {
        unlink_readiness_score: i.unlinkReadinessScore,
        unlink_blocking_count: i.unlinkBlockingCount,
      };
  }
}

function recommendationsForStage(id: RetirementStageId, blockers: string[]): string[] {
  if (blockers.length === 0) {
    switch (id) {
      case 'PHASED_STAGING': return ['Continue to flip ENFORCEMENT_MODE=PREFER_PLANNED in non-prod.'];
      case 'LIMITED_PRODUCTION': return ['Advance to PLANNED_REQUIRED_NON_CRITICAL for safe content types.'];
      case 'NON_CRITICAL_FULL': return ['Advance global enforcement to PLANNED_REQUIRED_ALL.'];
      case 'CRITICAL_GRADUAL': return ['Enable COMPATIBILITY_CORE_SHADOW_SHUTDOWN=sample:0.05 to validate.'];
      case 'FULL_RETIREMENT_READY': return ['Generate the offline code-map and run the unlink analyzer.'];
      case 'COMPATIBILITY_CORE_UNLINK': return ['Execute the deletion plan generated by compatibilityCoreDeletionPlanner.'];
    }
  }
  return blockers.map((b) => `Resolve: ${b}`);
}

function pctStr(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
