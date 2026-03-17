import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireTenantScope } from './utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const { data: notifications, error } = await supabase
    .from('community_ai_notifications')
    .select('id, action_id, event_type, message, is_read, created_at')
    .eq('tenant_id', scope.tenantId)
    .eq('organization_id', scope.organizationId)
    .eq('is_read', false)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_NOTIFICATIONS' });
  }

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    notifications: notifications || [],
  });
}
