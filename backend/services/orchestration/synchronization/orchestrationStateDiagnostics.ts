/**
 * Orchestration State Synchronization — observability.
 * Phase-2 Step-4.
 */

import type { ExecutionStateProjection } from './orchestrationStateTypes';

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export function logStateSync(
  campaignId: string | null,
  executionId: string,
  source: string,
): void {
  LOG('STATE_SYNC', { campaign_id: campaignId, execution_id: executionId, synchronization_source: source });
}

export function logStateProject(
  campaignId: string | null,
  projection: ExecutionStateProjection,
  source: string,
): void {
  LOG('STATE_PROJECT', {
    campaign_id: campaignId,
    execution_id: projection.execution_id,
    orchestration_state: projection.orchestration_state,
    readiness_score: projection.readiness_score,
    synchronization_source: source,
  });
}

export function logReadinessChange(
  campaignId: string | null,
  executionId: string,
  previous: ExecutionStateProjection | null,
  next: ExecutionStateProjection,
  source: string,
): void {
  const prevState = previous?.orchestration_state ?? null;
  const prevScore = previous?.readiness_score ?? null;
  if (prevState === next.orchestration_state && prevScore === next.readiness_score) return;
  LOG('READINESS_CHANGE', {
    campaign_id: campaignId,
    execution_id: executionId,
    previous_state: prevState,
    new_state: next.orchestration_state,
    readiness_score: next.readiness_score,
    blocking_reasons: next.blocking_reasons,
    synchronization_source: source,
  });
  if (next.blocking_reasons.length > 0) {
    LOG('BLOCKING_REASON', {
      campaign_id: campaignId,
      execution_id: executionId,
      blocking_reasons: next.blocking_reasons,
      synchronization_source: source,
    });
  }
}

export function logStatePropagation(
  campaignId: string | null,
  executionId: string,
  target: string,
  source: string,
): void {
  LOG('STATE_PROPAGATION', { campaign_id: campaignId, execution_id: executionId, target, synchronization_source: source });
}

export function logOrchestrationStateConflict(
  campaignId: string | null,
  executionId: string,
  detail: Record<string, unknown>,
  source: string,
): void {
  LOG('ORCHESTRATION_STATE_CONFLICT', { campaign_id: campaignId, execution_id: executionId, ...detail, synchronization_source: source });
}
