
/**
 * POST /api/external-apis/[id]/test-connection
 *
 * Lightweight connection test. Resolves credentials on backend, never returns secrets.
 * Returns { success, status, message, latency_ms }.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { testApiConnection } from '../../../../backend/services/apiConnectionTestService';
import { getLegacySuperAdminSession } from '../../../../backend/services/superAdminSession';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../../backend/services/rbacService';

const requirePlatformAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) return { userId: legacySession.userId };
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id };
  if (await isSuperAdmin(user.id)) return { userId: user.id };
  res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  return null;
};

const requireExternalApiAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) return { userId: legacySession.userId };
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) return { userId: user.id };
  if (await isSuperAdmin(user.id)) return { userId: user.id };
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
  return { userId: user.id };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }

  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  const platformScope = req.query.scope === 'platform';

  if (!companyId && !platformScope) {
    return res.status(400).json({ error: 'companyId or scope=platform required' });
  }

  const access = platformScope
    ? await requirePlatformAdmin(req, res)
    : await requireExternalApiAccess(req, res, companyId);
  if (!access) return;

  try {
    const result = await testApiConnection({
      apiId: id,
      companyId: companyId || null,
      platformScope,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[external-apis/test-connection]', err?.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err?.message ?? 'Test failed',
      latency_ms: 0,
    });
  }
}
