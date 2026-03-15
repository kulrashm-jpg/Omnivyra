/**
 * Slack Community Adapter
 *
 * Implements IPlatformAdapter for Slack.
 * Primarily for signal detection and intelligence; no publishing.
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

const SLACK_API = 'https://slack.com/api';

async function fetchSlackJson(url: string, token: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<any> {
  const data = await fetchJsonWithBearer(url, token, { init });
  if (data?.ok === false) throw new Error(data?.error || 'Slack API error');
  return data;
}

const notSupported = (method: string) =>
  ({ success: false, error: `Slack does not support ${method} via this adapter` });

export const slackAdapter: IPlatformAdapter = {
  platformKey: 'slack',

  async publishContent(): Promise<PublishResult> {
    return notSupported('publishing');
  },

  async replyToComment(): Promise<{ success: boolean; error?: string }> {
    return notSupported('replies');
  },

  async likeComment(): Promise<{ success: boolean; error?: string }> {
    return notSupported('like');
  },

  async fetchComments(params: FetchCommentsParams): Promise<CommunityMessage[]> {
    return withRateLimit('slack', async () => {
      const channelId = params.platformPostId;
      const history = await fetchSlackJson(
        `${SLACK_API}/conversations.history?channel=${encodeURIComponent(channelId)}&limit=100`,
        params.accessToken
      );
      const messages = history?.messages ?? [];
      return messages.map((m: any) => ({
        thread_id: channelId,
        message_id: m.ts ?? m.client_msg_id ?? `slack_${Date.now()}`,
        author: m.user ?? m.username ?? 'Unknown',
        text: m.text ?? '',
        created_at: m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : new Date().toISOString(),
        platform: 'slack',
      }));
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('slack', async () => {
      try {
        const auth = await fetchSlackJson(`${SLACK_API}/auth.test`, credentials.access_token);
        if (auth?.ok && auth?.user_id) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: auth?.error || 'Slack auth failed' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
