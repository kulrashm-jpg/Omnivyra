import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getCommunityAiActionById } from '../../../../backend/db/communityAiActionStore';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { logCommunityAiActionEvent } from '../../../../backend/services/communityAiActionLogService';

type ApproveRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
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
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.APPROVE_ACTIONS],
  });
  if (!roleGate) return;

  const body = (req.body || {}) as ApproveRequest;
  const actionId = body.action_id;
  if (!actionId) {
    return res.status(400).json({ error: 'action_id is required' });
  }

  const { data: action, error } = await getCommunityAiActionById(actionId);

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  if (action.status !== 'pending') {
    return res.status(409).json({ error: 'ACTION_NOT_PENDING' });
  }

  if (action.requires_human_approval !== true) {
    return res.status(400).json({ error: 'APPROVAL_NOT_REQUIRED' });
  }

  const approvedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('community_ai_actions')
    .update({
      status: 'approved',
      approved_at: approvedAt,
      approved_by: roleGate.userId,
      updated_at: approvedAt,
    })
    .eq('id', actionId)
    .select('*')
    .single();

  if (updateError || !updated) {
    return res.status(500).json({ error: 'FAILED_TO_APPROVE' });
  }

  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: 'approved',
    event_payload: {
      approved: true,
      playbook_id: action.playbook_id ?? null,
      intent: action.intent_classification ?? null,
      user_id: roleGate.userId,
      timestamp: approvedAt,
    },
  });

  return res.status(200).json(updated);
}
