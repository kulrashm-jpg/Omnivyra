import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/extension/events/comments
 *
 * Extension-scraped comment sync. The extension's LinkedIn content
 * script visits the user's activity / posts pages, walks the DOM
 * for each post, extracts the comment list, and POSTs here.
 *
 *   engagement_threads  â€” one row per *post* the user owns
 *                         (platform_thread_id = post URN, e.g.
 *                          urn:li:activity:1234567890).
 *   engagement_messages â€” one row per comment on that post
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
 *       post_urn: string,            // FK â†’ posts above
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
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  isExtensionCommentPlatform,
  normalizeExtensionPlatform,
  normalizeScrapedMessageContent,
} from '@/lib/engagement/extensionIngestion';
import { derivePlatformThreadId, validateSyncRecord } from '@/lib/engagement/syncIngestion';

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
  platform_message_id?: string | null;
  thread_id?: string | null;
  parent_id?: string | null;
  author_name?: string | null;
  author_handle?: string | null;
  actor_type?: string | null;
  actor_id?: string | null;
  author_avatar_url?: string | null;
  author_self?: boolean;
  content?: string | null;
  created_at?: string | null;
  raw_time?: string | null;
  normalized_time?: string | null;
  scraped_at?: string | null;
  timestamp_confidence?: string | null;
  parent_confidence?: string | null;
  reaction_type?: string | null;
  reaction_count?: number | null;
  user_reaction?: string | null;
  source?: string | null;
  like_count?: number | null;
  parent_comment_urn?: string | null;
};

type Body = {
  platform?: string;
  posts?: IncomingPost[];
  comments?: IncomingComment[];
};

function normalizeIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

function isSyncValidationError(err: unknown): boolean {
  const message = (err as Error)?.message || '';
  return /\b(required|must be|parent_id not found)\b/i.test(message);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;
  const organizationId = session.orgId;

  const body = (req.body || {}) as Body;
  const platform = normalizeExtensionPlatform(body.platform);
  if (!platform || !isExtensionCommentPlatform(platform)) {
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
      /* non-fatal â€” FK is nullable */
    }

    // â”€â”€ Threads (one per post URN) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Messages (one per comment) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let messagesUpserted = 0;
    let duplicatesUpdated = 0;
    let duplicatesRejected = 0;
    const insertedMessageIdByPlatformId = new Map<string, string>();
    const touchedThreadIds = new Set<string>();
    const sortedComments = [...incomingComments].sort((a, b) => {
      const aParent = Boolean(a.parent_id ?? a.parent_comment_urn);
      const bParent = Boolean(b.parent_id ?? b.parent_comment_urn);
      return Number(aParent) - Number(bParent);
    });

    for (const c of sortedComments) {
      const postUrn = (c.post_urn || '').toString().trim();
      const commentUrn = (c.platform_message_id || c.comment_urn || '').toString().trim();
      const content = (c.content ?? '').toString();
      const parentId = (c.parent_id ?? c.parent_comment_urn ?? null) as string | null;
      const scrapedAt = normalizeIso(c.scraped_at)
        ?? normalizeIso(c.normalized_time)
        ?? normalizeIso(c.created_at)
        ?? new Date().toISOString();
      const normalizedTime = firstText(c.normalized_time, c.created_at);
      const timestampConfidence = firstText(c.timestamp_confidence)
        ?? (normalizeIso(normalizedTime) ? null : 'low');
      const rawTime = firstText(c.raw_time, c.normalized_time, c.created_at, scrapedAt);
      const actorId = firstText(
        c.actor_id,
        c.author_handle,
        c.author_name,
        c.author_self ? `self:${organizationId}` : null,
        commentUrn,
      );
      const syncRecord = validateSyncRecord({
        platform_message_id: commentUrn,
        thread_id: c.thread_id,
        parent_id: parentId,
        content,
        actor_type: c.actor_type ?? (c.author_self ? 'company' : 'user'),
        actor_id: actorId,
        raw_time: rawTime,
        normalized_time: normalizedTime,
        scraped_at: scrapedAt,
        timestamp_confidence: timestampConfidence,
        source: c.source ?? 'platform_sync',
      });
      if (!postUrn) throw new Error('post_urn required');

      let threadUuid = threadIdByPostUrn[postUrn];
      if (!threadUuid) {
        // Comment arrived without its post in the batch â€” backfill a minimal
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
      touchedThreadIds.add(threadUuid);

      const normalizedComment = normalizeScrapedMessageContent({
        content: syncRecord.content,
        author_self: c.author_self,
      });

      let parentMessageId: string | null = null;
      if (syncRecord.parent_id) {
        parentMessageId = insertedMessageIdByPlatformId.get(syncRecord.parent_id) ?? null;
        if (!parentMessageId) {
          const { data: parentRow } = await supabase
            .from('engagement_messages')
            .select('id')
            .eq('platform', platform)
            .eq('platform_message_id', syncRecord.parent_id)
            .maybeSingle();
          parentMessageId = parentRow?.id ?? null;
        }
        if (!parentMessageId) throw new Error(`parent_id not found: ${syncRecord.parent_id}`);
      }

      const row = {
        thread_id: threadUuid,
        source_id: sourceId,
        platform,
        platform_message_id: syncRecord.platform_message_id,
        sync_thread_id: derivePlatformThreadId(syncRecord),
        platform_parent_id: syncRecord.parent_id,
        parent_message_id: parentMessageId,
        post_comment_id: null,
        message_type: 'comment',
        content: normalizedComment.content,
        platform_created_at: syncRecord.normalized_time,
        raw_time: syncRecord.raw_time,
        normalized_time: syncRecord.normalized_time,
        scraped_at: syncRecord.scraped_at,
        sync_source: syncRecord.source,
        actor_type: syncRecord.actor_type,
        actor_external_id: syncRecord.actor_id,
        like_count: typeof c.like_count === 'number' ? c.like_count : null,
        direction: normalizedComment.isSelf ? 'outgoing' : 'incoming',
        raw_payload: {
          author_name: c.author_name ?? null,
          author_handle: c.author_handle ?? null,
          author_avatar_url: c.author_avatar_url ?? null,
          author_self: normalizedComment.isSelf,
          you_prefix_detected: normalizedComment.prefixDetected,
          parent_comment_urn: syncRecord.parent_id,
          sync_thread_id: syncRecord.thread_id,
          raw_time: syncRecord.raw_time,
          normalized_time: syncRecord.normalized_time,
          scraped_at: syncRecord.scraped_at,
          timestamp_confidence: syncRecord.timestamp_confidence,
          parent_confidence: c.parent_confidence ?? null,
          reaction_type: c.reaction_type ?? null,
          reaction_count: typeof c.reaction_count === 'number'
            ? c.reaction_count
            : typeof c.like_count === 'number'
              ? c.like_count
              : null,
          user_reaction: c.user_reaction ?? null,
          source: syncRecord.source,
          ingested_via: 'platform_sync',
        },
      };

      const { data: insertedMessage, error: insertErr } = await supabase
        .from('engagement_messages')
        .insert(row)
        .select('id')
        .single();
      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          const { data: updatedRow, error: updateErr } = await supabase
            .from('engagement_messages')
            .update(row)
            .eq('platform', platform)
            .eq('platform_message_id', syncRecord.platform_message_id)
            .eq('thread_id', threadUuid)
            .select('id')
            .maybeSingle();
          if (updateErr) {
            console.warn('[extension/events/comments] duplicate message refresh failed:', updateErr.message);
            duplicatesRejected += 1;
            continue;
          }
          if (updatedRow?.id) {
            insertedMessageIdByPlatformId.set(syncRecord.platform_message_id, updatedRow.id as string);
          }
          duplicatesUpdated += 1;
          continue;
        }
        console.warn('[extension/events/comments] message insert failed:', insertErr.message);
        continue;
      }
      if (insertedMessage?.id) {
        insertedMessageIdByPlatformId.set(syncRecord.platform_message_id, insertedMessage.id as string);
      }
      messagesUpserted += 1;
    }

    if (touchedThreadIds.size > 0) {
      await supabase
        .from('engagement_threads')
        .update({ updated_at: new Date().toISOString() })
        .in('id', Array.from(touchedThreadIds));
    }

    return res.status(200).json({
      success: true,
      platform,
      threads_upserted: threadsUpserted,
      messages_upserted: messagesUpserted,
      duplicates_updated: duplicatesUpdated,
      duplicates_rejected: duplicatesRejected,
    });
  } catch (err) {
    console.error('[extension/events/comments]', err);
    return res.status(isSyncValidationError(err) ? 400 : 500).json({
      success: false,
      error: (err as Error)?.message || 'comment sync failed',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

