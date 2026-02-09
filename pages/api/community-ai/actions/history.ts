import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceActionRole, requireTenantScope } from '../utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';

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
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
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

  const actionIds = (logs || []).map((log) => log.action_id).filter(Boolean);
  const actionContextMap = new Map<string, any>();
  if (actionIds.length > 0) {
    const { data: actions } = await supabase
      .from('community_ai_actions')
      .select(
        'id, playbook_id, playbook_name, tone_used, execution_mode, requires_approval, intent_classification'
      )
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .in('id', actionIds);
    (actions || []).forEach((action) => {
      actionContextMap.set(action.id, {
        playbook_id: action.playbook_id,
        playbook_name: action.playbook_name,
        tone_used: action.tone_used,
        execution_mode: action.execution_mode,
        requires_approval: action.requires_approval,
        intent_classification: action.intent_classification,
      });
    });
  }

    const enriched = (logs || []).map((log) => {
      const actionContext = actionContextMap.get(log.action_id) || null;
      const payload = log.event_payload || {};
      return {
        ...log,
        action_context: actionContext,
        audit: {
          playbook_id: payload.playbook_id ?? actionContext?.playbook_id ?? null,
          intent: payload.intent ?? actionContext?.intent_classification ?? null,
          execution_mode: payload.execution_mode ?? actionContext?.execution_mode ?? null,
          user_id: payload.user_id ?? null,
          timestamp: payload.timestamp ?? log.created_at,
          final_text: payload.final_text ?? null,
        },
      };
    });

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    events: enriched,
  });
}
