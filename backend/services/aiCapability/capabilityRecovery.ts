/**
 * capabilityRecovery.ts — deterministic failure recovery (AIC-001 §8).
 *
 * ONE recovery model for every capability. A pure decision function maps the
 * current failure state to the next action — retry, fallback model, partial
 * completion, or fail. No randomness, no wall-clock: identical state → identical
 * decision, so recovery is fully reproducible and testable.
 */

export type FailureKind =
  | 'model_error'
  | 'tool_failure'
  | 'validation_failure'
  | 'timeout'
  | 'no_knowledge'
  | 'none';

export type RecoveryAction =
  | 'retry'            // re-run the model pass with the same model
  | 'fallback_model'   // re-run with the capability's fallback model
  | 'partial'          // accept a partial result (capability allows it)
  | 'fail';            // give up (deterministic terminal)

export interface RecoveryState {
  failure: FailureKind;
  attempt: number;      // attempts already made (1-based)
  maxAttempts: number;
  hasFallbackModel: boolean;
  fallbackModelUsed: boolean;
  partialAllowed: boolean;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
}

/**
 * Decide the next recovery action. Deterministic. Order of precedence:
 *   1. no more attempts → partial (if allowed) else fail
 *   2. no_knowledge is non-recoverable → partial (if allowed) else fail
 *   3. model/timeout error with an unused fallback model → fallback_model
 *   4. otherwise → retry
 */
export function decideRecovery(state: RecoveryState): RecoveryDecision {
  if (state.failure === 'none') return { action: 'fail', reason: 'no_failure_but_recovery_invoked' };

  const attemptsLeft = state.attempt < state.maxAttempts;

  if (!attemptsLeft) {
    return state.partialAllowed
      ? { action: 'partial', reason: 'attempts_exhausted_partial' }
      : { action: 'fail', reason: 'attempts_exhausted' };
  }

  if (state.failure === 'no_knowledge') {
    return state.partialAllowed
      ? { action: 'partial', reason: 'no_knowledge_partial' }
      : { action: 'fail', reason: 'no_knowledge' };
  }

  if ((state.failure === 'model_error' || state.failure === 'timeout') && state.hasFallbackModel && !state.fallbackModelUsed) {
    return { action: 'fallback_model', reason: `${state.failure}_fallback_model` };
  }

  return { action: 'retry', reason: `${state.failure}_retry` };
}
