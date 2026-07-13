/**
 * decisionEvents.ts — decision events + telemetry (PMF-007R §7/§8).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log via logSecurityEvent,
 * the versioned SignupEventEnvelope, correlation, and the HARDEN-001 metric registry).
 * Only the decision.<Event> vocabulary and decision.* metric names are new — no
 * duplicate event system, no new telemetry.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';

export type DecisionEventName =
  | 'DecisionCreated'
  | 'DecisionValidated'
  | 'DecisionApproved'
  | 'DecisionSuperseded'
  | 'DecisionConsumed'
  | 'DecisionRejected';

export const DECISION_EVENT_CAPABILITY_PREFIX = 'decision.';

export interface DecisionEvent {
  event: DecisionEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  decisionId?: string | null;
  decisionType?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §8 — the counter each event increments. */
export function metricForDecisionEvent(event: DecisionEventName): string | null {
  switch (event) {
    case 'DecisionCreated':    return 'created';
    case 'DecisionValidated':  return 'validated';
    case 'DecisionApproved':   return 'approved';
    case 'DecisionSuperseded': return 'superseded';
    case 'DecisionConsumed':   return 'consumed';
    case 'DecisionRejected':   return 'rejected';
    default:                   return null;
  }
}

export { resolveCrawlCorrelationId as resolveDecisionCorrelationId };

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/** Emit one decision event. Fire-and-forget; never throws. */
export async function emitDecisionEvent(e: DecisionEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v: SIGNUP_EVENT_SCHEMA_VERSION,
      event: e.event as unknown as SignupEventEnvelope['event'],
      state: (e.decisionType ? String(e.decisionType) : null) as unknown as SignupEventEnvelope['state'],
      email: null,
      reason: e.reason ?? null,
      requestId: safeAmbientRequestId(),
      metadata: e.decisionId ? { decisionId: e.decisionId, ...(e.metadata ?? {}) } : (e.metadata ?? null),
    };
    await logSecurityEvent({
      capability: `${DECISION_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision: e.outcome,
      reason: JSON.stringify(envelope),
      resourceId: e.correlationId,
      organizationId: e.companyId ?? null,
    });
    const metric = metricForDecisionEvent(e.event);
    if (metric) { try { recordRawCounter(`decision.${metric}`, 1, {}); } catch { /* fail-safe */ } }
  } catch (err) {
    logger.warn('decision_event_emit_failed', { event: e.event, message: err instanceof Error ? err.message : String(err) });
  }
}
