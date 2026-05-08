/**
 * MFA Reset Service — admin-driven canonical authority for breaking
 * the permanent TOTP-only lockout chain.
 *
 * The chain this closes:
 *   - User enrolled TOTP
 *   - User lost their authenticator device
 *   - User exhausted / lost their recovery codes
 *   - User has no WebAuthn passkey
 *   ⇒ Recovery-code regenerate requires phishing-resistant step-up
 *     (= WebAuthn) which the user does not have.
 *   ⇒ Permanent lockout.
 *
 * The canonical fix is operator-driven: an admin (with phishing-resistant
 * step-up via THEIR own factors) revokes the user's TOTP factor +
 * WebAuthn credentials + outstanding recovery codes. The user then
 * re-enrolls fresh on next login (post-MFA-enforcement, sync-supabase-
 * user notices `userHasVerifiedMfaFactor=false` and proceeds without an
 * MFA challenge — no `mfa_intent` is issued because there's nothing to
 * challenge).
 *
 * Safety invariants:
 *   - Operator is the admin, NOT the user. The user has no path to
 *     reset their own MFA — they go through support. This intentionally
 *     trades self-service for safety: a self-serve "reset MFA via email"
 *     creates an email-takeover MFA-bypass.
 *   - Every reset writes a full audit row: who did it, against whom,
 *     for what reason, what factors were revoked.
 *   - Idempotent: a re-click against a user with no remaining factors
 *     returns `idempotent: true`.
 *   - All live auth_sessions for the user are revoked AFTER the factor
 *     reset so a stolen pre-reset session cannot continue post-reset.
 *
 * Out of scope (per phase spec):
 *   - rewriting MFA architecture
 *   - rewriting org architecture
 *   - rewriting onboarding UX
 */

import { ownedDbTable } from '../db/writeOwner';
import { revokeFactor as revokeTotpFactor, findActiveForUser as findActiveTotpFactor } from './totp/TotpFactorRepository';
import { listForUser as listWebAuthnForUser, revokeCredential as revokeWebAuthnCredential } from './webauthn/WebAuthnCredentialRepository';
import { revokeAllSessionsForUser } from './SessionAuthorityService';
import { revokeForUser as revokeStepUpForUser } from './stepup/StepUpSessionService';
import { logger } from '../services/logger';
import { logSecurityEvent } from './audit/SecurityAuditService';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdminResetMfaInput {
  /** Target user whose MFA factors will be revoked. */
  userId: string;
  /** Operator (super-admin) performing the reset. Recorded as the actor. */
  performedBy: string;
  /** Free-text reason. Stored in the audit row. */
  reason: string;
  /** When true, also invalidate every recovery code so the user starts clean. Default true. */
  alsoRevokeRecoveryCodes?: boolean;
  /** When true, revoke every live auth_session for the user. Default true. */
  alsoRevokeSessions?: boolean;
}

export interface AdminResetMfaResult {
  ok: true;
  totpRevoked: boolean;
  webauthnRevoked: number;
  recoveryCodesRevoked: number;
  sessionsRevoked: number;
  stepupSessionsRevoked: number;
  /** True when the user had no remaining factors before this call — idempotent reset. */
  idempotent: boolean;
}

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Admin-driven MFA factor reset. Revokes:
 *   - the user's active TOTP factor (if any)
 *   - all non-revoked WebAuthn credentials
 *   - all unused recovery codes (when `alsoRevokeRecoveryCodes !== false`)
 *   - all live auth_sessions + stepup_sessions (when `alsoRevokeSessions !== false`)
 *
 * The user must re-enroll MFA on next login. For the MFA-enforcement
 * gate to allow login post-reset, no factor must remain — the new
 * `userHasVerifiedMfaFactor` check returns false and the auth_session
 * is minted without a challenge.
 */
export async function adminResetMfa(input: AdminResetMfaInput): Promise<AdminResetMfaResult> {
  const reasonText = `admin_mfa_reset operator=${input.performedBy} reason=${input.reason}`;

  // ── 1. TOTP factor ─────────────────────────────────────────────────────────
  const totp = await findActiveTotpFactor(input.userId);
  let totpRevoked = false;
  if (totp && !totp.revokedAt) {
    totpRevoked = await revokeTotpFactor(totp.id, input.userId, `admin_reset: ${input.reason}`);
  }

  // ── 2. WebAuthn credentials ────────────────────────────────────────────────
  const credentials = await listWebAuthnForUser(input.userId);
  let webauthnRevoked = 0;
  for (const cred of credentials) {
    if (cred.revokedAt) continue;
    const ok = await revokeWebAuthnCredential(cred.id, input.userId, `admin_reset: ${input.reason}`);
    if (ok) webauthnRevoked += 1;
  }

  // ── 3. Recovery codes ──────────────────────────────────────────────────────
  let recoveryCodesRevoked = 0;
  if (input.alsoRevokeRecoveryCodes !== false) {
    try {
      const { data: claimed } = await ownedDbTable('recovery_codes')
        .update({ used_at: new Date().toISOString(), used_ip: null })
        .eq('user_id', input.userId)
        .is('used_at', null)
        .select('id');
      recoveryCodesRevoked = claimed?.length ?? 0;
    } catch (err) {
      logger.warn('admin_mfa_reset_recovery_revoke_failed', {
        userId: input.userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 4. Sessions ────────────────────────────────────────────────────────────
  let sessionsRevoked = 0;
  let stepupSessionsRevoked = 0;
  if (input.alsoRevokeSessions !== false) {
    try {
      sessionsRevoked = await revokeAllSessionsForUser(input.userId, reasonText);
      stepupSessionsRevoked = await revokeStepUpForUser(input.userId, reasonText);
    } catch (err) {
      logger.warn('admin_mfa_reset_session_revoke_failed', {
        userId: input.userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const idempotent = !totpRevoked && webauthnRevoked === 0 && recoveryCodesRevoked === 0;

  // ── 5. Audit row (always written, even when idempotent) ────────────────────
  void logSecurityEvent({
    capability:      'mfa.revoke',
    decision:        'allowed',
    actorUserId:     input.performedBy,
    principalUserId: input.userId,
    resourceId:      input.userId,
    reason: `admin_mfa_reset reason=${input.reason} totp_revoked=${totpRevoked} webauthn_revoked=${webauthnRevoked} recovery_codes_revoked=${recoveryCodesRevoked} sessions_revoked=${sessionsRevoked} stepup_revoked=${stepupSessionsRevoked} idempotent=${idempotent}`,
  });

  return {
    ok: true,
    totpRevoked,
    webauthnRevoked,
    recoveryCodesRevoked,
    sessionsRevoked,
    stepupSessionsRevoked,
    idempotent,
  };
}
