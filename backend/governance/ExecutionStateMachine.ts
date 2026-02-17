/**
 * Stage 17 — Campaign Execution State Machine Enforcement.
 * Formal state machine for execution_status transitions.
 */

export type CampaignExecutionState =
  | 'DRAFT'
  | 'PRE_PLANNING'
  | 'INVALIDATED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'PREEMPTED';

export const ALLOWED_EXECUTION_TRANSITIONS: Record<
  CampaignExecutionState,
  CampaignExecutionState[]
> = {
  DRAFT: ['PRE_PLANNING'],
  PRE_PLANNING: ['INVALIDATED'],
  INVALIDATED: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'PREEMPTED'],
  PAUSED: ['ACTIVE', 'PREEMPTED'],
  COMPLETED: [],
  PREEMPTED: [],
};

export class InvalidExecutionTransitionError extends Error {
  code = 'INVALID_EXECUTION_TRANSITION' as const;
  from: CampaignExecutionState;
  to: CampaignExecutionState;
  constructor(from: CampaignExecutionState, to: CampaignExecutionState) {
    super('Illegal execution state transition');
    this.name = 'InvalidExecutionTransitionError';
    this.from = from;
    this.to = to;
  }
}

const VALID_STATES: CampaignExecutionState[] = [
  'DRAFT',
  'PRE_PLANNING',
  'INVALIDATED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'PREEMPTED',
];

/**
 * Terminal states: no further mutations allowed.
 * COMPLETED = campaign finished normally; PREEMPTED = campaign preempted by higher priority.
 */
export function isTerminalExecutionState(state: CampaignExecutionState): boolean {
  return state === 'COMPLETED' || state === 'PREEMPTED';
}

/** Normalize raw DB value to CampaignExecutionState. Unknown values default to DRAFT. */
export function normalizeExecutionState(raw: string | null | undefined): CampaignExecutionState {
  const upper = String(raw ?? 'DRAFT').toUpperCase();
  if (VALID_STATES.includes(upper as CampaignExecutionState)) {
    return upper as CampaignExecutionState;
  }
  return 'DRAFT';
}

/**
 * Assert that a transition from current state to next state is allowed.
 * @throws InvalidExecutionTransitionError when transition is invalid
 */
export function assertValidExecutionTransition(
  from: CampaignExecutionState,
  to: CampaignExecutionState
): void {
  const allowed = ALLOWED_EXECUTION_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    throw new InvalidExecutionTransitionError(from, to);
  }
}
