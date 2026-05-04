import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/engagement/messages
 * Returns engagement messages from the unified model.
 * Supports filters: platform, thread_id, author_id, organization_id, date_range.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { isAuthorSelf, stripSenderColonPrefix } from '../../../lib/engagement/messageRoles';
import {
  getEffectiveMessageTimestamp,
  getLowConfidenceRawTimeLabel,
  parseMessageDateMs,
} from '../../../lib/engagement/messageTime';

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

function actionCoversMessage(input: {
  actionText: string | null | undefined;
  actionTime: string | null | undefined;
  messageText: string | null | undefined;
  messageCreatedAt: string | null | undefined;
  messageEffectiveAt: string | null | undefined;
}): boolean {
  const actionText = normalizeComparableText(input.actionText);
  const messageText = normalizeComparableText(input.messageText);
  if (!actionText || !messageText || actionText !== messageText) return false;

  const actionMs = parseMessageDateMs(input.actionTime);
  const observedMs = parseMessageDateMs(input.messageCreatedAt)
    ?? parseMessageDateMs(input.messageEffectiveAt);
  if (actionMs === null || observedMs === null) return true;

  const toleranceBeforeActionMs = 5 * 60 * 1000;
  const maxScrapeDelayMs = 8 * 60 * 60 * 1000;
  return observedMs >= actionMs - toleranceBeforeActionMs
    && observedMs <= actionMs + maxScrapeDelayMs;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const platform = (req.query.platform as string)?.trim();
    const threadId = (req.query.thread_id ?? req.query.threadId) as string | undefined;
    const authorId = (req.query.author_id ?? req.query.authorId) as string | undefined;
    const startDate = (req.query.start_date ?? req.query.startDate) as string | undefined;
    const endDate = (req.query.end_date ?? req.query.endDate) as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    // Sibling thread ids â€” the inbox API collapses legacy-split DM threads
    // by counterparty author and surfaces the other thread ids through
    // sibling_thread_ids. The conversation pane passes them back here so
    // the merged history loads as a single chain. Comma-separated string
    // or repeated query params both supported.
    const siblingThreadIdsParam =
      (req.query['sibling_thread_ids'] ?? req.query['siblingThreadIds']) as string | string[] | undefined;
    const siblingThreadIds: string[] = Array.isArray(siblingThreadIdsParam)
      ? siblingThreadIdsParam
      : typeof siblingThreadIdsParam === 'string'
        ? siblingThreadIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Scope by organization via engagement_threads
    let threadIds: string[] | null = null;
    if (!threadId) {
      const { data: threads } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('organization_id', organizationId);
      threadIds = (threads ?? []).map((r: { id: string }) => r.id);
      if (threadIds.length === 0) {
        return res.status(200).json({ messages: [] });
      }
    }

    let query = supabase
      .from('engagement_messages')
      .select('id, thread_id, source_id, author_id, platform, platform_message_id, message_type, direction, parent_message_id, content, like_count, reply_count, sentiment_score, created_at, platform_created_at, normalized_time, raw_time, raw_payload')
      .order('normalized_time', { ascending: true, nullsFirst: false })
      .order('platform_created_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (threadId) {
      // Validate the canonical thread + any siblings all belong to the
      // caller's org. Anything that doesn't match is dropped silently
      // rather than 404'd because a stale sibling list shouldn't break
      // the legitimate canonical-thread fetch.
      const idsToCheck = [threadId, ...siblingThreadIds];
      const { data: validatedThreads } = await supabase
        .from('engagement_threads')
        .select('id')
        .in('id', idsToCheck)
        .eq('organization_id', organizationId);
      const validatedIds = (validatedThreads ?? []).map((r: { id: string }) => r.id);
      if (!validatedIds.includes(threadId)) {
        return res.status(404).json({ error: 'Thread not found or access denied' });
      }
      query = validatedIds.length === 1
        ? query.eq('thread_id', threadId)
        : query.in('thread_id', validatedIds);
    } else if (threadIds && threadIds.length > 0) {
      query = query.in('thread_id', threadIds);
    }
    if (platform) query = query.eq('platform', platform);
    if (authorId) query = query.eq('author_id', authorId);
    if (startDate) query = query.gte('platform_created_at', startDate);
    if (endDate) query = query.lte('platform_created_at', endDate);

    const { data, error } = await query;

    if (error) {
      console.error('[engagement/messages]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const messageRows = (data ?? []) as Record<string, unknown>[];
    const rowThreadIds = Array.from(
      new Set(
        messageRows
          .map((r) => (typeof r.thread_id === 'string' ? r.thread_id : null))
          .filter((id): id is string => Boolean(id))
      )
    );
    const actionTargetsByThread = new Map<string, Set<string>>();
    const addActionTarget = (thread: string, value: unknown) => {
      const target = typeof value === 'string' ? value.trim() : '';
      if (!target) return;
      const set = actionTargetsByThread.get(thread) ?? new Set<string>();
      set.add(target);
      actionTargetsByThread.set(thread, set);
    };
    if (rowThreadIds.length > 0) {
      const { data: threadRows } = await supabase
        .from('engagement_threads')
        .select('id, platform_thread_id, raw_payload')
        .in('id', rowThreadIds);
      for (const row of threadRows ?? []) {
        const t = row as { id: string; platform_thread_id?: string | null; raw_payload?: Record<string, unknown> | null };
        const rp = t.raw_payload ?? {};
        addActionTarget(t.id, t.id);
        addActionTarget(t.id, t.platform_thread_id);
        addActionTarget(t.id, rp.participant_profile_url);
        addActionTarget(t.id, rp.participant_username);
        addActionTarget(t.id, rp.participant_name);
      }
      for (const row of messageRows) {
        if (typeof row.thread_id !== 'string') continue;
        addActionTarget(row.thread_id, row.id);
        addActionTarget(row.thread_id, row.platform_message_id);
      }
    }

    const actionTargetIds = Array.from(
      new Set(Array.from(actionTargetsByThread.values()).flatMap((set) => Array.from(set)))
    );
    const outboundActionsByThread = new Map<string, Array<{
      final_text?: string | null;
      suggested_text?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }>>();
    if (actionTargetIds.length > 0) {
      const targetToThreadIds = new Map<string, string[]>();
      for (const [tid, targets] of actionTargetsByThread.entries()) {
        for (const target of targets) {
          targetToThreadIds.set(target, [...(targetToThreadIds.get(target) ?? []), tid]);
        }
      }
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
        const matchedThreadIds = row.target_id ? targetToThreadIds.get(row.target_id) ?? [] : [];
        for (const tid of matchedThreadIds) {
          const list = outboundActionsByThread.get(tid) ?? [];
          list.push(row);
          outboundActionsByThread.set(tid, list);
        }
      }
    }

    const messages = messageRows.map((r: Record<string, unknown>) => {
      const rp = (r.raw_payload && typeof r.raw_payload === 'object' ? r.raw_payload : {}) as Record<string, unknown>;
      const authorDisplayName =
        typeof rp.author_name === 'string' && rp.author_name.length > 0
          ? rp.author_name
          : typeof rp.sender_name === 'string' && rp.sender_name.length > 0
            ? rp.sender_name
            : null;
      const authorHandle =
        typeof rp.author_handle === 'string' && rp.author_handle.length > 0
          ? rp.author_handle
          : typeof rp.sender_username === 'string' && rp.sender_username.length > 0
            ? rp.sender_username
            : null;
      const authorAvatarUrl =
        typeof rp.author_avatar_url === 'string' && /^https?:/.test(rp.author_avatar_url)
          ? rp.author_avatar_url
          : null;
      // Synthetic seed rows carry placeholder=true and have invalid
      // platform_message_id values (e.g. ...#demo-comment-1). LinkedIn API
      // rejects those URNs, so the UI should gate Like/Reply on real ones.
      const isPlaceholder = rp.placeholder === true;

      // LinkedIn's messaging list prepends "You:" or "Sender:" to the
      // preview. lib/engagement/messageRoles owns both the routing decision
      // (who sent it) and the content cleanup, so this layer just consumes
      // the helpers â€” no duplicate prefix-matching regex here.
      const rawContent = typeof r.content === 'string' ? r.content : '';
      const messageTimeRow = {
        id: typeof r.id === 'string' ? r.id : null,
        created_at: typeof r.created_at === 'string' ? r.created_at : null,
        platform_created_at: typeof r.platform_created_at === 'string' ? r.platform_created_at : null,
        normalized_time: typeof r.normalized_time === 'string' ? r.normalized_time : null,
        raw_time: typeof r.raw_time === 'string' ? r.raw_time : null,
        raw_payload: rp,
      };
      const effectiveTimestamp = getEffectiveMessageTimestamp(messageTimeRow);
      const roleAuthorSelf = isAuthorSelf({
        platform: typeof r.platform === 'string' ? r.platform : null,
        platform_message_id: typeof r.platform_message_id === 'string' ? r.platform_message_id : null,
        direction: typeof r.direction === 'string' ? r.direction : null,
        author_self: rp.author_self as boolean | null | undefined,
        sender_self: rp.sender_self as boolean | null | undefined,
        sender_username: rp.sender_username as string | null | undefined,
        sender_profile_url: rp.sender_profile_url as string | null | undefined,
        content: rawContent,
      });
      const cleanContent = stripSenderColonPrefix(rawContent);
      const threadActions = typeof r.thread_id === 'string'
        ? outboundActionsByThread.get(r.thread_id) ?? []
        : [];
      const actionMatchedSelf = threadActions.some((action) =>
        actionCoversMessage({
          actionText: action.final_text ?? action.suggested_text ?? null,
          actionTime: action.updated_at ?? action.created_at ?? null,
          messageText: cleanContent,
          messageCreatedAt: typeof r.created_at === 'string' ? r.created_at : null,
          messageEffectiveAt: effectiveTimestamp,
        })
      );
      const finalAuthorSelf = roleAuthorSelf || actionMatchedSelf;
      // Sender's display name from a "Name: ..." preview, when no other
      // signal gave us one. Only meaningful for inbound rows.
      const senderColonMatch = !finalAuthorSelf
        ? rawContent.match(/^([A-Z][\w'.-]{0,40})\s*:\s*/)
        : null;
      const finalAuthorDisplayName =
        authorDisplayName || (senderColonMatch ? senderColonMatch[1] : null);
      return {
        id: r.id,
        thread_id: r.thread_id,
        author_id: r.author_id,
        platform: r.platform,
        platform_message_id: r.platform_message_id,
        message_type: r.message_type,
        parent_message_id: r.parent_message_id,
        content: cleanContent,
        like_count: r.like_count ?? 0,
        reply_count: r.reply_count ?? 0,
        sentiment_score: r.sentiment_score,
        created_at: r.created_at,
        platform_created_at: effectiveTimestamp,
        display_time_label: getLowConfidenceRawTimeLabel(messageTimeRow),
        author_display_name: finalAuthorDisplayName,
        author_handle: authorHandle,
        author_self: finalAuthorSelf,
        author_avatar_url: authorAvatarUrl,
        is_placeholder: isPlaceholder,
      };
    });

    // Surface pending outbound DM actions as virtual "queued" messages
    // so the conversation pane can render them inline alongside the real
    // platform messages. The user sees:
    //   - the chain of incoming messages from the other party (real rows)
    //   - their own queued reply with a "Queued Â· not yet delivered"
    //     marker and a Cancel button
    // Once the extension actually delivers the action, the row is marked
    // executed and a real outbound engagement_messages row gets ingested
    // on the next sync â€” at which point this virtual entry is replaced
    // by the real one.
    const threadIdsForPending = threadId
      ? [threadId, ...siblingThreadIds]
      : threadIds ?? [];
    let pendingActions: Array<{
      id: string;
      thread_id: string | null;
      platform: string | null;
      content: string;
      created_at: string;
      participant_target: string;
      claimed: boolean;
      acknowledged: boolean;
      lease_expires_at: string | null;
      lease_expired: boolean;
    }> = [];
    if (threadIdsForPending.length > 0) {
      const { data: pendingRows } = await supabase
        .from('engagement_threads')
        .select('id, platform, platform_thread_id, raw_payload')
        .in('id', Array.from(new Set(threadIdsForPending.filter(Boolean))));
      const platformThreadIdToThreadId = new Map<string, string>();
      const targetToThreadIds = new Map<string, string[]>();
      const threadPlatformById = new Map<string, string | null>();
      const addPendingTarget = (tid: string, value: unknown) => {
        const target = typeof value === 'string' ? value.trim() : '';
        if (!target) return;
        for (const key of [target, target.toLowerCase()]) {
          const current = targetToThreadIds.get(key) ?? [];
          if (!current.includes(tid)) targetToThreadIds.set(key, [...current, tid]);
        }
      };
      for (const row of pendingRows ?? []) {
        const t = row as {
          id: string;
          platform?: string | null;
          platform_thread_id?: string | null;
          raw_payload?: Record<string, unknown> | null;
        };
        const ptid = t.platform_thread_id ?? null;
        const rp = t.raw_payload ?? {};
        threadPlatformById.set(t.id, t.platform ?? null);
        addPendingTarget(t.id, t.id);
        addPendingTarget(t.id, ptid);
        addPendingTarget(t.id, rp.thread_url);
        addPendingTarget(t.id, rp.participant_profile_url);
        addPendingTarget(t.id, rp.participant_username);
        addPendingTarget(t.id, rp.participant_name);
        if (ptid) platformThreadIdToThreadId.set(ptid, t.id);
      }
      const requestedThreadSet = new Set(threadIdsForPending.filter(Boolean));
      for (const row of messageRows) {
        const tid = typeof row.thread_id === 'string' ? row.thread_id : null;
        if (!tid || !requestedThreadSet.has(tid)) continue;
        const rp = (row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}) as Record<string, unknown>;
        addPendingTarget(tid, row.id);
        addPendingTarget(tid, row.platform_message_id);
        addPendingTarget(tid, rp.sender_name);
        addPendingTarget(tid, rp.author_name);
        addPendingTarget(tid, rp.sender_profile_url);
        addPendingTarget(tid, rp.author_profile_url);
      }
      // The action's target_id is now the recipient identity (display name
      // or profile URL) for new actions, but legacy rows still use the
      // platform_thread_id. Match by either â€” fetch all pending DMs for
      // the org's matching set, then filter post-hoc.
      const platformThreadIds = Array.from(platformThreadIdToThreadId.keys());
      if (platformThreadIds.length > 0 || targetToThreadIds.size > 0) {
        const { data: actions } = await supabase
          .from('community_ai_actions')
          .select('id, platform, target_id, suggested_text, final_text, created_at, updated_at, status, dispatch_lease_id, dispatch_lease_expires_at, dispatch_acknowledged_at, action_type')
          .eq('organization_id', organizationId)
          .in('action_type', ['dm', 'reply'])
          .eq('status', 'pending');
        // Defensive: only surface actions whose target_id maps to one of
        // the requested threads. We compare against platform_thread_id
        // (legacy shape) only â€” the new recipient-identity target ids
        // can't be matched here without an authors join. Acceptable
        // tradeoff: legacy rows get the queued UI; brand-new ones light
        // up after we add the participant lookup below.
        for (const a of actions ?? []) {
          const action = a as {
            id: string;
            platform?: string | null;
            target_id?: string | null;
            final_text?: string | null;
            suggested_text?: string | null;
            created_at?: string | null;
            updated_at?: string | null;
            dispatch_lease_id?: string | null;
            dispatch_lease_expires_at?: string | null;
            dispatch_acknowledged_at?: string | null;
          };
          const target = (action.target_id ?? '').trim();
          const matchedIds = targetToThreadIds.get(target)
            ?? targetToThreadIds.get(target.toLowerCase())
            ?? (platformThreadIdToThreadId.has(target) ? [platformThreadIdToThreadId.get(target) as string] : []);
          if (matchedIds.length === 0) continue;
          const content = (action.final_text ?? action.suggested_text ?? '').toString();
          if (!content.trim()) continue;
          const leaseExpiresMs = action.dispatch_lease_expires_at
            ? Date.parse(action.dispatch_lease_expires_at)
            : Number.NaN;
          for (const matchedId of matchedIds) {
            pendingActions.push({
              id: action.id,
              thread_id: matchedId,
              platform: action.platform ?? threadPlatformById.get(matchedId) ?? null,
              content,
              created_at: action.created_at ?? action.updated_at ?? new Date().toISOString(),
              participant_target: target,
              claimed: Boolean(action.dispatch_lease_id),
              acknowledged: Boolean(action.dispatch_acknowledged_at),
              lease_expires_at: action.dispatch_lease_expires_at ?? null,
              lease_expired: Number.isFinite(leaseExpiresMs) ? leaseExpiresMs < Date.now() : false,
            });
          }
        }
      }
    }

    const pendingVirtualMessages = pendingActions.map((p) => ({
      id: `pending:${p.id}`,
      thread_id: p.thread_id,
      author_id: null,
      platform: p.platform || platform || null,
      platform_message_id: null,
      message_type: 'dm',
      parent_message_id: null,
      content: p.content,
      like_count: 0,
      reply_count: 0,
      sentiment_score: null,
      created_at: p.created_at,
      platform_created_at: p.created_at,
      author_display_name: 'You',
      author_handle: null,
      author_self: true,
      author_avatar_url: null,
      is_placeholder: false,
      // UI-only fields. The conversation pane uses these to render the
      // queued banner + cancel button.
      is_pending_outbound: true,
      pending_action_id: p.id,
      pending_action_claimed: p.claimed,
      pending_action_acknowledged: p.acknowledged,
      pending_action_lease_expires_at: p.lease_expires_at,
      pending_action_lease_expired: p.lease_expired,
    }));

    return res.status(200).json({ messages: [...messages, ...pendingVirtualMessages] });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch messages';
    console.error('[engagement/messages]', message);
    return res.status(500).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

