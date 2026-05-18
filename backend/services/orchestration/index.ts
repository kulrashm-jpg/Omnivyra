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
} from './generation';
export type {
  GenerationExecutionContext,
  GenerationMode,
  GenerationRouteEntry,
  OwnedContentDirective,
  ReadinessDirective,
} from './generation';
export { resolveOrCreateExecutionId, assertExecutionIdContinuity, findBlueprintItem, listBlueprintItems } from './canonicalExecutionResolver';
export { mapDailyRowToCanonical, mapBlueprintItemToCanonical, reconcile, parseRowContent } from './canonicalExecutionMapper';
