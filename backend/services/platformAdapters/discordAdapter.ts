/**
 * Discord Community Adapter
 *
 * Implements IPlatformAdapter for Discord.
 * Primarily for signal detection and intelligence; no publishing.
 */

import type {
  IPlatformAdapter,
  FetchCommentsParams,
  PlatformCredentials,
  PublishResult,
  ConnectionTestResult,
} from './baseAdapter';
import type { CommunityMessage } from './communityAdapterTypes';
import { withRateLimit, fetchJsonWithBearer } from './baseAdapter';

const DISCORD_API = 'https://discord.com/api/v10';

const notSupported = (method: string) =>
  ({ success: false, error: `Discord does not support ${method} via this adapter` });

export const discordAdapter: IPlatformAdapter = {
  platformKey: 'discord',

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
    return withRateLimit('discord', async () => {
      const channelId = params.platformPostId;
      const messages = await fetchJsonWithBearer(
        `${DISCORD_API}/channels/${channelId}/messages?limit=100`,
        params.accessToken
      );
      const list = Array.isArray(messages) ? messages : [];
      return list.map((m: any) => ({
        thread_id: channelId,
        message_id: m.id ?? `discord_${Date.now()}`,
        author: m.author?.username ?? m.author?.global_name ?? m.author?.id ?? 'Unknown',
        text: m.content ?? '',
        created_at: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        platform: 'discord',
      }));
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('discord', async () => {
      try {
        const me = await fetchJsonWithBearer(`${DISCORD_API}/users/@me`, credentials.access_token);
        if (me?.id) {
          return { success: true, message: 'Connection test passed' };
        }
        return { success: false, error: 'Discord user not found' };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Connection test failed' };
      }
    });
  },
};
