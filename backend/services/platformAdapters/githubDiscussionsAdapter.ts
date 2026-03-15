/**
 * GitHub Discussions Adapter
 *
 * Implements IPlatformAdapter for GitHub Discussions.
 * Supports publishing (create discussion), replies, ingestion.
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
import { withRateLimit, fetchJsonWithBearer } from './baseAdapter';

const GITHUB_API = 'https://api.github.com';

export const githubDiscussionsAdapter: IPlatformAdapter = {
  platformKey: 'github',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    return withRateLimit('github', async () => {
      const repoId = payload.platform_post_id;
      if (!repoId) return { success: false, error: 'platform_post_id (owner/repo) required' };
      try {
        const [owner, repo] = repoId.split('/');
        const res = await fetchJsonWithBearer(
          `${GITHUB_API}/repos/${owner}/${repo}/discussions`,
          credentials.access_token,
          {
            init: {
              method: 'POST',
              body: JSON.stringify({
              title: payload.title ?? payload.content?.slice(0, 80) ?? 'Discussion',
              body: payload.content ?? '',
              category: payload.hashtags?.[0] ?? 'General',
            }),
            },
            extraHeaders: { Accept: 'application/vnd.github+json' },
          }
        );
        return {
          success: true,
          platform_post_id: res?.number?.toString() ?? res?.id,
          post_url: res?.html_url,
        };
      } catch (e: any) {
        return { success: false, error: e?.message || 'GitHub discussion creation failed' };
      }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('github', async () => {
      try {
        const [owner, repo, discussionNumber] = threadId.split('/');
        await fetchJsonWithBearer(
          `${GITHUB_API}/repos/${owner}/${repo}/discussions/${discussionNumber}/comments`,
          credentials.access_token,
          {
            init: { method: 'POST', body: JSON.stringify({ body: message }) },
            extraHeaders: { Accept: 'application/vnd.github+json' },
          }
        );
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || 'GitHub reply failed' };
      }
    });
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'GitHub reactions use different API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<CommunityMessage[]> {
    return withRateLimit('github', async () => {
      const [owner, repo, discussionNumber] = params.platformPostId.split('/');
      const comments = await fetchJsonWithBearer(
        `${GITHUB_API}/repos/${owner}/${repo}/discussions/${discussionNumber}/comments`,
        params.accessToken,
        { extraHeaders: { Accept: 'application/vnd.github+json' } }
      );
      const list = Array.isArray(comments) ? comments : [];
      const threadId = `${owner}/${repo}/${discussionNumber}`;
      return list.map((c: any) => ({
        thread_id: threadId,
        message_id: String(c.id ?? ''),
        author: c.user?.login ?? 'Unknown',
        text: c.body ?? '',
        created_at: c.created_at ?? new Date().toISOString(),
        platform: 'github',
      }));
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('github', async () => {
      try {
        const me = await fetchJsonWithBearer(`${GITHUB_API}/user`, credentials.access_token, {
          extraHeaders: { Accept: 'application/vnd.github+json' },
        });
        if (me?.login) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'GitHub user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
