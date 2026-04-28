/**
 * POST /api/extension/events/dms
 *
 * Extension-scraped direct-message sync. The extension's LinkedIn
 * content script walks the inbox DOM, extracts thread + message data,
 * and POSTs here. We upsert into the unified engagement model:
 *
 *   engagement_threads  — one row per conversation
 *                         (platform='linkedin', platform_thread_id=URN/id,
 *                          message_type distinguisher lives on messages).
 *   engagement_messages — one row per captured message
 *                         (message_type='direct_message').
 *
 * Tenant-scoped via the extension session (orgId from hmac-signed token).
 * No user-supplied organization_id is trusted.
 *
 * Body contract:
 *   {
 *     platform: 'linkedin',
 *     threads: Array<{
 *       platform_thread_id: string,
 *       participant_name?: string,
 *       participant_username?: string,
 *       participant_avatar_url?: string,
 *       thread_url?: string,
 *       last_message_preview?: string,
 *       last_message_at?: string (ISO),
 *       unread_count?: number
 *     }>,
 *     messages: Array<{
 *       platform_thread_id: string,   // FK → threads above
 *       platform_message_id: string,
 *       sender_name?: string,
 *       sender_username?: string,
 *       sender_self?: boolean,        // true when sent by the logged-in user
 *       content: string,
 *       sent_at?: string (ISO)
 *     }>
 *   }
 *
 * Idempotent: upserts on (platform, platform_thread_id, organization_id)
 * for threads, and (thread_id, platform_message_id) for messages.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { supabase } from '@/backend/db/supabaseClient';

type IncomingThread = {
  platform_thread_id?: string;
  participant_name?: string | null;
  participant_username?: string | null;
  participant_avatar_url?: string | null;
  thread_url?: string | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  /** True when the conversation list preview was prefixed with "You:" —
   *  i.e. the user sent the last message in this thread. The Needs
   *  Response filter uses this signal so the user's own pending replies
   *  drop out of the queue. */
  last_message_self?: boolean;
  unread_count?: number | null;
};

type IncomingMessage = {
  platform_thread_id?: string;
  platform_message_id?: string;
  sender_name?: string | null;
  sender_username?: string | null;
  sender_self?: boolean;
  content?: string | null;
  sent_at?: string | null;
};

type Body = {
  platform?: string;
  threads?: IncomingThread[];
  messages?: IncomingMessage[];
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
  const incomingThreads = Array.isArray(body.threads) ? body.threads : [];
  const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
  if (incomingThreads.length === 0 && incomingMessages.length === 0) {
    return res.status(200).json({ success: true, threads_upserted: 0, messages_upserted: 0 });
  }

  try {
    // Ensure an engagement_sources row exists for this platform — some
    // queries join on it. Cheap: upsert-on-conflict.
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

    // ── Threads upsert ─────────────────────────────────────────────────────
    // Map of incoming platform_thread_id → DB uuid so we can link messages.
    const threadIdByPlatformThread: Record<string, string> = {};
    let threadsUpserted = 0;

    for (const t of incomingThreads) {
      const platformThreadId = (t.platform_thread_id || '').toString().trim();
      if (!platformThreadId) continue;

      // Look up existing first (scoped to tenant). If found → update
      // mutable fields; if not → insert.
      const { data: existing } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('platform', platform)
        .eq('platform_thread_id', platformThreadId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (existing?.id) {
        threadIdByPlatformThread[platformThreadId] = existing.id as string;
        await supabase
          .from('engagement_threads')
          .update({
            source_id: sourceId,
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
          platform_thread_id: platformThreadId,
          source_id: sourceId,
          organization_id: organizationId,
        })
        .select('id')
        .single();
      if (insertErr) {
        console.warn('[extension/events/dms] thread insert failed:', insertErr.message);
        continue;
      }
      if (inserted?.id) {
        threadIdByPlatformThread[platformThreadId] = inserted.id as string;
        threadsUpserted += 1;
      }
    }

    // ── Messages upsert ────────────────────────────────────────────────────
    let messagesUpserted = 0;
    for (const m of incomingMessages) {
      const platformThreadId = (m.platform_thread_id || '').toString().trim();
      const platformMessageId = (m.platform_message_id || '').toString().trim();
      const content = (m.content ?? '').toString();
      if (!platformThreadId || !platformMessageId) continue;

      let threadUuid = threadIdByPlatformThread[platformThreadId];
      if (!threadUuid) {
        // Message arrived for a thread not in the batch; look up (or
        // create a minimal thread row so the message has a home).
        const { data: existing } = await supabase
          .from('engagement_threads')
          .select('id')
          .eq('platform', platform)
          .eq('platform_thread_id', platformThreadId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (existing?.id) {
          threadUuid = existing.id as string;
        } else {
          const { data: inserted } = await supabase
            .from('engagement_threads')
            .insert({
              platform,
              platform_thread_id: platformThreadId,
              source_id: sourceId,
              organization_id: organizationId,
            })
            .select('id')
            .single();
          if (inserted?.id) threadUuid = inserted.id as string;
        }
      }
      if (!threadUuid) continue;

      // Upsert by (thread_id, platform_message_id). Unique index
      // idx_engagement_messages_platform_thread enforces dedup.
      //
      // Sender detection — the scraper passes sender_self when LinkedIn
      // marks the message with .--self. As a defence-in-depth fallback we
      // also detect a "You: " content prefix (LinkedIn's preview format).
      // Both signals feed direction so downstream filters (Needs Response)
      // don't have to reinvent the heuristic.
      const contentStartsWithYou = /^you\s*:/i.test((content || '').trim());
      const isSelf = Boolean(m.sender_self) || contentStartsWithYou;
      const cleanedContent = contentStartsWithYou
        ? (content || '').replace(/^you\s*:\s*/i, '')
        : content;
      const row = {
        thread_id: threadUuid,
        source_id: sourceId,
        platform,
        platform_message_id: platformMessageId,
        message_type: 'direct_message',
        content: cleanedContent,
        direction: isSelf ? 'outgoing' : 'incoming',
        platform_created_at: normalizeIso(m.sent_at),
        raw_payload: {
          sender_name: m.sender_name ?? null,
          sender_username: m.sender_username ?? null,
          sender_self: isSelf,
          you_prefix_detected: contentStartsWithYou,
        },
      };

      const { error: upsertErr } = await supabase
        .from('engagement_messages')
        .upsert(row, { onConflict: 'thread_id,platform_message_id' });
      if (upsertErr) {
        // Unique-violation (23505) is a duplicate → fine. Anything else is a real error.
        if ((upsertErr as { code?: string }).code !== '23505') {
          console.warn('[extension/events/dms] message upsert failed:', upsertErr.message);
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
    console.error('[extension/events/dms]', err);
    return res.status(500).json({
      success: false,
      error: (err as Error)?.message || 'dm sync failed',
    });
  }
}
