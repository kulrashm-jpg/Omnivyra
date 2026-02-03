import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { ACTION_EXECUTOR_ROLES, enforceActionRole, requireTenantScope } from '../utils';
import { executeAction } from '../../../../backend/services/communityAiActionExecutor';
import { logCommunityAiActionEvent } from '../../../../backend/services/communityAiActionLogService';
import { notifyCommunityAi } from '../../../../backend/services/communityAiNotificationService';

type ExecuteRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  approved?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: ACTION_EXECUTOR_ROLES,
  });
  if (!roleGate) return;

  const body = (req.body || {}) as ExecuteRequest;
  const actionId = body.action_id;
  if (!actionId) {
    return res.status(400).json({ error: 'action_id is required' });
  }
  if (body.approved !== true) {
    return res.status(403).json({ error: 'APPROVAL_REQUIRED' });
  }

  const { data: action, error } = await supabase
    .from('community_ai_actions')
    .select('*')
    .eq('id', actionId)
    .single();

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  if (action.status && !['pending', 'approved', 'scheduled'].includes(action.status)) {
    return res.status(409).json({ error: 'ACTION_NOT_PENDING' });
  }

  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: 'approved',
    event_payload: { approved: true },
  });

  await notifyCommunityAi({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    action_id: actionId,
    event_type: 'approved',
    message: `Action approved for ${action.platform}`,
  });

  const result = await executeAction(action, body.approved === true);
  const nextStatus = result.ok ? 'executed' : 'failed';

  await supabase
    .from('community_ai_actions')
    .update({
      status: nextStatus,
      execution_result: result,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);

  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: nextStatus === 'executed' ? 'executed' : 'failed',
    event_payload: result,
  });

  return res.status(result.ok ? 200 : 400).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    action_id: actionId,
    status: nextStatus,
    execution: result,
  });
}
