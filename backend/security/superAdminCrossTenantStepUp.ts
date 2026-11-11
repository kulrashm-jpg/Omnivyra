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
 * `hasMembership`: the Super Admin holds an ACTIVE role in `companyId`. When
 * unknown (a lookup that failed), pass false - that fails closed into step-up.
 */
export async function requireSuperAdminCrossTenantStepUp(
  req: NextApiRequest,
  res: NextApiResponse,
  input: { companyId: string | null | undefined; hasMembership: boolean },
): Promise<boolean> {
  if (isReadMethod(req.method)) return true;
  if (input.hasMembership) return true;

  const [{ resolvePrincipal }, { requireStepUp }, { getStepUpPolicy }, sec] = await Promise.all([
    import('./IdentityResolver'),
    import('./requireStepUp'),
    import('./stepup/StepUpPolicyRegistry'),
    import('../../shared/contracts/security'),
  ]);
  const resolved = await resolvePrincipal(req);
  if (resolved.ok !== true) {
    res.status(401).json({ error: 'Authentication required', code: 'NOT_AUTHENTICATED' });
    return false;
  }
  const platformPolicy = getStepUpPolicy(sec.PLATFORM_CONTROLS_MANAGE);
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
    ...(platformPolicy ? { policyOverride: { ...platformPolicy, capability: sec.ORGANIZATION_MANAGE } } : {}),
  });
}
