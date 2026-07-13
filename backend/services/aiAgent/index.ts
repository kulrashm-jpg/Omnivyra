/**
 * aiAgent — the canonical AI Agent Framework (AIA-001).
 *
 * ONE agent runtime, registry, lifecycle, memory model, checkpoint model, approval
 * framework, and operational read model. Agents ORCHESTRATE capabilities through
 * AIC-001 — they never run inference, assemble prompts, or read Company Knowledge
 * directly. New autonomous workflows are added as registry configuration, not new
 * orchestration layers. Composes the existing platform (AIC-001, CKC-001, CKRE,
 * report_settings persistence, AUTH events, HARDEN telemetry) — duplicates none.
 */

export { runAgent, resumeAgent, cancelAgent } from './aiAgentRuntime';
export type { AgentRuntimeDeps } from './aiAgentRuntime';

export { AGENT_REGISTRY, REGISTERED_AGENTS, resolveAgent } from './agentRegistry';
export type { AgentDefinition, AgentExecutionStrategy, MemoryStrategy, CompletionStrategy } from './agentRegistry';

export {
  AGENT_STATES, canAgentTransition, assertAgentTransition, isTerminal, nextStates,
} from './agentLifecycle';

export type {
  AgentId, AgentState, AgentStep, AgentPlan, AgentRequest, AgentResult, AgentStatus,
  AgentMemory, AgentCheckpoint, ApprovalDecision, ApprovalRecord, PendingApproval, StepMode,
} from './agentContracts';
export { emptyMemory } from './agentContracts';

export { reportSettingsAgentStore } from './agentStateStore';
export type { AgentStore } from './agentStateStore';

export {
  computeReadySteps, executeStep, stepIsActive, buildCapabilityRequest, stepFailureKind, defaultCapabilityExecutor,
} from './agentCapabilityOrchestrator';
export type { CapabilityExecutor, PredicateRegistry } from './agentCapabilityOrchestrator';

export { decideApprovalGate, makeApprovalRecord } from './agentApproval';
export type { GateOutcome, GateInput } from './agentApproval';

export { decideAgentRecovery } from './agentRecovery';
export type { AgentRecoveryAction, AgentRecoveryDecision, AgentRecoveryState, StepFailureKind } from './agentRecovery';

export {
  emitAgentEvent, metricForAgentEvent, recordAgentTelemetry, recordApprovalLatency,
  AGENT_EVENT_CAPABILITY_PREFIX,
} from './agentEvents';
export type { AgentEventName } from './agentEvents';

export { getAgentOperationalSnapshot } from './agentOperationalModel';
export type { AgentOperationalSnapshot, AgentRunView } from './agentOperationalModel';
