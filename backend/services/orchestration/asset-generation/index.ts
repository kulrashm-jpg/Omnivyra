/**
 * AI-Asset Generation Runtime bridge (Phase-2 Step-19). Import surface.
 *
 * Orchestration-aware trigger into the REAL creator generation runtime,
 * with process-local queue safety, fallback signal mapping, and rendered-
 * media resolution for the Step-18 hydrator.
 */
export {
  triggerAiAssetGeneration,
  triggerAiAssetGenerationAsync,
  isAiAssetAutogenEnabled,
} from './aiAssetGenerationRuntime';
export type {
  TriggerAiAssetGenerationInput,
  TriggerAiAssetGenerationResult,
} from './aiAssetGenerationRuntime';
export { withGenerationGuard, __resetGenerationGuard } from './aiAssetGenerationQueue';
export type { QueueGuardResult } from './aiAssetGenerationQueue';
export {
  resolveRenderedMedia,
  mapRuntimeResultToSummary,
} from './aiAssetGenerationMapper';
export type {
  ResolvedRenderedMedia,
  GenerationRuntimeSummary,
} from './aiAssetGenerationMapper';
export {
  mapOutcomeToSignals,
  resolveRowGenerationSignals,
  resolveOverrideSignals,
} from './aiAssetGenerationFallback';
export type { GenerationOutcome, RuntimeFinalStatus } from './aiAssetGenerationFallback';
export { aiAssetGenerationDiagnostics } from './aiAssetGenerationDiagnostics';
