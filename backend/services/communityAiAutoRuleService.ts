import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { getPlaybookById, listPlaybooks } from './playbooks/playbookService';
import { evaluatePlaybookForEvent } from './playbooks/playbookEvaluator';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getCommunityAiPlatformPolicy } from './communityAiPlatformPolicyService';
import { canExecuteAction } from './executionGuardrailService';

type AutoRule = {
  id: string;
  tenant_id: string;
  organization_id: string;
  rule_name: string;
  condition: Record<string, any>;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule';
  max_risk_level: 'low' | 'medium';
  is_active: boolean;
  created_at?: string;
};

type AutoRuleInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  suggested_actions: any[];
  context?: any;
};

const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };

const normalizeRisk = (value?: string | null) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : null;
};

const containsUrl = (value?: string | null) => {
  if (!value) return false;
  return /https?:\/\//i.test(value) || /\bwww\./i.test(value);
};

const isInfluencerOutreach = (action: any) => {
  return (
    action?.target_type === 'influencer' ||
    action?.target_category === 'influencer' ||
    action?.target_role === 'influencer' ||
    action?.influencer === true
  );
};

const resolveTargetId = (action: any) => {
  return (
    action?.target_id ||
    action?.targetId ||
    action?.post_id ||
    action?.postId ||
    action?.comment_id ||
    action?.commentId ||
    action?.profile_id ||
    action?.profileId ||
    action?.target
  );
};

const resolveSuggestedText = (action: any) => {
  return (
    action?.suggested_text ||
    action?.reply_text ||
    action?.comment_text ||
    action?.message ||
    action?.text ||
    null
  );
};

const loadHistoryMetrics = async (
  tenantId: string,
  organizationId: string,
  playbookId: string
) => {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();

    const { data: replyRows } = await supabase
      .from('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'reply')
      .gte('updated_at', hourAgo);

    const { data: followRows } = await supabase
      .from('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .eq('action_type', 'follow')
      .gte('updated_at', dayStartIso);

    const { data: actionRows } = await supabase
      .from('community_ai_actions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .gte('updated_at', dayStartIso);

    return {
      replies_last_hour: replyRows?.length ?? 0,
      follows_today: followRows?.length ?? 0,
      actions_today: actionRows?.length ?? 0,
    };
  } catch (error: any) {
    console.warn('PLAYBOOK_HISTORY_METRICS_FAILED', error?.message || error);
    return {
      replies_last_hour: 0,
      follows_today: 0,
      actions_today: 0,
    };
  }
};

const matchesCondition = (condition: Record<string, any>, action: any, context?: any) => {
  if (!condition || typeof condition !== 'object') return false;
  return Object.entries(condition).every(([key, expected]) => {
    const actual = action?.[key] ?? context?.[key];
    if (typeof expected === 'boolean') {
      return Boolean(actual) === expected;
    }
    if (expected === null) {
      return actual == null;
    }
    return String(actual ?? '').toLowerCase() === String(expected).toLowerCase();
  });
};

const resolveActionRecord = async (
  tenantId: string,
  organizationId: string,
  action: any,
  status: string,
  options?: { allowAnyStatus?: boolean }
) => {
  const targetId = resolveTargetId(action);
  const platform = (action?.platform || '').toString().toLowerCase();
  const actionType = (action?.action_type || '').toString().toLowerCase();

  if (!platform || !actionType || !targetId) return null;
  if (
    !action?.playbook_id ||
    !action?.playbook_name ||
    !action?.intent_classification ||
    !action?.execution_mode ||
    !action?.execution_modes_config ||
    !action?.tone_used
  ) {
    return null;
  }

  let query = supabase
    .from('community_ai_actions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('organization_id', organizationId)
    .eq('platform', platform)
    .eq('action_type', actionType)
    .eq('target_id', targetId);

  if (!options?.allowAnyStatus) {
    query = query.eq('status', 'pending');
  }

  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    return existing[0];
  }

  const id = action?.id || randomUUID();
  const { data: created } = await supabase
    .from('community_ai_actions')
    .insert({
      id,
      tenant_id: tenantId,
      organization_id: organizationId,
      platform,
      action_type: actionType,
      target_id: targetId,
      suggested_text: resolveSuggestedText(action),
      tone: action?.tone ?? null,
      tone_used: action?.tone_used ?? action?.tone ?? null,
      risk_level: action?.risk_level ?? null,
      requires_human_approval: action?.requires_human_approval ?? true,
      requires_approval: action?.requires_approval ?? null,
      execution_mode: action?.execution_mode ?? 'manual',
      execution_modes_config: action?.execution_modes_config ?? null,
      playbook_id: action?.playbook_id ?? null,
      playbook_name: action?.playbook_name ?? null,
      intent_classification: action?.intent_classification ?? null,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .limit(1);

  return created?.[0] || null;
};

export const evaluateAutoRules = async (input: AutoRuleInput) => {
  if (!input?.tenant_id || !input?.organization_id) {
    return { actions: input.suggested_actions || [], autoExecuted: 0 };
  }

  const policy = await getCommunityAiPlatformPolicy();
  if (!policy.auto_rules_enabled) {
    console.debug('COMMUNITY_AI_PLATFORM_POLICY_BLOCK', {
      reason: 'auto_rules_enabled=false',
      source: 'auto_rules',
    });
    await supabase.from('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'auto_rules_enabled',
        source: 'auto_rules',
      },
      created_at: new Date().toISOString(),
    });
    return { actions: input.suggested_actions || [], autoExecuted: 0 };
  }

  const playbooks = (await listPlaybooks(input.tenant_id, input.organization_id)).filter(
    (playbook) => playbook.status === 'active'
  );

  const { data: rules } = await supabase
    .from('community_ai_auto_rules')
    .select('*')
    .eq('tenant_id', input.tenant_id)
    .eq('organization_id', input.organization_id)
    .eq('is_active', true);

  const activeRules = (rules || []) as AutoRule[];

  let autoExecuted = 0;
  const actions = await Promise.all(
    (input.suggested_actions || []).map(async (action: any) => {
      if (action?.intent_classification?.primary_intent === 'network_expansion') {
        let actionId = action?.id || action?.action_id;
        if (!actionId) {
          const targetId = resolveTargetId(action);
          const platform = (action?.platform || input.platform || '').toString().toLowerCase();
          const actionType = (action?.action_type || '').toString().toLowerCase();
          if (targetId && platform && actionType) {
            const { data: existing } = await supabase
              .from('community_ai_actions')
              .select('id')
              .eq('tenant_id', input.tenant_id)
              .eq('organization_id', input.organization_id)
              .eq('platform', platform)
              .eq('action_type', actionType)
              .eq('target_id', targetId)
              .limit(1);
            actionId = existing?.[0]?.id;
          }
        }
        if (actionId) {
          await logCommunityAiActionEvent({
            action_id: actionId,
            tenant_id: input.tenant_id,
            organization_id: input.organization_id,
            event_type: 'skipped',
            event_payload: {
              reason: 'PHASE_5B_OBSERVATION_LOCK',
            },
          });
        }
        return action;
      }
      const normalizedAction = {
        ...action,
        platform: action?.platform || input.platform || null,
        suggested_text: resolveSuggestedText(action),
      };
      const eventContext = {
        platform: normalizedAction.platform || '',
        content_type: normalizedAction.content_type || input.context?.content_type || '',
        intent_scores:
          normalizedAction.intent_scores || input.context?.intent_scores || {},
        sentiment: normalizedAction.sentiment || input.context?.sentiment || 'neutral',
        user_type: normalizedAction.user_type || input.context?.user_type || 'regular_user',
      };
      const evaluation = evaluatePlaybookForEvent(eventContext, playbooks);
      if (!evaluation?.primary_playbook) {
        return {
          ...normalizedAction,
          blocked_reason: 'No applicable playbook',
        };
      }
      const historyMetrics = await loadHistoryMetrics(
        input.tenant_id,
        input.organization_id,
        evaluation.primary_playbook.id
      );
      const executionMode = evaluation?.decision?.execution_mode ?? 'manual';
      const toneUsed = evaluation?.decision?.tone?.style ?? normalizedAction.tone ?? null;
      const executionModesConfig = evaluation?.primary_playbook?.execution_modes || null;
      const intentClassification =
        normalizedAction.intent_classification ??
        normalizedAction.intent_scores ??
        input.context?.intent_scores ??
        null;
      const playbookId = evaluation.primary_playbook.id || null;
      const playbookName = evaluation.primary_playbook.name || null;
      if (
        !playbookId ||
        !playbookName ||
        !executionMode ||
        !toneUsed ||
        !intentClassification ||
        !executionModesConfig
      ) {
        return {
          ...normalizedAction,
          blocked_reason: 'Playbook metadata missing',
        };
      }
      normalizedAction.playbook_id = playbookId;
      normalizedAction.playbook_name = playbookName;
      normalizedAction.intent_classification = intentClassification;
      normalizedAction.execution_mode = executionMode;
      normalizedAction.execution_modes_config = executionModesConfig;
      normalizedAction.tone_used = toneUsed;

      const playbookValidation = validateActionAgainstPlaybook(
        {
          action_type: normalizedAction.action_type,
          text: normalizedAction.suggested_text,
          execution_mode: normalizedAction.execution_mode || 'manual',
          risk_level: normalizedAction.risk_level,
        },
        evaluation.primary_playbook,
        historyMetrics
      );
      if (!playbookValidation.allowed) {
        return {
          ...normalizedAction,
          blocked_reason: playbookValidation.reason || 'Playbook validation failed',
        };
      }

      const actionType = (normalizedAction.action_type || '').toString().toLowerCase();
      const risk = normalizeRisk(normalizedAction.risk_level);

      const isHardBlocked =
        actionType === 'follow' ||
        isInfluencerOutreach(normalizedAction) ||
        risk === 'high' ||
        containsUrl(normalizedAction.suggested_text);

      if (
        isHardBlocked ||
        normalizedAction.requires_human_approval !== false ||
        !normalizedAction.suggested_text ||
        !risk
      ) {
        await resolveActionRecord(
          input.tenant_id,
          input.organization_id,
          normalizedAction,
          'pending',
          { allowAnyStatus: true }
        );
        return action;
      }

      const matchingRule = activeRules.find((rule) => {
        const ruleActionType = (rule.action_type || '').toString().toLowerCase();
        return (
          ruleActionType === actionType &&
          matchesCondition(rule.condition || {}, normalizedAction, input.context)
        );
      });

      if (!matchingRule) {
        await resolveActionRecord(
          input.tenant_id,
          input.organization_id,
          normalizedAction,
          'pending',
          { allowAnyStatus: true }
        );
        return action;
      }

      const maxRisk = normalizeRisk(matchingRule.max_risk_level) || 'low';
      if (riskRank[risk] > riskRank[maxRisk]) {
        await resolveActionRecord(
          input.tenant_id,
          input.organization_id,
          normalizedAction,
          'pending',
          { allowAnyStatus: true }
        );
        return action;
      }

      const record = await resolveActionRecord(
        input.tenant_id,
        input.organization_id,
        normalizedAction,
        'approved',
        { allowAnyStatus: true }
      );

      if (!record) {
        return {
          ...action,
          blocked_reason: 'No applicable playbook',
        };
      }

      let playbook = null;
      try {
        playbook = await getPlaybookById(
          record.playbook_id,
          input.tenant_id,
          input.organization_id
        );
      } catch (error: any) {
        await supabase
          .from('community_ai_actions')
          .update({
            status: 'failed',
            execution_result: { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND' },
            updated_at: new Date().toISOString(),
          })
          .eq('id', record.id);
        await logCommunityAiActionEvent({
          action_id: record.id,
          tenant_id: input.tenant_id,
          organization_id: input.organization_id,
          event_type: 'failed',
          event_payload: { error: 'PLAYBOOK_NOT_FOUND' },
        });
        return {
          ...action,
          blocked_reason: 'No applicable playbook',
        };
      }

      const recordValidation = validateActionAgainstPlaybook(
        {
          action_type: record.action_type,
          text: record.suggested_text,
          execution_mode: record.execution_mode || 'manual',
          risk_level: record.risk_level,
        },
        playbook,
        null
      );
      if (!recordValidation.allowed) {
        await supabase
          .from('community_ai_actions')
          .update({
            status: 'failed',
            execution_result: {
              ok: false,
              status: 'failed',
              error: recordValidation.reason || 'PLAYBOOK_VIOLATION',
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', record.id);
        await logCommunityAiActionEvent({
          action_id: record.id,
          tenant_id: input.tenant_id,
          organization_id: input.organization_id,
          event_type: 'failed',
          event_payload: { error: recordValidation.reason || 'PLAYBOOK_VIOLATION' },
        });
        return {
          ...action,
          blocked_reason: recordValidation.reason || 'Playbook validation failed',
        };
      }

      const guardrail = await canExecuteAction(
        {
          id: record.id,
          company_id: input.organization_id,
          tenant_id: input.tenant_id,
          organization_id: input.organization_id,
          platform: record.platform,
          action_type: record.action_type,
          target_id: record.target_id,
        },
        { source: 'evaluation' }
      );
      if (!guardrail.allowed) {
        await supabase
          .from('community_ai_actions')
          .update({
            status: 'skipped_guardrail',
            skip_reason: guardrail.reason ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', record.id);
        return { ...action, blocked_reason: guardrail.reason ?? 'guardrail' };
      }

      const execution = await executeAction(
        {
          id: record.id,
          tenant_id: input.tenant_id,
          organization_id: input.organization_id,
          platform: record.platform,
          action_type: record.action_type,
          target_id: record.target_id,
          suggested_text: record.suggested_text,
          playbook_id: record.playbook_id,
          execution_mode: record.execution_mode,
          requires_human_approval: false,
          risk_level: record.risk_level,
        },
        true,
        { source: 'auto' }
      );
      if (execution.status === 'skipped' && execution.reason === 'HUMAN_APPROVAL_REQUIRED') {
        return {
          ...action,
          blocked_reason: 'Human approval required by platform policy',
        };
      }

      const nextStatus =
        execution.status === 'skipped' ? 'skipped' : execution.ok ? 'executed' : 'failed';
      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        execution_result: execution,
        updated_at: new Date().toISOString(),
      };
      if (nextStatus === 'executed') {
        updatePayload.executed_at = new Date().toISOString();
      }
      await supabase
        .from('community_ai_actions')
        .update(updatePayload)
        .eq('id', record.id);

      await logCommunityAiActionEvent({
        action_id: record.id,
        tenant_id: input.tenant_id,
        organization_id: input.organization_id,
        event_type: 'auto_executed',
        event_payload: {
          rule_id: matchingRule.id,
          rule_name: matchingRule.rule_name,
          status: nextStatus,
          result: execution,
        },
      });

      autoExecuted += 1;
      return {
        ...action,
        auto_executed: true,
        execution_status: nextStatus,
      };
    })
  );

  return { actions, autoExecuted };
};
