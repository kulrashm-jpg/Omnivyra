/**
 * Creator Rendering contracts — public surface (barrel).
 *
 * R0 PURE FOUNDATION. Types + a pure deterministic-hash strategy + the
 * immutable lifecycle/transition data. NO providers, NO queue runtime,
 * NO workspace/scheduler integration, NO DB. Importing this changes zero
 * runtime behavior — nothing in pages/ or backend/queue/ imports it yet.
 */

export type {
  RenderModality,
  RenderBlueprintProjection,
  RenderPackagingProjection,
  RenderPlatformProjection,
  RenderParameters,
  RenderModerationContext,
  RenderSpec,
  RenderOutputRef,
  RenderAttemptOutcome,
  RenderAttemptResult,
  RenderRequestProjector,
} from './renderTypes';
export { RENDER_SAFE_FIELDS, RENDER_FORBIDDEN_FIELDS } from './renderTypes';

export type {
  RenderProviderKey,
  RenderCapabilityMatrix,
  RenderProviderHealthState,
  RenderProviderHealth,
  CreditEstimate,
  ProviderHandle,
  ProviderStatusState,
  ProviderStatus,
  RenderProvider,
  RenderProviderRegistry,
} from './providerTypes';

export type {
  RenderModerationStage,
  RenderModerationDecision,
  RenderModerationSeverity,
  RenderModerationReason,
  RenderModerationFinding,
  RenderModerationResult,
} from './moderationTypes';
export { FAIL_CLOSED_MODERATION, isModerationPassable } from './moderationTypes';

export type {
  RenderQueuePriority,
  RenderRecoveryKind,
  RenderBackoffPolicy,
  RenderQueueItem,
  RenderQueueDispatchResult,
} from './queueTypes';

export type {
  RenderLifecycleState,
  RenderTerminalState,
} from './lifecycleTypes';
export {
  RENDER_TERMINAL_STATES,
  RENDER_LEGAL_TRANSITIONS,
  isRenderTerminal,
  isLegalRenderTransition,
} from './lifecycleTypes';

export {
  stableCanonicalize,
  stableStringify,
  computeDeterministicInputHash,
} from './deterministicHash';
