import {
  evaluateCommunityAiEngagement,
  isOmniVyraEnabled,
} from './omnivyraClientV1';
import { supabase } from '../db/supabaseClient';
import { evaluateAutoRules } from './communityAiAutoRuleService';
import { listPlaybooks } from './playbooks/playbookService';
import { evaluatePlaybookForEvent } from './playbooks/playbookEvaluator';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';

export type CommunityAiOmnivyraInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  post_data?: any;
  engagement_metrics?: any;
  goals?: any;
  brand_voice: string;
  context?: any;
};

export type CommunityAiOmnivyraOutput = {
  analysis: string;
  suggested_actions: any[];
  content_improvement: any;
  safety_classification: any;
  execution_links: any;
  source: 'omnivyra' | 'placeholder';
};

const normalizeBrandVoice = (value: string) => {
  const trimmed = (value || '').toString().trim();
  return trimmed.length > 0 ? trimmed : 'professional';
};

const normalizeSuggestedActions = (actions: any[], brandVoice: string) => {
  const tone = normalizeBrandVoice(brandVoice);
  return (actions || []).map((action) => ({
    ...action,
    tone,
  }));
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

export const evaluateEngagement = async (
  input: CommunityAiOmnivyraInput
): Promise<CommunityAiOmnivyraOutput> => {
  const brandVoice = normalizeBrandVoice(input.brand_voice);
  if (!isOmniVyraEnabled()) {
    return {
      analysis: 'OmniVyra disabled',
      suggested_actions: [],
      content_improvement: null,
      safety_classification: null,
      execution_links: null,
      source: 'placeholder',
    };
  }

  const response = await evaluateCommunityAiEngagement({
    ...input,
    brand_voice: brandVoice,
  });
  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_COMMUNITY_AI_FALLBACK', { reason: response.error?.message });
    return {
      analysis: 'OmniVyra unavailable',
      suggested_actions: [],
      content_improvement: null,
      safety_classification: null,
      execution_links: null,
      source: 'placeholder',
    };
  }

  const data = response.data || {};
  const suggested = normalizeSuggestedActions(data.suggested_actions ?? [], brandVoice);
  const playbooks = (await listPlaybooks(input.tenant_id, input.organization_id)).filter(
    (playbook) => playbook.status === 'active'
  );
  const playbookApplied = playbooks.length > 0;

  const evaluatedActions = await Promise.all(
    suggested.map(async (action) => {
      const platform = action.platform || input.platform || '';
      const contentType = action.content_type || input.context?.content_type || '';
      if (!playbookApplied) {
        return {
          ...action,
          blocked_reason: 'No applicable playbook',
        };
      }

      const evaluation = evaluatePlaybookForEvent(
        {
          platform,
          content_type: contentType,
          intent_scores: action.intent_scores || input.context?.intent_scores || {},
          sentiment: action.sentiment || input.context?.sentiment || 'neutral',
          user_type: action.user_type || input.context?.user_type || 'regular_user',
        },
        playbooks
      );

      if (!evaluation?.primary_playbook) {
        return {
          ...action,
          blocked_reason: 'No applicable playbook',
        };
      }

      const decision = evaluation?.decision;
      const executionMode = decision?.execution_mode ?? 'manual';
      const toneUsed = decision?.tone?.style ?? brandVoice;
      const playbookId = evaluation.primary_playbook.id || null;
      const playbookName = evaluation?.primary_playbook?.name || null;
      const executionModesConfig = evaluation?.primary_playbook?.execution_modes || null;
      const intentClassification =
        action.intent_classification ?? action.intent_scores ?? input.context?.intent_scores ?? null;
      if (
        !playbookId ||
        !playbookName ||
        !executionMode ||
        !toneUsed ||
        !intentClassification ||
        !executionModesConfig
      ) {
        return {
          ...action,
          blocked_reason: 'Playbook metadata missing',
        };
      }
      const historyMetrics = await loadHistoryMetrics(
        input.tenant_id,
        input.organization_id,
        playbookId
      );
      const playbookValidation = validateActionAgainstPlaybook(
        {
          action_type: action.action_type,
          text: action.suggested_text,
          execution_mode: executionMode,
          risk_level: action.risk_level,
        },
        evaluation?.primary_playbook,
        historyMetrics
      );
      if (!playbookValidation.allowed) {
        return {
          ...action,
          blocked_reason: playbookValidation.reason || 'Playbook validation failed',
        };
      }

      const requiresApproval =
        decision?.requires_approval ?? playbookValidation.requires_approval ?? true;

      if (requiresApproval) {
        const targetId =
          action.target_id ||
          action.targetId ||
          action.post_id ||
          action.postId ||
          action.comment_id ||
          action.commentId ||
          action.profile_id ||
          action.profileId ||
          action.target;

        if (targetId) {
          const { data: existing } = await supabase
            .from('community_ai_actions')
            .select('id')
            .eq('tenant_id', input.tenant_id)
            .eq('organization_id', input.organization_id)
            .eq('platform', platform)
            .eq('action_type', action.action_type)
            .eq('target_id', targetId)
            .in('status', ['pending', 'approved'])
            .limit(1);
          if (!existing || existing.length === 0) {
            await supabase.from('community_ai_actions').insert({
              tenant_id: input.tenant_id,
              organization_id: input.organization_id,
              platform,
              action_type: action.action_type,
              target_id: targetId,
              suggested_text: action.suggested_text ?? null,
              tone: toneUsed,
              tone_used: toneUsed,
              risk_level: action.risk_level ?? null,
              requires_human_approval: true,
              requires_approval: requiresApproval,
              execution_mode: executionMode,
              execution_modes_config: executionModesConfig,
              playbook_id: playbookId,
              playbook_name: playbookName,
              intent_classification: intentClassification,
              status: 'pending',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      return {
        ...action,
        playbook_id: playbookId,
        playbook_name: playbookName,
        intent_classification: intentClassification,
        requires_approval: requiresApproval,
        execution_mode: executionMode,
        execution_modes_config: executionModesConfig,
        tone_used: toneUsed,
        requires_human_approval: requiresApproval,
      };
    })
  );

  const filteredActions = evaluatedActions.filter(Boolean);

  let autoRules = { actions: filteredActions, autoExecuted: 0 };
  try {
    autoRules = await evaluateAutoRules({
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
      platform: input.platform ?? null,
      suggested_actions: filteredActions,
      context: input.context,
    });
  } catch (error: any) {
    console.warn('COMMUNITY_AI_AUTO_RULES_FAILED', error?.message || error);
  }
  return {
    analysis: data.analysis ?? '',
    suggested_actions: autoRules.actions,
    content_improvement: data.content_improvement ?? null,
    safety_classification: data.safety_classification ?? null,
    execution_links: data.execution_links ?? null,
    source: 'omnivyra',
  };
};

