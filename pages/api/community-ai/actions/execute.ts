import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getCommunityAiActionById } from '../../../../backend/db/communityAiActionStore';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { executeAction } from '../../../../backend/services/communityAiActionExecutor';
import { logCommunityAiActionEvent } from '../../../../backend/services/communityAiActionLogService';
import { notifyCommunityAi } from '../../../../backend/services/communityAiNotificationService';
import { sendCommunityAiWebhooks } from '../../../../backend/services/communityAiWebhookService';
import { getPlaybookById } from '../../../../backend/services/playbooks/playbookService';
import {
  validateActionAgainstPlaybook,
} from '../../../../backend/services/playbooks/playbookValidator';

type ExecuteRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  approved?: boolean;
  execution_mode?: 'manual' | 'api' | 'rpa' | string;
  final_text?: string;
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
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
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

  const { data: action, error } = await getCommunityAiActionById(actionId);

  if (error || !action) {
    return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
  }

  if (action.tenant_id !== scope.tenantId || action.organization_id !== scope.organizationId) {
    return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
  }

  if (action.status && !['pending', 'approved', 'scheduled'].includes(action.status)) {
    return res.status(409).json({ error: 'ACTION_NOT_PENDING' });
  }

  const executionMode = (body.execution_mode || action.execution_mode || 'manual').toString();
  if (executionMode !== 'manual') {
    return res.status(400).json({ error: 'EXECUTION_MODE_NOT_ALLOWED' });
  }

  const finalText = (body.final_text ?? action.suggested_text ?? '').toString();
  if (finalText.trim().length === 0) {
    return res.status(400).json({ error: 'FINAL_TEXT_REQUIRED' });
  }

  let playbook: any = null;
  if (action.playbook_id) {
    try {
      playbook = await getPlaybookById(
        action.playbook_id,
        scope.tenantId,
        scope.organizationId
      );
    } catch (error: any) {
      return res.status(404).json({ error: 'PLAYBOOK_NOT_FOUND' });
    }
  }
  const validation = validateActionAgainstPlaybook(
    {
      action_type: action.action_type as 'like' | 'reply' | 'schedule' | 'follow' | 'share',
      text: finalText,
      execution_mode: executionMode,
      risk_level: action.risk_level as 'high' | 'medium' | 'low',
    },
    playbook,
    null
  );
  if (!validation.allowed) {
    return res.status(400).json({
      error: 'PLAYBOOK_VIOLATION',
      reason: validation.reason || 'Playbook validation failed.',
    });
  }

  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: 'approved',
    event_payload: {
      approved: true,
      execution_mode: executionMode,
      user_id: roleGate.userId,
      timestamp: new Date().toISOString(),
    },
  });

  await notifyCommunityAi({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    action_id: actionId,
    event_type: 'approved',
    message: `Action approved for ${action.platform}`,
  });

  const result = await executeAction(
    {
      id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      platform: action.platform,
      action_type: action.action_type as 'like' | 'reply' | 'schedule' | 'follow' | 'share',
      target_id: action.target_id,
      suggested_text: finalText,
      playbook_id: action.playbook_id,
      requires_approval: action.requires_approval,
      requires_human_approval: action.requires_human_approval,
      risk_level: action.risk_level as 'high' | 'medium' | 'low',
      execution_mode: executionMode,
      tone_used: action.tone_used,
    },
    body.approved === true
  );
  const nextStatus = result.ok ? 'executed' : 'failed';

  await supabase
    .from('community_ai_actions')
    .update({
      status: nextStatus,
      execution_result: {
        ...result,
        execution_mode: executionMode,
        final_text: finalText,
        playbook_id: action.playbook_id ?? null,
      },
      final_text: finalText,
      execution_mode: executionMode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);

  await logCommunityAiActionEvent({
    action_id: actionId,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    event_type: nextStatus === 'executed' ? 'executed' : 'failed',
    event_payload: {
      ...result,
      execution_mode: executionMode,
      final_text: finalText,
      playbook_id: action.playbook_id ?? null,
      intent: action.intent_classification ?? null,
      user_id: roleGate.userId,
      timestamp: new Date().toISOString(),
    },
  });

  if (!result.ok) {
    const { data: failureLogs } = await supabase
      .from('community_ai_action_logs')
      .select('id')
      .eq('action_id', actionId)
      .eq('event_type', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (failureLogs && failureLogs.length >= 3) {
      void sendCommunityAiWebhooks({
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        event_type: 'failed',
        action_id: actionId,
        message: 'Repeated action failures detected',
        metadata: { failure_count: failureLogs.length },
      });
    }
  }

  return res.status(result.ok ? 200 : 400).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    action_id: actionId,
    status: nextStatus,
    execution: result,
  });
}
