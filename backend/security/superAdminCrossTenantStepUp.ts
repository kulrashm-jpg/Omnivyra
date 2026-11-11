/**
 * Owner principle (2026-11-12): "only Super Admin crosses companies, WITH
 * step-up". A platform Super Admin may act inside any company, but a WRITE into
 * a company where they hold no real (active) membership needs a valid step-up -
 * the same policy and evaluation every platform write uses (passkey on a
 * trusted device, 10-minute window, reused within it).
 *
 * Reads never step up. A Super Admin acting in their OWN company is unchanged.
 *
 * Used by enforceRole's Super Admin bypass and by the routes that check
 * isSuperAdmin / isPlatformSuperAdmin directly. Reuses requireStepUp and the
 * registered platform policy - no new mechanism. The capability recorded on the
 * audit row is ORGANIZATION_MANAGE (acting on another organization), with the
 * reason naming the cross-tenant write; the policy is the platform-controls one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isReadMethod(method: string | undefined): boolean {
  return READ_METHODS.has(String(method ?? '').toUpperCase());
}

/**
 * Returns true when the request may proceed. On false the response (401
 * STEP_UP_REQUIRED, or 401 when no principal resolves) is already written and
 * the caller MUST return.
 *
 * The membership decision is made HERE, from the membership rows, for the
 * AUTHENTICATED principal (05): the caller supplies only the company - no
 * identity and no membership flag - so no call site can make the helper judge
 * the wrong person (e.g. the target user of an invite) and skip step-up. getUserRole reports a failed lookup
 * as "no role" (its error field never carries a failure), so `role` alone
 * decides, and an unverifiable membership falls into step-up.
 */
export async function requireSuperAdminCrossTenantStepUp(
  req: NextApiRequest,
  res: NextApiResponse,
  input: { companyId: string | null | undefined },
): Promise<boolean> {
  if (isReadMethod(req.method)) return true;

  const [{ resolvePrincipal }, { requireStepUp }, { getStepUpPolicy }, sec, { logSecurityEvent }] = await Promise.all([
    import('./IdentityResolver'),
    import('./requireStepUp'),
    import('./stepup/StepUpPolicyRegistry'),
    import('../../shared/contracts/security'),
    import('./audit/SecurityAuditService'),
  ]);
  // The ACTOR is the authenticated principal - resolved first, never passed in.
  const resolved = await resolvePrincipal(req);
  if (resolved.ok !== true) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return false;
  }

  if (input.companyId) {
    const { getUserRole } = await import('../services/rbacService');
    const { role } = await getUserRole(resolved.principal.userId, input.companyId);
    if (role) return true;          // the actor holds an active role here: not cross-tenant
  }
  // The policy applied is the PLATFORM one, explicitly. If it cannot be
  // resolved, refuse here (05): never fall back to whatever another capability's
  // policy may later say.
  const platformPolicy = getStepUpPolicy(sec.PLATFORM_CONTROLS_MANAGE);
  if (!platformPolicy) {
    await logSecurityEvent({
      capability: sec.ORGANIZATION_MANAGE,
      decision: 'stepup_required',
      reason: `super admin cross-tenant write refused: platform step-up policy not registered | company=${input.companyId ?? '(none)'}`,
      actorUserId: resolved.principal.userId,
      principalUserId: resolved.principal.userId,
    });
    res.status(401).json({ error: 'Step-up authentication required (policy unavailable)', code: 'STEP_UP_REQUIRED' });
    return false;
  }
  // A principal missing its step-up / device / MFA state is treated as having
  // NO step-up (refused cleanly), never as a crash.
  const p = resolved.principal;
  const principal = {
    ...p,
    stepUp: p.stepUp ?? { active: false, expiresAt: null, factor: null, sessionId: null },
    device: p.device ?? { deviceId: null, trusted: false, fingerprint: '' },
    mfa: p.mfa ?? { enrolled: false, factors: [], lastVerifiedAt: null, phishingResistant: false },
  } as typeof p;
  return requireStepUp(req, res, principal, {
    capability: sec.ORGANIZATION_MANAGE,
    reason: `super admin cross-tenant write into company ${input.companyId ?? '(none)'} (no membership)`,
    policyOverride: { ...platformPolicy, capability: sec.ORGANIZATION_MANAGE },
  });
}
