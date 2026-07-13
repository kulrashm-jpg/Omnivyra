/**
 * decisionLifecycle.ts — deterministic decision lifecycle (PMF-007R §3).
 *
 * ONE state machine for every Decision Object. Illegal transitions are impossible;
 * the machine is deterministic and replayable (no clock/randomness). Mirrors the
 * proven CKRE / AIA lifecycle pattern (frozen transition table + guard assertions).
 *
 *   CREATED → VALIDATED → APPROVED → EXECUTING → COMPLETED
 *   with SUPERSEDED / REJECTED reachable from the pre-terminal states.
 */

export type DecisionStatus =
  | 'CREATED'
  | 'VALIDATED'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'SUPERSEDED'
  | 'REJECTED';

export const DECISION_STATES: ReadonlyArray<DecisionStatus> = [
  'CREATED', 'VALIDATED', 'APPROVED', 'EXECUTING', 'COMPLETED', 'SUPERSEDED', 'REJECTED',
];

const TRANSITIONS: Readonly<Record<DecisionStatus, ReadonlyArray<DecisionStatus>>> = {
  CREATED:    ['VALIDATED', 'SUPERSEDED', 'REJECTED'],
  VALIDATED:  ['APPROVED', 'SUPERSEDED', 'REJECTED'],
  APPROVED:   ['EXECUTING', 'SUPERSEDED', 'REJECTED'],
  EXECUTING:  ['COMPLETED', 'SUPERSEDED', 'REJECTED'],
  COMPLETED:  ['SUPERSEDED'],
  SUPERSEDED: [],
  REJECTED:   [],
};

export function canDecisionTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertDecisionTransition(from: DecisionStatus, to: DecisionStatus): void {
  if (!canDecisionTransition(from, to)) {
    throw new Error(`ILLEGAL_DECISION_TRANSITION:${from}->${to}`);
  }
}

export function isDecisionTerminal(state: DecisionStatus): boolean {
  return state === 'COMPLETED' || state === 'SUPERSEDED' || state === 'REJECTED';
}

/** Next legal states from a given state (for the read model / tests). */
export function nextDecisionStates(from: DecisionStatus): ReadonlyArray<DecisionStatus> {
  return TRANSITIONS[from] ?? [];
}

/**
 * Replay a sequence of transitions from a start state, asserting each step. Returns
 * the final state. Deterministic — the same sequence always yields the same result.
 * Throws on the first illegal transition (supports replay validation).
 */
export function replayDecisionLifecycle(start: DecisionStatus, transitions: DecisionStatus[]): DecisionStatus {
  let state = start;
  for (const to of transitions) {
    assertDecisionTransition(state, to);
    state = to;
  }
  return state;
}
