/**
 * agentRecovery.ts — deterministic agent failure recovery (AIA-001 §8).
 *
 * ONE recovery model for a failed step. Pure decision function — identical state
 * yields the identical action. Composes with (does not duplicate) the AIC-001
 * capability-level recovery: AIC recovers WITHIN a capability; this recovers the
 * AGENT step (retry the step, fall back to another capability, roll back to the
 * last checkpoint, accept partial, or require manual intervention).
 */

export type StepFailureKind = 'capability_failed' | 'capability_blocked' | 'timeout' | 'none';

export type AgentRecoveryAction =
  | 'retry_step'
  | 'fallback_capability'
  | 'rollback'          // restore last checkpoint and stop for manual intervention
  | 'partial'           // accept partial completion (best_effort agents)
  | 'manual'            // block for manual intervention
  | 'fail';

export interface AgentRecoveryState {
  failure: StepFailureKind;
  attempt: number;          // step attempts already made (1-based)
  maxAttempts: number;
  hasFallbackCapability: boolean;
  fallbackUsed: boolean;
  bestEffort: boolean;      // completionStrategy === 'best_effort'
  hasCheckpoint: boolean;
}

export interface AgentRecoveryDecision {
  action: AgentRecoveryAction;
  reason: string;
}

/**
 * Decide the next recovery action. Precedence:
 *   1. attempts left + retryable failure → retry_step
 *   2. unused fallback capability → fallback_capability
 *   3. attempts exhausted + best_effort → partial
 *   4. a checkpoint exists → rollback (restore + manual)
 *   5. otherwise → fail (or manual for blocked)
 */
export function decideAgentRecovery(state: AgentRecoveryState): AgentRecoveryDecision {
  if (state.failure === 'none') return { action: 'fail', reason: 'no_failure' };

  const attemptsLeft = state.attempt < state.maxAttempts;

  if (state.failure === 'capability_blocked') {
    return { action: 'manual', reason: 'capability_blocked_manual' };
  }

  if (attemptsLeft && (state.failure === 'capability_failed' || state.failure === 'timeout')) {
    return { action: 'retry_step', reason: `${state.failure}_retry` };
  }

  if (state.hasFallbackCapability && !state.fallbackUsed) {
    return { action: 'fallback_capability', reason: 'fallback_capability' };
  }

  if (state.bestEffort) {
    return { action: 'partial', reason: 'best_effort_partial' };
  }

  if (state.hasCheckpoint) {
    return { action: 'rollback', reason: 'rollback_to_checkpoint' };
  }

  return { action: 'fail', reason: 'exhausted' };
}
