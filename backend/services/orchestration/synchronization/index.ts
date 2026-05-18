/**
 * Orchestration State Synchronization (Phase-2 Step-4).
 * Single import surface for the canonical state feed + synchronizer.
 */
export {
  synchronizeExecutionState,
  synchronizeByActivity,
  getCampaignExecutionState,
  getWeekExecutionState,
  getExecutionReadinessSummary,
  orchestrationStateSynchronizer,
} from './orchestrationStateSynchronizer';
export { projectExecutionState } from './orchestrationStateProjector';
export type {
  ExecutionStateProjection,
  CampaignExecutionState,
  WeekExecutionState,
  ExecutionStateRollup,
} from './orchestrationStateTypes';
