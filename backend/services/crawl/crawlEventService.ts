/**
 * crawlEventService.ts — crawl lifecycle events (CKRE-001 §1/§6).
 *
 * REUSES the AUTH-001 event infrastructure end-to-end — NOT a new event
 * framework:
 *   - same sink: capability_audit_log via logSecurityEvent (immutable)
 *   - same envelope + schema version: SignupEventEnvelope /
 *     SIGNUP_EVENT_SCHEMA_VERSION (imported, not re-declared)
 *   - same correlation: the signup/onboarding journey correlation ID
 *     (ensureSignupCorrelationId → shared resource_id)
 *   - same metric registry: recordRawCounter (HARDEN-001), event-derived
 *
 * Only the crawl.<Event> vocabulary and the crawl.* metric names are new.
 */

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import {
  SIGNUP_EVENT_SCHEMA_VERSION,
  ensureSignupCorrelationId,
  type SignupEventEnvelope,
} from '../signupEventService';
import type { ChangeVerdict } from './changeDetectionService';
import { changeMetricFor } from './changeDetectionService';

export type CrawlEventName =
  | 'CrawlRequested'
  | 'CrawlStarted'
  | 'CrawlCompleted'
  | 'CrawlSkipped'
  | 'CrawlFailed'
  | 'MetadataExtracted'
  | 'SocialDiscoveryCompleted'
  | 'EnrichmentTriggered'
  | 'EnrichmentSkipped'
  | 'ChangeEvaluated';

export const CRAWL_EVENT_CAPABILITY_PREFIX = 'crawl.';

export interface CrawlEvent {
  event: CrawlEventName;
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  userId?: string | null;
  /** The crawl workflow (e.g. 'onboarding', 'profile_refresh', 'website_intelligence'). */
  workflow?: string | null;
  /** The URL / target (rides envelope.state). */
  target?: string | null;
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** §6 — canonical metric each crawl event derives. Events are the source of truth. */
export function metricForCrawlEvent(event: CrawlEventName): string | null {
  switch (event) {
    case 'CrawlCompleted':          return 'count';
    case 'CrawlSkipped':            return 'skipped';
    case 'CrawlFailed':             return 'failed';
    case 'EnrichmentTriggered':     return 'enrichment_triggered';
    case 'EnrichmentSkipped':       return 'enrichment_skipped';
    case 'MetadataExtracted':       return 'metadata_extracted';
    case 'SocialDiscoveryCompleted':return 'social_discovery_completed';
    default:                        return null;
  }
}

function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/**
 * Recover the shared journey correlation ID for a company's crawl. Prefers the
 * signup journey ID (continuity with signup/onboarding events); falls back to a
 * stable per-company key. Never throws.
 */
export async function resolveCrawlCorrelationId(
  email: string | null | undefined,
  companyId: string | null | undefined,
): Promise<string> {
  if (email) {
    try {
      const cid = await ensureSignupCorrelationId(email);
      if (cid) return cid;
    } catch { /* fall through */ }
  }
  return companyId ? `company:${companyId}` : 'crawl:unknown';
}

/** Emit one crawl event into capability_audit_log. Fire-and-forget; never throws. */
export async function emitCrawlEvent(e: CrawlEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event as unknown as SignupEventEnvelope['event'],
      state:     (e.target ?? null) as unknown as SignupEventEnvelope['state'],
      email:     null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  { workflow: e.workflow ?? null, ...(e.metadata ?? {}) },
    };

    await logSecurityEvent({
      capability:      `${CRAWL_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:        e.outcome,
      reason:          JSON.stringify(envelope),
      resourceId:      e.correlationId,
      organizationId:  e.companyId ?? null,
      principalUserId: e.userId ?? null,
    });

    const metric = metricForCrawlEvent(e.event);
    if (metric) {
      try {
        recordRawCounter(`crawl.${metric}`, 1, { workflow: e.workflow ?? 'n/a' });
      } catch { /* fail-safe */ }
    }
  } catch (err) {
    logger.warn('crawl_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record the change-detection metric for a verdict (§6). Fail-safe. The verdict
 * event itself is emitted separately as ChangeEvaluated.
 */
export function recordCrawlChangeMetric(verdict: ChangeVerdict, workflow?: string | null): void {
  const metric = changeMetricFor(verdict);
  if (!metric) return;
  try {
    recordRawCounter(`crawl.${metric}`, 1, { workflow: workflow ?? 'n/a' });
  } catch { /* fail-safe */ }
}
