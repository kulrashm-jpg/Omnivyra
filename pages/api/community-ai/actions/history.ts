import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { ACTION_VIEW_ROLES, enforceActionRole, requireTenantScope } from '../utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: ACTION_VIEW_ROLES,
  });
  if (!roleGate) return;

  const actionId =
    typeof req.query?.action_id === 'string' ? req.query.action_id : undefined;

  if (actionId) {
    const { data: action, error } = await supabase
      .from('community_ai_actions')
      .select('id, tenant_id, organization_id')
      .eq('id', actionId)
      .single();

    if (error || !action) {
      return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
    }

    if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
      return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
    }
  }

  let query = supabase
    .from('community_ai_action_logs')
    .select('action_id, event_type, event_payload, created_at')
    .eq('tenant_id', scope.tenantId)
    .eq('organization_id', scope.organizationId)
    .order('created_at', { ascending: false });

  if (actionId) {
    query = query.eq('action_id', actionId);
  }

  const { data: logs, error } = await query;
  if (error) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_ACTION_HISTORY' });
  }

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    events: logs || [],
  });
}
