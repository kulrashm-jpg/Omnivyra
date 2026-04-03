import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Super-admin cookie (e.g. from /super-admin/login) grants access without Supabase user
    if (req.cookies?.super_admin_session === '1') {
      return res.status(200).json({
        success: true,
        isSuperAdmin: true,
        userId: null,
      });
    }

    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const userId = user.id;
    const companyId =
      (req.query.companyId as string | undefined) ||
      (req.query.company_id as string | undefined);

    const query = supabase
      .from('user_company_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'SUPER_ADMIN')
      .limit(1);

    const { data, error } = companyId ? await query.eq('company_id', companyId).maybeSingle() : await query.maybeSingle();

    if (error) {
      console.error('Error checking super admin status:', error);
      return res.status(500).json({
        error: 'Failed to check super admin status',
        details: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      isSuperAdmin: !!data,
      userId: userId,
    });

  } catch (error) {
    console.error('Error in check-super-admin API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
