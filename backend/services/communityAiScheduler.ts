import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { notifyCommunityAi } from './communityAiNotificationService';
import { sendCommunityAiWebhooks } from './communityAiWebhookService';
import { getPlaybookById } from './playbooks/playbookService';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getToken } from './platformTokenService';
import { getCommunityAiPlatformPolicy } from './communityAiPlatformPolicyService';
import { canExecuteAction } from './executionGuardrailService';

type SchedulerResult = {
  processed: number;
  executed: number;
  failed: number;
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
      .select('id, intent_classification')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .eq('playbook_id', playbookId)
      .eq('status', 'executed')
      .gte('updated_at', dayStartIso);

    const networkActionsToday =
      (actionRows || []).filter(
        (row: any) => row?.intent_classification?.primary_intent === 'network_expansion'
      ).length ?? 0;

    return {
      replies_last_hour: replyRows?.length ?? 0,
      follows_today: followRows?.length ?? 0,
      actions_today: actionRows?.length ?? 0,
      networkActionsToday,
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

export const runCommunityAiScheduler = async (now = new Date()): Promise<SchedulerResult> => {
  const policy = await getCommunityAiPlatformPolicy();
  if (!policy.execution_enabled) {
    console.debug('COMMUNITY_AI_PLATFORM_POLICY_BLOCK', {
      reason: 'execution_enabled=false',
      source: 'scheduler',
    });
    await supabase.from('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'execution_enabled',
        source: 'scheduler',
      },
      created_at: new Date().toISOString(),
    });
    return { processed: 0, executed: 0, failed: 0 };
  }

  const cutoff = now.toISOString();
  const { data: actions, error } = await supabase
    .from('community_ai_actions')
    .select('*')
    .eq('status', 'approved')
    .gte('scheduled_at', '1970-01-01T00:00:00.000Z')
    .lte('scheduled_at', cutoff);

  if (error || !actions) {
    console.warn('COMMUNITY_AI_SCHEDULER_LOAD_FAILED', error?.message);
    return { processed: 0, executed: 0, failed: 0 };
  }

  let executed = 0;
  let failed = 0;

  for (const action of actions) {
    if (!action.tenant_id || !action.organization_id) {
      failed += 1;
      await supabase
        .from('community_ai_actions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', action.id);
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id || 'unknown',
        organization_id: action.organization_id || 'unknown',
        event_type: 'failed',
        event_payload: { error: 'TENANT_SCOPE_MISSING' },
      });
      continue;
    }

    if (action.intent_classification?.primary_intent === 'network_expansion') {
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'skipped',
        event_payload: {
          reason: 'PHASE_5B_OBSERVATION_LOCK',
        },
      });
      continue;
    }

    if (!action.playbook_id) {
      failed += 1;
      const failure = { ok: false, status: 'failed', error: 'PLAYBOOK_REQUIRED' };
      await supabase
        .from('community_ai_actions')
        .update({
          status: 'failed',
          execution_result: failure,
          updated_at: new Date().toISOString(),
        })
        .eq('id', action.id);
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    let playbook = null;
    try {
      playbook = await getPlaybookById(
        action.playbook_id,
        action.tenant_id,
        action.organization_id
      );
    } catch (error: any) {
      failed += 1;
      const failure = { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND' };
      await supabase
        .from('community_ai_actions')
        .update({
          status: 'failed',
          execution_result: failure,
          updated_at: new Date().toISOString(),
        })
        .eq('id', action.id);
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    const historyMetrics = await loadHistoryMetrics(
      action.tenant_id,
      action.organization_id,
      action.playbook_id
    );
    const playbookValidation = validateActionAgainstPlaybook(
      {
        action_type: action.action_type,
        text: action.suggested_text,
        execution_mode: action.execution_mode || 'manual',
        risk_level: action.risk_level,
        intent_classification: action.intent_classification || null,
      },
      playbook,
      historyMetrics
    );
    if (!playbookValidation.allowed) {
      const reason = playbookValidation.reason || 'PLAYBOOK_VIOLATION';
      const skipReasons = new Set([
        'NETWORK_DAILY_LIMIT_EXCEEDED',
        'OUTSIDE_ALLOWED_HOURS',
        'AUTOMATION_LEVEL_OBSERVE',
        'AUTOMATION_LEVEL_ASSIST_LIMIT',
        'AUTOMATION_LEVEL_AUTOMATE_LIMIT',
      ]);
      if (skipReasons.has(reason)) {
        await supabase
          .from('community_ai_actions')
          .update({
            status: 'skipped',
            updated_at: new Date().toISOString(),
          })
          .eq('id', action.id);
        await logCommunityAiActionEvent({
          action_id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'skipped',
          event_payload: { reason },
        });
        continue;
      }

      failed += 1;
      const failure = {
        ok: false,
        status: 'failed',
        error: reason,
      };
      await supabase
        .from('community_ai_actions')
        .update({
          status: 'failed',
          execution_result: failure,
          updated_at: new Date().toISOString(),
        })
        .eq('id', action.id);
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        event_payload: failure,
      });
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Scheduled action failed on ${action.platform}`,
      });
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Scheduled action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
      continue;
    }

    const executionMode = (action.execution_mode || 'manual').toString().trim().toLowerCase();
    if (executionMode === 'api') {
      let tokenRow: { access_token?: string | null } | null = null;
      try {
        tokenRow = await getToken(
          action.tenant_id,
          action.organization_id,
          (action.platform || '').toString().trim().toLowerCase()
        );
      } catch (error: any) {
        tokenRow = null;
      }
      if (!tokenRow?.access_token) {
        failed += 1;
        const failure = {
          ok: false,
          status: 'failed',
          error: 'Platform not connected',
        };
        await supabase
          .from('community_ai_actions')
          .update({
            status: 'failed',
            execution_result: failure,
            updated_at: new Date().toISOString(),
          })
          .eq('id', action.id);
        await logCommunityAiActionEvent({
          action_id: action.id,
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          event_payload: failure,
        });
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Scheduled action failed on ${action.platform}`,
        });
        void sendCommunityAiWebhooks({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          action_id: action.id,
          message: `Scheduled action failed on ${action.platform}`,
          metadata: { platform: action.platform, action_type: action.action_type },
        });
        continue;
      }
    }

    const guardrail = await canExecuteAction(
      {
        id: action.id,
        company_id: action.organization_id,
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        platform: action.platform,
        action_type: action.action_type,
        target_id: action.target_id,
      },
      { source: 'scheduler' }
    );
    if (!guardrail.allowed) {
      await supabase
        .from('community_ai_actions')
        .update({
          status: 'skipped_guardrail',
          skip_reason: guardrail.reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', action.id);
      continue;
    }

    const result = await executeAction(action, true, {
      notify: false,
      webhook: false,
      source: 'scheduler',
    });

    if (result.status === 'skipped' && result.reason === 'HUMAN_APPROVAL_REQUIRED') {
      continue;
    }

    const nextStatus =
      result.status === 'skipped' ? 'skipped' : result.ok ? 'executed' : 'failed';
    if (result.ok) executed += 1;
    else if (result.status !== 'skipped') failed += 1;

    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      execution_result: result,
      updated_at: new Date().toISOString(),
    };
    if (nextStatus === 'executed') {
      updatePayload.executed_at = new Date().toISOString();
    }
    await supabase
      .from('community_ai_actions')
      .update(updatePayload)
      .eq('id', action.id);

    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: nextStatus === 'executed' ? 'executed' : nextStatus === 'skipped' ? 'skipped' : 'failed',
      event_payload: result,
    });

    if (nextStatus !== 'skipped') {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: nextStatus === 'executed' ? 'executed' : 'failed',
        message: `Scheduled action ${nextStatus} on ${action.platform}`,
      });

      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: nextStatus === 'executed' ? 'executed' : 'failed',
        action_id: action.id,
        message: `Scheduled action ${nextStatus} on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
  }

  return { processed: actions.length, executed, failed };
};
