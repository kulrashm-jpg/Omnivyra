/**
 * Execution Routing Engine — THE single entrypoint (Phase-2 Step-2).
 *
 * resolveExecutionRouting() is the only authority for execution
 * classification, workflow routing, asset expectation, and
 * scheduling/publish readiness eligibility. No other module should
 * independently classify — they must consume this decision.
 *
 * Pure + deterministic + observable. Registries are inputs (rules module),
 * not authorities.
 */

import { computeRoutingDecision, isLegacyAutonomousMediaRoute } from './executionRoutingRules';
import { logRoutingDecision } from './executionRoutingDiagnostics';
import type {
  ExecutionRoutingDecision,
  ExecutionRoutingInput,
} from './executionRoutingTypes';

/** Single entrypoint. Same input → same decision (deterministic). */
export function resolveExecutionRouting(
  input: ExecutionRoutingInput,
): ExecutionRoutingDecision {
  const decision = computeRoutingDecision(input ?? {});
  logRoutingDecision(input ?? {}, decision);
  return decision;
}

/**
 * Behaviour-preserving migration shim for the legacy `requiresMediaIntent`
 * boolean in generate-weekly-structure.ts. Returns the SAME truth value as
 * the old hard-coded list while sourcing the decision from the engine.
 */
export function routeRequiresMediaIntent(
  contentType: string,
  ctx?: { campaign_id?: string; execution_id?: string; platform?: string },
): boolean {
  const result = isLegacyAutonomousMediaRoute(contentType);
  // eslint-disable-next-line no-console
  console.log('[EXECUTION_ROUTING]', JSON.stringify({
    campaign_id: ctx?.campaign_id ?? null,
    execution_id: ctx?.execution_id ?? null,
    platform: ctx?.platform ?? null,
    content_type: contentType,
    decision: 'requiresMediaIntent',
    value: result,
    routing_source: 'executionRoutingEngine.v1',
  }));
  return result;
}

export type { ExecutionRoutingDecision, ExecutionRoutingInput } from './executionRoutingTypes';
export { detectRoutingConflicts } from './executionRoutingDiagnostics';

export const executionRoutingEngine = {
  resolveExecutionRouting,
  routeRequiresMediaIntent,
};
