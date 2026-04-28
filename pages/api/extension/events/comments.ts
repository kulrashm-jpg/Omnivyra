/**
 * POST /api/extension/events/comments
 *
 * Extension-scraped comment sync. The extension's LinkedIn content
 * script visits the user's activity / posts pages, walks the DOM
 * for each post, extracts the comment list, and POSTs here.
 *
 *   engagement_threads  — one row per *post* the user owns
 *                         (platform_thread_id = post URN, e.g.
 *                          urn:li:activity:1234567890).
 *   engagement_messages — one row per comment on that post
 *                         (message_type='comment',
 *                          platform_message_id = comment URN).
 *
 * Tenant-scoped via the extension session (orgId from hmac-signed token).
 * No user-supplied organization_id is trusted.
 *
 * Body contract:
 *   {
 *     platform: 'linkedin',
 *     posts: Array<{
 *       post_urn: string,            // e.g. 'urn:li:activity:7234...'
 *       post_url?: string,
 *       post_text_preview?: string,
 *       reaction_count?: number,
 *       comment_count?: number
 *     }>,
 *     comments: Array<{
 *       post_urn: string,            // FK → posts above
 *       comment_urn: string,         // unique per comment
 *       author_name?: string,
 *       author_handle?: string,
 *       author_self?: boolean,       // true when written by the logged-in user
 *       content: string,
 *       created_at?: string,         // ISO
 *       like_count?: number,
 *       parent_comment_urn?: string  // for threaded replies
 *     }>
 *   }
 *
 * Idempotent: upserts on (platform, platform_thread_id, organization_id)
 * for threads, and (thread_id, platform_message_id) for messages.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { supabase } from '@/backend/db/supabaseClient';

type IncomingPost = {
  post_urn?: string;
  post_url?: string | null;
  post_text_preview?: string | null;
  reaction_count?: number | null;
  comment_count?: number | null;
};

type IncomingComment = {
  post_urn?: string;
  comment_urn?: string;
  author_name?: string | null;
  author_handle?: string | null;
  author_avatar_url?: string | null;
  author_self?: boolean;
  content?: string | null;
  created_at?: string | null;
  like_count?: number | null;
  parent_comment_urn?: string | null;
};

type Body = {
  platform?: string;
  posts?: IncomingPost[];
  comments?: IncomingComment[];
};

const SUPPORTED_PLATFORMS = new Set(['linkedin']);

function normalizeIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;
  const organizationId = session.orgId;

  const body = (req.body || {}) as Body;
  const platform = (body.platform ?? '').toString().toLowerCase().trim();
  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return res.status(400).json({ success: false, error: 'unsupported platform' });
  }
  const incomingPosts = Array.isArray(body.posts) ? body.posts : [];
  const incomingComments = Array.isArray(body.comments) ? body.comments : [];
  if (incomingPosts.length === 0 && incomingComments.length === 0) {
    return res.status(200).json({ success: true, threads_upserted: 0, messages_upserted: 0 });
  }

  try {
    let sourceId: string | null = null;
    try {
      const { data: existingSource } = await supabase
        .from('engagement_sources')
        .select('id')
        .eq('platform', platform)
        .maybeSingle();
      if (existingSource?.id) {
        sourceId = existingSource.id as string;
      } else {
        const { data: insertedSource } = await supabase
          .from('engagement_sources')
          .insert({ platform, source_type: 'extension' })
          .select('id')
          .single();
        sourceId = insertedSource?.id ?? null;
      }
    } catch {
      /* non-fatal — FK is nullable */
    }

    // ── Threads (one per post URN) ─────────────────────────────────────────
    const threadIdByPostUrn: Record<string, string> = {};
    let threadsUpserted = 0;

    for (const p of incomingPosts) {
      const postUrn = (p.post_urn || '').toString().trim();
      if (!postUrn) continue;

      const { data: existing } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('platform', platform)
        .eq('platform_thread_id', postUrn)
        .eq('organization_id', organizationId)
        .maybeSingle();

      const rawPayload = {
        post_url: p.post_url ?? null,
        post_text_preview: p.post_text_preview ?? null,
        reaction_count: p.reaction_count ?? null,
        comment_count: p.comment_count ?? null,
        ingested_via: 'extension_comments',
      };

      if (existing?.id) {
        threadIdByPostUrn[postUrn] = existing.id as string;
        await supabase
          .from('engagement_threads')
          .update({
            source_id: sourceId,
            raw_payload: rawPayload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        threadsUpserted += 1;
        continue;
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('engagement_threads')
        .insert({
          platform,
          platform_thread_id: postUrn,
          source_id: sourceId,
          organization_id: organizationId,
          raw_payload: rawPayload,
        })
        .select('id')
        .single();
      if (insertErr) {
        console.warn('[extension/events/comments] thread insert failed:', insertErr.message);
        continue;
      }
      if (inserted?.id) {
        threadIdByPostUrn[postUrn] = inserted.id as string;
        threadsUpserted += 1;
      }
    }

    // ── Messages (one per comment) ────────────────────────────────────────
    let messagesUpserted = 0;
    for (const c of incomingComments) {
      const postUrn = (c.post_urn || '').toString().trim();
      const commentUrn = (c.comment_urn || '').toString().trim();
      const content = (c.content ?? '').toString();
      if (!postUrn || !commentUrn) continue;

      let threadUuid = threadIdByPostUrn[postUrn];
      if (!threadUuid) {
        // Comment arrived without its post in the batch — backfill a minimal
        // thread row so the comment has a home.
        const { data: existing } = await supabase
          .from('engagement_threads')
          .select('id')
          .eq('platform', platform)
          .eq('platform_thread_id', postUrn)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (existing?.id) {
          threadUuid = existing.id as string;
        } else {
          const { data: inserted } = await supabase
            .from('engagement_threads')
            .insert({
              platform,
              platform_thread_id: postUrn,
              source_id: sourceId,
              organization_id: organizationId,
            })
            .select('id')
            .single();
          if (inserted?.id) threadUuid = inserted.id as string;
        }
      }
      if (!threadUuid) continue;

      const row = {
        thread_id: threadUuid,
        source_id: sourceId,
        platform,
        platform_message_id: commentUrn,
        message_type: 'comment',
        content,
        platform_created_at: normalizeIso(c.created_at),
        like_count: typeof c.like_count === 'number' ? c.like_count : null,
        direction: c.author_self ? 'outgoing' : 'incoming',
        raw_payload: {
          author_name: c.author_name ?? null,
          author_handle: c.author_handle ?? null,
          author_avatar_url: c.author_avatar_url ?? null,
          author_self: Boolean(c.author_self),
          parent_comment_urn: c.parent_comment_urn ?? null,
        },
      };

      const { error: upsertErr } = await supabase
        .from('engagement_messages')
        .upsert(row, { onConflict: 'thread_id,platform_message_id' });
      if (upsertErr) {
        if ((upsertErr as { code?: string }).code !== '23505') {
          console.warn('[extension/events/comments] message upsert failed:', upsertErr.message);
          continue;
        }
      }
      messagesUpserted += 1;
    }

    return res.status(200).json({
      success: true,
      platform,
      threads_upserted: threadsUpserted,
      messages_upserted: messagesUpserted,
    });
  } catch (err) {
    console.error('[extension/events/comments]', err);
    return res.status(500).json({
      success: false,
      error: (err as Error)?.message || 'comment sync failed',
    });
  }
}
