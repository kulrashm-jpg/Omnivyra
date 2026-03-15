/**
 * Twitter/X Platform Adapter
 *
 * Implements IPlatformAdapter for Twitter/X.
 * Uses Twitter API v2: https://api.twitter.com/2
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

const TWITTER_API = 'https://api.twitter.com/2';

const fetchJson = (url: string, init: RequestInit & { headers?: Record<string, string> }, token: string) =>
  fetchJsonWithBearer(url, token, {
    init,
    getErrorMsg: (d, s) => d?.error || d?.detail || `Twitter request failed (${s})`,
  });

export const twitterAdapter: IPlatformAdapter = {
  platformKey: 'twitter',

  async publishContent(payload: PublishContentPayload, credentials: PlatformCredentials): Promise<PublishResult> {
    return withRateLimit('twitter', async () => {
      enforcePublishPolicy('twitter', payload);
    if (process.env.USE_MOCK_PLATFORMS === 'true') {
      return {
        success: true,
        platform_post_id: `mock_twitter_${Date.now()}`,
        post_url: `https://twitter.com/i/status/${Date.now()}`,
      };
    }
    try {
      const res = await fetchJson(
        `${TWITTER_API}/tweets`,
        {
          method: 'POST',
          body: JSON.stringify({ text: payload.content.slice(0, 280) }),
        },
        credentials.access_token
      );
      const id = res?.data?.id;
      return {
        success: true,
        platform_post_id: id ? String(id) : undefined,
        post_url: id ? `https://twitter.com/i/status/${id}` : undefined,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Twitter publish failed' };
    }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('twitter', async () => {
    try {
      await fetchJson(
        `${TWITTER_API}/tweets`,
        {
          method: 'POST',
          body: JSON.stringify({
            text: message.slice(0, 280),
            reply: { in_reply_to_tweet_id: threadId },
          }),
        },
        credentials.access_token
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Twitter reply failed' };
    }
    });
  },

  async likeComment(
    messageId: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('twitter', async () => {
    try {
      const me = await fetchJson(`${TWITTER_API}/users/me`, {}, credentials.access_token);
      const userId = me?.data?.id;
      if (!userId) throw new Error('Twitter user ID missing');
      await fetchJson(
        `${TWITTER_API}/users/${userId}/likes`,
        {
          method: 'POST',
          body: JSON.stringify({ tweet_id: messageId }),
        },
        credentials.access_token
      );
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Twitter like failed' };
    }
    });
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('twitter', async () => {
    const response = await fetch(
      `${TWITTER_API}/tweets/${encodeURIComponent(params.platformPostId)}/replies`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Twitter replies fetch failed: ${response.statusText}`);
    }
    return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('twitter', async () => {
    try {
      const me = await fetchJson(`${TWITTER_API}/users/me`, {}, credentials.access_token);
      if (me?.data?.id) {
        return { success: true, message: 'Connection test passed' };
      }
      return { success: false, error: 'Twitter user ID missing' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Connection test failed' };
    }
    });
  },
};
