import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hasSession = req.cookies?.super_admin_session === '1';
  if (!hasSession) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED' });
  }

  const { data, error } = await supabase
    .from('super_admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: 'Failed to load audit logs' });
  }

  return res.status(200).json({ logs: data || [] });
}
