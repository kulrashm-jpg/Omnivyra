/**
 * Closure-005 — platform write authority for publish-recovery operations.
 *
 * The super-admin publish reconciliation, thread resume and thread
 * reconciliation routes are WRITES: they record a post as published, re-queue
 * it, publish to the tenant's platform account, or call the provider and
 * persist a snapshot. They were gated only on SUPER_ADMIN_DASHBOARD_VIEW,
 * which SecurityCapabilities documents as read-only ("NOT the destructive
 * admin actions") and which is also held by
 *   - legacy bridge principals (LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES), and
 *   - any user granted it directly through `capability_assignments`.
 * Holding a capability does not prove platform authority
 * (isPlatformSuperAdminPrincipal). No dedicated publish-recovery write
 * capability exists yet — adding one (and whether it needs step-up) is an
 * owner decision — so these writes additionally require the established
 * predicate for platform authority: an active platform SUPER_ADMIN role on a
 * canonical (non-bridge) principal. Real platform super-admins remain
 * platform-wide by design (AuthorizationService / TenantGuard); bridge
 * principals never are.
 */

import type { NextApiResponse } from 'next';
import type { AuthenticatedPrincipal } from '../../shared/contracts/security';
import { isPlatformSuperAdminPrincipal } from './platformCapabilities';

/** The fields platform write authority is decided from. */
export type PlatformWriteActor = Pick<AuthenticatedPrincipal, 'userId' | 'organizations' | 'legacyCookieSuperAdmin'>;

/** True only for a canonical principal holding the active platform SUPER_ADMIN role. */
export function hasPlatformWriteAuthority(actor: PlatformWriteActor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.legacyCookieSuperAdmin === true) return false;
  return isPlatformSuperAdminPrincipal(actor);
}

/**
 * Route helper, run AFTER requireCapability: answers 403 (nothing is written)
 * unless the principal has platform write authority. Returns true when the
 * caller may proceed.
 */
export function requirePlatformWriteAuthority(
  res: NextApiResponse,
  actor: PlatformWriteActor,
  operation: string,
): boolean {
  if (hasPlatformWriteAuthority(actor)) return true;
  res.status(403).json({
    error: 'Forbidden',
    code: 'PLATFORM_SUPER_ADMIN_REQUIRED',
    operation,
  });
  return false;
}
