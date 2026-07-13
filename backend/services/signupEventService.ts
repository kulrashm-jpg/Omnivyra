/**
 * signupEventService.ts — canonical signup event model (AUTH-001, Sections 9–11).
 *
 * ONE vocabulary for every important signup-journey stage, emitted into the
 * EXISTING immutable audit trail (capability_audit_log via
 * backend/security/audit/SecurityAuditService). This is deliberately NOT a new
 * event framework:
 *
 *   - immutable      — capability_audit_log blocks UPDATE/DELETE at the DB layer
 *   - timestamped    — occurred_at on every row
 *   - correlated     — the journey's correlation ID is stored in resource_id,
 *                      so `SELECT * FROM capability_audit_log WHERE resource_id = $1
 *                      ORDER BY occurred_at` replays one signup journey
 *   - queryable      — capability = 'signup.<EventName>' (indexable prefix scan)
 *   - retry-safe     — emission is fire-and-forget and never throws; a retried
 *                      request emits a new attempt row (attempts are the unit
 *                      of intelligence, journeys are grouped by correlation ID)
 *
 * Correlation ID lifecycle (Section 10):
 *   - Minted once per signup journey in /api/auth/signup and persisted in
 *     signup_intents.intent_data.correlation_id.
 *   - Later stages (verification, company creation, credits, onboarding) run
 *     in requests that only know the user's email — they recover the journey
 *     ID via resolveSignupCorrelationId(email). Journeys that predate AUTH-001
 *     (or invite-based flows with no intent row) get a fresh ID on first use.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { logger } from './logger';

export type SignupEventName =
  | 'SignupAttempted'
  | 'SignupValidated'
  | 'SignupRejected'
  | 'PublicEmailRejected'
  | 'DisposableEmailRejected'
  | 'WebsiteRejected'
  | 'ValidationFailed'
  | 'VerificationSent'
  | 'VerificationSucceeded'
  | 'CompanyCreated'
  | 'CompanyExists'
  | 'CreditsGranted'
  | 'OnboardingStarted'
  | 'OnboardingCompleted'
  | 'SystemFailure';

/** Prefix every event carries in capability_audit_log.capability. */
export const SIGNUP_EVENT_CAPABILITY_PREFIX = 'signup.';

export interface SignupEvent {
  event: SignupEventName;
  /** Journey correlation ID (stored in resource_id). */
  correlationId: string;
  /** allowed = the stage succeeded; denied = rejected / failed. */
  outcome: 'allowed' | 'denied';
  email?: string | null;
  /** public.users.id when known. */
  userId?: string | null;
  supabaseUid?: string | null;
  companyId?: string | null;
  /** Short machine-readable detail, e.g. an eligibility code. */
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Map an eligibility result code to the spec'd rejection event name.
 * Anything unrecognized falls back to ValidationFailed.
 */
export function signupRejectionEventFor(code: string): SignupEventName {
  switch (code) {
    case 'PUBLIC_EMAIL':        return 'PublicEmailRejected';
    case 'DISPOSABLE_EMAIL':    return 'DisposableEmailRejected';
    case 'NO_WEBSITE_FOUND':
    case 'DOMAIN_MISMATCH':
    case 'PARKED_DOMAIN':
    case 'FORWARDING_DOMAIN':
    case 'DOMAIN_NOT_CANONICAL': return 'WebsiteRejected';
    case 'CLAIMED_DOMAIN':      return 'CompanyExists';
    default:                    return 'ValidationFailed';
  }
}

/** Mint a fresh journey correlation ID. */
export function newSignupCorrelationId(): string {
  return randomUUID();
}

/**
 * Recover the journey correlation ID persisted on the newest signup_intents
 * row for this email (any status — completed intents still identify the
 * journey). Returns null when no intent row carries one.
 * Never throws.
 */
export async function resolveSignupCorrelationId(email: string): Promise<string | null> {
  try {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const { data } = await supabase
      .from('signup_intents')
      .select('intent_data')
      .eq('email', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const cid = (data as { intent_data?: { correlation_id?: unknown } } | null)
      ?.intent_data?.correlation_id;
    return typeof cid === 'string' && cid ? cid : null;
  } catch {
    return null;
  }
}

/** Recover the journey ID for this email, or mint a fresh one. Never throws. */
export async function ensureSignupCorrelationId(email: string): Promise<string> {
  return (await resolveSignupCorrelationId(email)) ?? newSignupCorrelationId();
}

/**
 * Emit one signup event into capability_audit_log. Fire-and-forget: never
 * throws, never blocks the caller's response on failure (logSecurityEvent is
 * itself fail-safe; this wrapper only shapes the row).
 */
export async function emitSignupEvent(e: SignupEvent): Promise<void> {
  try {
    const reasonParts = [
      `event=${e.event}`,
      e.email ? `email=${e.email.trim().toLowerCase()}` : null,
      e.reason ? `reason=${e.reason}` : null,
      e.ip ? `ip=${e.ip}` : null,
    ].filter(Boolean);

    await logSecurityEvent({
      capability:           `${SIGNUP_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:             e.outcome,
      reason:               reasonParts.join(' '),
      resourceId:           e.correlationId,
      organizationId:       e.companyId ?? null,
      principalUserId:      e.userId ?? null,
      principalSupabaseUid: e.supabaseUid ?? null,
      ip:                   e.ip ?? null,
      userAgent:            e.userAgent ?? null,
    });
  } catch (err) {
    logger.warn('signup_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Convenience for API routes: extract the client IP the same way the auth endpoints do. */
export function requestIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string | null } }): string {
  return String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
}

/** Convenience: extract the user-agent header, or null. */
export function requestUserAgent(req: { headers: Record<string, unknown> }): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
