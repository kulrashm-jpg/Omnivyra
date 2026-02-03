import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.query.company_id as string | undefined);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (!(await isSuperAdmin(user.id))) {
    const { role, error: roleError } = await getUserRole(user.id, companyId);
    if (roleError || !role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }

  try {
    let query = supabase
      .from('company_profile_refinements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    query = query.eq('company_id', companyId);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to load refinements' });
    }

    return res.status(200).json({ refinements: data || [] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load refinements' });
  }
}
