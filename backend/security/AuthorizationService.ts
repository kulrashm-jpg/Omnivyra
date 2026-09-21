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
import {
  allowsCrossOrganizationIdentityAdministration,
  isPlatformSuperAdminPrincipal,
  PLATFORM_TIER_CAPABILITIES,
} from './platformCapabilities';
import { capabilitiesForRole } from './capabilityRegistry';
import type {
  AuthenticatedPrincipal,
  AuthorizationDecision,
  AuthorizationRequirement,
  Capability,
  StepUpRequirement,
} from '../../shared/contracts/security';

// ── Pure decision helpers (no DB I/O, audit-free) ────────────────────────────

const PLATFORM_TIER = new Set<Capability>(PLATFORM_TIER_CAPABILITIES);

/**
 * CPG-060 — does the principal hold `capability` IN `organizationId`?
 *
 * `principal.capabilities` is the UNION across every organisation the user
 * belongs to. Accepting it for an org-scoped check let an administrator of
 * company A exercise admin-only capabilities in company B, where they held only
 * a lesser role. The union therefore stays only an upper bound here: this
 * never grants anything the union does not.
 *
 * Unchanged, deliberately:
 *   • PLATFORM-TIER capabilities. No tenant role can hold one (boot-time
 *     invariant, platformCapabilities.ts), so their authority is not
 *     tenant-derived and scoping them to a tenant would be wrong.
 *   • A platform SUPER_ADMIN principal (`isPlatformSuperAdminPrincipal`). Its
 *     authority is platform authority, a superset of COMPANY_ADMIN wherever it
 *     is a member — exactly as before.
 * Everything else must come from the target organisation itself — the ACTIVE
 * role held there, or an assignment scoped to it — or from an assignment made
 * deliberately with no organisation. Membership is checked separately and
 * first by the callers; this answers only "held in this org?".
 */
export function holdsCapabilityInOrganization(
  principal: AuthenticatedPrincipal,
  capability: Capability,
  organizationId: string,
): boolean {
  if (!principal.capabilities.includes(capability)) return false;
  if (PLATFORM_TIER.has(capability)) return true;
  if (isPlatformSuperAdminPrincipal(principal)) return true;
  const scope = principal.capabilityScope;
  if (scope) {
    return (scope.byOrganization[organizationId] ?? []).includes(capability) || scope.global.includes(capability);
  }
  // A principal built without a scope: only the ACTIVE role held in the target org counts.
  return principal.organizations.some(
    (m) => m.organizationId === organizationId && m.status === 'active' && capabilitiesForRole(m.role).includes(capability),
  );
}

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
    if (!holdsCapabilityInOrganization(principal, capability, options.organizationId)) return false;
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
    // Bridge-vs-platform telemetry: when a bridge principal attempts a
    // platform-tier capability that's outside its allowlist, enrich the
    // audit reason so operators can monitor bridge → platform attempts.
    // Phase: Platform Authority Hard Enforcement.
    const enrichedReason = principal.legacyCookieSuperAdmin
      ? `${requirement.reason} [bridge attempted platform capability]`
      : requirement.reason;
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'denied',
      reason: enrichedReason,
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
  //
  // For platform identity administration the organizationId names the TARGET
  // tenant, not one the actor must belong to — requiring membership there makes
  // provisioning a tenant's FIRST member impossible (Phase 2Z-AF). The waiver is
  // capability-specific and role-gated; see
  // `allowsCrossOrganizationIdentityAdministration`. Only the actor-membership
  // precondition is waived — the target org still bounds the write and is still
  // recorded on the audit row below.
  const memberOfTargetOrg = requirement.organizationId
    ? principal.organizations.some(
        (m) => m.organizationId === requirement.organizationId && m.status === 'active',
      )
    : true;
  // Load-bearing only when the actor is genuinely outside the target org, so
  // the audit marker below never overstates an ordinary in-org decision.
  const orgMembershipWaived =
    Boolean(requirement.organizationId)
    && !memberOfTargetOrg
    && allowsCrossOrganizationIdentityAdministration(principal, requirement.capability);

  if (requirement.organizationId && !memberOfTargetOrg && !orgMembershipWaived) {
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

  // CPG-060 — the capability must be held IN the target organisation. Being a
  // member there and holding the capability somewhere else is not enough: the
  // cross-organisation union must never satisfy an org-scoped check.
  if (
    requirement.organizationId
    && !orgMembershipWaived
    && !holdsCapabilityInOrganization(principal, requirement.capability, requirement.organizationId)
  ) {
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'denied',
      reason: `${requirement.reason ?? ''} [capability not held in the target organisation]`.trim(),
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
    return { allowed: false, reason: 'CAPABILITY_NOT_HELD', capability: requirement.capability };
  }

  // Allowed.
  await logSecurityEvent({
    capability: requirement.capability,
    decision: 'allowed',
    reason: orgMembershipWaived
      ? `${requirement.reason} [cross-org platform identity administration]`
      : requirement.reason,
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
    const denyReason = 'reason' in stepUpDecision ? stepUpDecision.reason : 'STEP_UP_DENIED';
    await logSecurityEvent({
      capability: requirement.capability,
      decision: 'step_up_required',
      reason: `${requirement.reason} | step-up: ${denyReason}`,
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
 * Auth-denial diagnostics emitted alongside the deny reason. Phase 1 —
 * Session Integrity Diagnostics. Every super-admin frontend should branch
 * on `code` and surface `correlationId` to the operator so an engineer
 * can find the matching capability_audit_log row.
 */
export interface AuthDeniedDiagnostics {
  /** Per-request opaque id; matches what's logged in capability_audit_log. */
  correlationId: string;
  /**
   * Resolved authentication mode at decision time:
   *   - 'canonical': Supabase identity OR canonical auth_session
   *   - 'bridge':    legacy cookie super-admin bridge principal
   *   - 'unauthenticated': no principal could be resolved
   */
  authMode: 'canonical' | 'bridge' | 'unauthenticated';
  /**
   * Step-up applicability for this capability:
   *   - 'not_required':   capability has no step-up policy
   *   - 'required':       step-up needed; not satisfied
   *   - 'satisfied':      step-up active and satisfies policy
   *   - 'not_applicable': principal cannot ever satisfy step-up (e.g., bridge)
   */
  stepUpStatus: 'not_required' | 'required' | 'satisfied' | 'not_applicable';
}

/**
 * Send a standard response for a denied decision. The chosen status code
 * maps:
 *   NOT_AUTHENTICATED   → 401
 *   CAPABILITY_NOT_HELD → 403
 *   NOT_ORG_MEMBER      → 403
 *   STEP_UP_REQUIRED    → 401 with code STEP_UP_REQUIRED  (so the UI
 *                         knows to launch the step-up challenge)
 *   BRIDGE_FACTOR_INSUFFICIENT → 403
 *   anything else       → 403
 *
 * Every body carries: { error, code, capability, correlationId, authMode,
 * stepUpStatus }. Frontends MUST branch on `code`, NOT on the HTTP status,
 * to differentiate session-expired vs missing-capability vs step-up-needed.
 */
export function respondDenied(
  res: NextApiResponse,
  decision: Extract<AuthorizationDecision, { allowed: false }>,
  diagnostics: AuthDeniedDiagnostics,
): void {
  // Echo the correlation id so client scripts can pin it without parsing
  // the body. Cheap, never sensitive.
  res.setHeader('x-omnivyra-correlation-id', diagnostics.correlationId);

  const base = {
    capability: decision.capability,
    correlationId: diagnostics.correlationId,
    authMode: diagnostics.authMode,
    stepUpStatus: diagnostics.stepUpStatus,
  };

  if (decision.reason === 'NOT_AUTHENTICATED') {
    res.status(401).json({ error: 'Authorization required', code: 'NOT_AUTHENTICATED', ...base });
    return;
  }
  if (decision.reason === 'STEP_UP_REQUIRED') {
    res.status(401).json({
      error: 'Step-up authentication required',
      code: 'STEP_UP_REQUIRED',
      ...base,
    });
    return;
  }
  if (decision.reason === 'BRIDGE_FACTOR_INSUFFICIENT') {
    res.status(403).json({
      error: 'Cookie bridge cannot satisfy elevated requirement',
      code: 'BRIDGE_FACTOR_INSUFFICIENT',
      ...base,
    });
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    code: decision.reason,
    ...base,
  });
}
