import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/engagement/inbox
 * SYSTEM 1: General Engagement Inbox — thread-based items from engagement_threads.
 * Used by: /engagement page, InboxDashboard, useEngagementInbox hook.
 * Returns: { items: InboxThread[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getThreads } from '../../../backend/services/engagementThreadService';
import { supabase } from '../../../backend/db/supabaseClient';
import { isActionableDmPreview, isAuthorSelf, isDmMessageType } from '../../../lib/engagement/messageRoles';
import {
  resolveDmThreadIdentity,
  type DmIdentityMessage,
} from '../../../lib/engagement/dmThreadIdentity';
import { compareMessagesDescending } from '../../../lib/engagement/messageTime';
import {
  ACTIONABLE_INBOX_LOOKBACK_DAYS,
  isNeedsResponseThread,
  isPeopleReactionThread,
} from '../../../lib/engagement/queueRules';


function normalizeActionTargetId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function addActionTarget(
  lookup: Map<string, Set<string>>,
  targetId: unknown,
  threadId: string,
) {
  const normalized = normalizeActionTargetId(targetId);
  if (!normalized) return;
  const existing = lookup.get(normalized) ?? new Set<string>();
  existing.add(threadId);
  lookup.set(normalized, existing);
}

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeComparableText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDisplayNameKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized || ['unknown', 'linkedin member', 'member'].includes(normalized)) return null;
  return normalized;
}

function actionCoversLatestMessage(
  actionTime: string | null | undefined,
  latestMessageTime: string | null | undefined,
  actionText?: string | null,
  latestMessageText?: string | null,
): boolean {
  const normalizedActionText = normalizeComparableText(actionText);
  const normalizedLatestText = normalizeComparableText(latestMessageText);
  if (normalizedActionText && normalizedLatestText && normalizedActionText === normalizedLatestText) {
    return true;
  }

  const latestMs = parseTimeMs(latestMessageTime);
  if (latestMs === null) return true;

  const actionMs = parseTimeMs(actionTime);
  if (actionMs === null) return false;

  return actionMs >= latestMs;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const platform = (req.query.platform as string)?.trim() || undefined;
  const priority = (req.query.priority ?? req.query.status) as 'high' | 'medium' | 'low' | undefined;
  const startDateParam = (req.query.start_date ?? req.query.dateFrom) as string | undefined;
  const startDate =
    startDateParam || new Date(Date.now() - ACTIONABLE_INBOX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const endDate = (req.query.end_date ?? req.query.dateTo) as string | undefined;
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

  const companyId = organizationId?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const threads = await getThreads({
      organization_id: companyId,
      platform: platform || null,
      priority: priority || null,
      start_date: startDate || null,
      end_date: endDate || null,
      limit,
      exclude_ignored: true,
    });

    // Drop empty threads — these are skeletal rows left behind when the
    // last message was deleted or never arrived (the "Unknown with no
    // message" appearance the user reported). A thread with zero captured
    // messages has nothing actionable; the UI shouldn't render it.
    const nonEmptyThreads = threads.filter((t) => (t.message_count ?? 0) > 0);

    const threadIds = nonEmptyThreads.map((t) => t.thread_id);
    let opportunityByThread = new Set<string>();
    if (threadIds.length > 0) {
      const { data: opps } = await supabase
        .from('engagement_opportunities')
        .select('source_thread_id')
        .in('source_thread_id', threadIds)
        .eq('resolved', false);
      (opps ?? []).forEach((o: { source_thread_id: string }) => opportunityByThread.add(o.source_thread_id));
    }

    // Latest message_type, direction, AND content per thread.
    //   message_type drives the People Reacted tab.
    //   direction + author_self + content drive the Needs Response filter
    //   (drop threads where the user replied last).
    //
    // The DM scraper writes every captured message with direction='inbound'
    // regardless of sender, and never populates sender_self. The reliable
    // signal LinkedIn DOM gives us is the content prefix "You:" on messages
    // the user sent. We OR that into author_self detection so the filter
    // works against the data we actually have.
    const messageTypeByThread = new Map<string, string>();
    const messageDirectionByThread = new Map<string, string | null>();
    const messageAuthorSelfByThread = new Map<string, boolean>();
    const latestMessageByThread = new Map<string, DmIdentityMessage>();
    const dmMessagesByThread = new Map<string, DmIdentityMessage[]>();
    // For DM dedup we also need the participant author_id on each thread's
    // latest message — the engagement_authors row is keyed on LinkedIn
    // profile URL, so it's a stable per-person identifier across the
    // multiple thread rows the legacy ingester produced for one
    // conversation. Display name is intentionally NOT used as the dedup
    // key (two real people sharing a name would collide).
    const messageAuthorIdByThread = new Map<string, string | null>();
    // Build a lookup from possible community_ai_actions.target_id values
    // back to UI threads. It includes platform thread ids, participant
    // identities, and local engagement_messages ids for degraded DM sends.
    const threadIdsByActionTarget = new Map<string, Set<string>>();
    const latestMessageIds = nonEmptyThreads
      .map((t) => t.latest_message_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (latestMessageIds.length > 0) {
      const { data: latestMsgs } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, platform, platform_message_id, message_type, direction, content, author_id, raw_payload')
        .in('id', latestMessageIds);
      (latestMsgs ?? []).forEach(
        (m: { id: string; thread_id: string; platform: string | null; platform_message_id: string | null; message_type: string; direction: string | null; content: string | null; author_id: string | null; raw_payload: Record<string, unknown> | null }) => {
          addActionTarget(threadIdsByActionTarget, m.id, m.thread_id);
          messageTypeByThread.set(m.thread_id, m.message_type);
          messageDirectionByThread.set(m.thread_id, m.direction ?? null);
          messageAuthorIdByThread.set(m.thread_id, m.author_id ?? null);
          latestMessageByThread.set(m.thread_id, {
            platform: m.platform,
            platform_message_id: m.platform_message_id,
            message_type: m.message_type,
            direction: m.direction ?? null,
            content: m.content,
            author_id: m.author_id ?? null,
            raw_payload: m.raw_payload ?? null,
          });
          const rp = m.raw_payload || {};
          messageAuthorSelfByThread.set(
            m.thread_id,
            isAuthorSelf({
              platform: m.platform,
              platform_message_id: m.platform_message_id,
              direction: m.direction,
              author_self: rp.author_self as boolean | null | undefined,
              sender_self: rp.sender_self as boolean | null | undefined,
              sender_username: rp.sender_username as string | null | undefined,
              sender_profile_url: rp.sender_profile_url as string | null | undefined,
              content: m.content,
            }),
          );
        }
      );
    }

    if (threadIds.length > 0) {
      const { data: dmMessages } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, platform, platform_message_id, message_type, direction, content, author_id, platform_created_at, created_at, raw_payload')
        .in('thread_id', threadIds)
        .order('platform_created_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(5000);
      const orderedDmMessages = [...(dmMessages ?? [])].sort(compareMessagesDescending);
      orderedDmMessages.forEach(
        (m: {
          id?: string | null;
          thread_id: string;
          platform?: string | null;
          platform_message_id?: string | null;
          message_type: string | null;
          direction: string | null;
          content: string | null;
          author_id: string | null;
          platform_created_at?: string | null;
          created_at?: string | null;
          raw_payload: Record<string, unknown> | null;
        }) => {
          if (!isDmMessageType(m.message_type)) return;
          addActionTarget(threadIdsByActionTarget, m.id, m.thread_id);
          const list = dmMessagesByThread.get(m.thread_id) ?? [];
          list.push({
            platform: m.platform ?? null,
            platform_message_id: m.platform_message_id ?? null,
            message_type: m.message_type,
            direction: m.direction ?? null,
            content: m.content,
            author_id: m.author_id ?? null,
            raw_payload: m.raw_payload ?? null,
          });
          dmMessagesByThread.set(m.thread_id, list);
        }
      );
    }

    // For People-Reaction threads (post URN as platform_thread_id) we want
    // to show the post text + URL in the conversation pane. Fetch raw_payload
    // for all visible threads in one round-trip.
    const postMetaByThread = new Map<
      string,
      {
        platform_thread_id: string | null;
        post_url: string | null;
        post_text_preview: string | null;
        impression_count: number | null;
        reaction_count: number | null;
        comment_count: number | null;
        ingested_via: string | null;
      }
    >();
    const threadRawPayloadByThread = new Map<string, Record<string, unknown>>();
    const platformThreadIdByThread = new Map<string, string | null>();
    // Threads where the LinkedIn list preview was prefixed "You: …" — the
    // DM scraper marks last_message_self=true on the thread row's raw_payload
    // for these. The user already replied directly in LinkedIn (outside
    // Omnivyra), so the thread should drop from Needs Response even though
    // we don't have a corresponding outbound community_ai_actions row.
    const threadLastMessageSelfByThread = new Map<string, boolean>();
    if (threadIds.length > 0) {
      const { data: threadMeta } = await supabase
        .from('engagement_threads')
        .select('id, platform_thread_id, raw_payload')
        .in('id', threadIds);
      (threadMeta ?? []).forEach(
        (row: { id: string; platform_thread_id: string; raw_payload: Record<string, unknown> | null }) => {
          const rp = row.raw_payload || {};
          threadRawPayloadByThread.set(row.id, rp);
          platformThreadIdByThread.set(row.id, row.platform_thread_id ?? null);
          const platformThreadId = row.platform_thread_id ?? '';
          const looksLikePostThread = /^urn:li:(activity|share|ugcPost):/i.test(platformThreadId);
          const lastMessagePreview =
            typeof rp.last_message_preview === 'string'
              ? rp.last_message_preview
              : null;
          const looksLikeDmThread =
            !looksLikePostThread &&
            (
              (typeof rp.thread_url === 'string' && /\/messaging\//i.test(rp.thread_url))
              || isActionableDmPreview(lastMessagePreview)
              || rp.last_message_self === true
            );
          if (looksLikeDmThread && !messageTypeByThread.has(row.id)) {
            messageTypeByThread.set(row.id, 'direct_message');
            messageDirectionByThread.set(row.id, rp.last_message_self === true ? 'outgoing' : 'incoming');
            messageAuthorSelfByThread.set(row.id, rp.last_message_self === true);
          }
          const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
          postMetaByThread.set(row.id, {
            platform_thread_id: row.platform_thread_id ?? null,
            post_url: typeof rp.post_url === 'string' ? rp.post_url : null,
            post_text_preview:
              typeof rp.post_text_preview === 'string' ? rp.post_text_preview : null,
            impression_count: num(rp.impression_count),
            reaction_count: num(rp.reaction_count),
            comment_count: num(rp.comment_count),
            ingested_via: typeof rp.ingested_via === 'string' ? rp.ingested_via : null,
          });
          if (row.platform_thread_id) {
            addActionTarget(threadIdsByActionTarget, row.platform_thread_id, row.id);
          }
          addActionTarget(threadIdsByActionTarget, rp.participant_profile_url, row.id);
          addActionTarget(threadIdsByActionTarget, rp.participant_username, row.id);
          addActionTarget(threadIdsByActionTarget, rp.participant_name, row.id);
          if (rp.last_message_self === true) {
            threadLastMessageSelfByThread.set(row.id, true);
          }
        }
      );
    }

    const dmIdentityByThread = new Map<string, ReturnType<typeof resolveDmThreadIdentity>>();
    for (const thread of nonEmptyThreads) {
      if (!isDmMessageType(messageTypeByThread.get(thread.thread_id))) continue;
      const identity = resolveDmThreadIdentity({
        platform: thread.platform,
        threadId: thread.thread_id,
        platformThreadId: platformThreadIdByThread.get(thread.thread_id) ?? null,
        threadRawPayload: threadRawPayloadByThread.get(thread.thread_id) ?? null,
        latestMessage: latestMessageByThread.get(thread.thread_id) ?? null,
        messages: dmMessagesByThread.get(thread.thread_id) ?? [],
      });
      dmIdentityByThread.set(thread.thread_id, identity);
      for (const targetId of identity.targetIds) {
        addActionTarget(threadIdsByActionTarget, targetId, thread.thread_id);
      }
    }

    // The reply endpoint often queues LinkedIn/DM actions against the
    // counterparty profile URL or display name because extension commands
    // need a browser-resolvable target. Matching only platform_thread_id
    // misses those actions, leaving already-replied conversations in Needs
    // Response until the scraper mirrors the outbound message back.
    const counterpartyAuthorIds = Array.from(
      new Set(
        Array.from(dmIdentityByThread.values())
          .map((identity) => identity.counterpartyAuthorId)
          .filter((id): id is string => Boolean(id))
      )
    );
    const uniqueAuthorIdByDisplayName = new Map<string, string>();
    const duplicateDisplayNames = new Set<string>();
    if (counterpartyAuthorIds.length > 0) {
      const { data: authors } = await supabase
        .from('engagement_authors')
        .select('id, platform_user_id, username, display_name, profile_url')
        .in('id', counterpartyAuthorIds);
      for (const author of authors ?? []) {
        const a = author as {
          id: string;
          platform_user_id?: string | null;
          username?: string | null;
          display_name?: string | null;
          profile_url?: string | null;
        };
        const displayNameKey = normalizeDisplayNameKey(a.display_name);
        const addUniqueDisplayAlias = (alias: string | null) => {
          if (!alias) return;
          const existingAuthorId = uniqueAuthorIdByDisplayName.get(alias);
          if (existingAuthorId && existingAuthorId !== a.id) {
            duplicateDisplayNames.add(alias);
          } else {
            uniqueAuthorIdByDisplayName.set(alias, a.id);
          }
        };
        if (displayNameKey) {
          addUniqueDisplayAlias(displayNameKey);
        }
        for (const [threadId, identity] of dmIdentityByThread.entries()) {
          if (identity.counterpartyAuthorId !== a.id) continue;
          addActionTarget(threadIdsByActionTarget, a.platform_user_id, threadId);
          addActionTarget(threadIdsByActionTarget, a.profile_url, threadId);
          addActionTarget(threadIdsByActionTarget, a.username, threadId);
          addActionTarget(threadIdsByActionTarget, a.display_name, threadId);
        }
      }
      for (const duplicateName of duplicateDisplayNames) {
        uniqueAuthorIdByDisplayName.delete(duplicateName);
      }
    }

    // A thread drops out of "Needs Response" only after the outbound action
    // is confirmed as executed. Queued browser actions can fail before
    // LinkedIn actually receives the message, so pending/sent-unverified
    // rows must not hide work that still needs the user's attention.
    const latestMessageTimeByThread = new Map(
      nonEmptyThreads.map((thread) => [thread.thread_id, thread.latest_message_time ?? null])
    );
    const latestMessageTextByThread = new Map(
      nonEmptyThreads.map((thread) => [thread.thread_id, thread.latest_message ?? null])
    );
    const respondedThreadIds = new Set<string>();
    if (threadIdsByActionTarget.size > 0) {
      const targetIds = Array.from(threadIdsByActionTarget.keys());
      const { data: actionRows } = await supabase
        .from('community_ai_actions')
        .select('target_id, status, action_type, created_at, updated_at, final_text, suggested_text')
        .eq('organization_id', companyId)
        .in('target_id', targetIds)
        .in('action_type', ['dm', 'reply']);
      for (const row of actionRows ?? []) {
        const action = row as {
          target_id: string;
          status?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          final_text?: string | null;
          suggested_text?: string | null;
        };
        const status = (action.status ?? '').trim().toLowerCase();
        if (status !== 'executed') {
          continue;
        }
        const target = action.target_id;
        const matchedThreadIds = threadIdsByActionTarget.get(target);
        for (const matchedThreadId of matchedThreadIds ?? []) {
          const actionTime = action.updated_at ?? action.created_at ?? null;
          const actionText = action.final_text ?? action.suggested_text ?? null;
          if (
            !actionCoversLatestMessage(
              actionTime,
              latestMessageTimeByThread.get(matchedThreadId),
              actionText,
              latestMessageTextByThread.get(matchedThreadId),
            )
          ) {
            continue;
          }
          respondedThreadIds.add(matchedThreadId);
        }
      }
    }

    const allItems = nonEmptyThreads.map((t) => ({
      thread_id: t.thread_id,
      platform: t.platform,
      author_name: t.author_summary ?? null,
      author_username: null,
      latest_message: t.latest_message ?? null,
      latest_message_time: t.latest_message_time ?? null,
      priority_score: t.priority_score ?? 0,
      unread_count: t.unread_count ?? 0,
      message_count: t.message_count ?? 0,
      dominant_intent: t.dominant_intent ?? null,
      lead_detected: t.lead_detected ?? false,
      lead_score: t.lead_score ?? 0,
      negative_feedback: t.negative_feedback ?? false,
      customer_question: t.customer_question ?? false,
      opportunity_indicator: opportunityByThread.has(t.thread_id),
      latest_message_id: t.latest_message_id ?? null,
      classification_category: t.classification_category ?? null,
      triage_priority: t.triage_priority ?? null,
      sentiment: t.sentiment ?? null,
      assigned_to: t.assigned_to ?? null,
      assigned_at: t.assigned_at ?? null,
      assignee_name: t.assignee_name ?? null,
      latest_message_type: messageTypeByThread.get(t.thread_id) ?? null,
      latest_message_direction: messageDirectionByThread.get(t.thread_id) ?? null,
      latest_message_author_self:
        messageAuthorSelfByThread.get(t.thread_id)
        || threadLastMessageSelfByThread.get(t.thread_id)
        || false,
      // True when a terminal outbound reply/DM exists for this thread.
      // In-flight browser actions are intentionally not counted here because
      // LinkedIn automation can stall before the message is delivered.
      has_completed_outbound_action: respondedThreadIds.has(t.thread_id),
      has_pending_outbound_action: respondedThreadIds.has(t.thread_id),
      platform_thread_id: postMetaByThread.get(t.thread_id)?.platform_thread_id ?? null,
      post_url: postMetaByThread.get(t.thread_id)?.post_url ?? null,
      post_text_preview: postMetaByThread.get(t.thread_id)?.post_text_preview ?? null,
      post_impression_count: postMetaByThread.get(t.thread_id)?.impression_count ?? null,
      post_reaction_count: postMetaByThread.get(t.thread_id)?.reaction_count ?? null,
      post_comment_count: postMetaByThread.get(t.thread_id)?.comment_count ?? null,
      post_stats_source: postMetaByThread.get(t.thread_id)?.ingested_via ?? null,
      // Engagement-author id of the OTHER party on the latest message.
      // Used by the dedup pass below — multiple engagement_threads rows
      // for the same LinkedIn conversation (legacy ingester artefact)
      // collapse into a single inbox entry keyed on this id.
      counterparty_author_id:
        dmIdentityByThread.get(t.thread_id)?.counterpartyAuthorId
        ?? messageAuthorIdByThread.get(t.thread_id)
        ?? null,
      counterparty_identity_key: dmIdentityByThread.get(t.thread_id)?.key ?? null,
    }));

    // Collapse legacy-split DM threads. The DM ingestion path historically
    // wrote one engagement_threads row per LinkedIn message preview, so a
    // single conversation with someone shows up as 2-3 sibling threads
    // here. Group by (platform, counterparty_author_id) — author_id is
    // engagement_authors.id which is keyed on LinkedIn profile URL, NOT
    // display name, so two real people sharing a name would have
    // different author_ids and remain separate rows.
    //
    // For each group we keep the thread with the most recent latest
    // message (so the user clicks into the thread that holds the freshest
    // context), and sum message counts across siblings.
    //
    // Comment / reaction / post-context threads are NOT collapsed — those
    // genuinely have one platform_thread_id per post URN and the legacy
    // duplication issue doesn't apply.
    const isDmKind = (t: typeof allItems[number]) => isDmMessageType(t.latest_message_type);
    const dmRows = allItems.filter(isDmKind);
    const nonDmRows = allItems.filter((t) => !isDmKind(t));

    const dmGroups = new Map<string, typeof dmRows[number] & { sibling_thread_ids?: string[] }>();
    // Canonical selection follows the newest sibling in the collapsed DM
    // conversation. If the freshest sibling is the user's reply, the whole
    // conversation should leave Needs Response until the other party replies.
    const isBetter = (a: typeof dmRows[number], b: typeof dmRows[number]) => {
      const ta = new Date(a.latest_message_time ?? 0).getTime();
      const tb = new Date(b.latest_message_time ?? 0).getTime();
      return ta > tb;
    };

    for (const row of dmRows) {
      // Fall back to thread_id when there's no author_id — without an
      // author_id alone misses self-latest rows, so this now prefers a
      // whole-thread counterparty key before falling back to thread_id.
      const nameOnlyIdentity = String(row.counterparty_identity_key ?? '').startsWith('name:')
        ? String(row.counterparty_identity_key).slice('name:'.length)
        : null;
      const nameAliasAuthorId = nameOnlyIdentity
        ? (
            uniqueAuthorIdByDisplayName.get(nameOnlyIdentity)
          )
        : null;
      const groupKey = nameAliasAuthorId
        ? `${row.platform}:author:${nameAliasAuthorId}`
        : row.counterparty_identity_key
          ? `${row.platform}:${row.counterparty_identity_key}`
          : row.counterparty_author_id
            ? `${row.platform}:author:${row.counterparty_author_id}`
            : `thread:${row.thread_id}`;
      const existing = dmGroups.get(groupKey);
      if (!existing) {
        dmGroups.set(groupKey, { ...row, sibling_thread_ids: [] });
        continue;
      }
      if (isBetter(row, existing)) {
        const carriedSiblings = [
          existing.thread_id,
          ...(existing.sibling_thread_ids ?? []),
        ];
        const hasCompletedOutbound =
          Boolean(existing.has_completed_outbound_action)
          || Boolean(existing.has_pending_outbound_action)
          || Boolean(row.has_completed_outbound_action)
          || Boolean(row.has_pending_outbound_action);
        dmGroups.set(groupKey, {
          ...row,
          sibling_thread_ids: carriedSiblings,
          message_count: (existing.message_count ?? 0) + (row.message_count ?? 0),
          has_completed_outbound_action: hasCompletedOutbound,
          has_pending_outbound_action: hasCompletedOutbound,
        });
      } else {
        existing.sibling_thread_ids = [...(existing.sibling_thread_ids ?? []), row.thread_id];
        existing.message_count = (existing.message_count ?? 0) + (row.message_count ?? 0);
        existing.has_completed_outbound_action =
          Boolean(existing.has_completed_outbound_action)
          || Boolean(existing.has_pending_outbound_action)
          || Boolean(row.has_completed_outbound_action)
          || Boolean(row.has_pending_outbound_action);
        existing.has_pending_outbound_action =
          Boolean(existing.has_completed_outbound_action);
      }
    }

    const nowMs = Date.now();
    const items = [...Array.from(dmGroups.values()), ...nonDmRows].map((item) => ({
      ...item,
      needs_response_eligible: isNeedsResponseThread(item, nowMs),
      people_reaction_eligible: isPeopleReactionThread(item, nowMs),
    }));

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[engagement/inbox]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch inbox',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/inbox' });
