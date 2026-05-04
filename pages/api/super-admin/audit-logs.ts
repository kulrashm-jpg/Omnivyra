import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminRateLimit, requireAdminScope } from '../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:audit-logs', 20, 60))) return;

  const ctx = await requireAdminScope(req, res, 'audit-logs:view');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/audit-logs', 'audit-logs:view');
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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
