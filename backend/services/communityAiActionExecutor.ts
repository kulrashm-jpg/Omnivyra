import { notifyCommunityAi } from './communityAiNotificationService';

type CommunityAiAction = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule';
  target_id: string;
  suggested_text: string | null;
  requires_human_approval?: boolean | null;
  risk_level?: 'low' | 'medium' | 'high' | null;
};

type ExecutionResult = {
  ok: boolean;
  status: 'executed' | 'failed';
  error?: string;
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
  if (action?.suggested_text == null || String(action.suggested_text).trim().length === 0) {
    return { ok: false, error: 'SUGGESTED_TEXT_REQUIRED' };
  }
  return { ok: true };
};

const requiresApproval = (action: CommunityAiAction, approved: boolean) => {
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

export const executeAction = async (
  action: CommunityAiAction,
  approved: boolean,
  options?: { notify?: boolean }
): Promise<ExecutionResult> => {
  const validation = validateAction(action);
  if (!validation.ok) {
    return { ok: false, status: 'failed', error: validation.error };
  }

  if (requiresApproval(action, approved)) {
    return { ok: false, status: 'failed', error: 'APPROVAL_REQUIRED' };
  }

  const connector = await loadConnector(action.platform);
  if (!connector?.executeAction) {
    return { ok: false, status: 'failed', error: 'PLATFORM_NOT_SUPPORTED' };
  }

  try {
    const response = await connector.executeAction(action);
    if (response?.ok === false) {
      if (options?.notify !== false) {
        await notifyCommunityAi({
          tenant_id: action.tenant_id,
          organization_id: action.organization_id,
          action_id: action.id,
          event_type: 'failed',
          message: `Action failed on ${action.platform}`,
        });
      }
      return { ok: false, status: 'failed', error: response.error || 'EXECUTION_FAILED', response };
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
    return { ok: false, status: 'failed', error: error?.message || 'EXECUTION_FAILED' };
  }
};

export type { CommunityAiAction, ExecutionResult };
