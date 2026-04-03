import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceActionRole, requireTenantScope, resolveActionRole } from './utils';
import {
  COMMUNITY_AI_CAPABILITIES,
  hasCommunityAiCapability,
} from '../../../backend/services/rbac/communityAiCapabilities';
import { logCommunityAiActionEvent } from '../../../backend/services/communityAiActionLogService';
import { notifyCommunityAi } from '../../../backend/services/communityAiNotificationService';
import { sendCommunityAiWebhooks } from '../../../backend/services/communityAiWebhookService';

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
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
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
    let logRows: Array<{
      action_id: string;
      event_type: string;
      created_at: string;
      event_payload?: any;
    }> = [];
    if (ids.length > 0) {
      const { data: logs } = await supabase
        .from('community_ai_action_logs')
        .select('action_id, event_type, created_at, event_payload')
        .in('action_id', ids)
        .order('created_at', { ascending: false });
      logRows = logs || [];
    }

    const lastEventMap = logRows.reduce<
      Record<string, { event_type: string; created_at: string; event_payload?: any }>
    >((acc, row) => {
      if (!acc[row.action_id]) {
        acc[row.action_id] = {
          event_type: row.event_type,
          created_at: row.created_at,
          event_payload: row.event_payload,
        };
      }
      return acc;
    }, {});

    const playbookIds = Array.from(
      new Set((actions || []).map((action) => action.playbook_id).filter(Boolean))
    ) as string[];
    let playbookMap: Record<string, { tone: any; safety: any }> = {};
    if (playbookIds.length > 0) {
      const { data: playbooks } = await supabase
        .from('community_ai_playbooks')
        .select('id, tone, safety')
        .eq('tenant_id', scope.tenantId)
        .eq('organization_id', scope.organizationId)
        .in('id', playbookIds);
      playbookMap = (playbooks || []).reduce<Record<string, { tone: any; safety: any }>>(
        (acc, playbook: any) => {
          acc[playbook.id] = {
            tone: playbook.tone ?? null,
            safety: playbook.safety ?? null,
          };
          return acc;
        },
        {}
      );
    }

    const activeRules = (await supabase
      .from('community_ai_auto_rules')
      .select('id, rule_name, condition, action_type, max_risk_level, is_active')
      .eq('tenant_id', scope.tenantId)
      .eq('organization_id', scope.organizationId)
      .eq('is_active', true)).data || [];

    const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const normalizeRisk = (value?: string | null) => {
      const normalized = (value || '').toString().trim().toLowerCase();
      return ['low', 'medium', 'high'].includes(normalized) ? normalized : null;
    };
    const containsUrl = (value?: string | null) =>
      Boolean(value && (/https?:\/\//i.test(value) || /\bwww\./i.test(value)));
    const isInfluencerOutreach = (action: any) =>
      action?.target_type === 'influencer' ||
      action?.target_category === 'influencer' ||
      action?.target_role === 'influencer' ||
      action?.influencer === true;
    const matchesCondition = (condition: Record<string, any>, action: any) => {
      if (!condition || typeof condition !== 'object') return false;
      return Object.entries(condition).every(([key, expected]) => {
        const actual = action?.[key];
        if (typeof expected === 'boolean') {
          return Boolean(actual) === expected;
        }
        if (expected === null) {
          return actual == null;
        }
        return String(actual ?? '').toLowerCase() === String(expected).toLowerCase();
      });
    };

    const serialized = (actions || []).map((action) => ({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      platform: action.platform,
      action_type: action.action_type,
      target_id: action.target_id,
      target_url: action.target_url,
      suggested_text: action.suggested_text,
      final_text: action.final_text,
      tone: action.tone,
      tone_used: action.tone_used,
      tone_limits: action.playbook_id ? playbookMap[action.playbook_id]?.tone ?? null : null,
      safety_rules: action.playbook_id ? playbookMap[action.playbook_id]?.safety ?? null : null,
      risk_level: action.risk_level,
      requires_human_approval: action.requires_human_approval,
      requires_approval: action.requires_approval,
      execution_mode: action.execution_mode,
      execution_modes_config: action.execution_modes_config,
      playbook_id: action.playbook_id,
      playbook_name: action.playbook_name,
      intent_classification: action.intent_classification,
      status: action.status || 'pending',
      scheduled_at: action.scheduled_at,
      execution_result: action.execution_result,
      last_event: lastEventMap[action.id] || null,
      last_event_type: lastEventMap[action.id]?.event_type || null,
      rule_name:
        lastEventMap[action.id]?.event_type === 'auto_executed'
          ? lastEventMap[action.id]?.event_payload?.rule_name || null
          : null,
      rule_match: (() => {
        if (action.status !== 'pending') return false;
        const actionType = (action.action_type || '').toString().toLowerCase();
        const risk = normalizeRisk(action.risk_level);
        if (!actionType || !risk) return false;
        if (actionType === 'follow') return false;
        if (risk === 'high') return false;
        if (action.requires_human_approval !== false) return false;
        if (!action.suggested_text || containsUrl(action.suggested_text)) return false;
        if (isInfluencerOutreach(action)) return false;
        const matchingRule = (activeRules || []).find((rule: any) => {
          const ruleActionType = (rule.action_type || '').toString().toLowerCase();
          if (ruleActionType !== actionType) return false;
          const maxRisk = normalizeRisk(rule.max_risk_level) || 'low';
          if (riskRank[risk] > riskRank[maxRisk]) return false;
          return matchesCondition(rule.condition || {}, action);
        });
        return Boolean(matchingRule);
      })(),
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
        void sendCommunityAiWebhooks({
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          event_type: 'high_risk_pending',
          action_id: action.id,
          message: `High-risk action pending approval on ${action.platform}`,
          metadata: { platform: action.platform, action_type: action.action_type },
        });
      }
    }

    const pending_actions = serialized.filter(
      (action) =>
        ['pending', 'approved'].includes(action.status) && !action.scheduled_at
    );
    const scheduled_actions = serialized.filter(
      (action) => action.status === 'approved' && action.scheduled_at
    );
    const completed_actions = serialized.filter((action) =>
      ['executed', 'failed'].includes(action.status)
    );
    const skipped_actions = serialized.filter((action) => action.status === 'skipped');

    return res.status(200).json({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      action_role: resolveActionRole(roleGate.role),
      permissions: {
        canApprove: hasCommunityAiCapability(roleGate.role, 'APPROVE_ACTIONS'),
        canExecute: hasCommunityAiCapability(roleGate.role, 'EXECUTE_ACTIONS'),
        canSchedule: hasCommunityAiCapability(roleGate.role, 'SCHEDULE_ACTIONS'),
        canSkip: hasCommunityAiCapability(roleGate.role, 'SCHEDULE_ACTIONS'),
        // Community-AI connectors are NOT Virality External APIs.
        // Connector OAuth does NOT imply access to the Virality API catalog.
        // Capabilities are isolated by domain.
        canManageConnectors: hasCommunityAiCapability(roleGate.role, 'MANAGE_CONNECTORS'),
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
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.SCHEDULE_ACTIONS],
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

      return res.status(200).json({
        status: action.status || 'pending',
        scheduled_at: body.scheduled_at,
      });
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
