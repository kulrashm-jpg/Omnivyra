/**
 * Execution Routing — observability + conflict detection (Phase-2 Step-2).
 */

import type { ExecutionRoutingDecision, ExecutionRoutingInput } from './executionRoutingTypes';

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

function ctx(input: ExecutionRoutingInput): Record<string, unknown> {
  const cc = (input.campaign_context as Record<string, unknown> | null) ?? {};
  return {
    campaign_id: cc.campaign_id ?? null,
    execution_id: cc.execution_id ?? null,
    platform: input.platform ?? null,
    content_type: input.content_type ?? null,
  };
}

/** Detect internally inconsistent decisions (defensive — never throws). */
export function detectRoutingConflicts(d: ExecutionRoutingDecision): string[] {
  const conflicts: string[] = [];
  if (d.creator_requirement && d.execution_type === 'BOLT_TEXT') {
    conflicts.push('creator_requirement=true but execution_type=BOLT_TEXT');
  }
  if (d.execution_type === 'VIDEO_WORKFLOW' && d.asset_requirement !== 'REQUIRED') {
    conflicts.push('VIDEO_WORKFLOW without REQUIRED asset');
  }
  if (d.publish_readiness === 'READY' && d.scheduling_readiness === 'BLOCKED') {
    conflicts.push('publish READY while scheduling BLOCKED');
  }
  if (d.activity_type === 'OWNED_CONTENT' && d.workflow_type !== 'EXTERNAL_REFERENCE') {
    conflicts.push('OWNED_CONTENT not routed as EXTERNAL_REFERENCE');
  }
  return conflicts;
}

export function logRoutingDecision(
  input: ExecutionRoutingInput,
  decision: ExecutionRoutingDecision,
): void {
  const base = ctx(input);
  LOG('EXECUTION_ROUTING', { ...base, routing_source: decision.routing_source });
  LOG('ROUTING_DECISION', {
    ...base,
    execution_type: decision.execution_type,
    activity_type: decision.activity_type,
    workflow_type: decision.workflow_type,
    asset_requirement: decision.asset_requirement,
    creator_requirement: decision.creator_requirement,
    readiness_state: {
      scheduling: decision.scheduling_readiness,
      publish: decision.publish_readiness,
    },
    routing_source: decision.routing_source,
  });
  const conflicts = detectRoutingConflicts(decision);
  if (conflicts.length > 0) {
    LOG('ROUTING_CONFLICT', { ...base, conflicts });
  }
  if (decision.publish_readiness === 'INVALID_CONFIGURATION') {
    LOG('INVALID_EXECUTION_ROUTE', { ...base, reasoning: decision.reasoning });
  }
}

export function logRoutingOverride(
  input: ExecutionRoutingInput,
  from: string,
  to: string,
  reason: string,
): void {
  LOG('ROUTING_OVERRIDE', { ...ctx(input), from, to, reason });
}
