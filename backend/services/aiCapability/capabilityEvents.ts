/**
 * capabilityEvents.ts — capability events + telemetry (AIC-001 §9/§10).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log via
 * logSecurityEvent, the versioned SignupEventEnvelope, correlation, and the
 * HARDEN-001 metric registry). Only the capability.<Event> vocabulary and
 * capability.* metric names are new — no duplicate event system, no new telemetry.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter, recordRawHistogram } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';
import type { CapabilityId, CapabilityResult } from './capabilityContracts';

export type CapabilityEventName =
  | 'CapabilityRequested'
  | 'CapabilityStarted'
  | 'CapabilityCompleted'
  | 'CapabilityFailed'
  | 'CapabilityRetried'
  | 'CapabilityValidated'
  | 'CapabilityRecovered';

export const CAPABILITY_EVENT_CAPABILITY_PREFIX = 'capability.';

export interface CapabilityEvent {
  event: CapabilityEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  capability?: CapabilityId | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §9 — the counter each event increments. */
export function metricForCapabilityEvent(event: CapabilityEventName): string | null {
  switch (event) {
    case 'CapabilityStarted':   return 'executions';
    case 'CapabilityCompleted': return 'completed';
    case 'CapabilityFailed':    return 'failed';
    case 'CapabilityRetried':   return 'retries';
    case 'CapabilityRecovered': return 'recovered';
    default:                    return null;
  }
}

export { resolveCrawlCorrelationId as resolveCapabilityCorrelationId };

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/** Emit one capability event. Fire-and-forget; never throws. */
export async function emitCapabilityEvent(e: CapabilityEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v: SIGNUP_EVENT_SCHEMA_VERSION,
      event: e.event as unknown as SignupEventEnvelope['event'],
      state: (e.capability ? String(e.capability) : null) as unknown as SignupEventEnvelope['state'],
      email: null,
      reason: e.reason ?? null,
      requestId: safeAmbientRequestId(),
      metadata: e.metadata ?? null,
    };
    await logSecurityEvent({
      capability: `${CAPABILITY_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision: e.outcome,
      reason: JSON.stringify(envelope),
      resourceId: e.correlationId,
      organizationId: e.companyId ?? null,
    });
    const metric = metricForCapabilityEvent(e.event);
    if (metric) { try { recordRawCounter(`capability.${metric}`, 1, {}); } catch { /* fail-safe */ } }
  } catch (err) {
    logger.warn('capability_event_emit_failed', { event: e.event, message: err instanceof Error ? err.message : String(err) });
  }
}

/** §9 — record the telemetry a finished execution produced. Fail-safe. */
export function recordCapabilityTelemetry(result: CapabilityResult): void {
  try {
    const cap = String(result.capability);
    recordRawHistogram('capability.latency_ms', result.execution.durationMs, { capability: cap });
    recordRawCounter('capability.tool_calls', result.tools.calls.length, { capability: cap });
    recordRawCounter('capability.validation_failures', result.validation.failures, { capability: cap });
    recordRawCounter('capability.tokens', result.execution.tokens.input + result.execution.tokens.output, { capability: cap });
    if (result.execution.model) recordRawCounter('capability.model_usage', 1, { model: result.execution.model });
    if (result.execution.knowledgeVersion != null) recordRawCounter('capability.knowledge_version_usage', 1, { version: String(result.execution.knowledgeVersion) });
    if (result.execution.cacheUsed) recordRawCounter('capability.cache_usage', 1, { capability: cap });
  } catch { /* fail-safe */ }
}
