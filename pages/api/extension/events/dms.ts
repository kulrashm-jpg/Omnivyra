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
import { config } from '@/config';
import {
  isExtensionDmPlatform,
  normalizeExtensionPlatform,
  normalizeScrapedMessageContent,
  resolvePlatformUserId,
} from '@/lib/engagement/extensionIngestion';
import { isActionableDmPreview, isLinkedInMailboxSelfSender } from '@/lib/engagement/messageRoles';
import { validateSyncRecord } from '@/lib/engagement/syncIngestion';
import { parseMessageDateMs } from '@/lib/engagement/messageTime';

type IncomingThread = {
  platform_thread_id?: string;
  participant_name?: string | null;
  participant_username?: string | null;
  /** LinkedIn profile URL (https://www.linkedin.com/in/<slug>/). Stable
   *  per person — used as engagement_authors.platform_user_id so the
   *  inbox dedup keys on real identity, not display name. */
  participant_profile_url?: string | null;
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
  thread_id?: string | null;
  parent_id?: string | null;
  sender_name?: string | null;
  sender_username?: string | null;
  sender_profile_url?: string | null;
  actor_type?: string | null;
  actor_id?: string | null;
  sender_self?: boolean;
  content?: string | null;
  sent_at?: string | null;
  raw_time?: string | null;
  normalized_time?: string | null;
  scraped_at?: string | null;
  timestamp_confidence?: string | null;
  source?: string | null;
};

type Body = {
  platform?: string;
  threads?: IncomingThread[];
  messages?: IncomingMessage[];
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
  return /\b(required|must be)\b/i.test(message);
}

function normalizeComparableText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function isTerminalOutboundStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  return Boolean(normalized) && ![
    'failed',
    'blocked',
    'skipped',
    'cancelled',
    'canceled',
    'rejected',
    'expired',
  ].includes(normalized);
}

function actionMatchesScrapedMessage(input: {
  actionText: string | null | undefined;
  actionTime: string | null | undefined;
  messageText: string | null | undefined;
  observedAt: string | null | undefined;
}): boolean {
  const actionText = normalizeComparableText(input.actionText);
  const messageText = normalizeComparableText(input.messageText);
  if (!actionText || !messageText || actionText !== messageText) return false;

  const actionMs = parseMessageDateMs(input.actionTime);
  const observedMs = parseMessageDateMs(input.observedAt);
  if (actionMs === null || observedMs === null) return true;

  const toleranceBeforeActionMs = 5 * 60 * 1000;
  const maxScrapeDelayMs = 7 * 24 * 60 * 60 * 1000;
  return observedMs >= actionMs - toleranceBeforeActionMs
    && observedMs <= actionMs + maxScrapeDelayMs;
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
  const platform = normalizeExtensionPlatform(body.platform);
  if (!platform || !isExtensionDmPlatform(platform)) {
    return res.status(400).json({ success: false, error: 'unsupported platform' });
  }
  const incomingThreads = Array.isArray(body.threads) ? body.threads : [];
  const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
  if (incomingThreads.length === 0 && incomingMessages.length === 0) {
    return res.status(200).json({
      success: true,
      threads_upserted: 0,
      messages_upserted: 0,
      duplicates_updated: 0,
      duplicates_rejected: 0,
    });
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

    // ── Authors upsert ──────────────────────────────────────────────────────
    // The inbox dedup logic in /api/engagement/inbox keys on
    // engagement_authors.id — a stable per-person uuid backed by
    // (platform, platform_user_id=profile_url). Without these rows the
    // dedup falls back to thread_id and never collapses, so two threads
    // for the same external person stay split AND two real people sharing
    // a display name collide. We populate authors here so both work.
    //
    // Build the unique set of (profile_url|username, display_name) pairs
    // from this batch. Profile URL is preferred as the platform_user_id
    // because it is the most stable identifier; fall back to slug if only
    // a username was scraped, and skip rows that have neither (those
    // can't be used for cross-thread identity anyway).
    type AuthorKeyed = { platformUserId: string; profileUrl: string | null; username: string | null; displayName: string | null };
    const authorByPlatformUserId = new Map<string, AuthorKeyed>();
    const collectAuthor = (
      profileUrl: string | null | undefined,
      username: string | null | undefined,
      displayName: string | null | undefined,
    ) => {
      const url = (profileUrl || '').trim();
      const slug = (username || '').trim();
      const platformUserId = resolvePlatformUserId(platform, url, slug) ?? '';
      if (!platformUserId) return;
      if (authorByPlatformUserId.has(platformUserId)) return;
      authorByPlatformUserId.set(platformUserId, {
        platformUserId,
        profileUrl: url || platformUserId,
        username: slug || null,
        displayName: (displayName || '').trim() || null,
      });
    };
    for (const t of incomingThreads) {
      collectAuthor(t.participant_profile_url, t.participant_username, t.participant_name);
    }
    for (const m of incomingMessages) {
      // Self messages don't need an author row — they're the user, not a
      // counterparty. Skipping keeps the engagement_authors table tidy.
      if (normalizeScrapedMessageContent({
        platform,
        platform_message_id: m.platform_message_id,
        content: m.content,
        sender_self: m.sender_self,
        sender_username: m.sender_username,
        sender_profile_url: m.sender_profile_url,
      }).isSelf) continue;
      collectAuthor(m.sender_profile_url, m.sender_username, m.sender_name);
    }

    // Resolve author ids: SELECT existing rows by (platform, platform_user_id),
    // INSERT any missing ones. Map keyed by platformUserId → uuid so the
    // message upsert below can stamp author_id without another round-trip.
    //
    // Wrapped in its own try/catch so a partial failure (e.g. a transient
    // Supabase blip on insert) doesn't fail the entire DM sync. Author
    // resolution is best-effort — without it, messages just keep
    // author_id=null and dedup degrades to thread-level grouping, which
    // is the same behaviour the system had before identity-anchoring.
    const authorIdByPlatformUserId = new Map<string, string>();
    try {
      if (authorByPlatformUserId.size > 0) {
        const platformUserIds = Array.from(authorByPlatformUserId.keys());
        const { data: existingAuthors } = await supabase
          .from('engagement_authors')
          .select('id, platform_user_id')
          .eq('platform', platform)
          .in('platform_user_id', platformUserIds);
        for (const row of existingAuthors ?? []) {
          const r = row as { id: string; platform_user_id: string };
          authorIdByPlatformUserId.set(r.platform_user_id, r.id);
        }
        const missing: AuthorKeyed[] = [];
        for (const [pid, info] of authorByPlatformUserId) {
          if (!authorIdByPlatformUserId.has(pid)) missing.push(info);
        }
        if (missing.length > 0) {
          const insertRows = missing.map((a) => ({
            platform,
            platform_user_id: a.platformUserId,
            username: a.username,
            display_name: a.displayName,
            profile_url: a.profileUrl ?? a.platformUserId,
          }));
          const { data: insertedAuthors, error: authorInsertErr } = await supabase
            .from('engagement_authors')
            .insert(insertRows)
            .select('id, platform_user_id');
          if (authorInsertErr) {
            console.warn('[extension/events/dms] author insert failed (continuing with degraded dedup):', authorInsertErr.message);
          }
          for (const row of insertedAuthors ?? []) {
            const r = row as { id: string; platform_user_id: string };
            authorIdByPlatformUserId.set(r.platform_user_id, r.id);
          }
        }
      }
    } catch (authorPhaseErr) {
      console.warn('[extension/events/dms] author phase failed (continuing with degraded dedup):', (authorPhaseErr as Error)?.message);
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

      // Carry the scraped per-thread signals onto raw_payload so the
      // inbox layer can read participant identity + last_message_self
      // without re-scraping. last_message_self lets the inbox drop the
      // thread from Needs Response when the user already replied
      // outside Omnivyra (LinkedIn preview is "You: …").
      const threadRawPayload: Record<string, unknown> = {
        participant_name: t.participant_name ?? null,
        participant_username: t.participant_username ?? null,
        participant_profile_url: t.participant_profile_url ?? null,
        participant_avatar_url: t.participant_avatar_url ?? null,
        thread_url: t.thread_url ?? null,
        last_message_preview: t.last_message_preview ?? null,
        last_message_at: normalizeIso(t.last_message_at),
        last_message_self: Boolean(t.last_message_self),
        unread_count: typeof t.unread_count === 'number' ? t.unread_count : null,
      };

      if (existing?.id) {
        threadIdByPlatformThread[platformThreadId] = existing.id as string;
        await supabase
          .from('engagement_threads')
          .update({
            source_id: sourceId,
            raw_payload: threadRawPayload,
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
          raw_payload: threadRawPayload,
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
    const platformThreadIdsWithDetailedMessages = new Set(
      incomingMessages
        .map((m) => (m.platform_thread_id || m.thread_id || '').toString().trim())
        .filter(Boolean)
    );
    const messageInputs: IncomingMessage[] = [...incomingMessages];
    const threadUuidsForPreview = Object.values(threadIdByPlatformThread);
    const latestDetailedMessageTimeByThread = new Map<string, number>();
    if (threadUuidsForPreview.length > 0) {
      const { data: existingMessageRows } = await supabase
        .from('engagement_messages')
        .select('thread_id, platform_message_id, platform_created_at, created_at')
        .in('thread_id', threadUuidsForPreview)
        .limit(5000);
      for (const row of existingMessageRows ?? []) {
        const r = row as {
          thread_id: string | null;
          platform_message_id: string | null;
          platform_created_at?: string | null;
          created_at?: string | null;
        };
        if (!r.thread_id || !r.platform_message_id || r.platform_message_id.startsWith('preview:')) {
          continue;
        }
        const messageMs = Date.parse(r.platform_created_at ?? r.created_at ?? '');
        if (!Number.isFinite(messageMs)) continue;
        const currentMs = latestDetailedMessageTimeByThread.get(r.thread_id) ?? 0;
        if (messageMs > currentMs) {
          latestDetailedMessageTimeByThread.set(r.thread_id, messageMs);
        }
      }
    }
    for (const t of incomingThreads) {
      const platformThreadId = (t.platform_thread_id || '').toString().trim();
      const preview = (t.last_message_preview || '').toString().trim();
      const threadUuid = threadIdByPlatformThread[platformThreadId];
      if (!platformThreadId || !preview || !threadUuid) continue;
      if (!isActionableDmPreview(preview)) continue;
      if (platformThreadIdsWithDetailedMessages.has(platformThreadId)) continue;
      const previewTime = normalizeIso(t.last_message_at);
      if (!previewTime) continue;
      const previewMs = Date.parse(previewTime);
      const latestDetailedMs = latestDetailedMessageTimeByThread.get(threadUuid) ?? 0;
      if (Number.isFinite(previewMs) && latestDetailedMs >= previewMs) continue;
      messageInputs.push({
        platform_thread_id: platformThreadId,
        platform_message_id: `preview:${platformThreadId}`,
        sender_name: t.last_message_self ? null : t.participant_name ?? null,
        sender_username: t.last_message_self ? null : t.participant_username ?? null,
        sender_profile_url: t.last_message_self ? null : t.participant_profile_url ?? null,
        sender_self: Boolean(t.last_message_self),
        content: preview,
        sent_at: previewTime,
        normalized_time: previewTime,
        scraped_at: new Date().toISOString(),
        timestamp_confidence: 'medium',
        source: 'platform_sync',
      });
    }

    let messagesUpserted = 0;
    let duplicatesUpdated = 0;
    let duplicatesRejected = 0;
    const touchedThreadIds = new Set<string>();
    const actionTargetsByPlatformThread = new Map<string, Set<string>>();
    const addActionTarget = (platformThreadId: string, value: unknown) => {
      const target = typeof value === 'string' ? value.trim() : '';
      if (!platformThreadId || !target) return;
      const set = actionTargetsByPlatformThread.get(platformThreadId) ?? new Set<string>();
      set.add(target);
      actionTargetsByPlatformThread.set(platformThreadId, set);
    };
    for (const t of incomingThreads) {
      const platformThreadId = (t.platform_thread_id || '').toString().trim();
      if (!platformThreadId) continue;
      addActionTarget(platformThreadId, platformThreadId);
      addActionTarget(platformThreadId, t.participant_profile_url);
      addActionTarget(platformThreadId, t.participant_username);
      addActionTarget(platformThreadId, t.participant_name);
    }
    for (const m of messageInputs) {
      const platformThreadId = (m.platform_thread_id || m.thread_id || '').toString().trim();
      if (!platformThreadId) continue;
      addActionTarget(platformThreadId, platformThreadId);
      addActionTarget(platformThreadId, m.sender_profile_url);
      addActionTarget(platformThreadId, m.sender_username);
      addActionTarget(platformThreadId, m.sender_name);
    }
    const targetToPlatformThreadIds = new Map<string, string[]>();
    for (const [platformThreadId, targets] of actionTargetsByPlatformThread.entries()) {
      for (const target of targets) {
        targetToPlatformThreadIds.set(target, [
          ...(targetToPlatformThreadIds.get(target) ?? []),
          platformThreadId,
        ]);
      }
    }
    const outboundActionsByPlatformThread = new Map<string, Array<{
      final_text?: string | null;
      suggested_text?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>>();
    const actionTargetIds = Array.from(targetToPlatformThreadIds.keys());
    if (actionTargetIds.length > 0) {
      const { data: actions } = await supabase
        .from('community_ai_actions')
        .select('target_id, status, action_type, created_at, updated_at, final_text, suggested_text')
        .eq('organization_id', organizationId)
        .in('target_id', actionTargetIds)
        .in('action_type', ['dm', 'reply']);
      for (const action of actions ?? []) {
        const row = action as {
          target_id?: string | null;
          status?: string | null;
          final_text?: string | null;
          suggested_text?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        if (!isTerminalOutboundStatus(row.status)) continue;
        const platformThreadIds = row.target_id ? targetToPlatformThreadIds.get(row.target_id) ?? [] : [];
        for (const platformThreadId of platformThreadIds) {
          const list = outboundActionsByPlatformThread.get(platformThreadId) ?? [];
          list.push(row);
          outboundActionsByPlatformThread.set(platformThreadId, list);
        }
      }
    }
    for (const m of messageInputs) {
      const platformThreadId = (m.platform_thread_id || m.thread_id || '').toString().trim();
      const platformMessageId = (m.platform_message_id || '').toString().trim();
      const content = (m.content ?? '').toString();
      const scrapedAt = normalizeIso(m.scraped_at)
        ?? normalizeIso(m.normalized_time)
        ?? normalizeIso(m.sent_at)
        ?? new Date().toISOString();
      const normalizedTime = firstText(m.normalized_time, m.sent_at);
      const timestampConfidence = firstText(m.timestamp_confidence)
        ?? (normalizeIso(normalizedTime) ? null : 'low');
      const rawTime = firstText(m.raw_time, m.normalized_time, m.sent_at, scrapedAt);
      const linkedInMailboxSelf = isLinkedInMailboxSelfSender({
        platform,
        platform_message_id: platformMessageId,
        sender_username: m.sender_username,
        sender_profile_url: m.sender_profile_url,
      });
      const provisionalSelf = Boolean(m.sender_self) || linkedInMailboxSelf;
      const actorId = firstText(
        m.actor_id,
        provisionalSelf ? `self:${organizationId}` : null,
        m.sender_profile_url,
        m.sender_username,
        m.sender_name,
        platformThreadId,
      );
      const syncRecord = validateSyncRecord({
        platform_message_id: platformMessageId,
        thread_id: m.thread_id ?? platformThreadId,
        parent_id: m.parent_id ?? null,
        content,
        actor_type: m.actor_type ?? (provisionalSelf ? 'company' : 'user'),
        actor_id: actorId,
        raw_time: rawTime,
        normalized_time: normalizedTime,
        scraped_at: scrapedAt,
        timestamp_confidence: timestampConfidence,
        source: m.source ?? 'platform_sync',
      });
      if (!platformThreadId) throw new Error('thread_id required');

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
      touchedThreadIds.add(threadUuid);

      // Upsert by (thread_id, platform_message_id). Unique index
      // idx_engagement_messages_platform_thread enforces dedup.
      //
      const normalizedMessage = normalizeScrapedMessageContent({
        platform,
        platform_message_id: syncRecord.platform_message_id,
        content: syncRecord.content,
        sender_self: provisionalSelf,
        sender_username: m.sender_username,
        sender_profile_url: m.sender_profile_url,
      });
      const actionMatchedSelf = (outboundActionsByPlatformThread.get(platformThreadId) ?? []).some((action) =>
        actionMatchesScrapedMessage({
          actionText: action.final_text ?? action.suggested_text ?? null,
          actionTime: action.updated_at ?? action.created_at ?? null,
          messageText: normalizedMessage.content,
          observedAt: syncRecord.scraped_at ?? syncRecord.normalized_time,
        })
      );
      const isSelf = normalizedMessage.isSelf || actionMatchedSelf;

      // Resolve author_id for the counterparty. Self messages keep
      // author_id=null since "self" isn't a counterparty.
      let authorId: string | null = null;
      if (!isSelf) {
        const senderProfileUrl = (m.sender_profile_url || '').trim();
        const senderUsername = (m.sender_username || '').trim();
        const senderPlatformUserId = resolvePlatformUserId(platform, senderProfileUrl, senderUsername);
        if (senderPlatformUserId) {
          authorId = authorIdByPlatformUserId.get(senderPlatformUserId) ?? null;
        }
      }

      const row = {
        thread_id: threadUuid,
        source_id: sourceId,
        platform,
        platform_message_id: syncRecord.platform_message_id,
        sync_thread_id: syncRecord.thread_id,
        platform_parent_id: syncRecord.parent_id,
        parent_message_id: null,
        message_type: 'direct_message',
        content: normalizedMessage.content,
        direction: isSelf ? 'outgoing' : 'incoming',
        author_id: authorId,
        platform_created_at: syncRecord.normalized_time,
        raw_time: syncRecord.raw_time,
        normalized_time: syncRecord.normalized_time,
        scraped_at: syncRecord.scraped_at,
        sync_source: syncRecord.source,
        actor_type: syncRecord.actor_type,
        actor_external_id: syncRecord.actor_id,
        raw_payload: {
          sender_name: m.sender_name ?? null,
          sender_username: m.sender_username ?? null,
          sender_profile_url: m.sender_profile_url ?? null,
          sender_self: isSelf,
          author_self: isSelf,
          self_inferred_from_linkedin_mailbox: linkedInMailboxSelf || undefined,
          self_inferred_from_action: actionMatchedSelf || undefined,
          you_prefix_detected: normalizedMessage.prefixDetected,
          sync_thread_id: syncRecord.thread_id,
          raw_time: syncRecord.raw_time,
          normalized_time: syncRecord.normalized_time,
          scraped_at: syncRecord.scraped_at,
          timestamp_confidence: syncRecord.timestamp_confidence,
          source: syncRecord.source,
          ingested_via: 'platform_sync',
        },
      };

      const { error: insertErr } = await supabase
        .from('engagement_messages')
        .insert(row);
      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          const { error: updateErr } = await supabase
            .from('engagement_messages')
            .update(row)
            .eq('thread_id', threadUuid)
            .eq('platform_message_id', syncRecord.platform_message_id);
          if (updateErr) {
            console.warn('[extension/events/dms] duplicate message refresh failed:', updateErr.message);
            duplicatesRejected += 1;
            continue;
          }
          duplicatesUpdated += 1;
          continue;
        }
        console.warn('[extension/events/dms] message insert failed:', insertErr.message);
        continue;
      }
      messagesUpserted += 1;
    }

    if (touchedThreadIds.size > 0) {
      const nowIso = new Date().toISOString();
      await supabase
        .from('engagement_threads')
        .update({ updated_at: nowIso })
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
    // Always return STRUCTURED JSON, never an HTML 500 page. The extension's
    // SW relay reads .error → console.error → chrome://extensions error log,
    // so a missing/empty error message is exactly what produced the
    // "[APIClient] Failed: [object Object]" the user has been seeing.
    const e = err as Error;
    console.error('[extension/events/dms] unhandled:', e?.message, e?.stack);
    return res.status(isSyncValidationError(err) ? 400 : 500).json({
      success: false,
      error: e?.message || 'dm sync failed',
      error_class: e?.name || 'Error',
      stack: config.NODE_ENV !== 'production' ? e?.stack?.split('\n').slice(0, 6) : undefined,
    });
  }
}
