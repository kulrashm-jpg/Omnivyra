/**
 * knowledgeConsumerEvents.ts — consumption events + telemetry (CKC-001 §8/§9).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log via
 * logSecurityEvent, the versioned SignupEventEnvelope, correlation, and the
 * HARDEN-001 metric registry). Only the consumption.<Event> vocabulary and
 * consumption.* metric names are new — no duplicate event system, no new telemetry.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter, recordRawHistogram } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';
import type { KnowledgeConsumerId } from './knowledgeContextContracts';

export type ConsumerEventName =
  | 'ContextRequested'
  | 'ContextAssembled'
  | 'ContextServed'
  | 'ContextInvalidated'
  | 'ContextCacheHit'
  | 'ContextCacheMiss';

export const CONSUMPTION_EVENT_CAPABILITY_PREFIX = 'consumption.';

export interface ConsumerEvent {
  event: ConsumerEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  consumer?: KnowledgeConsumerId | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §9 — the counter each event increments. */
export function metricForConsumerEvent(event: ConsumerEventName): string | null {
  switch (event) {
    case 'ContextRequested':   return 'requests';
    case 'ContextServed':      return 'served';
    case 'ContextCacheHit':    return 'cache_hits';
    case 'ContextCacheMiss':   return 'cache_misses';
    case 'ContextInvalidated': return 'invalidations';
    default:                   return null;
  }
}

export { resolveCrawlCorrelationId as resolveConsumptionCorrelationId };

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/** Emit one consumption event. Fire-and-forget; never throws. */
export async function emitConsumerEvent(e: ConsumerEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v: SIGNUP_EVENT_SCHEMA_VERSION,
      event: e.event as unknown as SignupEventEnvelope['event'],
      state: (e.consumer ? String(e.consumer) : null) as unknown as SignupEventEnvelope['state'],
      email: null,
      reason: e.reason ?? null,
      requestId: safeAmbientRequestId(),
      metadata: e.metadata ?? null,
    };
    await logSecurityEvent({
      capability: `${CONSUMPTION_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision: e.outcome,
      reason: JSON.stringify(envelope),
      resourceId: e.correlationId,
      organizationId: e.companyId ?? null,
    });
    const metric = metricForConsumerEvent(e.event);
    if (metric) { try { recordRawCounter(`consumption.${metric}`, 1, {}); } catch { /* fail-safe */ } }
  } catch (err) {
    logger.warn('consumer_event_emit_failed', { event: e.event, message: err instanceof Error ? err.message : String(err) });
  }
}

/** §9 — record the telemetry that a served context produced. Fail-safe. */
export function recordContextTelemetry(input: {
  consumer: KnowledgeConsumerId;
  version: number;
  servedTokens: number;
  savedTokens: number;
  domains: string[];
}): void {
  try {
    recordRawHistogram('consumption.context_size', input.servedTokens, { consumer: String(input.consumer) });
    recordRawCounter('consumption.token_savings', Math.max(0, input.savedTokens), { consumer: String(input.consumer) });
    recordRawCounter('consumption.version_usage', 1, { version: String(input.version) });
    for (const d of input.domains) recordRawCounter('consumption.domain_usage', 1, { domain: d });
  } catch { /* fail-safe */ }
}
