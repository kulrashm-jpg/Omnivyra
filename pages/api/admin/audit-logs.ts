import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'audit-logs:admin');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/audit-logs', 'audit-logs:admin');
  }

  try {
    const { data, error } = await supabase
      .from('super_admin_audit_logs')
      .select('id, username, action, ip_address, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      // Table may not be migrated yet â€” return empty rather than 500
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
