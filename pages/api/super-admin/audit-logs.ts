import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAdminRateLimit, requireSuperAdminUser } from '../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:audit-logs', 20, 60))) return;

  if (!(await requireSuperAdminUser(req, res))) return;

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
