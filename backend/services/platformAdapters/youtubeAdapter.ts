/**
 * YouTube Platform Adapter
 *
 * Implements IPlatformAdapter for YouTube.
 * Uses YouTube Data API v3: https://www.googleapis.com/youtube/v3
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

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

async function fetchJson(url: string, token: string, params?: Record<string, string>): Promise<any> {
  const u = new URL(url);
  if (params) {
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  }
  const response = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const msg = data?.error?.message || `YouTube request failed (${response.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

export const youtubeAdapter: IPlatformAdapter = {
  platformKey: 'youtube',

  async publishContent(_payload: PublishContentPayload, _credentials: PlatformCredentials): Promise<PublishResult> {
    return withRateLimit('youtube', async () => {
    if (process.env.USE_MOCK_PLATFORMS === 'true') {
      return {
        success: true,
        platform_post_id: `mock_youtube_${Date.now()}`,
        post_url: `https://www.youtube.com/watch?v=${Date.now()}`,
      };
    }
    return {
      success: false,
      error: 'YouTube publish requires channel/video upload flow - use existing platformAdapter',
    };
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('youtube', async () => {
    try {
      const body = {
        snippet: {
          parentId: threadId,
          textOriginal: message,
        },
      };
      const res = await fetch(
        `${YOUTUBE_API}/commentThreads?part=snippet`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'YouTube reply failed');
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'YouTube reply failed' };
    }
    });
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'YouTube like via API requires commentThreads/replies - not implemented' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('youtube', async () => {
    const response = await fetch(
      `${YOUTUBE_API}/commentThreads?part=snippet&videoId=${encodeURIComponent(params.platformPostId)}&order=time&maxResults=100`,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) {
      throw new Error(`YouTube comments fetch failed: ${response.statusText}`);
    }
    return response.json();
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('youtube', async () => {
      try {
        const data = await fetchJson(
          `${YOUTUBE_API}/channels`,
          credentials.access_token,
          { part: 'snippet', mine: 'true' }
        );
        const items = data?.items ?? [];
        if (items.length > 0) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: true, message: 'Token valid (no channels)' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
