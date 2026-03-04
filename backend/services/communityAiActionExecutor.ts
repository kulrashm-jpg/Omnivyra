import { notifyCommunityAi } from './communityAiNotificationService';
import { sendCommunityAiWebhooks } from './communityAiWebhookService';
import { supabase } from '../db/supabaseClient';
import { getPlaybookById } from './playbooks/playbookService';
import { validateActionAgainstPlaybook } from './playbooks/playbookValidator';
import { getToken } from './platformTokenService';
import { executeRpaTask } from './rpaWorker/rpaWorkerService';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { getCommunityAiPlatformPolicy } from './communityAiPlatformPolicyService';
import { logUsageEvent } from './usageLedgerService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';

type CommunityAiAction = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule';
  target_id: string;
  suggested_text: string | null;
  playbook_id?: string | null;
  discovered_user_id?: string | null;
  requires_approval?: boolean | null;
  execution_mode?: 'api' | 'rpa' | 'manual' | null;
  tone_used?: string | null;
  requires_human_approval?: boolean | null;
  risk_level?: 'low' | 'medium' | 'high' | null;
};

type ExecutionResult = {
  ok: boolean;
  status: 'executed' | 'failed' | 'skipped' | 'blocked_plan_limit';
  error?: string | Record<string, unknown>;
  reason?: string;
  response?: any;
};

const allowedActions = new Set(['like', 'reply', 'share', 'follow', 'schedule']);

const normalizePlatform = (platform: string) => {
  const value = (platform || '').toString().trim().toLowerCase();
  if (value === 'x') return 'twitter';
  return value;
};

const validateAction = (action: CommunityAiAction) => {
  if (!action?.tenant_id) return { ok: false, error: 'TENANT_ID_REQUIRED' };
  if (!action?.organization_id) return { ok: false, error: 'ORGANIZATION_ID_REQUIRED' };
  if (!action?.platform) return { ok: false, error: 'PLATFORM_REQUIRED' };
  if (!allowedActions.has(action?.action_type)) return { ok: false, error: 'ACTION_TYPE_INVALID' };
  if (!action?.target_id) return { ok: false, error: 'TARGET_ID_REQUIRED' };
  const actionType = (action?.action_type || '').toString().toLowerCase();
  if (actionType === 'reply') {
    if (action?.suggested_text == null || String(action.suggested_text).trim().length === 0) {
      return { ok: false, error: 'SUGGESTED_TEXT_REQUIRED' };
    }
  }
  return { ok: true };
};

const requiresApproval = (action: CommunityAiAction, approved: boolean) => {
  if (action.requires_approval && !approved) return true;
  if (!approved) return true;
  if (action.requires_human_approval) return false;
  if (action.risk_level === 'high') return false;
  return false;
};

const loadConnector = async (platform: string) => {
  const normalized = normalizePlatform(platform);
  switch (normalized) {
    case 'linkedin':
      return import('./platformConnectors/linkedinConnector');
    case 'facebook':
      return import('./platformConnectors/facebookConnector');
    case 'twitter':
      return import('./platformConnectors/twitterConnector');
    case 'instagram':
      return import('./platformConnectors/instagramConnector');
    case 'youtube':
      return import('./platformConnectors/youtubeConnector');
    case 'reddit':
      return import('./platformConnectors/redditConnector');
    default:
      return null;
  }
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

const simulateManualExecution = (action: CommunityAiAction): ExecutionResult => {
  return {
    ok: true,
    status: 'executed',
    response: {
      simulated: true,
      execution_mode: 'manual',
      platform: action.platform,
      action_type: action.action_type,
      target_id: action.target_id,
      sent_text: action.suggested_text,
      sent_at: new Date().toISOString(),
    },
  };
};

export const executeAction = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: { notify?: boolean; webhook?: boolean; source?: 'manual' | 'auto' | 'scheduler' }
): Promise<ExecutionResult> => {
  const policy = await getCommunityAiPlatformPolicy();
  if (!policy.execution_enabled) {
    console.debug('COMMUNITY_AI_PLATFORM_POLICY_BLOCK', {
      reason: 'execution_enabled=false',
      action_id: action.id,
      source: options?.source || 'unknown',
    });
    await supabase.from('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'execution_enabled',
        action_id: action.id,
        source: options?.source || 'unknown',
      },
      created_at: new Date().toISOString(),
    });
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'execution_enabled',
        source: options?.source || 'unknown',
      },
    });
    return { ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' };
  }

  if (policy.require_human_approval && options?.source && options.source !== 'manual') {
    console.debug('COMMUNITY_AI_PLATFORM_POLICY_BLOCK', {
      reason: 'require_human_approval=true',
      action_id: action.id,
      source: options?.source,
    });
    await supabase.from('audit_logs').insert({
      actor_user_id: null,
      action: 'COMMUNITY_AI_PLATFORM_POLICY_BLOCK',
      metadata: {
        policy_flag: 'require_human_approval',
        action_id: action.id,
        source: options?.source,
      },
      created_at: new Date().toISOString(),
    });
    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: 'skipped_due_to_platform_policy',
      event_payload: {
        policy_flag: 'require_human_approval',
        source: options?.source,
      },
    });
    return { ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' };
  }

  const validation = validateAction(action);
  if (!validation.ok) {
    return { ok: false, status: 'failed', error: validation.error };
  }

  if (!action.playbook_id) {
    return { ok: false, status: 'failed', error: 'PLAYBOOK_REQUIRED' };
  }
  let playbook = null;
  try {
    playbook = await getPlaybookById(action.playbook_id, action.tenant_id, action.organization_id);
  } catch (error: any) {
    return { ok: false, status: 'failed', error: 'PLAYBOOK_NOT_FOUND' };
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
    },
    playbook,
    historyMetrics
  );
  if (!playbookValidation.allowed) {
    return {
      ok: false,
      status: 'failed',
      error: playbookValidation.reason || 'PLAYBOOK_VIOLATION',
    };
  }

  if (requiresApproval(action, approved)) {
    return { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED' };
  }

  const enforcement = await checkUsageBeforeExecution({
    organization_id: action.organization_id,
    resource_key: 'automation_executions',
    projected_increment: 1,
  });
  if (!enforcement.allowed) {
    return {
      ok: false,
      status: 'blocked_plan_limit',
      error: { code: 'PLAN_LIMIT_EXCEEDED', ...enforcement },
    };
  }

  const executionMode = action.execution_mode || 'manual';
  if (executionMode === 'manual') {
    const simulated = simulateManualExecution(action);
    if (options?.notify !== false) {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'executed',
        message: `Action executed on ${action.platform}`,
      });
    }
    if (options?.webhook !== false) {
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'executed',
        action_id: action.id,
        message: `Action executed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
    void logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
    void incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
    return simulated;
  }

  if (executionMode === 'rpa') {
    const rpaResult = await executeRpaTask({
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      platform: action.platform,
      action_type: action.action_type,
      target_url: action.target_id,
      text: action.suggested_text,
      action_id: action.id,
    });
    if (!rpaResult.success) {
      if (options?.notify !== false) {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action failed on ${action.platform}`,
        });
      }
      if (options?.webhook !== false) {
        void sendCommunityAiWebhooks({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          action_id: action.id,
          message: `Action failed on ${action.platform}`,
          metadata: { platform: action.platform, action_type: action.action_type },
        });
      }
      return {
        ok: false,
        status: 'failed',
        error: rpaResult.error || 'RPA_EXECUTION_FAILED',
        response: { ...rpaResult, execution_mode: 'rpa' },
      };
    }
    if (options?.notify !== false) {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'executed',
        message: `Action executed on ${action.platform}`,
      });
    }
    if (options?.webhook !== false) {
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'executed',
        action_id: action.id,
        message: `Action executed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
    void logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
    void incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
    return {
      ok: true,
      status: 'executed',
      response: {
        ...rpaResult,
        execution_mode: 'rpa',
        message: 'RPA executed',
      },
    };
  }

  const connector = await loadConnector(action.platform);
  if (!connector?.executeAction) {
    return { ok: false, status: 'failed', error: 'PLATFORM_NOT_SUPPORTED' };
  }

  let tokenRow: { access_token?: string | null } | null = null;
  try {
    tokenRow = await getToken(
      action.tenant_id,
      action.organization_id,
      normalizePlatform(action.platform)
    );
  } catch (error: any) {
    tokenRow = null;
  }
  if (!tokenRow?.access_token) {
    if (options?.notify !== false) {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Action failed on ${action.platform}`,
      });
    }
    if (options?.webhook !== false) {
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
    return { ok: false, status: 'failed', error: 'Platform not connected' };
  }

  try {
    const response = await connector.executeAction(action, tokenRow.access_token);
    if (response?.success === false) {
      if (options?.notify !== false) {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action failed on ${action.platform}`,
        });
      }
      if (options?.webhook !== false) {
        void sendCommunityAiWebhooks({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          event_type: 'failed',
          action_id: action.id,
          message: `Action failed on ${action.platform}`,
          metadata: { platform: action.platform, action_type: action.action_type },
        });
      }
      return {
        ok: false,
        status: 'failed',
        error: response.error || 'EXECUTION_FAILED',
        response,
      };
    }
    if (options?.notify !== false) {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'executed',
        message: `Action executed on ${action.platform}`,
      });
    }
    if (options?.webhook !== false) {
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'executed',
        action_id: action.id,
        message: `Action executed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
    void logUsageEvent({
      organization_id: action.organization_id,
      campaign_id: null,
      user_id: null,
      source_type: 'automation_execution',
      provider_name: action.platform,
      model_name: null,
      model_version: null,
      source_name: `${action.platform}:${action.action_type}`,
      process_type: 'community_execution',
      metadata: { action_id: action.id },
    });
    void incrementUsageMeter({
      organization_id: action.organization_id,
      source_type: 'automation_execution',
    });
    return { ok: true, status: 'executed', response };
  } catch (error: any) {
    if (options?.notify !== false) {
      await notifyCommunityAi({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        action_id: action.id,
        event_type: 'failed',
        message: `Action failed on ${action.platform}`,
      });
    }
    if (options?.webhook !== false) {
      void sendCommunityAiWebhooks({
        tenant_id: action.tenant_id,
        organization_id: action.organization_id,
        event_type: 'failed',
        action_id: action.id,
        message: `Action failed on ${action.platform}`,
        metadata: { platform: action.platform, action_type: action.action_type },
      });
    }
    return { ok: false, status: 'failed', error: error?.message || 'EXECUTION_FAILED' };
  }
};

export type { CommunityAiAction, ExecutionResult };
