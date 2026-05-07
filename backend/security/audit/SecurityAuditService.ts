/**
 * SecurityAuditService — immutable audit trail for security decisions.
 *
 * Writes ONLY append-INSERT into capability_audit_log. The table has DB
 * triggers that block UPDATE and DELETE, so audit-row tampering is
 * impossible from the app layer.
 *
 * Every privileged action records:
 *   - actor + actor session
 *   - principal (subject)
 *   - capability evaluated
 *   - org / resource
 *   - decision and reason
 *   - MFA / step-up / device snapshot
 *   - IP / user-agent
 *   - bridge-mode marker
 *
 * The shape mirrors the capability_audit_log columns. Adding a new field
 * requires a migration.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import type { AuthenticatedPrincipal } from '../../../shared/contracts/security';

export type AuditDecision =
  | 'allowed'
  | 'denied'
  | 'step_up_required'
  | 'session_revoked'
  | 'bridge_used'
  | 'bridge_rejected'
  | 'mfa_enrolled'
  | 'mfa_revoked'
  | 'mfa_failed'
  | 'passkey_verified'
  | 'passkey_registration_started'
  | 'passkey_registered'
  | 'passkey_registration_failed'
  | 'passkey_auth_started'
  | 'passkey_authenticated'
  | 'passkey_auth_failed'
  | 'passkey_revoked'
  | 'totp_enrollment_started'
  | 'totp_enrolled'
  | 'totp_verification_failed'
  | 'totp_revoked'
  | 'recovery_code_used'
  | 'recovery_codes_regenerated'
  | 'trusted_device_created'
  | 'trusted_device_registered'
  | 'trusted_device_revoked'
  | 'suspicious_device_detected'
  | 'stepup_session_created'
  | 'stepup_session_rejected'
  | 'stepup_session_expired'
  | 'stepup_session_bound'
  | 'stepup_session_revoked'
  | 'auth_session_created'
  | 'auth_session_rotated'
  | 'auth_session_revoked'
  | 'auth_session_expired'
  | 'suspicious_session_invalidated'
  | 'concurrent_session_detected'
  | 'suspicious_login'
  | 'privilege_escalated'
  | 'capability_granted'
  | 'capability_revoked'
  | 'step_up_verified';

export interface SecurityAuditEvent {
  /** When the event occurred. Defaults to now() if omitted. */
  occurredAt?: Date;

  /** Actor performing the action. Often equals the principal but differs for impersonation. */
  actorUserId?: string | null;
  actorSessionId?: string | null;

  /** Principal being acted upon (or self). */
  principalUserId?: string | null;
  principalSupabaseUid?: string | null;

  capability: string;
  organizationId?: string | null;
  resourceId?: string | null;

  decision: AuditDecision;
  reason?: string | null;

  /** MFA / step-up / device snapshot at decision time. */
  mfaFactors?: ReadonlyArray<string> | null;
  mfaLastVerifiedAt?: Date | null;
  mfaPhishingResistant?: boolean | null;
  stepupActive?: boolean | null;
  stepupFactor?: string | null;
  deviceTrusted?: boolean | null;

  /** Network attribution. */
  ip?: string | null;
  userAgent?: string | null;

  /** True if decision was satisfied via legacy cookie super-admin path. */
  viaLegacyBridge?: boolean;
}

/**
 * Insert one row into capability_audit_log. Never throws — audit failures
 * are logged but never propagate to the caller (security decisions must
 * not fail because the audit table had a transient error).
 */
export async function logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  try {
    const occurredAt = (event.occurredAt ?? new Date()).toISOString();
    const { error } = await db.from('capability_audit_log').insert({
      occurred_at:             occurredAt,
      actor_user_id:           event.actorUserId ?? null,
      actor_session_id:        event.actorSessionId ?? null,
      principal_user_id:       event.principalUserId ?? null,
      principal_supabase_uid:  event.principalSupabaseUid ?? null,
      capability:              event.capability,
      organization_id:         event.organizationId ?? null,
      resource_id:             event.resourceId ?? null,
      decision:                event.decision,
      reason:                  event.reason ?? null,
      mfa_factors:             event.mfaFactors ?? null,
      mfa_last_verified_at:    event.mfaLastVerifiedAt ? event.mfaLastVerifiedAt.toISOString() : null,
      mfa_phishing_resistant:  event.mfaPhishingResistant ?? null,
      stepup_active:           event.stepupActive ?? null,
      stepup_factor:           event.stepupFactor ?? null,
      device_trusted:          event.deviceTrusted ?? null,
      ip:                      event.ip ?? null,
      user_agent:              event.userAgent ?? null,
      via_legacy_bridge:       !!event.viaLegacyBridge,
    });
    if (error) {
      logger.warn('security_audit_insert_failed', { capability: event.capability, message: error.message });
    }
  } catch (err) {
    logger.warn('security_audit_insert_threw', {
      capability: event.capability,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convenience: serialize the snapshot of MFA / step-up / device state from
 * an AuthenticatedPrincipal so call sites don't have to spread fields.
 */
export function snapshotFromPrincipal(
  principal: AuthenticatedPrincipal | null,
): Pick<SecurityAuditEvent, 'mfaFactors' | 'mfaLastVerifiedAt' | 'mfaPhishingResistant' | 'stepupActive' | 'stepupFactor' | 'deviceTrusted'> {
  if (!principal) {
    return {
      mfaFactors: null,
      mfaLastVerifiedAt: null,
      mfaPhishingResistant: null,
      stepupActive: null,
      stepupFactor: null,
      deviceTrusted: null,
    };
  }
  return {
    mfaFactors: principal.mfa.factors,
    mfaLastVerifiedAt: principal.mfa.lastVerifiedAt,
    mfaPhishingResistant: principal.mfa.phishingResistant,
    stepupActive: principal.stepUp.active,
    stepupFactor: principal.stepUp.factor,
    deviceTrusted: principal.device.trusted,
  };
}

/**
 * Specialized helper for the cookie super-admin bridge: every call from a
 * legacy cookie principal must be audited regardless of whether the action
 * succeeded. See backend/security/legacyCookieSuperAdminBridge.ts.
 */
export async function logCookieSuperAdminUsage(input: {
  capability: string;
  decision: AuditDecision;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  resourceId?: string | null;
  organizationId?: string | null;
}): Promise<void> {
  await logSecurityEvent({
    capability: input.capability,
    decision: input.decision,
    reason: input.reason ?? 'legacy cookie super-admin bridge',
    actorUserId: null,
    principalUserId: null,
    principalSupabaseUid: null,
    organizationId: input.organizationId ?? null,
    resourceId: input.resourceId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    viaLegacyBridge: true,
  });
}
