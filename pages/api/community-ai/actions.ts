import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  ACTION_APPROVER_ROLES,
  ACTION_EXECUTOR_ROLES,
  ACTION_VIEW_ROLES,
  enforceActionRole,
  requireTenantScope,
  resolveActionRole,
} from './utils';
import { logCommunityAiActionEvent } from '../../../backend/services/communityAiActionLogService';
import { notifyCommunityAi } from '../../../backend/services/communityAiNotificationService';

type ActionsRequest = {
  tenant_id?: string;
  organization_id?: string;
  action_id?: string;
  status?: 'scheduled' | 'skipped';
  scheduled_at?: string;
  approved?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  if (req.method === 'GET') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: ACTION_VIEW_ROLES,
    });
    if (!roleGate) return;

    const { data: actions, error } = await supabase
      .from('community_ai_actions')
      .select('*')
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LOAD_ACTIONS' });
    }

    const ids = (actions || []).map((action) => action.id).filter(Boolean);
    let logRows: Array<{ action_id: string; event_type: string; created_at: string }> = [];
    if (ids.length > 0) {
      const { data: logs } = await supabase
        .from('community_ai_action_logs')
        .select('action_id, event_type, created_at')
        .in('action_id', ids)
        .order('created_at', { ascending: false });
      logRows = logs || [];
    }

    const lastEventMap = logRows.reduce<Record<string, { event_type: string; created_at: string }>>(
      (acc, row) => {
        if (!acc[row.action_id]) {
          acc[row.action_id] = { event_type: row.event_type, created_at: row.created_at };
        }
        return acc;
      },
      {}
    );

    const serialized = (actions || []).map((action) => ({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      platform: action.platform,
      action_type: action.action_type,
      target_id: action.target_id,
      target_url: action.target_url,
      suggested_text: action.suggested_text,
      tone: action.tone,
      risk_level: action.risk_level,
      requires_human_approval: action.requires_human_approval,
      status: action.status || 'pending',
      scheduled_at: action.scheduled_at,
      execution_result: action.execution_result,
      last_event: lastEventMap[action.id] || null,
    }));

    const highRiskPending = (actions || []).filter(
      (action) =>
        action.status === 'pending' &&
        action.risk_level === 'high' &&
        action.requires_human_approval === true
    );

    if (highRiskPending.length > 0) {
      const actionIds = highRiskPending.map((action) => action.id);
      const { data: existingNotifications } = await supabase
        .from('community_ai_notifications')
        .select('action_id, event_type')
        .eq('tenant_id', scope.tenantId)
        .eq('organization_id', scope.organizationId)
        .in('action_id', actionIds)
        .eq('event_type', 'high_risk_pending');

      const existingSet = new Set(
        (existingNotifications || []).map((row) => `${row.action_id}:${row.event_type}`)
      );

      for (const action of highRiskPending) {
        const key = `${action.id}:high_risk_pending`;
        if (existingSet.has(key)) continue;
        await notifyCommunityAi({
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          action_id: action.id,
          event_type: 'high_risk_pending',
          message: `High-risk action pending approval on ${action.platform}`,
        });
      }
    }

    const pending_actions = serialized.filter((action) =>
      ['pending', 'approved'].includes(action.status)
    );
    const scheduled_actions = serialized.filter((action) => action.status === 'scheduled');
    const completed_actions = serialized.filter((action) =>
      ['executed', 'failed'].includes(action.status)
    );
    const skipped_actions = serialized.filter((action) => action.status === 'skipped');

    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      action_role: resolveActionRole(roleGate.role),
      permissions: {
        canApprove: ACTION_APPROVER_ROLES.includes(roleGate.role),
        canExecute: ACTION_EXECUTOR_ROLES.includes(roleGate.role),
        canSchedule: ACTION_APPROVER_ROLES.includes(roleGate.role),
        canSkip: ACTION_APPROVER_ROLES.includes(roleGate.role),
      },
      pending_actions,
      scheduled_actions,
      completed_actions,
      skipped_actions,
    });
  }

  if (req.method === 'POST') {
    const roleGate = await enforceActionRole({
      req,
      res,
      companyId: scope.organizationId,
      allowedRoles: ACTION_APPROVER_ROLES,
    });
    if (!roleGate) return;

    const body = (req.body || {}) as ActionsRequest;
    const actionId = body.action_id;
    if (!actionId) {
      return res.status(400).json({ error: 'action_id is required' });
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

    if (body.status === 'scheduled') {
      if (!body.scheduled_at) {
        return res.status(400).json({ error: 'scheduled_at is required' });
      }
      if (action.requires_human_approval && body.approved !== true) {
        return res.status(403).json({ error: 'APPROVAL_REQUIRED' });
      }
      await supabase
        .from('community_ai_actions')
        .update({
          status: 'scheduled',
          scheduled_at: body.scheduled_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', actionId);

      await logCommunityAiActionEvent({
        action_id: actionId,
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        event_type: 'scheduled',
        event_payload: { scheduled_at: body.scheduled_at },
      });

      return res.status(200).json({ status: 'scheduled', scheduled_at: body.scheduled_at });
    }

    if (body.status === 'skipped') {
      await supabase
        .from('community_ai_actions')
        .update({ status: 'skipped', updated_at: new Date().toISOString() })
        .eq('id', actionId);

      await logCommunityAiActionEvent({
        action_id: actionId,
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        event_type: 'skipped',
        event_payload: null,
      });

      return res.status(200).json({ status: 'skipped' });
    }

    return res.status(400).json({ error: 'INVALID_ACTION_UPDATE' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

