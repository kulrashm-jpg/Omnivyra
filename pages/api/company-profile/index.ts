import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  saveProfile,
} from '../../../backend/services/companyProfileService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

const resolveCompanyAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string | null
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const mode = (req.query.mode as string | undefined) || (req.body?.mode as string | undefined);

  if (req.method === 'GET') {
    try {
      if (mode === 'list') {
        const { user, error } = await getSupabaseUserFromRequest(req);
        if (error || !user) {
          return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        const { data: roleRows, error: roleError } = await supabase
          .from('user_company_roles')
          .select('company_id, role, status')
          .eq('user_id', user.id)
          .eq('status', 'active');
        if (roleError) {
          return res.status(500).json({ error: 'FAILED_TO_LOAD_COMPANIES' });
        }
        const companyIds = (roleRows || []).map((row: any) => row.company_id).filter(Boolean);
        const rolesByCompany = (roleRows || []).map((row: any) => ({
          company_id: row.company_id,
          role: row.role,
        }));
        const profiles = await Promise.all(
          companyIds.map(async (id) => {
            const profile = await getProfile(id, { autoRefine: false });
            return profile || { company_id: id, name: id };
          })
        );
        return res.status(200).json({
          companies: profiles.map((profile) => ({
            company_id: profile.company_id,
            name: profile.name || profile.company_id,
          })),
          rolesByCompany,
        });
      }

      const access = await resolveCompanyAccess(req, res, companyId);
      if (!access) return;

      const profile = await getProfile(companyId, { autoRefine: false });
      if (!profile) {
        const created = await saveProfile({ company_id: companyId });
        return res.status(200).json({ profile: created });
      }
      return res.status(200).json({ profile });
    } catch (error: any) {
      console.error('Error fetching company profile:', error);
      return res.status(500).json({ error: 'Failed to fetch company profile' });
    }
  }

  if (req.method === 'POST') {
    try {
      const resolvedCompanyId = companyId;
      const access = await resolveCompanyAccess(req, res, resolvedCompanyId);
      if (!access) return;
      const payload = {
        ...req.body,
        company_id: resolvedCompanyId,
      };
      const profile = await saveProfile(payload);
      return res.status(200).json({ profile });
    } catch (error: any) {
      console.error('Error saving company profile:', error);
      return res.status(500).json({ error: 'Failed to save company profile' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
