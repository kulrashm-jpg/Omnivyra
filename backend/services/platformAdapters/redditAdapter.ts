/**
 * Reddit Platform Adapter
 *
 * Implements IPlatformAdapter for Reddit.
 * Uses Reddit OAuth API: https://oauth.reddit.com
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import { withRateLimit, fetchJsonWithBearer } from './baseAdapter';

const REDDIT_API = 'https://oauth.reddit.com';
const USER_AGENT = 'community-ai/1.0';

function extractArticleId(platformPostId: string): string {
  const s = (platformPostId || '').trim();
  if (s.startsWith('t3_')) return s.slice(3);
  return s;
}

export const redditAdapter: IPlatformAdapter = {
  platformKey: 'reddit',

  async publishContent(_payload: PublishContentPayload, _credentials: PlatformCredentials): Promise<PublishResult> {
    return withRateLimit('reddit', async () => {
    if (process.env.USE_MOCK_PLATFORMS === 'true') {
      return {
        success: true,
        platform_post_id: `t3_mock_${Date.now()}`,
        post_url: `https://reddit.com/comments/mock`,
      };
    }
    return {
      success: false,
      error: 'Reddit publish requires subreddit submission - use existing platformAdapter',
    };
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('reddit', async () => {
    try {
      await fetchJsonWithBearer(`${REDDIT_API}/api/comment`, credentials.access_token, {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ api_type: 'json', thing_id: threadId, text: message }).toString(),
        },
        extraHeaders: { 'User-Agent': USER_AGENT },
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Reddit reply failed' };
    }
    });
  },

  async likeComment(
    messageId: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('reddit', async () => {
      try {
        await fetchJsonWithBearer(`${REDDIT_API}/api/vote`, credentials.access_token, {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ id: messageId, dir: '1' }).toString(),
          },
          extraHeaders: { 'User-Agent': USER_AGENT },
        });
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Reddit like failed' };
      }
    });
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('reddit', async () => {
    const articleId = extractArticleId(params.platformPostId);
    const response = await fetch(
      `${REDDIT_API}/comments/${articleId}.json?limit=100`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Reddit comments fetch failed: ${response.statusText}`);
    }
    return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('reddit', async () => {
    try {
      const me = await fetchJsonWithBearer(`${REDDIT_API}/api/v1/me`, credentials.access_token, {
        extraHeaders: { 'User-Agent': USER_AGENT },
      });
      if (me?.name) {
        return { success: true, message: 'Connection test passed' };
      }
      return { success: false, error: 'Reddit user name missing' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Connection test failed' };
    }
    });
  },
};
