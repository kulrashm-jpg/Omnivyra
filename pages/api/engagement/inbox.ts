
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
import { isAuthorSelf, isDmMessageType } from '../../../lib/engagement/messageRoles';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const platform = (req.query.platform as string)?.trim() || undefined;
  const priority = (req.query.priority ?? req.query.status) as 'high' | 'medium' | 'low' | undefined;
  const startDate = (req.query.start_date ?? req.query.dateFrom) as string | undefined;
  const endDate = (req.query.end_date ?? req.query.dateTo) as string | undefined;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

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
    // For DM dedup we also need the participant author_id on each thread's
    // latest message — the engagement_authors row is keyed on LinkedIn
    // profile URL, so it's a stable per-person identifier across the
    // multiple thread rows the legacy ingester produced for one
    // conversation. Display name is intentionally NOT used as the dedup
    // key (two real people sharing a name would collide).
    const messageAuthorIdByThread = new Map<string, string | null>();
    const latestMessageIds = nonEmptyThreads
      .map((t) => t.latest_message_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (latestMessageIds.length > 0) {
      const { data: latestMsgs } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, message_type, direction, content, author_id, raw_payload')
        .in('id', latestMessageIds);
      (latestMsgs ?? []).forEach(
        (m: { thread_id: string; message_type: string; direction: string | null; content: string | null; author_id: string | null; raw_payload: Record<string, unknown> | null }) => {
          messageTypeByThread.set(m.thread_id, m.message_type);
          messageDirectionByThread.set(m.thread_id, m.direction ?? null);
          messageAuthorIdByThread.set(m.thread_id, m.author_id ?? null);
          const rp = m.raw_payload || {};
          messageAuthorSelfByThread.set(
            m.thread_id,
            isAuthorSelf({
              direction: m.direction,
              author_self: rp.author_self as boolean | null | undefined,
              sender_self: rp.sender_self as boolean | null | undefined,
              content: m.content,
            }),
          );
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
    // Build a lookup from platform_thread_id → engagement_threads.id so we
    // can cross-reference community_ai_actions rows back to UI threads.
    const threadIdByPlatformThreadId = new Map<string, string>();
    if (threadIds.length > 0) {
      const { data: threadMeta } = await supabase
        .from('engagement_threads')
        .select('id, platform_thread_id, raw_payload')
        .in('id', threadIds);
      (threadMeta ?? []).forEach(
        (row: { id: string; platform_thread_id: string; raw_payload: Record<string, unknown> | null }) => {
          const rp = row.raw_payload || {};
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
            threadIdByPlatformThreadId.set(row.platform_thread_id, row.id);
          }
        }
      );
    }

    // Threads where the user's reply has actually reached the platform
    // (or been claimed by the extension for delivery) should drop out of
    // "Needs Response". Earlier this filter also matched plain 'pending'
    // rows — that turned out wrong: a 'pending' row with no lease is one
    // the extension never claimed, the user's Send click sits in our
    // queue undelivered, and dropping the thread silently hides the work.
    //
    // Inclusion criteria now:
    //   - status = executed         → platform confirmed the write
    //   - status = sent_unverified  → write accepted, no platform id back
    //   - status = pending AND dispatch_lease_id IS NOT NULL
    //                              → extension has claimed it, delivery
    //                                in flight
    // Pure pending without a lease => still in our queue, NOT delivered,
    // thread stays in Needs Response so the operator can see something is
    // actually pending.
    const respondedThreadIds = new Set<string>();
    if (threadIdByPlatformThreadId.size > 0) {
      const targetIds = Array.from(threadIdByPlatformThreadId.keys());
      const { data: actionRows } = await supabase
        .from('community_ai_actions')
        .select('target_id, status, action_type, dispatch_lease_id')
        .eq('organization_id', companyId)
        .in('target_id', targetIds)
        .in('action_type', ['dm', 'reply'])
        .in('status', ['pending', 'dispatched', 'executed', 'sent_unverified']);
      for (const row of actionRows ?? []) {
        const status = (row as { status: string }).status;
        const lease = (row as { dispatch_lease_id?: string | null }).dispatch_lease_id ?? null;
        // Pending without a claim = undelivered, ignore.
        if (status === 'pending' && !lease) continue;
        const target = (row as { target_id: string }).target_id;
        const matchedThreadId = threadIdByPlatformThreadId.get(target);
        if (matchedThreadId) respondedThreadIds.add(matchedThreadId);
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
      latest_message_type: messageTypeByThread.get(t.thread_id) ?? null,
      latest_message_direction: messageDirectionByThread.get(t.thread_id) ?? null,
      latest_message_author_self: messageAuthorSelfByThread.get(t.thread_id) ?? false,
      // True when the user has already taken an action (queued/dispatched/
      // executed reply or DM) targeting this thread via the engagement
      // pipeline. Drives the "drop from Needs Response after Send" rule
      // in the client-side dmThreads filter.
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
      counterparty_author_id: messageAuthorIdByThread.get(t.thread_id) ?? null,
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
    for (const row of dmRows) {
      // Fall back to thread_id when there's no author_id — without an
      // identifier we can't safely collapse, so each row stays distinct.
      const groupKey = row.counterparty_author_id
        ? `${row.platform}:${row.counterparty_author_id}`
        : `thread:${row.thread_id}`;
      const existing = dmGroups.get(groupKey);
      if (!existing) {
        dmGroups.set(groupKey, { ...row, sibling_thread_ids: [] });
        continue;
      }
      // Pick whichever has the most recent latest_message_time as the
      // canonical row. Other thread ids ride along as siblings so the
      // conversation pane can fetch the merged history.
      const incomingTs = new Date(row.latest_message_time ?? 0).getTime();
      const currentTs = new Date(existing.latest_message_time ?? 0).getTime();
      if (incomingTs > currentTs) {
        const carriedSiblings = [
          existing.thread_id,
          ...(existing.sibling_thread_ids ?? []),
        ];
        dmGroups.set(groupKey, { ...row, sibling_thread_ids: carriedSiblings });
      } else {
        existing.sibling_thread_ids = [...(existing.sibling_thread_ids ?? []), row.thread_id];
        existing.message_count = (existing.message_count ?? 0) + (row.message_count ?? 0);
        // Stay with existing as canonical — drops the older row from the list.
      }
    }

    const items = [...Array.from(dmGroups.values()), ...nonDmRows];

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[engagement/inbox]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch inbox',
    });
  }
}
