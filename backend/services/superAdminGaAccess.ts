/**
 * Shared Super Admin authorization for the GA endpoints.
 *
 * Unifies what `ga-connect`, `ga-select-property`, and `ga-analytics-summary`
 * use so they no longer give asymmetric outcomes for the same caller.
 *
 * READ rule — requireSuperAdminGaAccess: requireCapability(
 * SUPER_ADMIN_DASHBOARD_VIEW) and nothing else. (This comment used to claim a
 * `rbacService.isPlatformSuperAdmin` fallback; no such check exists.) The
 * GET-only callers (analytics-health, ga/gsc-analytics-summary, …) use it.
 *
 * WRITE rule — requireSuperAdminGaWriteAccess (Closure-009, owner decision):
 * every POST that connects, re-points, synchronises or acquires (ga/gsc-connect,
 * ga/gsc-select-property, ga/gsc-sync, serp-acquisition) needs, in order:
 *   1. the admin rate limit;
 *   2. INTEGRATION_PLATFORM_OAUTH_MANAGE — the dedicated platform
 *      integration-management WRITE capability, with its registered
 *      (passkey + trusted-device) step-up; the bridge can never satisfy it;
 *   3. platform write authority: an ACTIVE platform SUPER_ADMIN role on a
 *      canonical principal — so a direct capability_assignments grant of the
 *      capability alone is still refused.
 *
 * On failure this writes a standardized error JSON:
 *   { status: 'error', code, message }
 * and returns null. Callers should bail out when the result is null.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../shared/contracts/security';
import { requireCapability } from '../security/requireCapability';
import { requirePlatformWriteAuthority } from '../security/platformWriteAuthority';
import { requireAdminRateLimit } from './requestAccessService';

export type SuperAdminGaPrincipal = {
  userId: string | null;
  via: 'cookie' | 'supabase';
};

export async function requireSuperAdminGaAccess(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<SuperAdminGaPrincipal | null> {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'manage Omnivyra Google Analytics connection',
    requireStepUp: false,
  });
  if (guard.ok !== true) {
    return null;
  }

  return {
    userId: guard.principal.legacyCookieSuperAdmin ? null : guard.principal.userId,
    via: guard.principal.legacyCookieSuperAdmin ? 'cookie' : 'supabase',
  };
}

/**
 * The WRITE gate for the platform's own analytics integration (see the module
 * comment). Returns null — with the response already written — on any denial;
 * nothing has been read or written by then.
 */
export async function requireSuperAdminGaWriteAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  operation: string,
): Promise<{ userId: string } | null> {
  if (!(await requireAdminRateLimit(req, res, `rl:super-admin:analytics-write:${operation}`, 10, 60))) return null;
  const guard = await requireCapability(req, res, {
    capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
    reason: `platform analytics integration write: ${operation}`,
  });
  if (guard.ok !== true) return null;
  if (!requirePlatformWriteAuthority(res, guard.principal, operation)) return null;
  return { userId: guard.principal.userId };
}
