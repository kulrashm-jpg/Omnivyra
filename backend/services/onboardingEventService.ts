/**
 * onboardingEventService.ts — onboarding stage-transition events (ONBOARD-001R §5/§6).
 *
 * REUSES the AUTH-001 event infrastructure end-to-end — it is NOT a second
 * event system:
 *   - same sink: capability_audit_log via logSecurityEvent (immutable)
 *   - same envelope shape + schema version: SignupEventEnvelope /
 *     SIGNUP_EVENT_SCHEMA_VERSION (imported, not re-declared)
 *   - same correlation: the signup journey correlation ID
 *     (ensureSignupCorrelationId) so a company's onboarding events group with
 *     its signup events under one resource_id
 *   - same metric registry: recordRawCounter (HARDEN-001), event-derived
 *
 * Only the vocabulary (onboarding.<Event>) and the derived metric names are
 * new — exactly analogous to how signup events are a vocabulary over the same
 * audit log.
 */

import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { recordRawCounter } from '../observability';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import {
  SIGNUP_EVENT_SCHEMA_VERSION,
  ensureSignupCorrelationId,
  type SignupEventEnvelope,
} from './signupEventService';

export type OnboardingEventName =
  | 'StageStarted'
  | 'StageCompleted'
  | 'StageSkipped'
  | 'StageDismissed'
  | 'StageBlocked'
  | 'StageReopened'
  | 'JourneyCompleted'
  | 'PlatformReady';

export const ONBOARDING_EVENT_CAPABILITY_PREFIX = 'onboarding.';

export interface OnboardingEvent {
  event: OnboardingEventName;
  /** Journey correlation ID (shared with signup — resource_id). */
  correlationId: string;
  outcome: 'allowed' | 'denied';
  companyId: string | null;
  userId?: string | null;
  /** The journey stage id this event concerns (rides envelope.state). */
  stage?: string | null;
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * §6 — canonical metric each onboarding event derives. Events remain the
 * source of truth; counters are a fail-safe projection. Rates (skip/dismiss/
 * completion) and averages (completion time) are computed downstream FROM
 * these event counters — no rate is stored as a counter here.
 */
export function metricForOnboardingEvent(event: OnboardingEventName): string | null {
  switch (event) {
    case 'StageStarted':      return 'stage_entry';
    case 'StageCompleted':    return 'stage_completion';
    case 'StageSkipped':      return 'stage_skipped';
    case 'StageDismissed':    return 'stage_dismissed';
    case 'StageBlocked':      return 'stage_blocked';
    case 'JourneyCompleted':  return 'journey_completed';
    case 'PlatformReady':     return 'platform_ready';
    case 'StageReopened':     return 'stage_reopened';
    default:                  return null;
  }
}

/** Ambient request ID; null outside a request. */
function safeAmbientRequestId(): string | null {
  try { return getRequestContext()?.requestId ?? null; } catch { return null; }
}

/**
 * Recover the shared journey correlation ID for a company's onboarding.
 * Prefers the signup journey ID (continuity with signup events); falls back to
 * a stable per-company key so events are always correlatable. Never throws.
 */
export async function resolveOnboardingCorrelationId(
  email: string | null | undefined,
  companyId: string | null | undefined,
): Promise<string> {
  if (email) {
    try {
      const cid = await ensureSignupCorrelationId(email);
      if (cid) return cid;
    } catch { /* fall through */ }
  }
  return companyId ? `company:${companyId}` : 'onboarding:unknown';
}

/**
 * Emit one onboarding event into capability_audit_log using the AUTH-001
 * envelope. Fire-and-forget: never throws, never blocks the caller.
 */
export async function emitOnboardingEvent(e: OnboardingEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event as unknown as SignupEventEnvelope['event'],
      state:     (e.stage ?? null) as unknown as SignupEventEnvelope['state'],
      email:     null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  e.metadata ?? null,
    };

    await logSecurityEvent({
      capability:      `${ONBOARDING_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:        e.outcome,
      reason:          JSON.stringify(envelope),
      resourceId:      e.correlationId,
      organizationId:  e.companyId ?? null,
      principalUserId: e.userId ?? null,
      ip:              e.ip ?? null,
      userAgent:       e.userAgent ?? null,
    });

    const metric = metricForOnboardingEvent(e.event);
    if (metric) {
      try {
        recordRawCounter(`onboarding.${metric}`, 1, { stage: e.stage ?? 'n/a' });
      } catch { /* fail-safe — metrics never affect the event path */ }
    }
  } catch (err) {
    logger.warn('onboarding_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
