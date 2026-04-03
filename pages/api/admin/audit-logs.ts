import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hasCookie = req.cookies?.super_admin_session === '1';
  if (!hasCookie) {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const { data, error } = await supabase
      .from('super_admin_audit_logs')
      .select('id, username, action, ip_address, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      // Table may not be migrated yet — return empty rather than 500
      console.warn('[audit-logs] DB query failed (table may not exist):', error.message);
      return res.status(200).json({ success: true, logs: [] });
    }

    return res.status(200).json({
      success: true,
      logs: data || [],
    });
  } catch (error) {
    console.error('Error in audit-logs API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
