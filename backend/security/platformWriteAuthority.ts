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
 * (isPlatformSuperAdminPrincipal): `capability_assignments` can grant any
 * capability directly to any user. So platform writes require the established
 * predicate for platform authority — an active platform SUPER_ADMIN role on a
 * canonical (non-bridge) principal — IN ADDITION to their capability gate.
 * (Closure-009: the publish-recovery routes now gate on the dedicated
 * PUBLISH_RECOVERY_MANAGE capability with step-up, and this helper also backs
 * the other platform-wide write routes; see their call sites.) Real platform super-admins remain
 * platform-wide by design (AuthorizationService / TenantGuard); bridge
 * principals never are.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthenticatedPrincipal, Capability } from '../../shared/contracts/security';
import { getTrustedClientIpOrNull } from '../../lib/security/clientIp';
import { logSecurityEvent } from './audit/SecurityAuditService';
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

/**
 * Closure-013 (D-3) — the audited form of requirePlatformWriteAuthority.
 *
 * requireCapability has already logged `elevated_route_accessed` (or nothing,
 * without step-up) by the time this runs, so a refusal here would otherwise
 * leave a trail that reads as an allowed elevated access. This records the
 * refusal as `elevated_route_denied` before answering 403. Await it:
 * `if (!(await enforcePlatformWriteAuthority(...))) return;`.
 */
export async function enforcePlatformWriteAuthority(
  req: NextApiRequest,
  res: NextApiResponse,
  actor: PlatformWriteActor & Partial<Pick<AuthenticatedPrincipal, 'sessionId' | 'supabaseUid'>>,
  capability: Capability,
  operation: string,
): Promise<boolean> {
  if (hasPlatformWriteAuthority(actor)) return true;
  await logSecurityEvent({
    capability,
    decision: 'elevated_route_denied',
    reason: `${operation} | PLATFORM_SUPER_ADMIN_REQUIRED`,
    actorUserId: actor?.userId ?? null,
    actorSessionId: actor?.sessionId ?? null,
    principalUserId: actor?.userId ?? null,
    principalSupabaseUid: actor?.supabaseUid ?? null,
    viaLegacyBridge: actor?.legacyCookieSuperAdmin === true,
    ip: getTrustedClientIpOrNull(req),
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  });
  return requirePlatformWriteAuthority(res, actor, operation);
}
