/**
 * CMS / Scheduler Publishing Authority layer (Phase-2 Step-31).
 * Import surface. READ-ONLY canonical projection + fallback isolation +
 * diff validation. SHADOW-default (diff-only) — never alters scheduling
 * unless cutover is AUTHORITATIVE.
 */
export {
  resolveAuthoritativePublishing,
  evaluateAuthoritativePublishing,
} from './authoritativePublishingResolver';
export type { AuthoritativePublishingResult } from './authoritativePublishingResolver';
export { buildPublishingExecutionProjection } from './publishingEligibilityProjection';
export type {
  PublishingExecutionProjection,
  PublishingMode,
  SchedulerStatus,
} from './publishingEligibilityProjection';
export {
  resolvePublishingMode,
  deriveLegacyPublishingSnapshot,
  diffPublishing,
} from './publishingFallbackManager';
export type {
  PublishingModeDecision,
  LegacyPublishingSnapshot,
  PublishingDiffResult,
} from './publishingFallbackManager';
export { publishingDiagnostics } from './publishingDiagnostics';
export { enforceSchedulerEligibility } from './schedulerAuthorityEnforcer';
export type {
  SchedulerEnforcementResult,
  SchedulerDecision,
} from './schedulerAuthorityEnforcer';
export {
  resolveExecutionEnqueue,
  diffEnqueueVsLegacy,
} from './executionEnqueueAuthority';
export type {
  ExecutionEnqueueSummary,
  ExecutionEnqueueDecision,
  EnqueueDecision,
} from './executionEnqueueAuthority';
export {
  pruneExecutions,
  diffPruningVsLegacy,
} from './executionPruningAuthority';
export type {
  ExecutionPruningSummary,
  PruningResult,
} from './executionPruningAuthority';
export { prepareDeferredReplay, scanReplayCandidates } from './deferredExecutionReplay';
export type {
  DeferredExecutionRecord,
  DeferredReplaySummary,
  ReplayScanResult,
} from './deferredExecutionReplay';
export { coordinateReplay, __resetReplayCoordinator } from './replayCoordinator';
export type { ReplayExecutionSummary } from './replayCoordinator';
export {
  resolveFinalCutoverState,
  emitFinalOrchestrationDiff,
} from './finalOrchestrationState';
export type { FinalCutoverState, AuthorityState } from './finalOrchestrationState';
