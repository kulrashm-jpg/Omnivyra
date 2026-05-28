/**
 * unifiedRecoveryGraph.ts
 *
 * Phase 5.1 — Single source of truth for retries, abandonments, escalation
 * sequencing, and article-level convergence decisions.
 *
 * Before Phase 5, recovery decisions were split between two systems:
 *   - `runPlannedLongFormGeneration()`'s repair loop (Phase 4.1 adaptive budget)
 *   - `runLongFormGenerationOrchestrator()`'s section gate + recovery coordinator
 *
 * Both had local retry counters, local repair histories, and local
 * heuristics. The unified recovery graph consolidates ALL of it into a
 * single state graph that owns:
 *   - the section lifecycle history (delegates to SectionLifecycleManager)
 *   - the budget envelope (delegates to computeAdaptiveRecoveryBudget)
 *   - the per-section recovery plans (delegates to
 *     buildPlannedEngineRecoveryPlan)
 *   - the cross-system "what next" decisions (this module)
 *
 * The graph is intentionally side-effect-free where possible — callers
 * advance the graph via discrete events and read decisions out.
 */

import {
  SectionLifecycleManager,
  SectionLifecycleState,
  classifyFailureToLifecycleState,
  type SectionLifecycleHistoryEntry,
  type FailureCategory,
  type AcceptanceReason,
  type AbandonmentReason,
} from './sectionLifecycleManager';
import {
  computeAdaptiveRecoveryBudget,
  type AdaptiveRecoveryBudget,
  type EscalationStrategy,
  type IssueCategory,
  type IssueSeverity,
} from './adaptiveRecoveryBudget';
import {
  buildPlannedEngineRecoveryPlan,
  summarizeSectionFailure,
  type RecoveryPlan,
  type RecoveryStep,
  type SectionFailureSummary,
  type FallbackRecommendation,
} from './plannedEngineRecoveryCoordinator';
import type { LongFormGovernanceFailureReason } from './plannedEngineStabilityTelemetry';
// Phase 6.6 — Cost-aware recovery policy overlay.
import {
  evaluateCostAwareRecovery,
  deriveSectionValue,
  type CostAwareEvaluation,
} from './costAwareRecoveryPolicy';
import type { RecoveryStepAction } from './plannedEngineRecoveryCoordinator';
import type { ArticleConvergenceResult } from './articleConvergence';
// Phase 8.4 — Stabilizer-aware recovery action resolver.
import {
  resolveStabilizedRecoveryAction,
  recordStabilizedDecision,
} from './stabilizedRecoveryAction';
// Phase 9.1 — Self-healing actions consumed by the recovery graph.
import { hasActiveAction as hasActiveHealingAction } from './selfHealingCoordinator';

// ── Canonical graph node enum ────────────────────────────────────────────────
//
// Mirrors SectionLifecycleState with one addition: SOFTENING (Phase 5.1).
// Imported callers that need the original enum continue to import from
// sectionLifecycleManager; this re-export is for parity with the spec's
// canonical node list.

export enum UnifiedRecoveryNode {
  PLANNED = 'PLANNED',
  GENERATED = 'GENERATED',
  VALIDATING = 'VALIDATING',
  FAILED_ALIGNMENT = 'FAILED_ALIGNMENT',
  FAILED_FACTUAL = 'FAILED_FACTUAL',
  FAILED_REPETITION = 'FAILED_REPETITION',
  FAILED_ASSIGNMENT = 'FAILED_ASSIGNMENT',
  FAILED_TIMEOUT = 'FAILED_TIMEOUT',
  SOFTENING = 'SOFTENING',
  RETRYING = 'RETRYING',
  RECOVERED = 'RECOVERED',
  ACCEPTED = 'ACCEPTED',
  ABANDONED = 'ABANDONED',
}

const LIFECYCLE_TO_NODE: Partial<Record<SectionLifecycleState, UnifiedRecoveryNode>> = {
  [SectionLifecycleState.PLANNED]: UnifiedRecoveryNode.PLANNED,
  [SectionLifecycleState.GENERATED]: UnifiedRecoveryNode.GENERATED,
  [SectionLifecycleState.VALIDATING]: UnifiedRecoveryNode.VALIDATING,
  [SectionLifecycleState.FAILED_ALIGNMENT]: UnifiedRecoveryNode.FAILED_ALIGNMENT,
  [SectionLifecycleState.FAILED_FACTUAL]: UnifiedRecoveryNode.FAILED_FACTUAL,
  [SectionLifecycleState.FAILED_CONTINUITY]: UnifiedRecoveryNode.FAILED_ALIGNMENT,
  [SectionLifecycleState.FAILED_REPETITION]: UnifiedRecoveryNode.FAILED_REPETITION,
  [SectionLifecycleState.FAILED_ASSIGNMENT]: UnifiedRecoveryNode.FAILED_ASSIGNMENT,
  [SectionLifecycleState.FAILED_TIMEOUT]: UnifiedRecoveryNode.FAILED_TIMEOUT,
  [SectionLifecycleState.RETRYING]: UnifiedRecoveryNode.RETRYING,
  [SectionLifecycleState.RECOVERED]: UnifiedRecoveryNode.RECOVERED,
  [SectionLifecycleState.ACCEPTED]: UnifiedRecoveryNode.ACCEPTED,
  [SectionLifecycleState.ABANDONED]: UnifiedRecoveryNode.ABANDONED,
};

// ── Event types (graph inputs) ───────────────────────────────────────────────

export type RecoveryEvent =
  | { kind: 'section_started'; sectionIndex: number; sectionTitle: string }
  | { kind: 'section_generated'; sectionIndex: number; attempt: number }
  | { kind: 'section_validating'; sectionIndex: number; attempt: number }
  | {
      kind: 'section_passed';
      sectionIndex: number;
      attempt: number;
      acceptanceReason: AcceptanceReason;
      scoreSnapshot?: Record<string, number | undefined>;
    }
  | {
      kind: 'section_failed';
      sectionIndex: number;
      attempt: number;
      failureCategories: LongFormGovernanceFailureReason[];
      timeoutOccurred?: boolean;
      scoreSnapshot?: Record<string, number | undefined>;
    }
  | { kind: 'section_softening_started'; sectionIndex: number; attempt: number; reason: string }
  | { kind: 'section_retrying'; sectionIndex: number; nextAttempt: number; recoveryAction: string }
  | {
      kind: 'section_abandoned';
      sectionIndex: number;
      attempt: number;
      reason: AbandonmentReason;
      contextualReason: string;
    };

// ── Decision types (graph outputs) ──────────────────────────────────────────

export type NextSectionDecision =
  | { kind: 'retry'; recoveryAction: string; recoveryTargets: string[]; reason: string }
  | { kind: 'soften_claims'; reason: string }
  | { kind: 'targeted_repetition_fix'; reason: string }
  | { kind: 'minimal_recovery'; reason: string }
  | { kind: 'abandon_section'; reason: AbandonmentReason; contextualReason: string }
  | { kind: 'accept_with_warnings'; reason: AcceptanceReason }
  | { kind: 'no_action_needed' };

// ── Phase 6.1 — Recovery execution snapshot ──────────────────────────────────
//
// Returned by `executeRecoveryCycle()`. Captures the complete state of
// recovery decisions at a point in time so the orchestrator / planner
// can render diagnostics or drive a UI without re-reading internal
// graph state.

export interface RecoveryExecutionSnapshot {
  activeSections: Array<{
    sectionIndex: number;
    sectionTitle: string;
    state: SectionLifecycleState;
    attempt: number;
    timeoutCount: number;
  }>;
  retryQueue: Array<{
    sectionIndex: number;
    recommendedAction: RecoveryStepAction | 'soften_claims' | 'compact_retry';
    costAware: CostAwareEvaluation;
    reason: string;
  }>;
  abandonedSections: Array<{
    sectionIndex: number;
    reason: AbandonmentReason;
    finalAttempt: number;
  }>;
  softenedSections: Array<{
    sectionIndex: number;
    reason: string;
  }>;
  convergenceState: {
    score: number;
    recommendation: ArticleConvergenceResult['shipRecommendation'];
  } | null;
  escalationState: {
    fallbackRecommendation: ArticleLevelDecision['fallbackRecommendation'];
    totalRepairsUsed: number;
    remainingRepairBudget: number;
    budgetStrategy: string;
  };
}

export interface ArticleLevelDecision {
  fallbackRecommendation: FallbackRecommendation;
  budget: AdaptiveRecoveryBudget;
  recoveryPlan: RecoveryPlan | undefined;
  abandonedSections: number[];
  totalRepairsUsed: number;
  remainingRepairBudget: number;
}

// ── Graph implementation ─────────────────────────────────────────────────────

export interface UnifiedRecoveryGraphConfig {
  contentType: string;
  totalSections: number;
  /** Optional cap on total repairs, overlays the adaptive budget. */
  hardRepairCeiling?: number;
}

export class UnifiedRecoveryGraph {
  private lifecycle = new SectionLifecycleManager();
  private readonly contentType: string;
  private readonly totalSections: number;
  private readonly hardRepairCeiling?: number;
  private startMs: number = Date.now();
  private repairsUsed: number = 0;
  private timeoutCountsPerSection = new Map<number, number>();
  /** Recovery action history per section index (for diagnostics). */
  private recoveryActionsApplied = new Map<number, string[]>();
  /** Has any retry attempt actually improved scores? */
  private retryImprovementSamples: boolean[] = [];

  constructor(config: UnifiedRecoveryGraphConfig) {
    this.contentType = config.contentType;
    this.totalSections = config.totalSections;
    this.hardRepairCeiling = config.hardRepairCeiling;
  }

  // ── Event dispatch ─────────────────────────────────────────────────────

  dispatch(event: RecoveryEvent): { ok: true } | { ok: false; reason: string } {
    switch (event.kind) {
      case 'section_started':
        this.lifecycle.startSection(event.sectionIndex, event.sectionTitle);
        return { ok: true };
      case 'section_generated':
        return this.lifecycle.transition(event.sectionIndex, SectionLifecycleState.GENERATED, {
          attempt: event.attempt,
          reason: `attempt ${event.attempt} generation completed`,
        });
      case 'section_validating':
        return this.lifecycle.transition(event.sectionIndex, SectionLifecycleState.VALIDATING, {
          attempt: event.attempt,
          reason: `attempt ${event.attempt} entering validation`,
        });
      case 'section_passed':
        this.lifecycle.accept(event.sectionIndex, event.attempt, event.acceptanceReason);
        return { ok: true };
      case 'section_failed': {
        const lifeState = classifyFailureToLifecycleState(event.failureCategories);
        const cat = mapToFailureCategory(event.failureCategories);
        if (event.timeoutOccurred) {
          this.timeoutCountsPerSection.set(
            event.sectionIndex,
            (this.timeoutCountsPerSection.get(event.sectionIndex) ?? 0) + 1,
          );
        }
        if (lifeState) {
          return this.lifecycle.transition(event.sectionIndex, lifeState, {
            attempt: event.attempt,
            reason: `governance failed: ${event.failureCategories.join(', ')}`,
            failureCategory: cat,
            scoreSnapshot: event.scoreSnapshot,
          });
        }
        return { ok: false, reason: 'failure_unclassified' };
      }
      case 'section_softening_started':
        // SOFTENING is a virtual state — for diagnostics we record it
        // through the RETRYING transition so the lifecycle audit shows
        // the intermediate step.
        this.recordAction(event.sectionIndex, 'soften_claims');
        return this.lifecycle.transition(event.sectionIndex, SectionLifecycleState.RETRYING, {
          attempt: event.attempt,
          reason: `softening: ${event.reason}`,
          recoveryAction: 'soften_claims',
        });
      case 'section_retrying':
        this.recordAction(event.sectionIndex, event.recoveryAction);
        return this.lifecycle.transition(event.sectionIndex, SectionLifecycleState.RETRYING, {
          attempt: event.nextAttempt,
          reason: `retry with action: ${event.recoveryAction}`,
          recoveryAction: event.recoveryAction,
        });
      case 'section_abandoned':
        this.lifecycle.abandon(event.sectionIndex, event.attempt, event.reason, event.contextualReason);
        return { ok: true };
    }
  }

  recordRetryImprovement(improved: boolean): void {
    this.retryImprovementSamples.push(improved);
  }

  incrementRepairUsage(): void {
    this.repairsUsed += 1;
  }

  // ── Query API ──────────────────────────────────────────────────────────

  getLifecycleHistory(): SectionLifecycleHistoryEntry[] {
    return this.lifecycle.getHistory();
  }

  getSection(sectionIndex: number): SectionLifecycleHistoryEntry | undefined {
    return this.lifecycle.getSection(sectionIndex);
  }

  getTimeoutCount(sectionIndex: number): number {
    return this.timeoutCountsPerSection.get(sectionIndex) ?? 0;
  }

  getRecoveryActions(sectionIndex: number): string[] {
    return [...(this.recoveryActionsApplied.get(sectionIndex) ?? [])];
  }

  // ── Adaptive budget + recovery plan ───────────────────────────────────

  computeArticleDecision(input: {
    issueCategoriesObserved: LongFormGovernanceFailureReason[];
    sectionFailureSummaries: SectionFailureSummary[];
    failedSectionCount: number;
    severity: IssueSeverity;
  }): ArticleLevelDecision {
    const issueCategories: Partial<Record<IssueCategory, number>> = {};
    for (const reason of input.issueCategoriesObserved) {
      const cat = mapToIssueCategory(reason);
      issueCategories[cat] = (issueCategories[cat] ?? 0) + 1;
    }
    const severityDistribution: Partial<Record<IssueSeverity, number>> = {
      [input.severity]: Math.max(1, input.failedSectionCount),
    };
    const improvementRate = this.retryImprovementSamples.length === 0
      ? undefined
      : this.retryImprovementSamples.filter(Boolean).length / this.retryImprovementSamples.length;

    const budget = computeAdaptiveRecoveryBudget({
      total_sections: this.totalSections,
      failed_sections: input.failedSectionCount,
      severity_distribution: severityDistribution,
      issue_categories: issueCategories,
      content_type: this.contentType,
      generation_duration_ms: Date.now() - this.startMs,
      retry_improvement_rate: improvementRate,
      hardCeiling: this.hardRepairCeiling,
    });

    const remainingBudget = Math.max(0, budget.maxRepairs - this.repairsUsed);
    const effectiveBudget: AdaptiveRecoveryBudget = {
      ...budget,
      maxRepairs: remainingBudget,
    };

    const recoveryPlan = input.sectionFailureSummaries.length > 0
      ? buildPlannedEngineRecoveryPlan({
          budget: effectiveBudget,
          sectionFailures: input.sectionFailureSummaries,
          totalSections: this.totalSections,
        })
      : undefined;

    const abandoned = (recoveryPlan?.abandonedSections ?? []).map((a) => a.sectionIndex);

    return {
      fallbackRecommendation: recoveryPlan?.fallbackRecommendation ?? 'continue_planned_engine',
      budget: effectiveBudget,
      recoveryPlan,
      abandonedSections: abandoned,
      totalRepairsUsed: this.repairsUsed,
      remainingRepairBudget: remainingBudget,
    };
  }

  // ── Per-section decision ──────────────────────────────────────────────

  decideNextForSection(input: {
    sectionIndex: number;
    failureCategories: LongFormGovernanceFailureReason[];
    attempt: number;
    articleDecision: ArticleLevelDecision;
  }): NextSectionDecision {
    const lifeEntry = this.lifecycle.getSection(input.sectionIndex);
    if (!lifeEntry) return { kind: 'no_action_needed' };
    if (lifeEntry.finalState === SectionLifecycleState.ACCEPTED) return { kind: 'no_action_needed' };

    // If the global budget is exhausted, abandon this section.
    if (input.articleDecision.remainingRepairBudget <= 0) {
      return {
        kind: 'abandon_section',
        reason: 'retry_budget_exhausted',
        contextualReason: `Global recovery budget exhausted at section ${input.sectionIndex}.`,
      };
    }

    // Timeout-dominant → drive a compact/minimal retry.
    if (input.failureCategories.includes('timeout')) {
      const tCount = this.getTimeoutCount(input.sectionIndex);
      if (tCount >= 2) {
        return { kind: 'minimal_recovery', reason: 'two-or-more timeouts; minimal-recovery shell.' };
      }
      return {
        kind: 'retry',
        recoveryAction: 'compact_retry',
        recoveryTargets: ['Compress prompt; reduce word target.'],
        reason: 'timeout on previous attempt; compact retry.',
      };
    }

    // Repetition-only → targeted regen.
    if (input.failureCategories.length === 1 && input.failureCategories[0] === 'semantic_repetition') {
      return {
        kind: 'targeted_repetition_fix',
        reason: 'semantic-repetition-only; regenerate only this section.',
      };
    }

    // Factual-only → soften before regenerating.
    if (input.failureCategories.length === 1 && input.failureCategories[0] === 'factual') {
      return {
        kind: 'soften_claims',
        reason: 'factual-only failure; soften unsupported claims before regen.',
      };
    }

    // Phase 8.4 — Consult the content-type stabilizer for the preferred
    // action BEFORE falling through to the coordinator's per-step
    // planner. The stabilizer knows e.g. that blogs prefer
    // `restore_strategic_narrative` for alignment failures while
    // whitepapers prefer `restore_capability_emphasis`.
    // Phase 9.1 — Active self-healing actions raise the perceived
    // severity so the stabilizer picks more-conservative recoveries
    // (compact_retry / soften_claims) without us having to fork logic.
    const healingGrounding = hasActiveHealingAction('increase_grounding_strictness', this.contentType);
    const healingStabilize = hasActiveHealingAction('stabilize_content_type', this.contentType);
    const healingSeverityBoost = (healingGrounding ? 15 : 0) + (healingStabilize ? 15 : 0);
    const stabilized = resolveStabilizedRecoveryAction({
      contentType: this.contentType,
      failureCategories: input.failureCategories,
      timeoutDominant: input.failureCategories.includes('timeout'),
      defaultAction: input.articleDecision.recoveryPlan?.recoveryPlan
        .find((s) => s.sectionIndex === input.sectionIndex)?.action,
      severity: (this.lifecycle.getSection(input.sectionIndex)?.failureCategoriesEncountered.length
        ? 50 + 10 * (this.lifecycle.getSection(input.sectionIndex)?.failureCategoriesEncountered.length ?? 0)
        : 30) + healingSeverityBoost,
      sectionValue: 0.5,
    });
    recordStabilizedDecision(stabilized);
    if (stabilized.abandonmentRecommended) {
      return {
        kind: 'abandon_section',
        reason: 'no_improvement_across_attempts',
        contextualReason: stabilized.reasoning,
      };
    }
    if (stabilized.stabilizerApplied) {
      return {
        kind: 'retry',
        recoveryAction: stabilized.recommendedAction,
        recoveryTargets: [stabilized.reasoning],
        reason: stabilized.reasoning,
      };
    }

    // Alignment → driven by recovery coordinator's per-step planner.
    const step = input.articleDecision.recoveryPlan?.recoveryPlan.find((s) => s.sectionIndex === input.sectionIndex);
    if (step) {
      return {
        kind: 'retry',
        recoveryAction: step.action,
        recoveryTargets: [step.reason],
        reason: step.reason,
      };
    }

    return {
      kind: 'retry',
      recoveryAction: 'regenerate_section',
      recoveryTargets: ['regenerate from scratch'],
      reason: 'default fallback retry',
    };
  }

  // ── Phase 6.1 — Canonical executeRecoveryCycle ─────────────────────────
  //
  // The single entry point both the orchestrator's section loop AND the
  // planner's repair loop should call after each validation pass. Replaces
  // the local retry sequencing previously duplicated in two engines.
  //
  // Required flow per spec:
  //   section generated
  //     → validation bundle
  //     → graph decision
  //     → recovery action
  //     → retry / compress / soften / abandon
  //     → convergence update
  //     → final disposition
  //
  // The caller is responsible for executing the recovery ACTION the cycle
  // returns (it has the model + the cache). The graph owns the DECISION.

  executeRecoveryCycle(input: {
    sectionIndex: number;
    sectionTitle: string;
    attempt: number;
    failureCategories: LongFormGovernanceFailureReason[];
    timeoutOccurred: boolean;
    scoreSnapshot?: Record<string, number | undefined>;
    /** Convergence so far (article-level). */
    convergence?: ArticleConvergenceResult;
    /** Section-level value for cost weighting. */
    sectionValue?: number;
    /** Tokens already burned for this article. */
    tokensBurnedSoFar?: number;
    /** Token budget ceiling per article (operator-set). */
    tokenBudgetCeiling?: number;
    /** Retry amplification observed so far. */
    retryAmplificationFactor?: number;
    /** Estimated tokens for the next proposed retry step. */
    proposedStepTokens?: number;
    /** Article-level decision (budget + recovery plan). */
    articleDecision: ArticleLevelDecision;
  }): {
    decision: NextSectionDecision;
    costAware: CostAwareEvaluation | null;
    snapshot: RecoveryExecutionSnapshot;
  } {
    // (1) Section failed → dispatch the lifecycle transition.
    if (input.failureCategories.length > 0) {
      this.dispatch({
        kind: 'section_failed',
        sectionIndex: input.sectionIndex,
        attempt: input.attempt,
        failureCategories: input.failureCategories,
        timeoutOccurred: input.timeoutOccurred,
        scoreSnapshot: input.scoreSnapshot,
      });
    }

    // (2) Graph decides what to do next.
    const decision = this.decideNextForSection({
      sectionIndex: input.sectionIndex,
      failureCategories: input.failureCategories,
      attempt: input.attempt,
      articleDecision: input.articleDecision,
    });

    // (3) Apply cost-aware overlay when a recovery step is in play.
    let costAware: CostAwareEvaluation | null = null;
    const step = input.articleDecision.recoveryPlan?.recoveryPlan.find((s) => s.sectionIndex === input.sectionIndex);
    if (step && input.convergence
        && typeof input.sectionValue === 'number'
        && typeof input.retryAmplificationFactor === 'number'
        && typeof input.tokensBurnedSoFar === 'number'
        && typeof input.tokenBudgetCeiling === 'number'
        && typeof input.proposedStepTokens === 'number') {
      costAware = evaluateCostAwareRecovery({
        step,
        sectionValue: input.sectionValue,
        convergence: {
          convergenceScore: input.convergence.convergenceScore,
          shipRecommendation: input.convergence.shipRecommendation,
        },
        attemptsSoFar: input.attempt,
        tokensBurnedSoFar: input.tokensBurnedSoFar,
        tokenBudgetCeiling: input.tokenBudgetCeiling,
        retryAmplificationFactor: input.retryAmplificationFactor,
        proposedStepTokens: input.proposedStepTokens,
      });
    }

    return {
      decision,
      costAware,
      snapshot: this.snapshot(input.articleDecision, input.convergence),
    };
  }

  // ── Phase 6.1 — RecoveryExecutionSnapshot ──────────────────────────────
  snapshot(
    articleDecision: ArticleLevelDecision,
    convergence?: ArticleConvergenceResult,
  ): RecoveryExecutionSnapshot {
    const history = this.lifecycle.getHistory();
    const activeSections = history
      .filter((h) =>
        h.finalState !== SectionLifecycleState.ABANDONED
        && h.finalState !== SectionLifecycleState.ACCEPTED,
      )
      .map((h) => ({
        sectionIndex: h.sectionIndex,
        sectionTitle: h.sectionTitle,
        state: h.finalState,
        attempt: h.finalAttempt,
        timeoutCount: this.getTimeoutCount(h.sectionIndex),
      }));

    const retryQueue: RecoveryExecutionSnapshot['retryQueue'] = (articleDecision.recoveryPlan?.recoveryPlan ?? []).map((step) => ({
      sectionIndex: step.sectionIndex,
      recommendedAction: step.action,
      costAware: {
        decision: 'execute_as_planned',
        reason: 'No cost-aware overlay computed (defaults).',
        projectedSavings: 0,
        recommendedAction: step.action,
      },
      reason: step.reason,
    }));

    const abandonedSections = history
      .filter((h) => h.finalState === SectionLifecycleState.ABANDONED)
      .map((h) => ({
        sectionIndex: h.sectionIndex,
        reason: h.abandonmentReason ?? 'retry_budget_exhausted' as AbandonmentReason,
        finalAttempt: h.finalAttempt,
      }));

    const softenedSections = history
      .filter((h) => h.recoveryActionsApplied.includes('soften_claims'))
      .map((h) => ({
        sectionIndex: h.sectionIndex,
        reason: 'Softening pass applied during recovery.',
      }));

    const convergenceState = convergence
      ? {
          score: convergence.convergenceScore,
          recommendation: convergence.shipRecommendation,
        }
      : null;

    return {
      activeSections,
      retryQueue,
      abandonedSections,
      softenedSections,
      convergenceState,
      escalationState: {
        fallbackRecommendation: articleDecision.fallbackRecommendation,
        totalRepairsUsed: articleDecision.totalRepairsUsed,
        remainingRepairBudget: articleDecision.remainingRepairBudget,
        budgetStrategy: articleDecision.budget.escalationStrategy,
      },
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private recordAction(sectionIndex: number, action: string): void {
    const list = this.recoveryActionsApplied.get(sectionIndex) ?? [];
    list.push(action);
    this.recoveryActionsApplied.set(sectionIndex, list);
  }
}

// Re-export deriveSectionValue so callers wiring the graph can compute
// the cost-aware sectionValue input without a second import.
export { deriveSectionValue };

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapToFailureCategory(reasons: LongFormGovernanceFailureReason[]): FailureCategory {
  if (reasons.includes('timeout')) return 'timeout';
  if (reasons.includes('factual')) return 'factual';
  if (reasons.includes('company_alignment')) return 'alignment';
  if (reasons.includes('genericity')) return 'genericity';
  if (reasons.includes('continuity')) return 'continuity';
  if (reasons.includes('semantic_repetition')) return 'repetition';
  if (reasons.includes('strategic_assignment_consumption')) return 'assignment';
  return 'unknown';
}

function mapToIssueCategory(reason: LongFormGovernanceFailureReason): IssueCategory {
  switch (reason) {
    case 'company_alignment': return 'alignment';
    case 'factual':           return 'factual';
    case 'continuity':        return 'continuity';
    case 'genericity':        return 'genericity';
    case 'semantic_repetition': return 'repetition';
    case 'strategic_assignment_consumption': return 'assignment';
    case 'timeout':           return 'unknown';
    default:                  return 'unknown';
  }
}

// Convenience helper: build the per-section failure summary the
// coordinator expects from raw lifecycle + governance data.
export function buildFailureSummary(input: {
  graph: UnifiedRecoveryGraph;
  sectionIndex: number;
  failureCategories: LongFormGovernanceFailureReason[];
  attempts: number;
  recentRetryImproved: boolean;
}): SectionFailureSummary | null {
  const lifecycle = input.graph.getSection(input.sectionIndex);
  if (!lifecycle) return null;
  return summarizeSectionFailure({
    lifecycle,
    failureCategories: input.failureCategories,
    attempts: input.attempts,
    recentRetryImproved: input.recentRetryImproved,
    timeoutCount: input.graph.getTimeoutCount(input.sectionIndex),
  });
}

export type { EscalationStrategy };
