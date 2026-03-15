/**
 * Quora Platform Adapter
 *
 * Implements IPlatformAdapter for Quora.
 * Uses: https://api.quora.com (placeholder - Quora API may vary)
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import { withRateLimit, enforcePublishPolicy, fetchJsonWithBearer } from './baseAdapter';

const QUORA_API = 'https://api.quora.com';

export const quoraAdapter: IPlatformAdapter = {
  platformKey: 'quora',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('quora', async () => {
      enforcePublishPolicy('quora', payload);
      if (process.env.USE_MOCK_PLATFORMS === 'true') {
        return {
          success: true,
          platform_post_id: `mock_quora_${Date.now()}`,
          post_url: `https://quora.com/answer/${Date.now()}`,
        };
      }
      try {
        const res = await fetchJsonWithBearer(
          `${QUORA_API}/answers`,
          credentials.access_token,
          { init: { method: 'POST', body: JSON.stringify({ question_id: payload.platform_post_id, content: payload.content }) } }
        );
        const id = res?.id;
        return {
          success: true,
          platform_post_id: id,
          post_url: id ? `https://quora.com/answer/${id}` : undefined,
        };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Quora answer creation failed' };
      }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('quora', async () => {
      try {
        await fetchJsonWithBearer(
          `${QUORA_API}/comments`,
          credentials.access_token,
          { init: { method: 'POST', body: JSON.stringify({ parent_id: threadId, content: message }) } }
        );
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Quora comment failed' };
      }
    });
  },

  async likeComment(
    messageId: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('quora', async () => {
      try {
        await fetchJsonWithBearer(
          `${QUORA_API}/votes`,
          credentials.access_token,
          { init: { method: 'POST', body: JSON.stringify({ target_id: messageId, direction: 1 }) } }
        );
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Quora upvote failed' };
      }
    });
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('quora', async () => {
      const response = await fetch(
        `${QUORA_API}/answers/${encodeURIComponent(params.platformPostId)}/replies`,
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      if (!response.ok) {
        throw new Error(`Quora replies fetch failed: ${response.statusText}`);
      }
      return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('quora', async () => {
      try {
        const me = await fetchJsonWithBearer(`${QUORA_API}/me`, credentials.access_token);
        if (me?.id || me?.username) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'Quora user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
