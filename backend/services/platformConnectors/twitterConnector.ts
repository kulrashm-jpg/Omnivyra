import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const TWITTER_API = 'https://api.twitter.com/2';

const requestJson = async (url: string, options: RequestInit, errorPrefix: string) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.error || payload?.detail || `Twitter request failed (${response.status})`;
    throw new Error(`${errorPrefix}: ${message}`);
  }
  return { status: response.status, data: payload };
};

const getUserId = async (authToken: string) => {
  const result = await requestJson(
    `${TWITTER_API}/users/me`,
    { headers: { Authorization: `Bearer ${authToken}` } },
    'Twitter user lookup failed'
  );
  const userId = result?.data?.data?.id;
  if (!userId) {
    throw new Error('Twitter user id missing');
  }
  return userId as string;
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
      const result = await requestJson(
        `${TWITTER_API}/tweets`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: action.suggested_text,
            reply: { in_reply_to_tweet_id: action.target_id },
          }),
        },
        'Twitter reply failed'
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'like') {
      const userId = await getUserId(authToken);
      const result = await requestJson(
        `${TWITTER_API}/users/${encodeURIComponent(userId)}/likes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tweet_id: action.target_id }),
        },
        'Twitter like failed'
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'share') {
      const userId = await getUserId(authToken);
      const result = await requestJson(
        `${TWITTER_API}/users/${encodeURIComponent(userId)}/retweets`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tweet_id: action.target_id }),
        },
        'Twitter retweet failed'
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'follow') {
      const userId = await getUserId(authToken);
      const result = await requestJson(
        `${TWITTER_API}/users/${encodeURIComponent(userId)}/following`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ target_user_id: action.target_id }),
        },
        'Twitter follow failed'
      );
      return { success: true, platform_response: result };
    }

    return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'TWITTER_EXECUTION_FAILED' };
  }
};
