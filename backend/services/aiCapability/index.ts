/**
 * aiCapability — the canonical AI Capability Framework (AIC-001).
 *
 * ONE runtime, ONE registry, ONE pipeline, ONE validation framework, ONE output
 * contract, ONE recovery model for every AI capability in Omnivyra. Features
 * execute through executeCapability(); new capabilities are added as registry
 * configuration, not new runtimes. Composes the existing platform (CKC-001, the
 * AI gateway, existing tools, AUTH events, HARDEN observability) — duplicates none.
 */

export { executeCapability } from './aiCapabilityRuntime';
export type { CapabilityRuntimeDeps } from './aiCapabilityRuntime';

export {
  CAPABILITY_REGISTRY, REGISTERED_CAPABILITIES, resolveCapability, isModelSupported,
} from './capabilityRegistry';
export type {
  CapabilityDefinition, CapabilityKnowledgeSpec, CapabilityValidationSpec, ExecutionStrategy,
} from './capabilityRegistry';

export type {
  CapabilityId, CapabilityRequest, CapabilityResult, CapabilityStatus, CapabilitySource,
  ExecutionMetadata, PipelineStage, ToolSummary, ToolCallSummary, ValidationSummary,
  ValidationCheck, ValidationKind,
} from './capabilityContracts';
export { PIPELINE_STAGES, estimateTokens, clampConfidence } from './capabilityContracts';

export { acquireCapabilityKnowledge, defaultKnowledgeFetcher } from './capabilityKnowledge';
export type { KnowledgeFetcher } from './capabilityKnowledge';

export {
  orchestrateTools, buildToolPlan, EMPTY_TOOL_SUMMARY,
} from './capabilityTools';
export type { ToolSpec, ToolRegistry, ToolContext, ToolResult, ToolPlanItem, ToolOrchestrationResult } from './capabilityTools';

export { validateCapabilityOutput, OUTPUT_CONTRACTS } from './capabilityValidation';
export type { CapabilityRule, ValidationRules, ValidationContext } from './capabilityValidation';

export { decideRecovery } from './capabilityRecovery';
export type { RecoveryAction, RecoveryDecision, RecoveryState, FailureKind } from './capabilityRecovery';

export { defaultModelRunner } from './capabilityModelRunner';
export type { ModelRunner, ModelRunInput, ModelRunOutput } from './capabilityModelRunner';

export {
  emitCapabilityEvent, metricForCapabilityEvent, recordCapabilityTelemetry,
  CAPABILITY_EVENT_CAPABILITY_PREFIX,
} from './capabilityEvents';
export type { CapabilityEventName } from './capabilityEvents';
