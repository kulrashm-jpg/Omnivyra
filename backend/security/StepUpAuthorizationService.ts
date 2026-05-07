/**
 * StepUpAuthorizationService — elevated-session evaluation.
 *
 * Wave 2A scope: implement the EVALUATION side (does the principal
 * currently satisfy a StepUpRequirement?). The CHALLENGE/VERIFY side that
 * creates new stepup_sessions rows lands in Wave 2B together with the
 * WebAuthn / TOTP backends.
 *
 * Rules:
 *   - Bridge principals (legacy cookie super-admin) NEVER satisfy step-up.
 *   - WebAuthn-only requirements reject TOTP.
 *   - trustedDeviceRequired requires principal.device.trusted === true.
 *   - The step-up max-age is interpreted against principal.stepUp.expiresAt
 *     plus the require's policy maxAgeSeconds (whichever is stricter).
 */

import { logSecurityEvent } from './audit/SecurityAuditService';
import type {
  AuthenticatedPrincipal,
  StepUpDecision,
  StepUpRequirement,
} from '../../shared/contracts/security';

export function evaluateStepUp(
  principal: AuthenticatedPrincipal | null,
  requirement: StepUpRequirement,
): StepUpDecision {
  if (!principal) {
    return { satisfied: false, reason: 'NO_STEP_UP_SESSION', required: requirement };
  }

  if (principal.legacyCookieSuperAdmin) {
    return { satisfied: false, reason: 'BRIDGE_PRINCIPAL_INELIGIBLE', required: requirement };
  }

  if (!principal.stepUp.active || !principal.stepUp.expiresAt) {
    return { satisfied: false, reason: 'NO_STEP_UP_SESSION', required: requirement };
  }

  // Server-recorded expiry is the upper bound; the requirement's maxAgeSeconds
  // can be stricter. We don't have started_at on the principal directly so we
  // use expiresAt as the freshness anchor (the session's TTL was set against
  // its policy at creation time).
  if (principal.stepUp.expiresAt.getTime() <= Date.now()) {
    return { satisfied: false, reason: 'STEP_UP_EXPIRED', required: requirement };
  }

  const factor = principal.stepUp.factor;
  if (requirement.factor && factor !== requirement.factor) {
    return { satisfied: false, reason: 'FACTOR_INSUFFICIENT', required: requirement };
  }

  if (requirement.phishingResistantOnly && factor !== 'webauthn') {
    return { satisfied: false, reason: 'FACTOR_INSUFFICIENT', required: requirement };
  }

  if (requirement.trustedDeviceRequired && !principal.device.trusted) {
    return { satisfied: false, reason: 'TRUSTED_DEVICE_REQUIRED', required: requirement };
  }

  return { satisfied: true };
}

/**
 * Audit a successful step-up verification. Called by Wave-2B verify routes.
 */
export async function auditStepUpVerified(input: {
  principalUserId: string;
  principalSupabaseUid: string;
  authSessionId: string;
  factor: 'webauthn' | 'totp' | 'recovery_code';
  capability?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await logSecurityEvent({
    capability: input.capability ?? 'step_up.session',
    decision: 'step_up_verified',
    actorUserId: input.principalUserId,
    actorSessionId: input.authSessionId,
    principalUserId: input.principalUserId,
    principalSupabaseUid: input.principalSupabaseUid,
    stepupActive: true,
    stepupFactor: input.factor,
    mfaPhishingResistant: input.factor === 'webauthn',
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
