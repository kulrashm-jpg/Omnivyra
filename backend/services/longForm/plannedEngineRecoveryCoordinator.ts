/**
 * plannedEngineRecoveryCoordinator.ts
 *
 * Phase 4.6 — Global recovery orchestration.
 *
 * The per-section gates (continuity / generic / factual / alignment) drive
 * local retry decisions. This coordinator looks at the FULL set of failures
 * across an article and decides:
 *
 *   - which sections should be retried at all (prioritized)
 *   - which sections should be abandoned (catastrophic, exhausted, or
 *     no-improvement-across-attempts)
 *   - in what order to run the retries (failure clustering by category)
 *   - whether to escalate to compatibility-core fallback (only after
 *     planned-engine has genuinely failed — never after isolated section
 *     failures)
 *
 * No I/O. No LLM calls. Pure planning. Takes lifecycle states + governance
 * outputs + telemetry; returns a structured `RecoveryPlan`.
 */

import type { SectionLifecycleHistoryEntry } from './sectionLifecycleManager';
import { SectionLifecycleState } from './sectionLifecycleManager';
import type {
  AdaptiveRecoveryBudget,
  EscalationStrategy,
} from './adaptiveRecoveryBudget';
import type { LongFormGovernanceFailureReason } from './plannedEngineStabilityTelemetry';

// ── Public types ─────────────────────────────────────────────────────────────

export type RecoveryStepAction =
  | 'retry_section'              // straightforward regenerate with hint
  | 'soften_claims'              // run claim-softening pass (no model call needed)
  | 'targeted_repetition_fix'    // regenerate ONE section to break overlap
  | 'compact_retry'              // retry with compressed prompt (timeout pressure)
  | 'minimal_recovery'           // ship a structural shell
  | 'abandon_section'            // give up on this section
  | 'escalate_to_fallback';      // genuine planned-engine failure

export interface RecoveryStep {
  order: number;
  sectionIndex: number;
  action: RecoveryStepAction;
  reason: string;
  expectedCost: 'low' | 'medium' | 'high';
}

export interface AbandonedSection {
  sectionIndex: number;
  reason:
    | 'retry_budget_exhausted'
    | 'no_improvement_across_attempts'
    | 'catastrophic_failure'
    | 'timeout_threshold_breached'
    | 'recovery_strategy_unavailable';
  finalState: SectionLifecycleState;
}

export type FallbackRecommendation =
  | 'continue_planned_engine'
  | 'escalate_to_compatibility_core'
  | 'ship_partial_article';

export interface RecoveryPlan {
  recoveryPlan: RecoveryStep[];
  abandonedSections: AbandonedSection[];
  prioritizedRetries: number[];      // section indices in retry order
  fallbackRecommendation: FallbackRecommendation;
  reasoning: string[];
  failureClusters: Array<{
    category: LongFormGovernanceFailureReason;
    sectionIndices: number[];
    count: number;
  }>;
}

export interface SectionFailureSummary {
  sectionIndex: number;
  lifecycle: SectionLifecycleHistoryEntry;
  failureCategories: LongFormGovernanceFailureReason[];
  /** Combined severity: 0–100 (higher = more severe) */
  severity: number;
  /** Whether the most recent retry improved scores. */
  recentRetryImproved: boolean;
  timeoutCount: number;
  attempts: number;
}

export interface BuildRecoveryPlanInput {
  budget: AdaptiveRecoveryBudget;
  sectionFailures: SectionFailureSummary[];
  totalSections: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isCatastrophic(summary: SectionFailureSummary): boolean {
  if (summary.severity >= 85) return true;
  if (summary.attempts >= 3 && !summary.recentRetryImproved) return true;
  if (summary.timeoutCount >= 2) return true;
  return false;
}

function preferredAction(
  summary: SectionFailureSummary,
  budget: AdaptiveRecoveryBudget,
): RecoveryStepAction {
  const cats = summary.failureCategories;
  // Timeout-dominant → compact / minimal
  if (cats.includes('timeout') || summary.timeoutCount >= 1) {
    if (summary.timeoutCount >= 2) return 'minimal_recovery';
    return 'compact_retry';
  }
  // Repetition-only → targeted regeneration on the weaker side of overlap
  if (cats.length === 1 && cats[0] === 'semantic_repetition') {
    return 'targeted_repetition_fix';
  }
  // Pure factual failures → softening is cheaper than full regen
  if (cats.length === 1 && cats[0] === 'factual') {
    return 'soften_claims';
  }
  // Alignment-only failures with budget for cheap retries
  if (cats.length === 1 && cats[0] === 'company_alignment'
      && budget.escalationStrategy === 'CHEAP_ALIGNMENT') {
    return 'retry_section';
  }
  // Catch-all
  return 'retry_section';
}

function severityScoreFromCategories(
  categories: LongFormGovernanceFailureReason[],
  attempts: number,
  recentImproved: boolean,
): number {
  let score = 0;
  if (categories.includes('factual')) score += 35;
  if (categories.includes('company_alignment')) score += 20;
  if (categories.includes('continuity')) score += 15;
  if (categories.includes('genericity')) score += 15;
  if (categories.includes('semantic_repetition')) score += 12;
  if (categories.includes('strategic_assignment_consumption')) score += 10;
  if (categories.includes('timeout')) score += 30;
  // Compounding factor: more attempts without improvement = higher severity.
  if (attempts >= 2 && !recentImproved) score += 15;
  if (attempts >= 3 && !recentImproved) score += 25;
  return Math.min(100, score);
}

// ── Main planner ─────────────────────────────────────────────────────────────

export function buildPlannedEngineRecoveryPlan(input: BuildRecoveryPlanInput): RecoveryPlan {
  const reasoning: string[] = [];
  const steps: RecoveryStep[] = [];
  const abandoned: AbandonedSection[] = [];

  // ── Failure clustering ──────────────────────────────────────────────
  const clusterMap = new Map<LongFormGovernanceFailureReason, number[]>();
  for (const f of input.sectionFailures) {
    for (const cat of f.failureCategories) {
      const list = clusterMap.get(cat) ?? [];
      list.push(f.sectionIndex);
      clusterMap.set(cat, list);
    }
  }
  const failureClusters: RecoveryPlan['failureClusters'] = Array.from(clusterMap.entries())
    .map(([category, sectionIndices]) => ({ category, sectionIndices, count: sectionIndices.length }))
    .sort((a, b) => b.count - a.count);

  // ── Catastrophic check — escalate to fallback if too many sections are
  //    catastrophic OR the budget says EARLY_ABORT.
  const catastrophicCount = input.sectionFailures.filter(isCatastrophic).length;
  if (input.budget.escalationStrategy === 'EARLY_ABORT'
      || catastrophicCount >= Math.ceil(input.totalSections / 2)) {
    reasoning.push(`Catastrophic state: ${catastrophicCount} catastrophic sections of ${input.totalSections}; escalate to fallback.`);
    for (const f of input.sectionFailures) {
      abandoned.push({
        sectionIndex: f.sectionIndex,
        reason: isCatastrophic(f) ? 'catastrophic_failure' : 'recovery_strategy_unavailable',
        finalState: f.lifecycle.finalState,
      });
    }
    return {
      recoveryPlan: [{
        order: 1,
        sectionIndex: -1,
        action: 'escalate_to_fallback',
        reason: 'Planned engine cannot recover; escalate to compatibility-core.',
        expectedCost: 'high',
      }],
      abandonedSections: abandoned,
      prioritizedRetries: [],
      fallbackRecommendation: 'escalate_to_compatibility_core',
      reasoning,
      failureClusters,
    };
  }

  // ── Identify abandoned vs retryable sections ───────────────────────
  const retryable: SectionFailureSummary[] = [];
  for (const f of input.sectionFailures) {
    if (f.attempts >= input.budget.maxRetriesPerSection + 1 && !f.recentRetryImproved) {
      abandoned.push({
        sectionIndex: f.sectionIndex,
        reason: 'no_improvement_across_attempts',
        finalState: f.lifecycle.finalState,
      });
      reasoning.push(`Section ${f.sectionIndex}: no improvement across ${f.attempts} attempts → abandoned.`);
      continue;
    }
    if (f.timeoutCount >= 2) {
      // Try one more minimal-recovery attempt; if that's already happened,
      // abandon. We allow a single minimal recovery attempt by routing it
      // through retryable below.
      const alreadyTriedMinimal = f.lifecycle.recoveryActionsApplied.includes('minimal_recovery');
      if (alreadyTriedMinimal) {
        abandoned.push({
          sectionIndex: f.sectionIndex,
          reason: 'timeout_threshold_breached',
          finalState: f.lifecycle.finalState,
        });
        reasoning.push(`Section ${f.sectionIndex}: 2+ timeouts, minimal_recovery already tried → abandoned.`);
        continue;
      }
    }
    retryable.push(f);
  }

  // ── Prioritize retries ─────────────────────────────────────────────
  // Order: (1) factual failures first (highest semantic impact), (2)
  // alignment failures next, (3) repetition, (4) timeout-driven last
  // (they need the most compute).
  const priorityWeight: Record<LongFormGovernanceFailureReason, number> = {
    factual: 5,
    company_alignment: 4,
    continuity: 3,
    genericity: 3,
    semantic_repetition: 2,
    strategic_assignment_consumption: 2,
    timeout: 1,
    unknown: 0,
  };
  const prioritized = retryable
    .map((f) => {
      const maxWeight = f.failureCategories.reduce((m, c) => Math.max(m, priorityWeight[c] ?? 0), 0);
      return { f, maxWeight };
    })
    .sort((a, b) => b.maxWeight - a.maxWeight || b.f.severity - a.f.severity)
    .map(({ f }) => f);

  // ── Allocate steps under the budget ──────────────────────────────
  let allocated = 0;
  for (const f of prioritized) {
    if (allocated >= input.budget.maxRepairs) {
      abandoned.push({
        sectionIndex: f.sectionIndex,
        reason: 'retry_budget_exhausted',
        finalState: f.lifecycle.finalState,
      });
      reasoning.push(`Section ${f.sectionIndex}: budget exhausted (${input.budget.maxRepairs} repairs allocated) → abandoned.`);
      continue;
    }
    const action = preferredAction(f, input.budget);
    const cost: RecoveryStep['expectedCost'] = action === 'soften_claims' ? 'low'
      : action === 'targeted_repetition_fix' || action === 'compact_retry' ? 'medium'
      : action === 'minimal_recovery' ? 'low'
      : 'high';
    steps.push({
      order: steps.length + 1,
      sectionIndex: f.sectionIndex,
      action,
      reason: `Failure categories: [${f.failureCategories.join(', ')}]; severity ${f.severity}; attempt ${f.attempts}.`,
      expectedCost: cost,
    });
    allocated += 1;
  }

  // ── Fallback recommendation ──────────────────────────────────────
  // We only recommend escalating to compatibility-core when the planned
  // engine has genuinely failed. Isolated section failures absolutely do
  // NOT trigger escalation.
  let fallback: FallbackRecommendation = 'continue_planned_engine';
  if (abandoned.length >= Math.ceil(input.totalSections * 0.6)) {
    fallback = 'escalate_to_compatibility_core';
    reasoning.push(`${abandoned.length} of ${input.totalSections} sections abandoned → escalate to compatibility-core.`);
  } else if (abandoned.length > 0 && abandoned.length < Math.ceil(input.totalSections * 0.3)) {
    fallback = 'ship_partial_article';
    reasoning.push(`${abandoned.length} sections abandoned but article remains substantially complete → ship partial.`);
  }

  return {
    recoveryPlan: steps,
    abandonedSections: abandoned,
    prioritizedRetries: prioritized.map((f) => f.sectionIndex),
    fallbackRecommendation: fallback,
    reasoning,
    failureClusters,
  };
}

/**
 * Helper: derive a SectionFailureSummary from the orchestrator's section
 * outcome shape. Callers pass the lifecycle entry + recent failure
 * categories + score data.
 */
export function summarizeSectionFailure(input: {
  lifecycle: SectionLifecycleHistoryEntry;
  failureCategories: LongFormGovernanceFailureReason[];
  attempts: number;
  recentRetryImproved: boolean;
  timeoutCount: number;
}): SectionFailureSummary {
  return {
    sectionIndex: input.lifecycle.sectionIndex,
    lifecycle: input.lifecycle,
    failureCategories: input.failureCategories,
    severity: severityScoreFromCategories(input.failureCategories, input.attempts, input.recentRetryImproved),
    recentRetryImproved: input.recentRetryImproved,
    timeoutCount: input.timeoutCount,
    attempts: input.attempts,
  };
}

// Re-export EscalationStrategy from adaptiveRecoveryBudget for callers
// that need to pass it through to chooseSectionExecutionStrategy.
export type { EscalationStrategy };
