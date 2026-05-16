/**
 * Creator Rendering — top-level public surface (barrel).
 *
 * Step-R3: first real (image-only, synchronous, single-provider,
 * feature-flagged, fail-closed) rendering runtime. Re-exports the pure
 * contracts/projector plus the effectful executor + provider registry.
 * Effectful paths fire ONLY when ENABLE_CREATOR_RENDERING is on AND a
 * caller invokes the executor — importing this changes nothing.
 */

export * from './contracts';
export {
  projectRenderRequest,
  validateRenderProjection,
  assertRenderableAsset,
  RenderProjectionError,
} from './projector';

export {
  isCreatorRenderingEnabled,
  executeRenderJob,
} from './renderExecutor';
export type {
  RenderEvent,
  RenderDeps,
  ExecuteRenderArgs,
  ExecuteRenderResult,
} from './renderExecutor';

export { createRenderProviderRegistry } from './providers/renderProviderRegistry';
export { createOpenAIRenderProvider } from './providers/openAIRenderProvider';
export type { OpenAIProviderConfig } from './providers/openAIRenderProvider';

export {
  preRenderModeration,
  postRenderModeration,
} from './moderation/renderModerationGate';

// Step-R4 async queue orchestration (parallel to R3 sync; flag-gated).
export {
  isCreatorRenderQueueEnabled,
  enqueueRenderJob,
  claimRenderJob,
  advanceQueueState,
  completeRenderJob,
  cancelRenderJob,
  failRenderJob,
  isTransientFailure,
  isTerminalFailure,
} from './renderQueue';
export type { QueueState, RenderQueueDeps, EnqueueArgs, FailArgs } from './renderQueue';
export { processQueuedRenderJob } from './processQueuedRenderJob';
export type { ProcessRenderDeps, ProcessResult } from './processQueuedRenderJob';
export type { RenderProviderHealthMap } from './providers/renderProviderRegistry';

// Step-R5 distributed worker orchestration (autonomous, scheduled).
export { runRenderWorkerTick } from './renderWorker';
export type {
  RenderWorkerDeps, RenderWorkerOptions, RenderWorkerMetrics,
  WorkerProcessResult, WorkerProcessStatus,
} from './renderWorker';

// Step-R6 enterprise governance + analytics (pure; fail-closed).
export {
  GLOBAL_GOVERNANCE_SENTINEL,
  evaluateRenderGovernance,
  defaultGovernance,
  coerceGovernanceRow,
} from './governance/renderGovernance';
export type {
  GovernanceEvent, RenderGovernanceState, GovernanceContext, GovernanceDecision,
} from './governance/renderGovernance';
export { aggregateRenderAnalytics } from './governance/renderAnalytics';
export type {
  RenderAnalytics, AnalyticsInput, QueueRowLite, AttemptRowLite, JobStateRowLite,
} from './governance/renderAnalytics';

// Step-R7 pure operator-action builders (fail-closed; no lineage write).
export {
  buildGovernancePatch, buildProviderPatch, classifyQueueAction, buildOpsAuditRow,
} from './governance/renderOpsActions';
export type { OpsAction, OpsDecision } from './governance/renderOpsActions';
