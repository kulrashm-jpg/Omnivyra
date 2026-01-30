import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.query.company_id as string | undefined);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

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
