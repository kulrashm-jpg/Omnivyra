/**
 * Canonical orchestration layer (Phase-2 Step-1).
 * Single entrypoint for execution reads/writes.
 */
export {
  canonicalExecutionAdapter,
  getExecutionItem,
  getExecutionItems,
  getExecutionCampaign,
  writeExecutionItem,
  writeExecutionItems,
  updateExecutionStatus,
  updateExecutionContent,
  updateExecutionContentByActivity,
  updateExecutionScheduling,
  updateExecutionLifecycle,
  reconcileExecution,
} from './canonicalExecutionAdapter';
export { reconcileContentWrite } from './canonicalWriteReconciliation';
export {
  synchronizeExecutionState,
  synchronizeByActivity,
  getCampaignExecutionState,
  getWeekExecutionState,
  getExecutionReadinessSummary,
  orchestrationStateSynchronizer,
  projectExecutionState,
} from './synchronization';
export type {
  ExecutionStateProjection,
  CampaignExecutionState,
  WeekExecutionState,
  ExecutionStateRollup,
} from './synchronization';
export {
  resolveUnifiedCampaignContext,
  resolveGenerationContext,
  getUnifiedCampaignReadiness,
  orchestrationContextResolver,
} from './context';
export type {
  UnifiedCampaignOrchestrationContext,
  UnifiedCampaignReadiness,
} from './context';
export {
  resolveGenerationExecutionContext,
  generationExecutionContextResolver,
  generationCutoverManager,
  shadowCompareGeneration,
  resolveCutoverMode,
  getAuthoritativeGenerationDecision,
  runAuthoritativeGenerationGate,
  produceAuthoritativeWeekly,
  resolveWeeklyRowsForPersistence,
  authoritativeWeeklyGenerator,
  produceAuthoritativeDaily,
  evaluateAuthoritativeDaily,
  authoritativeDailyGenerator,
} from './generation';
export type {
  GenerationExecutionContext,
  GenerationMode,
  GenerationRouteEntry,
  OwnedContentDirective,
  ReadinessDirective,
} from './generation';
export {
  getPlannerExecutionView,
  getCalendarExecutionView,
} from './views';
export type { PlannerExecutionView, CalendarExecutionView } from './views';
export {
  getExecutionProvenance,
  getCampaignProvenanceSummary,
  executionProvenanceService,
  buildAuthoritativeProvenance,
  deriveProvenanceFromContent,
  ORCHESTRATION_VERSION,
} from './provenance';
export type { ExecutionProvenance, CampaignProvenanceSummary } from './provenance';
export { hydrateAiAsset, isAiCreatableRouting, evaluateAiAssetFallback } from './assets';
export type { AIAssetProjection, AIAssetState, AIAssetOrigin } from './assets';
export {
  triggerAiAssetGeneration,
  triggerAiAssetGenerationAsync,
  isAiAssetAutogenEnabled,
  resolveRenderedMedia,
  aiAssetGenerationDiagnostics,
} from './asset-generation';
export type {
  TriggerAiAssetGenerationInput,
  TriggerAiAssetGenerationResult,
  GenerationRuntimeSummary,
} from './asset-generation';
export {
  publishOrchestrationEvent,
  subscribeOrchestrationEvents,
  registerOrchestrationEventTransport,
  orchestrationEvents,
  orchestrationEventDiagnostics,
  ensureDistributedOrchestrationTransport,
  getDurableOrchestrationEventStream,
} from './events';
export type { OrchestrationEvent, OrchestrationEventType } from './events';
export { resolveAuthoritativeWorkspace, workspaceDiagnostics } from './workspace';
export type {
  AuthoritativeWorkspaceResult,
  WorkspaceExecutionProjection,
} from './workspace';
export {
  resolveAuthoritativePublishing,
  evaluateAuthoritativePublishing,
  enforceSchedulerEligibility,
  resolveExecutionEnqueue,
  diffEnqueueVsLegacy,
  pruneExecutions,
  diffPruningVsLegacy,
  prepareDeferredReplay,
  scanReplayCandidates,
  coordinateReplay,
  resolveFinalCutoverState,
  emitFinalOrchestrationDiff,
  publishingDiagnostics,
} from './publishing';
export type {
  AuthoritativePublishingResult,
  PublishingExecutionProjection,
  SchedulerStatus,
} from './publishing';
export { resolveOrCreateExecutionId, assertExecutionIdContinuity, findBlueprintItem, listBlueprintItems } from './canonicalExecutionResolver';
export { mapDailyRowToCanonical, mapBlueprintItemToCanonical, reconcile, parseRowContent } from './canonicalExecutionMapper';
