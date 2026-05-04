/**
 * Stage 17 — Campaign Execution State Machine Enforcement.
 * Formal state machine for execution_status transitions.
 */

export type CampaignExecutionState =
  | 'draft'
  | 'proposed'
  | 'approved'
  | 'committed'
  | 'scheduled'
  | 'executing'
  | 'completed'
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
  draft: ['proposed'],
  proposed: ['approved'],
  approved: ['committed'],
  committed: ['scheduled'],
  scheduled: ['executing'],
  executing: ['completed'],
  completed: [],
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
  'draft',
  'proposed',
  'approved',
  'committed',
  'scheduled',
  'executing',
  'completed',
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
  return state === 'completed' || state === 'COMPLETED' || state === 'PREEMPTED';
}

/** Normalize raw DB value to CampaignExecutionState. Unknown values default to DRAFT. */
export function normalizeExecutionState(raw: string | null | undefined): CampaignExecutionState {
  const direct = String(raw ?? 'DRAFT') as CampaignExecutionState;
  if (VALID_STATES.includes(direct)) return direct;
  const upper = String(raw ?? 'DRAFT').toUpperCase();
  if (VALID_STATES.includes(upper as CampaignExecutionState)) {
    return upper as CampaignExecutionState;
  }
  const aliases: Record<string, CampaignExecutionState> = {
    PROPOSED: 'proposed',
    APPROVED: 'approved',
    COMMITTED: 'committed',
    SCHEDULED: 'scheduled',
    EXECUTING: 'executing',
    EXECUTED: 'completed',
  };
  if (aliases[upper]) return aliases[upper];
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
