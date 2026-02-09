import type { CommunityAiAction } from '../communityAiActionExecutor';
import type { PlatformConnector } from './baseConnector';

const buildPayload = (action: CommunityAiAction) => {
  switch (action.action_type) {
    case 'reply':
      return { type: 'COMMENT', target_id: action.target_id, text: action.suggested_text };
    case 'like':
      return { type: 'LIKE', target_id: action.target_id };
    case 'share':
      return { type: 'SHARE', target_id: action.target_id };
    case 'follow':
      return { type: 'SUBSCRIBE', target_id: action.target_id };
    case 'schedule':
      return { type: 'SCHEDULE', target_id: action.target_id, text: action.suggested_text };
    default:
      return { type: 'UNKNOWN', target_id: action.target_id };
  }
};

export const executeAction: PlatformConnector['executeAction'] = async (action, _authToken) => {
  const payload = buildPayload(action);
  console.log('COMMUNITY_AI_YOUTUBE_EXECUTE', {
    action_id: action.id,
    platform: action.platform,
    action_type: action.action_type,
    payload_type: payload.type,
  });
  return { success: true, platform_response: payload };
};
