import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { resolveUserContext as resolveFromLib, UserContext } from '../lib/userContext';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { normalizePermissionRole, Role } from './rbacService';

export type { UserContext };

export const resolveUserContext = async (req?: NextApiRequest): Promise<UserContext> => {
  if (!req) return resolveFromLib();

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    return resolveFromLib();
  }

  const { data: roleRows, error: roleError } = await supabase
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', user.id);

  if (roleError) {
    return {
      userId: user.id,
      role: 'user',
      companyIds: [],
      defaultCompanyId: '',
    };
  }

  const activeRoles = (roleRows || []).filter((row) => row.status === 'active');
  const companyIds = Array.from(
    new Set(activeRoles.map((row) => row.company_id).filter(Boolean))
  ) as string[];
  const isAdmin = activeRoles.some((row) => {
    const normalized = normalizePermissionRole(row.role || '');
    return normalized === Role.COMPANY_ADMIN || normalized === Role.SUPER_ADMIN;
  });

  return {
    userId: user.id,
    role: isAdmin ? 'admin' : 'user',
    companyIds,
    defaultCompanyId: companyIds[0] || '',
  };
};

export const enforceCompanyAccess = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  campaignId?: string | null;
  requireCampaignId?: boolean;
}): Promise<UserContext | null> => {
  const user = await resolveUserContext(input.req);

  if (!input.companyId) {
    console.warn('MISSING_COMPANY_ID', { path: input.req.url });
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }

  if (!user.companyIds.includes(input.companyId)) {
    console.warn('ACCESS_DENIED', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
      role: user.role,
    });
    input.res.status(403).json({ error: 'Access denied to company' });
    return null;
  }

  if (input.requireCampaignId && !input.campaignId) {
    console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
    input.res.status(400).json({ error: 'campaignId required' });
    return null;
  }

  return user;
};
