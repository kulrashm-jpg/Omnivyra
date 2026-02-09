import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

const isUrl = (value: string) => /^https?:\/\//i.test(value);

const postJson = async (path: string, body: Record<string, any>, authToken: string) => {
  const response = await fetch(`${GRAPH_API}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
        : payload?.error?.message || `Facebook request failed (${response.status})`
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
      const result = await postJson(
        `${encodeURIComponent(action.target_id)}/comments`,
        { message: action.suggested_text },
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'like') {
      const result = await postJson(
        `${encodeURIComponent(action.target_id)}/likes`,
        {},
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'share') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      const shareBody = isUrl(action.target_id)
        ? { link: action.target_id, message: action.suggested_text }
        : { message: action.suggested_text };
      const result = await postJson('me/feed', shareBody, authToken);
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'follow') {
      return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
    }

    return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'FACEBOOK_EXECUTION_FAILED' };
  }
};
