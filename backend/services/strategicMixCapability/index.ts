/**
 * strategicMixCapability — Strategic Mix as a platform consumer (PMF-006).
 *
 * A Decision Graph (deterministic strategy model + execution graph) + a Strategic Mix
 * AIA agent (orchestration) + a platform runtime that executes the mix through AIA-001
 * (orchestration), AIC-001 (execution), and CKC-001 (knowledge), with the existing
 * strategic-mix engine as the backend (zero strategy/recommendation change) behind a
 * reversible flag.
 */

export {
  STRATEGIC_MIX_GRAPH, STRATEGIC_MIX_NODE_IDS, resolveStrategicMixNode,
  strategicMixExecutionOrder, mixProducingNode,
} from './strategicMixDecisionGraph';
export type { StrategicMixNodeId, StrategicMixNode } from './strategicMixDecisionGraph';

export { getStrategicMixRuntimeMode, shouldRunPlatform, legacyIsSafetyNet } from './strategicMixMigrationFlag';
export type { StrategicMixRuntimeMode } from './strategicMixMigrationFlag';

export { runStrategicMixViaPlatform, recordStrategicMixRuntime } from './strategicMixPlatformRuntime';
export type { StrategicMixPlatformInput, StrategicMixPlatformDeps } from './strategicMixPlatformRuntime';
