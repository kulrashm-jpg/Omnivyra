import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read-only dashboard surface; bridge principals satisfy this capability
  // (compatibility) until Wave 3 collapses the bridge.
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'platform audit log read',
  });
  if (guard.ok !== true) return;

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
