/**
 * AuthorizationService — capability-based authorization decisions.
 *
 * Every authorization check in the system flows through these helpers.
 * Route-local `if (role === 'SUPER_ADMIN')` is FORBIDDEN; check capabilities
 * via this service.
 *
 * Decisions are auditable via SecurityAuditService. Step-up requirements
 * are evaluated separately by StepUpAuthorizationService — the
 * `requireWithStepUp` helper composes both.
 */

import type { NextApiResponse } from 'next';
import { logSecurityEvent, snapshotFromPrincipal } from './audit/SecurityAuditService';
import { evaluateStepUp } from './StepUpAuthorizationService';
import type {
  AuthenticatedPrincipal,
  AuthorizationDecision,
  AuthorizationRequirement,
  Capability,
  StepUpRequirement,
} from '../../shared/contracts/security';

// ── Pure decision helpers (no DB I/O, audit-free) ────────────────────────────

/**
 * Pure capability check. No I/O, no audit. Useful for UI capability lookups
 * served via /api/auth/capabilities.
 */
export function hasCapability(
  principal: AuthenticatedPrincipal | null,
  capability: Capability,
  options: { organizationId?: string } = {},
): boolean {
  if (!principal) return false;
  if (!principal.capabilities.includes(capability)) return false;
  if (options.organizationId) {
    const org = principal.organizations.find((m) => m.organizationId === options.organizationId);
    if (!org || org.status !== 'active') return false;
  }
  return true;
}

// ── Audited decision helpers ─────────────────────────────────────────────────

/**
 * Make and audit an authorization decision. Always writes ONE row to
 * capability_audit_log. Returns the decision; never throws on the audit
 * path itself.
 */
export async function decideCapability(
  principal: AuthenticatedPrincipal | null,
  requirement: AuthorizationRequirement,
  context: {
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  } = {},
): Promise<AuthorizationDecision> {
  const snapshot = snapshotFromPrincipal(principal);

  // Not authenticated.
  if (!principal) {
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'denied',
      reason: requirement.reason ?? 'no principal',
      actorUserId: context.actorUserId ?? null,
      organizationId: requirement.organizationId ?? null,
      resourceId: requirement.resourceId ?? null,
      ip: context.ip,
      userAgent: context.userAgent,
      ...snapshot,
    });
    return { allowed: false, reason: 'NOT_AUTHENTICATED', capability: requirement.capability };
  }

  // Capability not held.
  if (!principal.capabilities.includes(requirement.capability)) {
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'denied',
      reason: requirement.reason,
      actorUserId: principal.userId,
      actorSessionId: principal.sessionId,
      principalUserId: principal.userId,
      principalSupabaseUid: principal.supabaseUid,
      organizationId: requirement.organizationId ?? null,
      resourceId: requirement.resourceId ?? null,
      ip: context.ip,
      userAgent: context.userAgent,
      viaLegacyBridge: principal.legacyCookieSuperAdmin,
      ...snapshot,
    });
    return { allowed: false, reason: 'CAPABILITY_NOT_HELD', capability: requirement.capability };
  }

  // Org scope check.
  if (requirement.organizationId) {
    const member = principal.organizations.find(
      (m) => m.organizationId === requirement.organizationId && m.status === 'active',
    );
    if (!member) {
      await logSecurityEvent({
        capability: requirement.capability,
        decision: 'denied',
        reason: requirement.reason ?? 'not org member',
        actorUserId: principal.userId,
        actorSessionId: principal.sessionId,
        principalUserId: principal.userId,
        principalSupabaseUid: principal.supabaseUid,
        organizationId: requirement.organizationId,
        resourceId: requirement.resourceId ?? null,
        ip: context.ip,
        userAgent: context.userAgent,
        viaLegacyBridge: principal.legacyCookieSuperAdmin,
        ...snapshot,
      });
      return { allowed: false, reason: 'NOT_ORG_MEMBER', capability: requirement.capability };
    }
  }

  // Allowed.
  await logSecurityEvent({
    capability: requirement.capability,
    decision: 'allowed',
    reason: requirement.reason,
    actorUserId: principal.userId,
    actorSessionId: principal.sessionId,
    principalUserId: principal.userId,
    principalSupabaseUid: principal.supabaseUid,
    organizationId: requirement.organizationId ?? null,
    resourceId: requirement.resourceId ?? null,
    ip: context.ip,
    userAgent: context.userAgent,
    viaLegacyBridge: principal.legacyCookieSuperAdmin,
    ...snapshot,
  });

  return { allowed: true };
}

/**
 * Compose capability + step-up checks. Returns allow/deny in one call so
 * callers don't fork the decision tree.
 */
export async function decideCapabilityWithStepUp(
  principal: AuthenticatedPrincipal | null,
  requirement: AuthorizationRequirement,
  stepUp: StepUpRequirement,
  context: {
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  } = {},
): Promise<AuthorizationDecision> {
  const cap = await decideCapability(principal, requirement, context);
  if (!cap.allowed) return cap;

  // Capability is held. Now check step-up.
  const stepUpDecision = evaluateStepUp(principal, stepUp);
  if (!stepUpDecision.satisfied) {
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'step_up_required',
      reason: `${requirement.reason} | step-up: ${stepUpDecision.reason}`,
      actorUserId: principal!.userId,
      actorSessionId: principal!.sessionId,
      principalUserId: principal!.userId,
      principalSupabaseUid: principal!.supabaseUid,
      organizationId: requirement.organizationId ?? null,
      resourceId: requirement.resourceId ?? null,
      ip: context.ip,
      userAgent: context.userAgent,
      viaLegacyBridge: principal!.legacyCookieSuperAdmin,
      ...snapshotFromPrincipal(principal),
    });
    return { allowed: false, reason: 'STEP_UP_REQUIRED', capability: requirement.capability };
  }
  return { allowed: true };
}

// ── HTTP-shaped helpers ──────────────────────────────────────────────────────

/**
 * Send a standard 403 response for a denied decision. The chosen status
 * code maps:
 *   NOT_AUTHENTICATED   → 401
 *   CAPABILITY_NOT_HELD → 403
 *   NOT_ORG_MEMBER      → 403
 *   STEP_UP_REQUIRED    → 401 with code STEP_UP_REQUIRED  (so the UI
 *                         knows to launch the step-up challenge)
 *   anything else       → 403
 */
export function respondDenied(res: NextApiResponse, decision: Extract<AuthorizationDecision, { allowed: false }>): void {
  if (decision.reason === 'NOT_AUTHENTICATED') {
    res.status(401).json({ error: 'Authorization required', code: 'NOT_AUTHENTICATED' });
    return;
  }
  if (decision.reason === 'STEP_UP_REQUIRED') {
    res.status(401).json({
      error: 'Step-up authentication required',
      code: 'STEP_UP_REQUIRED',
      capability: decision.capability,
    });
    return;
  }
  if (decision.reason === 'BRIDGE_FACTOR_INSUFFICIENT') {
    res.status(403).json({
      error: 'Cookie bridge cannot satisfy elevated requirement',
      code: 'BRIDGE_FACTOR_INSUFFICIENT',
      capability: decision.capability,
    });
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    code: decision.reason,
    capability: decision.capability,
  });
}
