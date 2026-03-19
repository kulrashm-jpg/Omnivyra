import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { resolveUserContext as resolveFromLib, UserContext, type MembershipType } from '../lib/userContext';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getCompanyRoleIncludingInvited, normalizePermissionRole, Role } from './rbacService';
import { getContentArchitectCompanyId, isContentArchitectSession } from './contentArchitectService';

export type { UserContext, MembershipType };

const DEFAULT_MEMBERSHIP: MembershipType = 'INTERNAL';

function normalizeMembershipType(value: string | null | undefined): MembershipType {
  const v = (value || '').trim().toUpperCase();
  return v === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
}

export const resolveUserContext = async (req?: NextApiRequest): Promise<UserContext> => {
  if (!req) return resolveFromLib();

  const archCompanyId = getContentArchitectCompanyId(req);
  if (archCompanyId) {
    return {
      userId: 'content_architect',
      role: 'admin',
      companyIds: [archCompanyId],
      defaultCompanyId: archCompanyId,
    };
  }
  if (isContentArchitectSession(req)) {
    return {
      userId: 'content_architect',
      role: 'admin',
      companyIds: [],
      defaultCompanyId: '',
    };
  }

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

  const membershipByCompany: Record<string, MembershipType> = {};
  for (const row of activeRoles) {
    if (row.company_id) {
      membershipByCompany[row.company_id] = DEFAULT_MEMBERSHIP;
    }
  }
  const defaultCompanyId = companyIds[0] || '';
  const membershipType = DEFAULT_MEMBERSHIP;

  return {
    userId: user.id,
    role: isAdmin ? 'admin' : 'user',
    companyIds,
    defaultCompanyId,
    membershipType,
    membershipByCompany: Object.keys(membershipByCompany).length ? membershipByCompany : undefined,
  };
};

/** True if the resolved context is an external (agency) member. No permission change; for future visibility filtering. */
export function isExternalMember(userContext: UserContext): boolean {
  return userContext.membershipType === 'EXTERNAL';
}

/** True if user is external for the given company. Use when filtering by company. */
export function isExternalMemberForCompany(
  userContext: UserContext,
  companyId: string
): boolean {
  return userContext.membershipByCompany?.[companyId] === 'EXTERNAL';
}

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

  const isContentArchitect = user.userId === 'content_architect';
  const hasActiveAccess = user.companyIds.includes(input.companyId);
  if (!isContentArchitect && !hasActiveAccess) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.userId, input.companyId);
    const allowedViaInvited =
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN;
    if (!allowedViaInvited) {
      console.warn('ACCESS_DENIED', {
        path: input.req.url,
        companyId: input.companyId,
        userId: user.userId,
        role: user.role,
      });
      input.res.status(403).json({ error: 'Access denied to company' });
      return null;
    }
  }

  if (input.requireCampaignId && !input.campaignId) {
    console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
    input.res.status(400).json({ error: 'campaignId required' });
    return null;
  }

  return user;
};
