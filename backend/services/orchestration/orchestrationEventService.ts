/**
 * orchestrationEventService.ts — orchestration events + metrics (CKRE-004 §10).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log,
 * SignupEventEnvelope, schema version, correlation, metric registry). Only the
 * orchestration.<Event> vocabulary + orchestration.* metrics are new.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';

export type OrchestrationEventName =
  | 'OrchestrationPlanned'
  | 'OrchestrationStarted'
  | 'OrchestrationCompleted'
  | 'OrchestrationPartial'
  | 'OrchestrationFailed'
  | 'InvalidationPropagated'
  | 'TaskEnqueued'
  | 'TaskRetried'
  | 'TaskDeadLettered'
  | 'ExecutionResumed'
  | 'RollbackOrchestrated';

export const ORCHESTRATION_EVENT_CAPABILITY_PREFIX = 'orchestration.';

export interface OrchestrationEvent {
  event: OrchestrationEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §10 — metric each event derives. */
export function metricForOrchestrationEvent(event: OrchestrationEventName): string | null {
  switch (event) {
    case 'OrchestrationStarted':    return 'executions';
    case 'OrchestrationCompleted':  return 'successful_refreshes';
    case 'OrchestrationFailed':     return 'failed_refreshes';
    case 'OrchestrationPartial':    return 'partial_refreshes';
    case 'InvalidationPropagated':  return 'dependency_propagations';
    case 'TaskRetried':             return 'retry_count';
    case 'TaskDeadLettered':        return 'dead_letter_count';
    case 'RollbackOrchestrated':    return 'rollback_count';
    case 'ExecutionResumed':        return 'resume_count';
    default:                        return null;
  }
}

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

export { resolveCrawlCorrelationId as resolveOrchestrationCorrelationId };

/** Emit one orchestration event. Fire-and-forget; never throws. */
export async function emitOrchestrationEvent(e: OrchestrationEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event as unknown as SignupEventEnvelope['event'],
      state:     null,
      email:     null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  e.metadata ?? null,
    };
    await logSecurityEvent({
      capability:      `${ORCHESTRATION_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:        e.outcome,
      reason:          JSON.stringify(envelope),
      resourceId:      e.correlationId,
      organizationId:  e.companyId ?? null,
    });
    const metric = metricForOrchestrationEvent(e.event);
    if (metric) {
      try { recordRawCounter(`orchestration.${metric}`, 1, {}); } catch { /* fail-safe */ }
    }
  } catch (err) {
    logger.warn('orchestration_event_emit_failed', { event: e.event, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Record a queue-latency / propagation-time observation (§10). Fail-safe. */
export function recordOrchestrationLatency(metric: 'queue_latency_ms' | 'knowledge_propagation_ms', ms: number): void {
  if (!(ms >= 0)) return;
  try { recordRawCounter(`orchestration.${metric}`, Math.round(ms), {}); } catch { /* fail-safe */ }
}
