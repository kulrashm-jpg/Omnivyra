import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { enforceRole, Role } from '../../../backend/services/rbacService';

const readParam = (req: NextApiRequest, key: string): string | null => {
  const fromQuery = req.query?.[key];
  if (typeof fromQuery === 'string') return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof fromBody === 'string') return fromBody;
  return null;
};

export const requireTenantScope = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ tenantId: string; organizationId: string } | null> => {
  const tenantId = readParam(req, 'tenant_id');
  const organizationId = readParam(req, 'organization_id');

  if (!tenantId || !organizationId) {
    res.status(400).json({ error: 'tenant_id and organization_id are required' });
    return null;
  }

  if (tenantId !== organizationId) {
    res.status(400).json({ error: 'tenant_id and organization_id must match' });
    return null;
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: organizationId,
  });

  if (!access) return null;

  return { tenantId, organizationId };
};

export const resolveBrandVoice = async (organizationId: string): Promise<string> => {
  const profile = await getProfile(organizationId, { autoRefine: false });
  const listEntry = Array.isArray(profile?.brand_voice_list) ? profile.brand_voice_list[0] : null;
  const voice = (listEntry || profile?.brand_voice || '').toString().trim();
  return voice.length > 0 ? voice : 'professional';
};

export const ACTION_VIEW_ROLES: Role[] = [
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.COMPANY_ADMIN,
  Role.SUPER_ADMIN,
];

export const ACTION_APPROVER_ROLES: Role[] = [
  Role.CONTENT_REVIEWER,
  Role.COMPANY_ADMIN,
  Role.SUPER_ADMIN,
];

export const ACTION_EXECUTOR_ROLES: Role[] = [
  Role.CONTENT_PUBLISHER,
  Role.COMPANY_ADMIN,
  Role.SUPER_ADMIN,
];

export const resolveActionRole = (role: Role | null) => {
  if (!role) return 'viewer';
  if ([Role.COMPANY_ADMIN, Role.SUPER_ADMIN].includes(role)) return 'admin';
  if (ACTION_EXECUTOR_ROLES.includes(role)) return 'executor';
  if (ACTION_APPROVER_ROLES.includes(role)) return 'approver';
  return 'viewer';
};

export const enforceActionRole = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId: string;
  allowedRoles: Role[];
}): Promise<{ userId: string; role: Role } | null> =>
  enforceRole({
    req: input.req,
    res: input.res,
    companyId: input.companyId,
    allowedRoles: input.allowedRoles,
  });

