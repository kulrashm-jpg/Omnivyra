/**
 * requireStepUp — gate a route on an active step-up session for a given
 * capability, AFTER the capability check has been done elsewhere.
 *
 * Most routes should use `requireCapability` (which composes both
 * checks). Use `requireStepUp` when the capability check has already
 * been done by another helper (e.g., a Wave-1-era auth middleware that
 * we haven't migrated yet) and we want to add step-up enforcement
 * incrementally.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluateStepUp } from './StepUpAuthorizationService';
import { getStepUpPolicy } from './stepup/StepUpPolicyRegistry';
import { logSecurityEvent } from './audit/SecurityAuditService';
import { respondDenied } from './AuthorizationService';
import { correlationIdFor } from './correlationId';
import { authModeFor } from './authMode';
import type {
  AuthenticatedPrincipal,
  Capability,
  StepUpRequirement,
} from '../../shared/contracts/security';

export interface RequireStepUpOptions {
  capability: Capability;
  reason: string;
  /** Override the registered policy. */
  policyOverride?: StepUpRequirement;
}

/**
 * Returns true iff step-up is satisfied. On false, response was already
 * written (401 with `STEP_UP_REQUIRED` code) and the caller MUST early-return.
 */
export async function requireStepUp(
  req: NextApiRequest,
  res: NextApiResponse,
  principal: AuthenticatedPrincipal,
  options: RequireStepUpOptions,
): Promise<boolean> {
  const correlationId = correlationIdFor(req);
  const authMode = authModeFor(principal);
  const policy = options.policyOverride ?? getStepUpPolicy(options.capability);
  if (!policy) {
    // Capability has no registered step-up policy. By convention this is
    // a configuration error: the caller asked for step-up but the
    // capability is unmarked. Audit and refuse.
    await logSecurityEvent({
      capability: options.capability,
      decision: 'stepup_required',
      reason: `${options.reason} | no policy registered | corr=${correlationId}`,
      actorUserId: principal.userId,
      actorSessionId: principal.sessionId,
      principalUserId: principal.userId,
      principalSupabaseUid: principal.supabaseUid,
      viaLegacyBridge: principal.legacyCookieSuperAdmin,
    });
    res.setHeader('x-omnivyra-correlation-id', correlationId);
    res.status(401).json({
      error: 'Step-up authentication required (no policy registered)',
      code: 'STEP_UP_REQUIRED',
      capability: options.capability,
      correlationId,
      authMode,
      stepUpStatus: principal.legacyCookieSuperAdmin ? 'not_applicable' : 'required',
    });
    return false;
  }

  const decision = evaluateStepUp(principal, policy);
  if (decision.satisfied === true) {
    await logSecurityEvent({
      capability: options.capability,
      decision: 'elevated_route_accessed',
      actorUserId: principal.userId,
      actorSessionId: principal.sessionId,
      principalUserId: principal.userId,
      principalSupabaseUid: principal.supabaseUid,
      reason: `${options.reason} | corr=${correlationId}`,
      stepupActive: principal.stepUp.active,
      stepupFactor: principal.stepUp.factor,
      mfaPhishingResistant: principal.mfa.phishingResistant,
      deviceTrusted: principal.device.trusted,
    });
    return true;
  }

  await logSecurityEvent({
    capability: options.capability,
    decision: policy.phishingResistantOnly === true
      ? 'phishing_resistant_required'
      : 'stepup_required',
    actorUserId: principal.userId,
    actorSessionId: principal.sessionId,
    principalUserId: principal.userId,
    principalSupabaseUid: principal.supabaseUid,
    reason: `${options.reason} | ${decision.reason} | corr=${correlationId}`,
    stepupActive: principal.stepUp.active,
    stepupFactor: principal.stepUp.factor,
    mfaPhishingResistant: principal.mfa.phishingResistant,
    deviceTrusted: principal.device.trusted,
    viaLegacyBridge: principal.legacyCookieSuperAdmin,
  });

  respondDenied(
    res,
    {
      allowed: false,
      reason: 'STEP_UP_REQUIRED',
      capability: options.capability,
    },
    {
      correlationId,
      authMode,
      stepUpStatus: principal.legacyCookieSuperAdmin ? 'not_applicable' : 'required',
    },
  );
  return false;
}
