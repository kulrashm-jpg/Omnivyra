import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:audit-logs', 20, 60))) return;

  // Phase: Platform Authority Hard Enforcement. SUPER_ADMIN_DASHBOARD_VIEW
  // is a platform-tier capability — replaces the legacy `requireSuperAdminUser`
  // Bearer-only check with canonical capability gate + audit linkage.
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin audit log read',
  });
  if (guard.ok !== true) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/audit-logs' });
