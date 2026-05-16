/**
 * Shared Super Admin authorization for the GA endpoints.
 *
 * Unifies what `ga-connect`, `ga-select-property`, and `ga-analytics-summary`
 * use so they no longer give asymmetric outcomes for the same caller.
 *
 * Auth rule (single source of truth):
 *   1. Legacy bridge cookie `super_admin_session=1` is accepted (matches
 *      pages/api/super-admin/login.ts behavior).
 *   2. Otherwise the caller must be a Supabase user whose `user_company_roles`
 *      contains a SUPER_ADMIN row (delegated to rbacService.isPlatformSuperAdmin).
 *      No `status='active'` filter — that filter was the source of the
 *      "valid Super Admin gets 403 from /ga-connect but 200 from
 *      /ga-analytics-summary" bug.
 *
 * On failure this writes a standardized error JSON:
 *   { status: 'error', code, message }
 * and returns null. Callers should bail out when the result is null.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../shared/contracts/security';
import { requireCapability } from '../security/requireCapability';

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
