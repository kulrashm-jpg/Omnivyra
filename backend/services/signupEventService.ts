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
import { getRequestContext } from './requestContext';
import { recordRawCounter } from '../observability';
import {
  EVENT_IMPLIED_LIFECYCLE_STATE,
  type SignupLifecycleState,
} from './signupLifecycleService';

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

/**
 * Event schema version (AUTH-001R §4).
 *
 *   '1'   — legacy: reason column held a `key=value` string
 *           (`event=X email=y reason=z ip=w`). Still parseable via
 *           parseSignupEventReason.
 *   '1.1' — current: reason column holds the versioned JSON envelope below.
 *
 * Evolution rule: ADDITIVE ONLY. New fields may be added to the envelope;
 * existing fields are never renamed or removed. Consumers must ignore
 * unknown fields. A breaking change requires a new major version and a
 * parser branch — never a rewrite of old rows (the table is append-only).
 */
export const SIGNUP_EVENT_SCHEMA_VERSION = '1.1';

/**
 * The versioned envelope serialized into capability_audit_log.reason.
 * The other contract fields ride existing columns:
 *   eventType     → capability ('signup.<Event>')
 *   timestamp     → occurred_at
 *   correlationId → resource_id
 *   actor         → principal_user_id / principal_supabase_uid (+ ip/user_agent)
 *   tenant        → organization_id
 */
export interface SignupEventEnvelope {
  /** schemaVersion */
  v: string;
  event: SignupEventName;
  /** journeyState (canonical lifecycle state at emission time) */
  state: SignupLifecycleState | null;
  email: string | null;
  reason: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
}

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
  /**
   * Canonical lifecycle state at emission (AUTH-001R §1/§3). Defaults to the
   * state the event implies (EVENT_IMPLIED_LIFECYCLE_STATE) so existing call
   * sites need no changes; pass explicitly to override.
   */
  journeyState?: SignupLifecycleState;
  /** Request ID — defaults to the ambient request context (AUTH-001R §3). */
  requestId?: string | null;
  /** Free-form structured detail carried in the envelope. */
  metadata?: Record<string, unknown> | null;
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
 * Canonical metric each event derives (AUTH-001R §5). Events remain the
 * source of truth; these counters are a projection recorded through the
 * existing HARDEN-001 registry (fail-safe, bounded). Registry names are
 * prefixed `signup.`.
 */
export function metricForSignupEvent(
  event: SignupEventName,
  outcome: 'allowed' | 'denied',
): string | null {
  switch (event) {
    case 'SignupAttempted':         return 'signup_started';
    case 'SignupValidated':         return 'signup_completed';
    case 'SignupRejected':
    case 'PublicEmailRejected':
    case 'DisposableEmailRejected':
    case 'WebsiteRejected':
    case 'ValidationFailed':
    case 'SystemFailure':           return 'signup_failed';
    case 'VerificationSent':        return outcome === 'allowed' ? 'verification_sent' : null;
    case 'VerificationSucceeded':   return outcome === 'allowed' ? 'verification_completed' : 'verification_failed';
    case 'CompanyCreated':          return 'company_created';
    case 'CompanyExists':           return 'company_exists';
    default:                        return null; // CreditsGranted / Onboarding* have no spec'd metric
  }
}

/**
 * Emit one signup event into capability_audit_log. Fire-and-forget: never
 * throws, never blocks the caller's response on failure (logSecurityEvent is
 * itself fail-safe; this wrapper only shapes the row).
 *
 * AUTH-001R: the reason column now carries the versioned JSON envelope
 * (SIGNUP_EVENT_SCHEMA_VERSION); a derived metric is recorded through the
 * HARDEN-001 registry.
 */
export async function emitSignupEvent(e: SignupEvent): Promise<void> {
  try {
    const envelope: SignupEventEnvelope = {
      v:         SIGNUP_EVENT_SCHEMA_VERSION,
      event:     e.event,
      state:     e.journeyState ?? EVENT_IMPLIED_LIFECYCLE_STATE[e.event] ?? null,
      email:     e.email ? e.email.trim().toLowerCase() : null,
      reason:    e.reason ?? null,
      requestId: e.requestId ?? safeAmbientRequestId(),
      metadata:  e.metadata ?? null,
    };

    await logSecurityEvent({
      capability:           `${SIGNUP_EVENT_CAPABILITY_PREFIX}${e.event}`,
      decision:             e.outcome,
      reason:               JSON.stringify(envelope),
      resourceId:           e.correlationId,
      organizationId:       e.companyId ?? null,
      principalUserId:      e.userId ?? null,
      principalSupabaseUid: e.supabaseUid ?? null,
      ip:                   e.ip ?? null,
      userAgent:            e.userAgent ?? null,
    });

    // §5 — derived metric (projection of the event; never authoritative).
    const metric = metricForSignupEvent(e.event, e.outcome);
    if (metric) {
      try {
        recordRawCounter(`signup.${metric}`, 1, { outcome: e.outcome });
      } catch { /* fail-safe — metrics must never affect the event path */ }
    }
  } catch (err) {
    logger.warn('signup_event_emit_failed', {
      event: e.event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Ambient request ID from the per-request context; null outside a request. */
function safeAmbientRequestId(): string | null {
  try {
    return getRequestContext()?.requestId ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a capability_audit_log.reason value from ANY schema version into a
 * normalized envelope (AUTH-001R §4 — backward compatibility). Handles:
 *   v1.1+ — JSON envelope (unknown fields preserved in `metadata`? no —
 *            unknown fields are simply retained on the returned object).
 *   v1    — legacy `event=X email=y reason=z ip=w` strings.
 * Returns null for values that are not signup-event reasons.
 */
export function parseSignupEventReason(reason: string | null | undefined): SignupEventEnvelope | null {
  if (!reason) return null;
  const trimmed = reason.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<SignupEventEnvelope>;
      if (!parsed || typeof parsed.event !== 'string') return null;
      return {
        v:         typeof parsed.v === 'string' ? parsed.v : '1.1',
        event:     parsed.event as SignupEventName,
        state:     (parsed.state as SignupLifecycleState | null) ?? null,
        email:     parsed.email ?? null,
        reason:    parsed.reason ?? null,
        requestId: parsed.requestId ?? null,
        metadata:  parsed.metadata ?? null,
      };
    } catch {
      return null;
    }
  }

  // Legacy v1: space-separated key=value pairs beginning with event=…
  if (!trimmed.startsWith('event=')) return null;
  const fields: Record<string, string> = {};
  for (const part of trimmed.split(' ')) {
    const idx = part.indexOf('=');
    if (idx > 0) fields[part.slice(0, idx)] = part.slice(idx + 1);
  }
  if (!fields.event) return null;
  return {
    v:         '1',
    event:     fields.event as SignupEventName,
    state:     EVENT_IMPLIED_LIFECYCLE_STATE[fields.event] ?? null,
    email:     fields.email ?? null,
    reason:    fields.reason ?? null,
    requestId: null,
    metadata:  null,
  };
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
