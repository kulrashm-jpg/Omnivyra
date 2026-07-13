/**
 * knowledgeEventService.ts — Company Knowledge lifecycle events (CKRE-003 §8/§9).
 *
 * REUSES the AUTH-001 event infrastructure (capability_audit_log,
 * SignupEventEnvelope, schema version, correlation, metric registry). Only the
 * knowledge.<Event> vocabulary + knowledge.* metric names are new.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { SIGNUP_EVENT_SCHEMA_VERSION, type SignupEventEnvelope } from '../signupEventService';
import { resolveCrawlCorrelationId } from '../crawl/crawlEventService';

export type KnowledgeEventName =
  | 'KnowledgeCreated'
  | 'KnowledgeValidated'
  | 'KnowledgeActivated'
  | 'KnowledgeSuperseded'
  | 'KnowledgeRolledBack'
  | 'KnowledgeArchived'
  | 'KnowledgeCompared'
  | 'KnowledgeSnapshotCreated';

export const KNOWLEDGE_EVENT_CAPABILITY_PREFIX = 'knowledge.';

export interface KnowledgeEvent {
  event: KnowledgeEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  version?: number | null;
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §9 — metric each knowledge event derives. Events remain the source of truth. */
export function metricForKnowledgeEvent(event: KnowledgeEventName): string | null {
  switch (event) {
    case 'KnowledgeCreated':         return 'versions_created';
    case 'KnowledgeActivated':       return 'versions_active';
    case 'KnowledgeArchived':        return 'versions_archived';
    case 'KnowledgeRolledBack':      return 'rollback_count';
    case 'KnowledgeCompared':        return 'comparison_count';
    case 'KnowledgeSnapshotCreated': return 'snapshot_count';
    case 'KnowledgeSuperseded':      return 'versions_superseded';
    default:                         return null; // KnowledgeValidated has no counter
  }
}

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

export { resolveCrawlCorrelationId as resolveKnowledgeCorrelationId };

/** Emit one knowledge event. Fire-and-forget; never throws. */
export async function emitKnowledgeEvent(e: KnowledgeEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event as unknown as SignupEventEnvelope['event'],
      state:     (e.version != null ? `v${e.version}` : null) as unknown as SignupEventEnvelope['state'],
      email:     null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  e.metadata ?? null,
    };
    await logSecurityEvent({
      capability:      `${KNOWLEDGE_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:        e.outcome,
      reason:          JSON.stringify(envelope),
      resourceId:      e.correlationId,
      organizationId:  e.companyId ?? null,
    });
    const metric = metricForKnowledgeEvent(e.event);
    if (metric) {
      try { recordRawCounter(`knowledge.${metric}`, 1, {}); } catch { /* fail-safe */ }
    }
  } catch (err) {
    logger.warn('knowledge_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Record a retention-cleanup count metric (§9). Fail-safe. */
export function recordRetentionCleanup(archivedCount: number): void {
  if (!(archivedCount > 0)) return;
  try { recordRawCounter('knowledge.retention_cleanup', archivedCount, {}); } catch { /* fail-safe */ }
}
