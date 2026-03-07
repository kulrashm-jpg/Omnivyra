import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformStrategies } from '../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../backend/services/rbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.query.company_id as string | undefined);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const legacySession = getLegacySuperAdminSession(req);
  const { user, error: userError } = legacySession
    ? { user: { id: legacySession.userId }, error: null }
    : await getSupabaseUserFromRequest(req);
  if (userError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const isPlatformOrSuperAdmin =
    legacySession || (await isPlatformSuperAdmin(user.id)) || (await isSuperAdmin(user.id));
  if (!isPlatformOrSuperAdmin) {
    let { role, error: roleError } = await getUserRole(user.id, companyId);
    if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
      const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
      if (fallbackRole) {
        role = fallbackRole;
        roleError = null;
      }
    }
    if (roleError || !role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }

  try {
    const strategies = await getPlatformStrategies(companyId);
    const grouped = strategies.reduce((acc: Record<string, any[]>, item: any) => {
      const key = item.platform_type || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return res.status(200).json({ platforms: grouped });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to load platform configs',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export default handler;
