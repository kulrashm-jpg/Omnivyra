/**
 * Stack Overflow Adapter
 *
 * Implements IPlatformAdapter for Stack Overflow.
 * Supports answer publishing, replies, ingestion.
 */

import type {
  IPlatformAdapter,
  PublishContentPayload,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import type { CommunityMessage } from './communityAdapterTypes';
import { withRateLimit } from './baseAdapter';

const STACK_API = 'https://api.stackexchange.com/2.3';

async function fetchJson(
  url: string,
  token: string
): Promise<any> {
  const u = new URL(url);
  u.searchParams.set('access_token', token);
  u.searchParams.set('key', process.env.STACKOVERFLOW_KEY ?? '');
  const response = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(data?.error_message || `Stack Overflow request failed (${response.status})`);
  }
  return data;
}

export const stackoverflowAdapter: IPlatformAdapter = {
  platformKey: 'stackoverflow',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('stackoverflow', async () => {
      const questionId = payload.platform_post_id;
      if (!questionId) return { success: false, error: 'platform_post_id (question_id) required' };
      try {
        const u = new URL(`${STACK_API}/questions/${questionId}/answers/add`);
        u.searchParams.set('access_token', credentials.access_token);
        u.searchParams.set('key', process.env.STACKOVERFLOW_KEY ?? '');
        const res = await fetch(u.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ body: payload.content ?? '' }).toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error_message || 'Post failed');
        const items = data?.items ?? [];
        const id = items[0]?.answer_id ?? items[0]?.question_id;
        return {
          success: true,
          platform_post_id: id ? String(id) : undefined,
          post_url: items[0]?.link,
        };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Stack Overflow post failed' };
      }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('stackoverflow', async () => {
      try {
        const u = new URL(`${STACK_API}/comments/add`);
        u.searchParams.set('access_token', credentials.access_token);
        u.searchParams.set('key', process.env.STACKOVERFLOW_KEY ?? '');
        const body = new URLSearchParams({
          body: message,
          post_id: threadId,
        }).toString();
        const res = await fetch(u.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error_message || 'Reply failed');
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Stack Overflow reply failed' };
      }
    });
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Stack Overflow voting uses different API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<CommunityMessage[]> {
    return withRateLimit('stackoverflow', async () => {
      const postId = params.platformPostId;
      const data = await fetchJson(
        `${STACK_API}/questions/${postId}/answers?order=desc&sort=activity&filter=withbody`,
        params.accessToken
      );
      const items = data?.items ?? [];
      return items.map((a: any) => ({
        thread_id: postId,
        message_id: String(a.answer_id ?? a.post_id ?? a.id ?? ''),
        author: a.owner?.display_name ?? a.owner?.user_id ?? 'Unknown',
        text: a.body ?? '',
        created_at: a.creation_date ? new Date(a.creation_date * 1000).toISOString() : new Date().toISOString(),
        platform: 'stackoverflow',
      }));
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('stackoverflow', async () => {
      try {
        const data = await fetchJson(`${STACK_API}/me`, credentials.access_token);
        const items = data?.items ?? [];
        if (items[0]?.user_id) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'Stack Overflow user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
