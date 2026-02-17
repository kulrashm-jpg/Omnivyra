/**
 * Stage 20 — Campaign Finalization & Archival Guard.
 * Terminal-state enforcement: no mutations after COMPLETED or PREEMPTED.
 */

import { isTerminalExecutionState, type CampaignExecutionState } from '../governance/ExecutionStateMachine';

export class CampaignFinalizedError extends Error {
  code = 'CAMPAIGN_FINALIZED' as const;

  constructor() {
    super('Campaign is finalized and cannot be modified');
    this.name = 'CampaignFinalizedError';
  }
}

/**
 * Assert campaign is not in a terminal state (COMPLETED, PREEMPTED).
 * @throws CampaignFinalizedError when state is terminal
 */
export function assertCampaignNotFinalized(state: CampaignExecutionState): void {
  if (isTerminalExecutionState(state)) {
    throw new CampaignFinalizedError();
  }
}
