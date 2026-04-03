import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../../../backend/services/companyContextGuardService';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin, Role } from '../../../../../backend/services/rbacService';

const mapAppRoleToRbac = (role: string): Role | null => {
  const normalized = role.toUpperCase();
  if (normalized === 'COMPANY_ADMIN') return Role.ADMIN;
  if (normalized === 'USER') return Role.CONTENT_CREATOR;
  return null;
};

const ensureCompanyAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id };
  }

  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
    return null;
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'ROLE_NOT_ASSIGNED' });
    return null;
  }
  if (role !== Role.ADMIN) {
    res.status(403).json({ error: 'NOT_AUTHORIZED' });
    return null;
  }

  return { userId: user.id };
};

const upsertUserCompanyRole = async (userId: string, companyId: string, role: string) => {
  const { data: existing } = await supabase
    .from('user_company_roles')
    .select('id, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    if (row.role !== role) {
      await supabase.from('user_company_roles').update({ role }).eq('id', row.id);
    }
    return;
  }

  await supabase.from('user_company_roles').insert({
    user_id: userId,
    company_id: companyId,
    role,
    created_at: new Date().toISOString(),
  });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const { companyId, role } = req.body || {};
  if (!companyId || !role) {
    return res.status(400).json({ error: 'companyId and role are required' });
  }

  const companyContext = await requireCompanyContext({ req, res, companyId: String(companyId).trim() });
  if (!companyContext) return;

  const access = await ensureCompanyAdminAccess(req, res, companyContext.companyId);
  if (!access) return;

  const desiredRole = String(role).toUpperCase();
  if (desiredRole !== 'COMPANY_ADMIN' && desiredRole !== 'USER') {
    return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
  }

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({ error: 'FAILED_TO_LOOKUP_USER' });
  }
  if (!existing || existing.company_id !== companyId) {
    return res.status(404).json({ error: 'USER_NOT_FOUND' });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ role: desiredRole })
    .eq('id', userId);

  if (updateError) {
    return res.status(500).json({ error: 'FAILED_TO_UPDATE_ROLE' });
  }

  const rbacRole = mapAppRoleToRbac(desiredRole);
  if (!rbacRole) {
    return res.status(400).json({ error: 'INVALID_ROLE_MAPPING' });
  }
  await upsertUserCompanyRole(userId, companyId, rbacRole);

  return res.status(200).json({ success: true });
}
