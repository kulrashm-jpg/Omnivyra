/**
 * refreshEventService.ts — refresh lifecycle events (CKRE-002 §6/§9).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log,
 * SignupEventEnvelope, schema version, correlation, metric registry). Only the
 * refresh.<Event> vocabulary and refresh.* metric names are new — no duplicate
 * event system.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import {
  SIGNUP_EVENT_SCHEMA_VERSION,
  type SignupEventEnvelope,
} from '../signupEventService';
import { resolveCrawlCorrelationId } from './crawlEventService';

export type RefreshEventName =
  | 'RefreshRequested'
  | 'RefreshSkipped'
  | 'RefreshStarted'
  | 'RefreshCompleted'
  | 'RefreshDeferred'
  | 'RefreshFailed'
  | 'MetadataRefreshed'
  | 'BusinessRefreshed'
  | 'KnowledgeVersionCreated';

export const REFRESH_EVENT_CAPABILITY_PREFIX = 'refresh.';

export interface RefreshEvent {
  event: RefreshEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  userId?: string | null;
  workflow?: string | null;
  /** Policy action / verdict / knowledge version, etc. */
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §9 — metric each refresh event derives. Events are the source of truth. */
export function metricForRefreshEvent(event: RefreshEventName): string | null {
  switch (event) {
    case 'RefreshRequested':        return 'requested';
    case 'RefreshSkipped':          return 'skipped';
    case 'RefreshStarted':          return 'executed';
    case 'RefreshDeferred':         return 'deferred';
    case 'RefreshFailed':           return 'failed';
    case 'MetadataRefreshed':       return 'metadata_refreshed';
    case 'BusinessRefreshed':       return 'business_refreshed';
    case 'KnowledgeVersionCreated': return 'knowledge_version_created';
    default:                        return null; // RefreshCompleted counted via started
  }
}

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

export { resolveCrawlCorrelationId as resolveRefreshCorrelationId };

/** Emit one refresh event. Fire-and-forget; never throws. */
export async function emitRefreshEvent(e: RefreshEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event as unknown as SignupEventEnvelope['event'],
      state:     null,
      email:     null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  { workflow: e.workflow ?? null, ...(e.metadata ?? {}) },
    };

    await logSecurityEvent({
      capability:      `${REFRESH_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:        e.outcome,
      reason:          JSON.stringify(envelope),
      resourceId:      e.correlationId,
      organizationId:  e.companyId ?? null,
      principalUserId: e.userId ?? null,
    });

    const metric = metricForRefreshEvent(e.event);
    if (metric) {
      try { recordRawCounter(`refresh.${metric}`, 1, { workflow: e.workflow ?? 'n/a' }); } catch { /* fail-safe */ }
    }
  } catch (err) {
    logger.warn('refresh_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Record an estimated token-savings metric (§9). Fail-safe. */
export function recordTokenSavings(estimatedTokens: number, workflow?: string | null): void {
  if (!(estimatedTokens > 0)) return;
  try { recordRawCounter('refresh.tokens_saved_estimate', estimatedTokens, { workflow: workflow ?? 'n/a' }); } catch { /* fail-safe */ }
}
