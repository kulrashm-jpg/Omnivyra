import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const REDDIT_API = 'https://oauth.reddit.com';
const USER_AGENT = 'community-ai/1.0';

const postForm = async (path: string, body: Record<string, string>, authToken: string) => {
  const response = await fetch(`${REDDIT_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }
  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload
        : payload?.message || `Reddit request failed (${response.status})`
    );
  }
  return { status: response.status, data: payload };
};

export const executeAction: PlatformConnector['executeAction'] = async (action, authToken) => {
  if (action.execution_mode && action.execution_mode !== 'api') {
    return { success: false, error: 'EXECUTION_MODE_NOT_ALLOWED' };
  }

  try {
    if (action.action_type === 'reply') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      const result = await postForm(
        '/api/comment',
        { api_type: 'json', thing_id: action.target_id, text: action.suggested_text },
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'like') {
      const result = await postForm(
        '/api/vote',
        { id: action.target_id, dir: '1' },
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'share' || action.action_type === 'follow') {
      return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
    }

    return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'REDDIT_EXECUTION_FAILED' };
  }
};
