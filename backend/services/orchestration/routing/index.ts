/**
 * Centralized execution routing engine (Phase-2 Step-2).
 * Single import surface for the ONE routing authority.
 */
export {
  resolveExecutionRouting,
  routeRequiresMediaIntent,
  executionRoutingEngine,
  detectRoutingConflicts,
} from './executionRoutingEngine';
export type {
  ExecutionRoutingDecision,
  ExecutionRoutingInput,
  ExecutionType,
  RoutingActivityType,
  RoutingWorkflowType,
  AssetRequirement,
  SchedulingReadiness,
  PublishReadiness,
} from './executionRoutingTypes';
