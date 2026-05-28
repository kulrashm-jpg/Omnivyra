/**
 * costAwareRecoveryPolicy.ts
 *
 * Phase 6.6 — Cost-aware recovery decisions.
 *
 * Earlier phases optimized recovery for quality. This module layers
 * COST awareness on top: low-value retries abort earlier, high-cost
 * low-improvement loops terminate, and near-converged articles favor
 * cheap softening over expensive regeneration.
 *
 * The output overlays — not replaces — the existing recovery plan: it
 * answers "should we actually run this step, or skip / downgrade it
 * given the article's cost trajectory?"
 *
 * Inputs:
 *   - retry amplification        (cost so far / first-attempt cost)
 *   - timeout waste              (tokens already burned without output)
 *   - grounding overhead         (tokens spent on grounding context)
 *   - section value              (how much the article depends on it)
 *   - article convergence score  (how close we are to "good enough")
 *   - operational cost           (tokens budget remaining)
 */

import type { RecoveryStep, RecoveryStepAction } from './plannedEngineRecoveryCoordinator';
import type { ArticleConvergenceResult } from './articleConvergence';

// ── Public types ─────────────────────────────────────────────────────────────

export type CostAwareDecision =
  | 'execute_as_planned'
  | 'downgrade_to_soften'
  | 'downgrade_to_compact_retry'
  | 'skip_low_value_retry'
  | 'terminate_amplification_loop'
  | 'abort_near_converged';

export interface CostAwareEvaluation {
  decision: CostAwareDecision;
  reason: string;
  /** Tokens we estimate we save by overriding the step. */
  projectedSavings: number;
  /** Cost-adjusted recommendation for the step's action. */
  recommendedAction: RecoveryStepAction | 'soften_claims' | 'compact_retry';
}

export interface CostAwareInput {
  /** The recovery step we are about to execute. */
  step: RecoveryStep;
  /** Section value: 0..1 — how much the article depends on this section. */
  sectionValue: number;
  /** Current article convergence (from evaluateArticleConvergence). */
  convergence: Pick<ArticleConvergenceResult, 'convergenceScore' | 'shipRecommendation'>;
  /** How many retries have already happened on this section. */
  attemptsSoFar: number;
  /** Tokens already burned recovering this article. */
  tokensBurnedSoFar: number;
  /** Token budget the operator considers acceptable for this article. */
  tokenBudgetCeiling: number;
  /** Retry amplification factor (final / first). */
  retryAmplificationFactor: number;
  /** Estimated tokens for the proposed step. */
  proposedStepTokens: number;
}

// ── Thresholds (deterministic) ────────────────────────────────────────────────

const NEAR_CONVERGED_THRESHOLD = 75;     // convergence ≥ 75 → near-converged
const VERY_NEAR_CONVERGED = 85;          // ≥ 85 → softening only
const HIGH_AMPLIFICATION = 2.5;          // amplification ≥ 2.5× → stop
const LOW_SECTION_VALUE = 0.25;          // section value < 0.25 = low value
const CRITICAL_BUDGET_USAGE = 0.85;      // 85% of budget burned → curtail
const HEAVY_STEP_TOKENS = 3000;          // step ≥ 3000 tokens = expensive

// ── Policy ──────────────────────────────────────────────────────────────────

export function evaluateCostAwareRecovery(input: CostAwareInput): CostAwareEvaluation {
  const budgetUsage = input.tokenBudgetCeiling > 0
    ? input.tokensBurnedSoFar / input.tokenBudgetCeiling
    : 0;

  // ── Article already very near converged → softening only ─────────────
  if (input.convergence.convergenceScore >= VERY_NEAR_CONVERGED) {
    return {
      decision: 'abort_near_converged',
      reason: `Convergence ${input.convergence.convergenceScore} ≥ ${VERY_NEAR_CONVERGED}; abort recovery and ship.`,
      projectedSavings: input.proposedStepTokens,
      recommendedAction: 'soften_claims',
    };
  }
  if (input.convergence.convergenceScore >= NEAR_CONVERGED_THRESHOLD
      && input.step.action !== 'soften_claims') {
    return {
      decision: 'downgrade_to_soften',
      reason: `Convergence ${input.convergence.convergenceScore} ≥ ${NEAR_CONVERGED_THRESHOLD}; soften rather than regenerate.`,
      projectedSavings: Math.max(0, input.proposedStepTokens - 200),
      recommendedAction: 'soften_claims',
    };
  }

  // ── Runaway amplification — terminate ──────────────────────────────
  if (input.retryAmplificationFactor >= HIGH_AMPLIFICATION) {
    return {
      decision: 'terminate_amplification_loop',
      reason: `Retry amplification ${input.retryAmplificationFactor}× ≥ ${HIGH_AMPLIFICATION}×; terminate.`,
      projectedSavings: input.proposedStepTokens,
      recommendedAction: 'soften_claims',
    };
  }

  // ── Budget exhaustion → downgrade to compact ───────────────────────
  if (budgetUsage >= CRITICAL_BUDGET_USAGE && input.step.action !== 'compact_retry' && input.step.action !== 'soften_claims') {
    return {
      decision: 'downgrade_to_compact_retry',
      reason: `Budget usage ${(budgetUsage * 100).toFixed(0)}% ≥ ${CRITICAL_BUDGET_USAGE * 100}%; downgrade to compact retry.`,
      projectedSavings: Math.max(0, input.proposedStepTokens - 1500),
      recommendedAction: 'compact_retry',
    };
  }

  // ── Low-value section + heavy step → skip ──────────────────────────
  if (input.sectionValue < LOW_SECTION_VALUE
      && input.proposedStepTokens >= HEAVY_STEP_TOKENS
      && input.attemptsSoFar >= 2) {
    return {
      decision: 'skip_low_value_retry',
      reason: `Section value ${input.sectionValue.toFixed(2)} < ${LOW_SECTION_VALUE} with heavy ${input.proposedStepTokens}-token step on attempt ${input.attemptsSoFar + 1}; skip.`,
      projectedSavings: input.proposedStepTokens,
      recommendedAction: 'soften_claims',
    };
  }

  // ── Default: execute as planned ────────────────────────────────────
  return {
    decision: 'execute_as_planned',
    reason: 'Cost trajectory acceptable; execute step as planned.',
    projectedSavings: 0,
    recommendedAction: input.step.action,
  };
}

/**
 * Compute a section value 0..1 from its position + the convergence
 * weighting. Sections at article extremities (intro/closing) and
 * sections with strategic-anchor density are higher value.
 */
export function deriveSectionValue(input: {
  sectionIndex: number;
  totalSections: number;
  isAccepted: boolean;
  hasGroundingAnchors: boolean;
  hasStrategicAnchors: boolean;
}): number {
  let value = 0.5; // baseline
  // Intro and closing carry disproportionate weight.
  if (input.sectionIndex === 0 || input.sectionIndex === input.totalSections - 1) {
    value += 0.25;
  }
  // Strategic + grounding anchors raise value.
  if (input.hasGroundingAnchors) value += 0.15;
  if (input.hasStrategicAnchors) value += 0.10;
  // Already-accepted sections aren't worth re-investing in.
  if (input.isAccepted) value -= 0.30;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
