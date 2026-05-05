/**
 * Threads (Meta) Platform Adapter
 *
 * Implements IPlatformAdapter for the Threads API (graph.threads.net/v1.0).
 *
 * Publish flow (two-step — required for all post types):
 *   1. POST /me/threads          → create container, returns container_id
 *   2. (for video) poll container status until FINISHED
 *   3. POST /me/threads_publish  → publish container, returns thread_id
 *
 * Rate limits: 250 API calls/user/hour · 250 posts/user/24h · 1000 replies/user/24h
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
import { assertMockPlatformsAllowed } from '../mockGuard';

const THREADS_API = 'https://graph.threads.net/v1.0';
const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_ATTEMPTS = 20; // 60s max wait

export const threadsAdapter: IPlatformAdapter = {
  platformKey: 'threads',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    return withRateLimit('threads', async () => {
      enforcePublishPolicy('threads', payload);

      if (process.env.USE_MOCK_PLATFORMS === 'true') {
        assertMockPlatformsAllowed('platformAdapters/threadsAdapter');
        return { success: true, platform_post_id: `mock_threads_${Date.now()}` };
      }

      try {
        const token = credentials.access_token;

        // ── Step 1: create container ────────────────────────────────────────
        const containerBody: Record<string, string> = {
          text: payload.content.slice(0, 500),
        };

        const hasMedia = payload.media_urls && payload.media_urls.length > 0;
        const mediaUrl = hasMedia ? payload.media_urls![0] : null;

        // Determine media type from URL extension heuristic
        const isVideo = mediaUrl ? /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl) : false;

        if (mediaUrl && !isVideo) {
          containerBody.media_type = 'IMAGE';
          containerBody.image_url  = mediaUrl;
        } else if (mediaUrl && isVideo) {
          containerBody.media_type = 'VIDEO';
          containerBody.video_url  = mediaUrl;
        } else {
          containerBody.media_type = 'TEXT';
        }

        // reply_to_id support (for threaded replies)
        if (payload.platform_post_id) {
          containerBody.reply_to_id = payload.platform_post_id;
        }

        const containerRes = await fetch(`${THREADS_API}/me/threads`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify(containerBody),
        });

        if (!containerRes.ok) {
          const err = await containerRes.json().catch(() => ({}));
          return { success: false, error: err?.error?.message ?? `Container creation failed (${containerRes.status})` };
        }

        const { id: containerId } = await containerRes.json();

        // ── Step 2: poll status for video ───────────────────────────────────
        if (isVideo) {
          let attempts = 0;
          while (attempts < VIDEO_POLL_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
            const statusRes = await fetchJsonWithBearer(
              `${THREADS_API}/${containerId}?fields=status,error_message`,
              token,
            );
            if (statusRes?.status === 'FINISHED') break;
            if (statusRes?.status === 'ERROR') {
              return { success: false, error: statusRes?.error_message ?? 'Video processing failed' };
            }
            attempts++;
          }
          if (attempts >= VIDEO_POLL_MAX_ATTEMPTS) {
            return { success: false, error: 'Video processing timed out' };
          }
        }

        // ── Step 3: publish container ───────────────────────────────────────
        const publishRes = await fetch(`${THREADS_API}/me/threads_publish`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ creation_id: containerId }),
        });

        if (!publishRes.ok) {
          const err = await publishRes.json().catch(() => ({}));
          return { success: false, error: err?.error?.message ?? `Publish failed (${publishRes.status})` };
        }

        const { id: threadId } = await publishRes.json();
        const postUrl = `https://www.threads.net/t/${threadId}`;

        return { success: true, platform_post_id: threadId, post_url: postUrl };
      } catch (e: any) {
        return { success: false, error: e?.message ?? 'Threads publish failed' };
      }
    });
  },

  async replyToComment(
    threadId: string,
    message: string,
    credentials: PlatformCredentials,
  ): Promise<{ success: boolean; error?: string }> {
    return withRateLimit('threads', async () => {
      try {
        // Create reply container
        const containerRes = await fetch(`${THREADS_API}/me/threads`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            media_type:   'TEXT',
            text:         message.slice(0, 500),
            reply_to_id:  threadId,
          }),
        });
        if (!containerRes.ok) {
          const err = await containerRes.json().catch(() => ({}));
          return { success: false, error: err?.error?.message ?? 'Reply container failed' };
        }
        const { id: containerId } = await containerRes.json();

        // Publish
        const publishRes = await fetch(`${THREADS_API}/me/threads_publish`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ creation_id: containerId }),
        });
        if (!publishRes.ok) {
          const err = await publishRes.json().catch(() => ({}));
          return { success: false, error: err?.error?.message ?? 'Reply publish failed' };
        }
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message ?? 'Threads reply failed' };
      }
    });
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Threads does not support like via API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('threads', async () => {
      try {
        const url = `${THREADS_API}/${params.platformPostId}/replies?fields=id,text,timestamp,username&limit=50`;
        const data = await fetchJsonWithBearer(url, params.accessToken);
        return data ?? { data: [] };
      } catch {
        return { data: [] };
      }
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('threads', async () => {
      try {
        const me = await fetchJsonWithBearer(
          `${THREADS_API}/me?fields=id,username,threads_profile_audience_size`,
          credentials.access_token,
        );
        if (me?.id) {
          return { success: true, message: `Connected as @${me.username ?? me.id}` };
        }
        return { success: false, error: 'Token validation failed' };
      } catch (e: any) {
        return { success: false, error: e?.message ?? 'Connection test failed' };
      }
    });
  },
};
