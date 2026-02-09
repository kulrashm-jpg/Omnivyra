import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const LINKEDIN_API = 'https://api.linkedin.com/v2';

const getActorUrn = async (authToken: string) => {
  const response = await fetch(`${LINKEDIN_API}/me`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LinkedIn profile lookup failed: ${errorText}`);
  }
  const profile = await response.json();
  if (!profile?.id) {
    throw new Error('LinkedIn profile ID missing');
  }
  return `urn:li:person:${profile.id}`;
};

const postJson = async (url: string, body: Record<string, any>, authToken: string) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
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
        : payload?.message || `LinkedIn request failed (${response.status})`
    );
  }
  return { status: response.status, data: payload };
};

const normalizeTargetUrn = (targetId: string) => targetId.trim();

const isUrl = (value: string) => /^https?:\/\//i.test(value);

export const executeAction: PlatformConnector['executeAction'] = async (action, authToken) => {
  if (action.execution_mode && action.execution_mode !== 'api') {
    return { success: false, error: 'EXECUTION_MODE_NOT_ALLOWED' };
  }

  const actor = await getActorUrn(authToken);
  const target = normalizeTargetUrn(action.target_id);

  try {
    if (action.action_type === 'reply') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      const result = await postJson(
        `${LINKEDIN_API}/socialActions/${encodeURIComponent(target)}/comments`,
        {
          actor,
          message: { text: action.suggested_text },
        },
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'like') {
      const result = await postJson(
        `${LINKEDIN_API}/socialActions/${encodeURIComponent(target)}/likes`,
        { actor },
        authToken
      );
      return { success: true, platform_response: result };
    }

    if (action.action_type === 'share') {
      if (!action.suggested_text) {
        return { success: false, error: 'SUGGESTED_TEXT_REQUIRED' };
      }
      const shareContent = isUrl(target)
        ? {
            shareCommentary: { text: action.suggested_text },
            shareMediaCategory: 'ARTICLE',
            media: [{ status: 'READY', originalUrl: target }],
          }
        : {
            shareCommentary: { text: action.suggested_text },
            shareMediaCategory: 'NONE',
          };
      const result = await postJson(
        `${LINKEDIN_API}/ugcPosts`,
        {
          author: actor,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': shareContent,
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
          },
        },
        authToken
      );
      return { success: true, platform_response: result };
    }

    return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'LINKEDIN_EXECUTION_FAILED' };
  }
};
