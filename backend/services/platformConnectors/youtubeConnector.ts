import type { PlatformConnector } from './baseConnector';

export const executeAction: PlatformConnector['executeAction'] = async (action, authToken) => {
  if (action.action_type !== 'reply') {
    return {
      success: false,
      error: `YouTube connector only supports reply right now. Unsupported action: ${action.action_type}`,
    };
  }

  const response = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        parentId: action.target_id,
        textOriginal: action.suggested_text || '',
      },
    }),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    return {
      success: false,
      error: data?.error?.message || `YouTube reply failed (${response.status})`,
    };
  }

  const platformId =
    typeof data?.id === 'string' && data.id.length > 0 ? data.id : null;
  return { success: true, platform_id: platformId, platform_response: data };
};
