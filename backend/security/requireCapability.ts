/**
 * requireCapability — the canonical route gate.
 *
 * Replaces ad-hoc role checks (`if (role === 'SUPER_ADMIN')`) at every
 * migrated route with a single capability-based gate that:
 *   1. Resolves the principal via IdentityResolver.
 *   2. Looks up the registered step-up policy for the capability (if any).
 *   3. Calls AuthorizationService.decideCapability or
 *      decideCapabilityWithStepUp to produce + audit the decision.
 *   4. Sends a structured 401/403 on deny with the appropriate code.
 *
 * Routes call this helper exactly once at the top, then continue with
 * the authorized principal in scope. NO route-local role logic, NO
 * inline `if (role === ...)` checks, NO direct cookie checks.
 *
 * For routes that need step-up but aren't in the canonical
 * STEP_UP_REQUIRED_CAPABILITIES list, pass `requireStepUp: true` to
 * force evaluation against a default policy.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  decideCapability,
  decideCapabilityWithStepUp,
  respondDenied,
} from './AuthorizationService';
import { resolvePrincipal } from './IdentityResolver';
import { getStepUpPolicy } from './stepup/StepUpPolicyRegistry';
import { logSecurityEvent } from './audit/SecurityAuditService';
import { correlationIdFor } from './correlationId';
import { authModeFor, stepUpStatusFor } from './authMode';
import {
  STEP_UP_REQUIRED_CAPABILITIES,
  type AuthenticatedPrincipal,
  type AuthorizationRequirement,
  type Capability,
  type StepUpRequirement,
} from '../../shared/contracts/security';

export interface RequireCapabilityOptions {
  capability: Capability;
  /** When set, the principal must have an active membership in this org. */
  organizationId?: string;
  /** Free-text reason recorded in the audit row. */
  reason: string;
  /** Optional resource id for audit correlation. */
  resourceId?: string;
  /**
   * When true, force step-up evaluation even if the capability is not
   * in STEP_UP_REQUIRED_CAPABILITIES. Useful for one-off routes that
   * need elevation but reuse a non-step-up capability.
   *
   * When false, suppress step-up even for capabilities that would
   * otherwise be policy-marked. AVOID using this — it's an escape hatch
   * for migration sequencing only.
   *
   * When omitted, defaults to STEP_UP_REQUIRED_CAPABILITIES membership.
   */
  requireStepUp?: boolean;
  /**
   * Override step-up policy. If omitted, the registered policy from
   * StepUpPolicyRegistry is used. If the capability has no registered
   * policy AND this is omitted, no step-up is required.
   */
  stepUpOverride?: StepUpRequirement;
}

export type RequireCapabilityResult =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; sent: true };

/**
 * Resolve, authorize, audit, and (if denied) respond.
 *
 * Return shape:
 *   { ok: true, principal } — authorized; route continues.
 *   { ok: false, sent: true } — denied; response was written; route MUST early-return.
 */
export async function requireCapability(
  req: NextApiRequest,
  res: NextApiResponse,
  options: RequireCapabilityOptions,
): Promise<RequireCapabilityResult> {
  const correlationId = correlationIdFor(req);
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    // Audit the unauth attempt against the capability so denied-while-unauth shows up.
    await logSecurityEvent({
      capability: options.capability,
      decision: 'capability_check_failed',
      reason: `unauthenticated: ${principalResult.reason} | corr=${correlationId}`,
      organizationId: options.organizationId ?? null,
      resourceId: options.resourceId ?? null,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.setHeader('x-omnivyra-correlation-id', correlationId);
    res.status(401).json({
      error: 'Authorization required',
      code: 'NOT_AUTHENTICATED',
      capability: options.capability,
      correlationId,
      authMode: 'unauthenticated' as const,
      stepUpStatus: 'not_applicable' as const,
    });
    return { ok: false, sent: true };
  }

  const principal = principalResult.principal;
  const requirement: AuthorizationRequirement = {
    capability: options.capability,
    organizationId: options.organizationId,
    reason: options.reason,
    resourceId: options.resourceId,
  };

  // Decide whether step-up is required.
  const stepUpExplicitlySet = options.requireStepUp !== undefined;
  const stepUpDefault = STEP_UP_REQUIRED_CAPABILITIES.includes(options.capability);
  const useStepUp = stepUpExplicitlySet ? options.requireStepUp! : stepUpDefault;

  const stepUpPolicy: StepUpRequirement | null = useStepUp
    ? (options.stepUpOverride ?? getStepUpPolicy(options.capability))
    : null;

  const ip = clientIp(req);
  const ua = userAgent(req);

  if (stepUpPolicy) {
    const decision = await decideCapabilityWithStepUp(principal, requirement, stepUpPolicy, {
      actorUserId: principal.userId,
      ip,
      userAgent: ua,
    });

    if (decision.allowed === true) {
      await logSecurityEvent({
        capability: options.capability,
        decision: 'elevated_route_accessed',
        actorUserId: principal.userId,
        actorSessionId: principal.sessionId,
        principalUserId: principal.userId,
        principalSupabaseUid: principal.supabaseUid,
        resourceId: options.resourceId ?? null,
        organizationId: options.organizationId ?? null,
        reason: options.reason,
        stepupActive: principal.stepUp.active,
        stepupFactor: principal.stepUp.factor,
        mfaPhishingResistant: principal.mfa.phishingResistant,
        deviceTrusted: principal.device.trusted,
        ip,
        userAgent: ua,
      });
      return { ok: true, principal };
    }

    // decision is now narrowed to { allowed: false; reason; capability }.
    const denied = decision;
    if (denied.reason === 'STEP_UP_REQUIRED') {
      await logSecurityEvent({
        capability: options.capability,
        decision: stepUpPolicy.phishingResistantOnly === true
          ? 'phishing_resistant_required'
          : 'stepup_required',
        actorUserId: principal.userId,
        actorSessionId: principal.sessionId,
        principalUserId: principal.userId,
        principalSupabaseUid: principal.supabaseUid,
        resourceId: options.resourceId ?? null,
        organizationId: options.organizationId ?? null,
        reason: options.reason,
        stepupActive: principal.stepUp.active,
        stepupFactor: principal.stepUp.factor,
        mfaPhishingResistant: principal.mfa.phishingResistant,
        deviceTrusted: principal.device.trusted,
        viaLegacyBridge: principal.legacyCookieSuperAdmin,
        ip,
        userAgent: ua,
      });
    } else {
      await logSecurityEvent({
        capability: options.capability,
        decision: 'elevated_route_denied',
        reason: `${options.reason} | ${denied.reason} | corr=${correlationId}`,
        actorUserId: principal.userId,
        actorSessionId: principal.sessionId,
        principalUserId: principal.userId,
        principalSupabaseUid: principal.supabaseUid,
        resourceId: options.resourceId ?? null,
        organizationId: options.organizationId ?? null,
        viaLegacyBridge: principal.legacyCookieSuperAdmin,
        ip,
        userAgent: ua,
      });
    }
    respondDenied(res, denied, {
      correlationId,
      authMode: authModeFor(principal),
      stepUpStatus: stepUpStatusFor(principal, true, denied.reason !== 'STEP_UP_REQUIRED'),
    });
    return { ok: false, sent: true };
  }

  // No step-up needed — pure capability check.
  const decision = await decideCapability(principal, requirement, {
    actorUserId: principal.userId,
    ip,
    userAgent: ua,
  });
  if (decision.allowed === true) {
    return { ok: true, principal };
  }
  const deniedFlat = decision;
  await logSecurityEvent({
    capability: options.capability,
    decision: 'capability_check_failed',
    reason: `${options.reason} | ${deniedFlat.reason} | corr=${correlationId}`,
    actorUserId: principal.userId,
    actorSessionId: principal.sessionId,
    principalUserId: principal.userId,
    principalSupabaseUid: principal.supabaseUid,
    resourceId: options.resourceId ?? null,
    organizationId: options.organizationId ?? null,
    viaLegacyBridge: principal.legacyCookieSuperAdmin,
    ip,
    userAgent: ua,
  });
  respondDenied(res, deniedFlat, {
    correlationId,
    authMode: authModeFor(principal),
    stepUpStatus: stepUpStatusFor(principal, false, false),
  });
  return { ok: false, sent: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
