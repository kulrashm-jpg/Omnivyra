/**
 * TikTok Platform Adapter
 *
 * Implements IPlatformAdapter for TikTok Content Posting API v2.
 *
 * Publish flow (video only — TikTok requires video):
 *   1. POST /v2/post/publish/video/init/  → upload_url + publish_id
 *   2. PUT  {upload_url}                  → upload video in chunks (5 MB)
 *   3. Poll /v2/post/publish/status/fetch/ until PUBLISH_COMPLETE
 *
 * Text/image posts use the "DIRECT_POST" source path via /v2/post/publish/content/init/
 * but TikTok only surfaces video on the main feed. We treat TEXT payloads as a no-video
 * direct-post attempt which may fail without creator permissions.
 *
 * Rate limits: undisclosed; adapter respects shared checkRateLimit gate.
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

const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // 60s

export const tiktokAdapter: IPlatformAdapter = {
  platformKey: 'tiktok',

  async publishContent(
    payload: PublishContentPayload,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    return withRateLimit('tiktok', async () => {
      enforcePublishPolicy('tiktok', payload);

      if (process.env.USE_MOCK_PLATFORMS === 'true') {
        return { success: true, platform_post_id: `mock_tiktok_${Date.now()}` };
      }

      try {
        const token = credentials.access_token;
        const caption = payload.content.slice(0, 2200);
        const mediaUrl = payload.media_urls?.[0] ?? null;

        // ── Step 1: init upload ─────────────────────────────────────────────
        const initBody: Record<string, unknown> = {
          post_info: {
            title:                  caption,
            privacy_level:          'PUBLIC_TO_EVERYONE',
            disable_duet:           false,
            disable_comment:        false,
            disable_stitch:         false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: { source: 'FILE_UPLOAD' },
        };

        if (!mediaUrl) {
          return { success: false, error: 'TikTok posts require a video file' };
        }

        const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify(initBody),
        });

        if (!initRes.ok) {
          const e = await initRes.json().catch(() => ({}));
          return { success: false, error: e?.error?.message ?? `Init failed (${initRes.status})` };
        }

        const initData = await initRes.json();
        const uploadUrl = initData?.data?.upload_url as string;
        const publishId = initData?.data?.publish_id as string;

        if (!uploadUrl || !publishId) {
          return { success: false, error: 'TikTok init did not return upload_url / publish_id' };
        }

        // ── Step 2: download + upload video ─────────────────────────────────
        const videoRes = await fetch(mediaUrl);
        if (!videoRes.ok) {
          return { success: false, error: `Failed to fetch video from storage (${videoRes.status})` };
        }
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
        const totalSize = videoBuffer.length;

        let offset = 0;
        while (offset < totalSize) {
          const end = Math.min(offset + CHUNK_SIZE, totalSize);
          const chunk = videoBuffer.slice(offset, end);

          const chunkRes = await fetch(uploadUrl, {
            method:  'PUT',
            headers: {
              Authorization:        `Bearer ${token}`,
              'Content-Type':       'video/mp4',
              'Content-Range':      `bytes ${offset}-${end - 1}/${totalSize}`,
              'Content-Length':     String(chunk.length),
            },
            body: chunk,
          });

          if (!chunkRes.ok) {
            const e = await chunkRes.json().catch(() => ({}));
            return { success: false, error: e?.error?.message ?? `Chunk upload failed at offset ${offset}` };
          }
          offset = end;
        }

        // ── Step 3: poll publish status ──────────────────────────────────────
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

          const statusRes = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ publish_id: publishId }),
          });

          if (!statusRes.ok) continue;

          const statusData = await statusRes.json();
          const status = statusData?.data?.status as string | undefined;

          if (status === 'PUBLISH_COMPLETE') {
            const itemId = statusData?.data?.publicaly_available_post_id?.[0] ?? publishId;
            return {
              success:          true,
              platform_post_id: String(itemId),
              post_url:         `https://www.tiktok.com/@me/video/${itemId}`,
            };
          }

          if (status === 'FAILED') {
            const failMsg = statusData?.data?.fail_reason ?? 'TikTok publish failed';
            return { success: false, error: failMsg };
          }
        }

        return { success: false, error: 'TikTok publish timed out waiting for PUBLISH_COMPLETE' };
      } catch (e: any) {
        return { success: false, error: e?.message ?? 'TikTok publish error' };
      }
    });
  },

  async replyToComment(
    _threadId: string,
    _message: string,
    _credentials: PlatformCredentials,
  ): Promise<{ success: boolean; error?: string }> {
    // TikTok comment reply is not available in Content Posting API v2
    return { success: false, error: 'TikTok does not support comment replies via API' };
  },

  async likeComment(
    _messageId: string,
    _credentials: PlatformCredentials,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'TikTok does not support comment likes via API' };
  },

  async fetchComments(params: FetchCommentsParams): Promise<unknown> {
    return withRateLimit('tiktok', async () => {
      try {
        // TikTok comment list endpoint: POST /v2/comment/list/
        const res = await fetch(`${TIKTOK_API}/comment/list/`, {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_id: params.platformPostId,
            max_count: 50,
          }),
        });

        if (!res.ok) return { data: [] };
        const data = await res.json().catch(() => ({ data: [] }));
        return data ?? { data: [] };
      } catch {
        return { data: [] };
      }
    });
  },

  async testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult> {
    return withRateLimit('tiktok', async () => {
      try {
        // GET /v2/user/info/ with fields
        const me = await fetchJsonWithBearer(
          `${TIKTOK_API}/user/info/?fields=open_id,union_id,display_name,follower_count`,
          credentials.access_token,
        );

        const displayName = me?.data?.user?.display_name;
        if (displayName || me?.data?.user?.open_id) {
          return { success: true, message: `Connected as ${displayName ?? me.data.user.open_id}` };
        }
        return { success: false, error: 'Token validation failed' };
      } catch (e: any) {
        return { success: false, error: e?.message ?? 'TikTok connection test failed' };
      }
    });
  },
};
