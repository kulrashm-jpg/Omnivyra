/**
 * Pinterest Platform Adapter
 *
 * Implements IPlatformAdapter for Pinterest API v5.
 * Uses: https://api.pinterest.com/v5
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

const PINTEREST_API = 'https://api.pinterest.com/v5';

export const pinterestAdapter: IPlatformAdapter = {
  platformKey: 'pinterest',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('pinterest', async () => {
      enforcePublishPolicy('pinterest', payload);
      if (process.env.USE_MOCK_PLATFORMS === 'true') {
        return {
          success: true,
          platform_post_id: `mock_pin_${Date.now()}`,
          post_url: `https://pinterest.com/pin/${Date.now()}`,
        };
      }
      const imageUrl = payload.media_urls?.[0];
      if (!imageUrl) {
        return { success: false, error: 'Pinterest requires at least one image (media_urls)' };
      }
      try {
        const res = await fetchJsonWithBearer(
          `${PINTEREST_API}/pins`,
          credentials.access_token,
          {
            init: {
              method: 'POST',
              body: JSON.stringify({
                link: payload.platform_post_id || 'https://pinterest.com',
                title: payload.title || payload.content?.slice(0, 100) || 'Pin',
                description: payload.content || '',
                media_source: {
                  source_type: 'url',
                  url: imageUrl,
                },
              }),
            },
          }
        );
        const id = res?.id;
        const link = res?.link;
        return {
          success: true,
          platform_post_id: id,
          post_url: link || (id ? `https://pinterest.com/pin/${id}` : undefined),
        };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Pinterest pin creation failed' };
      }
    });
  },

  async replyToComment(
    _threadId: string,
    _message: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Pinterest does not support replies via API' };
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Pinterest does not support like via this API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('pinterest', async () => {
      const response = await fetch(
        `${PINTEREST_API}/pins/${encodeURIComponent(params.platformPostId)}/comments`,
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      if (!response.ok) {
        throw new Error(`Pinterest comments fetch failed: ${response.statusText}`);
      }
      return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('pinterest', async () => {
      try {
        const me = await fetchJsonWithBearer(`${PINTEREST_API}/user_account`, credentials.access_token);
        if (me?.username || me?.id) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'Pinterest user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
