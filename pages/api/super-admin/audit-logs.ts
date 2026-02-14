import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  } else {
    const hasSession = req.cookies?.super_admin_session === '1';
    if (!hasSession) {
      return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    }
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
  }

  const { data, error: dbError } = await supabase
    .from('super_admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (dbError) {
    return res.status(500).json({ error: 'Failed to load audit logs' });
  }

  return res.status(200).json({ logs: data || [] });
}
