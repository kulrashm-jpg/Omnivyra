
/**
 * GET /api/social-platforms/configs
 *
 * Returns only APIs suitable for social posting:
 * platform_type = 'social' AND is_active = TRUE
 * AND (company_id = :companyId OR company_id IS NULL)
 *
 * Used by Social Platform Settings page to enforce separation from External APIs.
 * External APIs page shows all APIs; this endpoint shows only social posting APIs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSocialPostingConfigs } from '../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';

const requireExternalApiAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string,
  requireManage = false
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };
  if (await isSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };
  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (fallbackRole === Role.COMPANY_ADMIN || fallbackRole === Role.ADMIN || fallbackRole === Role.SUPER_ADMIN) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (requireManage && !(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

const requirePlatformAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };
  if (await isSuperAdmin(user.id)) return { userId: user.id, role: 'SUPER_ADMIN' };
  res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  return null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query?.companyId as string | undefined;
  const platformScopeRequested = req.query?.scope === 'platform';

  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId or scope=platform required' });
  }

  const access = platformScopeRequested
    ? await requirePlatformAdmin(req, res)
    : await requireExternalApiAccess(req, res, companyId, false);
  if (!access) return;

  try {
    const apis = platformScopeRequested
      ? await getSocialPostingConfigs(null, { platformScope: true })
      : await getSocialPostingConfigs(companyId, { skipCache: req.query?.skipCache === '1' });
    return res.status(200).json({ apis });
  } catch (err: any) {
    console.error('[social-platforms/configs]', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Failed to load configs' });
  }
}
