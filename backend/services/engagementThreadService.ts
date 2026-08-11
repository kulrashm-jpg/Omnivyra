/**
 * Engagement Thread Service
 *
 * Provides thread listing for the Unified Engagement Inbox.
 * Supports filters: organization_id, platform, source_id, priority, date_range.
 */

import { supabase } from '../db/supabaseClient';
import { scoreThreadPriority } from './engagementThreadPriorityService';
import { computeThreadLeadScoresBatch } from './leadThreadScoring';
import { isActionableDmPreview, isAuthorSelf } from '../../lib/engagement/messageRoles';
import {
  compareMessagesDescending,
  getEffectiveMessageTimeMs,
  getEffectiveMessageTimestamp,
  parseMessageDateMs,
} from '../../lib/engagement/messageTime';

const THREAD_COLUMNS_BASE =
  'id, platform, platform_thread_id, source_id, organization_id, priority_score, unread_count, raw_payload, created_at, updated_at';
const THREAD_COLUMNS_WITH_COLLABORATION =
  `${THREAD_COLUMNS_BASE}, assigned_to, assigned_at`;

export type GetThreadsFilters = {
  organization_id: string;
  platform?: string | null;
  source_id?: string | null;
  priority?: 'high' | 'medium' | 'low' | null;
  start_date?: string | null;
  end_date?: string | null;
  limit?: number;
  exclude_ignored?: boolean;
  /**
   * F1/F2: restrict the page to threads whose latest authoritative turn is
   * external — i.e. work that still needs a response.
   *
   * Defaults to false so every existing caller keeps its current result set;
   * only surfaces that page actionable work opt in. When true the exclusion
   * runs BEFORE sorting and before the page cut, so an answered thread can
   * never consume a slot that belongs to a real engagement.
   */
  actionable_only?: boolean;
  /**
   * F5: restrict the query to an explicit set of thread ids.
   *
   * Added so AI callers can resolve canonical actionability for the exact
   * threads they are about to act on WITHOUT re-deriving ownership and without
   * depending on the thread happening to fall inside the default page window.
   * It only narrows the SQL predicate — every downstream derivation (latest
   * turn, `isAuthorSelf`, unread gating, `actionable`) is untouched.
   */
  thread_ids?: string[] | null;
};

export type ThreadSummary = {
  thread_id: string;
  platform: string;
  author_summary: string;
  message_count: number;
  latest_message: string | null;
  latest_message_time: string | null;
  latest_message_id?: string | null;
  priority_score: number;
  unread_count: number;
  /**
   * F2: the canonical, materialised answer to "does this still need a reply?".
   *
   * Derived from the SAME latest-turn ownership result the rest of this service
   * already computes (`isAuthorSelf` → author_id ↔ connected-account map →
   * unresolved ⇒ external). It is deliberately a separate field from
   * `unread_count`: a thread can be unread yet already answered, and cached
   * unread must never be read as "needs action". Consumers must read this
   * rather than inferring actionability from a count.
   */
  actionable: boolean;
  dominant_intent?: string | null;
  lead_detected?: boolean;
  lead_score?: number;
  negative_feedback?: boolean;
  customer_question?: boolean;
  classification_category?: string | null;
  triage_priority?: number | null;
  sentiment?: string | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  assignee_name?: string | null;
  people_reaction_eligible?: boolean;
  post_reaction_count?: number | null;
  post_comment_count?: number | null;
};

type EngagementThreadRow = {
  id: string;
  platform: string;
  platform_thread_id?: string | null;
  source_id?: string | null;
  organization_id?: string | null;
  priority_score?: number | string | null;
  unread_count?: number | string | null;
  raw_payload?: Record<string, unknown> | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function isMissingEngagementThreadCollaborationColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === 'PGRST204' ||
    message.includes('engagement_threads.assigned_to') ||
    message.includes('engagement_threads.assigned_at') ||
    message.includes('could not find the') && message.includes('engagement_threads') ||
    message.includes('assigned_to') && message.includes('does not exist') ||
    message.includes('assigned_at') && message.includes('does not exist')
  );
}

function coerceOptionalCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * The set of engagement_authors ids that ARE the connected company.
 *
 * Exported (F6) so the AI context assembler can label conversation turns as
 * "the company" with exactly the accuracy actionability already has. It is the
 * same resolution, not a copy: without this, prompt-side self-detection would
 * have to re-implement the identity join and would drift from the canonical
 * predicate — which is the failure mode D2/F5 were built to remove.
 */
export async function getOrgAuthorIds(organizationId: string): Promise<Set<string>> {
  const { data: roleUsers } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', organizationId)
    .eq('status', 'active');

  const userIds = (roleUsers ?? []).map((row: { user_id: string }) => row.user_id);
  if (userIds.length === 0) return new Set();

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, platform_user_id')
    .in('user_id', userIds)
    .eq('is_active', true);

  if (!accounts?.length) return new Set();

  // D4: the identity key is `platform:platform_user_id`. A blank
  // platform_user_id collapses every such row onto the same key ("linkedin:"),
  // so a connected account missing its provider id would match ANY engagement
  // author that is also missing one — silently classifying a stranger as the
  // company and hiding their engagement from the work queue. An identity we
  // cannot state is not an identity: rows without a provider id are dropped
  // from the self set on both sides, leaving the actor external, which is the
  // safe direction (an extra item shown, never a real person hidden).
  const identityKey = (platform: unknown, platformUserId: unknown): string | null => {
    const p = (platform ?? '').toString().trim().toLowerCase();
    const id = (platformUserId ?? '').toString().trim();
    if (!p || !id) return null;
    return `${p}:${id}`;
  };

  const platformUserPairs = new Set(
    (accounts as Array<{ platform: string; platform_user_id: string }>)
      .map((account) => identityKey(account.platform, account.platform_user_id))
      .filter((key): key is string => key !== null)
  );
  if (platformUserPairs.size === 0) return new Set();

  const { data: authors } = await supabase
    .from('engagement_authors')
    .select('id, platform, platform_user_id')
    .in(
      'platform',
      Array.from(
        new Set(
          (accounts as Array<{ platform: string }>).map((account) =>
            (account.platform || '').toLowerCase()
          )
        )
      )
    );

  const orgAuthorIds = new Set<string>();
  (authors ?? []).forEach((author: { id: string; platform: string; platform_user_id: string }) => {
    const key = identityKey(author.platform, author.platform_user_id);
    // A null key means this author carries no usable provider identity — it can
    // never be matched to a connected account, so it stays external.
    if (key && platformUserPairs.has(key)) {
      orgAuthorIds.add(author.id);
    }
  });

  return orgAuthorIds;
}

function inferInboundDmFallback(input: {
  platform?: string | null;
  platform_message_id?: string | null;
  message_type?: string | null;
  direction?: string | null;
  raw_payload?: Record<string, unknown> | null;
  content?: string | null;
}): boolean {
  const originalMessageType =
    typeof input.raw_payload?.original_message_type === 'string'
      ? input.raw_payload.original_message_type.toLowerCase()
      : null;
  const messageType = (input.message_type ?? '').toLowerCase();
  const isDm = messageType === 'dm' || originalMessageType === 'dm';

  if (!isDm) return false;

  const content = (input.content ?? '').trim();
  if (!content) return false;

  return !isAuthorSelf({
    platform: input.platform,
    platform_message_id: input.platform_message_id,
    direction: input.direction,
    author_self: input.raw_payload?.author_self as boolean | null | undefined,
    sender_self: input.raw_payload?.sender_self as boolean | null | undefined,
    sender_username: input.raw_payload?.sender_username as string | null | undefined,
    sender_profile_url: input.raw_payload?.sender_profile_url as string | null | undefined,
    content,
  });
}

export async function getThreads(filters: GetThreadsFilters): Promise<ThreadSummary[]> {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 50));
  const orgAuthorIds = await getOrgAuthorIds(filters.organization_id);

  let dateScopedThreadIds: string[] | null = null;
  if (filters.start_date || filters.end_date) {
    let threadScopeQuery = supabase
      .from('engagement_threads')
      .select('id, raw_payload')
      .eq('organization_id', filters.organization_id)
      .limit(5000);

    if (filters.platform) {
      threadScopeQuery = threadScopeQuery.eq('platform', filters.platform);
    }
    if (filters.exclude_ignored) {
      threadScopeQuery = threadScopeQuery.eq('ignored', false);
    }
    if (filters.source_id) {
      threadScopeQuery = threadScopeQuery.eq('source_id', filters.source_id);
    }

    const { data: scopedThreads, error: scopedThreadsError } = await threadScopeQuery;
    if (scopedThreadsError) {
      throw new Error(`Failed to fetch date-scoped engagement threads: ${scopedThreadsError.message}`);
    }

    const scopedThreadIds = (scopedThreads ?? [])
      .map((row: { id: string | null }) => row.id)
      .filter((threadId): threadId is string => Boolean(threadId));

    if (scopedThreadIds.length === 0) {
      return [];
    }

    let messageScopeQuery = supabase
      .from('engagement_messages')
      .select('thread_id, platform_created_at, created_at')
      .in('thread_id', scopedThreadIds)
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(5000);

    const { data: scopedMessages, error: scopedMessagesError } = await messageScopeQuery;
    if (scopedMessagesError) {
      throw new Error(`Failed to fetch date-scoped engagement messages: ${scopedMessagesError.message}`);
    }

    const startMs = parseMessageDateMs(filters.start_date);
    const endMs = parseMessageDateMs(filters.end_date);
    const idsInWindow = new Set<string>(
      (scopedMessages ?? [])
        .filter((row: {
          platform_created_at?: string | null;
          created_at?: string | null;
        }) => {
          const effectiveTimeMs = parseMessageDateMs(row.platform_created_at ?? row.created_at ?? null);
          if (effectiveTimeMs === null) return false;
          if (startMs !== null && effectiveTimeMs < startMs) return false;
          if (endMs !== null && effectiveTimeMs > endMs) return false;
          return true;
        })
        .map((row: { thread_id: string | null }) => row.thread_id)
        .filter((threadId): threadId is string => Boolean(threadId))
    );

    (scopedThreads ?? []).forEach((row: { id: string | null; raw_payload?: Record<string, unknown> | null }) => {
      const lastMessageAt =
        row.raw_payload && typeof row.raw_payload === 'object' && typeof row.raw_payload.last_message_at === 'string'
          ? row.raw_payload.last_message_at
          : null;
      const lastMessageMs = parseMessageDateMs(lastMessageAt);
      if (!row.id || lastMessageMs === null) return;
      if (startMs !== null && lastMessageMs < startMs) return;
      if (endMs !== null && lastMessageMs > endMs) return;
      idsInWindow.add(row.id);
    });

    dateScopedThreadIds = Array.from(idsInWindow);

    if (dateScopedThreadIds.length === 0) {
      return [];
    }
  }

  const buildThreadQuery = (columns: string) => {
    let query = supabase
      .from('engagement_threads')
      .select(columns)
      .eq('organization_id', filters.organization_id)
      .order('updated_at', { ascending: false })
      .limit(Math.min(1000, Math.max(limit * 2, 300)));

    if (filters.platform) {
      query = query.eq('platform', filters.platform);
    }
    if (filters.exclude_ignored) {
      query = query.eq('ignored', false);
    }
    if (filters.source_id) {
      query = query.eq('source_id', filters.source_id);
    }
    if (dateScopedThreadIds) {
      query = query.in('id', dateScopedThreadIds);
    }
    // F5: exact-id narrowing. Combined with the org filter above, a thread id
    // belonging to another company simply yields no row — the caller's
    // fail-closed default then treats it as non-actionable.
    if (filters.thread_ids && filters.thread_ids.length > 0) {
      query = query.in('id', filters.thread_ids);
    }
    return query;
  };

  let { data: threads, error } = await buildThreadQuery(THREAD_COLUMNS_WITH_COLLABORATION);
  if (error && isMissingEngagementThreadCollaborationColumn(error)) {
    console.warn('[engagementThreadService] collaboration columns missing; retrying inbox query without assignment metadata', {
      message: error.message,
      code: error.code,
    });
    ({ data: threads, error } = await buildThreadQuery(THREAD_COLUMNS_BASE));
  }
  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }
  const list = (threads ?? []) as unknown as EngagementThreadRow[];

  const threadIds = list.map((t: { id: string }) => t.id);
  if (threadIds.length === 0) {
    return [];
  }

  const leadScores = await computeThreadLeadScoresBatch(threadIds, filters.organization_id);

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, classification_category, triage_priority, sentiment')
    .in('thread_id', threadIds)
    .eq('organization_id', filters.organization_id);
  const classificationByThread = new Map<string, { classification_category?: string; triage_priority?: number; sentiment?: string }>();
  (classifications ?? []).forEach((r: { thread_id: string; classification_category?: string; triage_priority?: number; sentiment?: string }) => {
    classificationByThread.set(r.thread_id, {
      classification_category: r.classification_category ?? null,
      triage_priority: r.triage_priority ?? null,
      sentiment: r.sentiment ?? null,
    });
  });

  const { data: threadIntel } = await supabase
    .from('engagement_thread_intelligence')
    .select('thread_id, dominant_intent, lead_detected, negative_feedback, customer_question, influencer_detected')
    .in('thread_id', threadIds);
  const intelByThread = new Map<string, { dominant_intent?: string; lead_detected?: boolean; negative_feedback?: boolean; customer_question?: boolean; influencer_detected?: boolean }>();
  (threadIntel ?? []).forEach((r: any) => {
    intelByThread.set(r.thread_id, {
      dominant_intent: r.dominant_intent ?? null,
      lead_detected: r.lead_detected === true,
      negative_feedback: r.negative_feedback === true,
      customer_question: r.customer_question === true,
      influencer_detected: r.influencer_detected === true,
    });
  });

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform, platform_message_id, content, platform_created_at, created_at, author_id, sentiment_score, message_type, direction, raw_payload')
    .in('thread_id', threadIds)
    // Order by platform_created_at DESC NULLS LAST, then created_at DESC.
    // Default Postgres DESC puts NULLs FIRST, which made any row with a
    // missing platform_created_at (legacy ingest, scraper glitch) win the
    // "latest message" slot — feeding incorrect direction/author_self into
    // the Needs Response gate. nullsFirst:false + ingest-time tiebreaker
    // restores chronological correctness.
    .order('platform_created_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false });

  const latestByThread = new Map<string, {
    id: string;
    platform: string | null;
    platform_message_id: string | null;
    content: string;
    platform_created_at: string | null;
    created_at: string | null;
    sentiment_score?: number | null;
    message_type?: string | null;
    direction?: string | null;
    raw_payload?: Record<string, unknown> | null;
    author_id?: string | null;
  }>();
  const countByThread = new Map<string, number>();
  const authorIds = new Set<string>();
  const orderedMessages = [...(messages ?? [])].sort(compareMessagesDescending);

  orderedMessages.forEach((m: any) => {
    if (!latestByThread.has(m.thread_id)) {
      latestByThread.set(m.thread_id, {
        id: m.id,
        platform: m.platform ?? null,
        platform_message_id: m.platform_message_id ?? null,
        content: (m.content ?? '').toString().slice(0, 200),
        platform_created_at: m.platform_created_at ?? null,
        created_at: m.created_at ?? null,
        sentiment_score: m.sentiment_score ?? null,
        message_type: m.message_type ?? null,
        direction: m.direction ?? null,
        raw_payload:
          m.raw_payload && typeof m.raw_payload === 'object'
            ? (m.raw_payload as Record<string, unknown>)
            : null,
        author_id: m.author_id ?? null,
      });
    }
    countByThread.set(m.thread_id, (countByThread.get(m.thread_id) ?? 0) + 1);
    if (m.author_id) authorIds.add(m.author_id);
  });

  const authorMap = new Map<string, { username?: string; display_name?: string }>();
  if (authorIds.size > 0) {
    const { data: authors } = await supabase
      .from('engagement_authors')
      .select('id, username, display_name')
      .in('id', Array.from(authorIds));
    (authors ?? []).forEach((a: any) => authorMap.set(a.id, { username: a.username, display_name: a.display_name }));
  }

  const firstAuthorByThread = new Map<string, string>();
  (messages ?? []).forEach((m: any) => {
    if (!firstAuthorByThread.has(m.thread_id) && m.author_id) {
      const a = authorMap.get(m.author_id);
      firstAuthorByThread.set(m.thread_id, a?.display_name ?? a?.username ?? 'Unknown');
    }
  });

  // Resolve assignee display names for assigned threads (best-effort).
  const assigneeNameById = new Map<string, string>();
  const assignedUserIds = Array.from(
    new Set(
      list
        .map((t: { assigned_to?: string | null }) => t.assigned_to)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    )
  );
  if (assignedUserIds.length > 0) {
    const { data: assignees } = await supabase
      .from('user_company_roles')
      .select('user_id, name')
      .eq('company_id', filters.organization_id)
      .in('user_id', assignedUserIds);
    (assignees ?? []).forEach((r: { user_id: string; name: string | null }) => {
      if (r.name) assigneeNameById.set(r.user_id, r.name);
    });
  }

  const results: ThreadSummary[] = [];
  for (const t of list) {
    const latest = latestByThread.get(t.id);
    const msgCount = countByThread.get(t.id) ?? 0;
    const threadRawPayload =
      t.raw_payload && typeof t.raw_payload === 'object'
        ? (t.raw_payload as Record<string, unknown>)
        : {};
    const threadPreview =
      typeof threadRawPayload.last_message_preview === 'string'
        ? threadRawPayload.last_message_preview.trim()
        : '';
    const postPreview =
      typeof threadRawPayload.post_text_preview === 'string'
        ? threadRawPayload.post_text_preview.trim()
        : '';
    const postReactionCount = coerceOptionalCount(threadRawPayload.reaction_count);
    const postCommentCount = coerceOptionalCount(threadRawPayload.comment_count);
    const isPostEngagementThread =
      typeof threadRawPayload.ingested_via === 'string'
      && threadRawPayload.ingested_via === 'extension_comments';
    const actionableThreadPreview = isActionableDmPreview(threadPreview);
    const threadPreviewTime =
      typeof threadRawPayload.last_message_at === 'string'
        ? threadRawPayload.last_message_at
        : null;
    const latestMessageMs = latest ? getEffectiveMessageTimeMs(latest) : null;
    const threadPreviewMs = actionableThreadPreview ? parseMessageDateMs(threadPreviewTime) : null;
    const threadPreviewWins =
      actionableThreadPreview
      && threadPreviewMs !== null
      && (latestMessageMs === null || threadPreviewMs >= latestMessageMs);
    const effectiveMessageCount = msgCount > 0 ? msgCount : actionableThreadPreview ? 1 : postCommentCount ?? 0;
    const rawParticipantName =
      typeof threadRawPayload.participant_name === 'string'
        ? threadRawPayload.participant_name.trim()
        : '';
    const rawParticipantUsername =
      typeof threadRawPayload.participant_username === 'string'
        ? threadRawPayload.participant_username.trim()
        : '';
    const firstAuthor = firstAuthorByThread.get(t.id);
    const authorSummary = firstAuthor && firstAuthor.trim()
      ? firstAuthor
      : rawParticipantName || rawParticipantUsername || 'Unknown';
    const intel = intelByThread.get(t.id);
    const leadResult = leadScores.get(t.id);
    const leadDetected = leadResult?.lead_detected ?? intel?.lead_detected ?? false;
    const leadScore = leadResult?.thread_lead_score ?? 0;
    const classification = classificationByThread.get(t.id);
    const latestAuthorSelf = latest
      ? isAuthorSelf({
          platform: latest.platform,
          platform_message_id: latest.platform_message_id,
          direction: latest.direction,
          author_self: latest.raw_payload?.author_self as boolean | null | undefined,
          sender_self: latest.raw_payload?.sender_self as boolean | null | undefined,
          sender_username: latest.raw_payload?.sender_username as string | null | undefined,
          sender_profile_url: latest.raw_payload?.sender_profile_url as string | null | undefined,
          content: latest.content,
        })
      : false;
    const latestAuthorIsExternal = latestAuthorSelf
      ? false
      : latest?.author_id
        ? !orgAuthorIds.has(latest.author_id)
        : true;
    // D2: the latest turn is authoritative over the stored cache.
    //
    // `engagement_threads.unread_count` is a cache written at ingestion and it
    // goes stale the moment the connected account replies — nothing rewrites it
    // on an outbound turn. Preferring it whenever it was > 0 meant an answered
    // thread kept reporting unread forever, which is what made the platform
    // badge disagree with the work queue. When the latest message is ours the
    // engagement is addressed, so unread is zero regardless of what the cache
    // still says. The cache survives only where it is still the best signal:
    // a thread whose latest turn is external (or whose messages have not been
    // ingested at all, where latestAuthorIsExternal defaults to true).
    const inferredUnreadCount = !latestAuthorIsExternal
      ? 0
      : Number(t.unread_count) > 0
        ? Number(t.unread_count)
        : 1;
    const dmFallbackUnread = !latestAuthorIsExternal
      ? 0
      : inferredUnreadCount > 0
        ? inferredUnreadCount
        : inferInboundDmFallback({
            platform: latest?.platform ?? null,
            platform_message_id: latest?.platform_message_id ?? null,
            message_type: latest?.message_type ?? null,
            direction: latest?.direction ?? null,
            raw_payload: latest?.raw_payload ?? null,
            content: latest?.content ?? null,
          })
          ? 1
          : 0;

    const scored = scoreThreadPriority({
      content: latest?.content ?? '',
      sentiment_score: latest?.sentiment_score ?? null,
      negative_feedback: intel?.negative_feedback,
      lead_detected: leadDetected,
      customer_question: intel?.customer_question,
      influencer_signal: intel?.influencer_detected,
    });
    const priorityScore = scored.priority_score;
    if (filters.priority) {
      const label = priorityScore >= 50 ? 'high' : priorityScore >= 25 ? 'medium' : 'low';
      if (label !== filters.priority) continue;
    }
    results.push({
      thread_id: t.id,
      platform: t.platform,
      author_summary: authorSummary,
      message_count: effectiveMessageCount,
      latest_message: threadPreviewWins
        ? threadPreview
        : latest?.content ?? (actionableThreadPreview ? threadPreview : postPreview || null),
      latest_message_time: threadPreviewWins
        ? threadPreviewTime
        : (latest ? getEffectiveMessageTimestamp(latest) : null) ?? (actionableThreadPreview ? threadPreviewTime : null) ?? t.updated_at ?? null,
      // If the thread-list preview is fresher than our detailed rows, do not
      // expose a stale message id. The inbox route will then use raw_payload
      // last_message_self/preview metadata to classify the true latest turn.
      latest_message_id: threadPreviewWins ? null : latest?.id ?? null,
      priority_score: priorityScore,
      unread_count: dmFallbackUnread,
      dominant_intent: intel?.dominant_intent ?? null,
      lead_detected: leadDetected,
      lead_score: leadScore,
      negative_feedback: intel?.negative_feedback ?? false,
      customer_question: intel?.customer_question ?? false,
      classification_category: classification?.classification_category ?? null,
      triage_priority: classification?.triage_priority ?? null,
      sentiment: classification?.sentiment ?? null,
      assigned_to: t.assigned_to ?? null,
      assigned_at: t.assigned_at ?? null,
      assignee_name: t.assigned_to ? assigneeNameById.get(t.assigned_to) ?? null : null,
      people_reaction_eligible: isPostEngagementThread || postReactionCount !== null || postCommentCount !== null,
      post_reaction_count: postReactionCount,
      post_comment_count: postCommentCount,
      // F2: materialise the decision rather than leaving consumers to infer it
      // from unread_count. Same source as the unread derivation above, so the
      // two can never disagree about a thread.
      actionable: latestAuthorIsExternal,
    });
    // F1: the old `if (results.length >= limit) break;` lived here. Truncating
    // during the build meant the page was cut from the raw `updated_at DESC`
    // window BEFORE actionability was known and BEFORE the priority sort ran.
    // Because a company reply bumps `updated_at`, answered threads ranked first
    // and filled the page, pushing genuinely actionable work off it entirely.
    // The candidate window is already bounded by the query (`max(limit*2,300)`),
    // so building it out fully here is safe — the cut now happens after
    // filtering and sorting, below.
  }

  // F1: exclude non-actionable threads BEFORE sorting and before the page cut,
  // so the limit applies to work that still needs a response.
  const ranked = filters.actionable_only ? results.filter((r) => r.actionable) : results;

  ranked.sort((a, b) => {
    const triageA = a.triage_priority ?? 0;
    const triageB = b.triage_priority ?? 0;
    if (triageB !== triageA) return triageB - triageA;
    const scoreA = a.priority_score ?? 0;
    const scoreB = b.priority_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const atA = a.latest_message_time ?? '';
    const atB = b.latest_message_time ?? '';
    return atB.localeCompare(atA);
  });

  // The page cut is now the LAST step, applied to the sorted actionable
  // population. Sort semantics (triage → priority → recency) are unchanged.
  return ranked.slice(0, limit);
}

/**
 * F5: canonical actionability lookup for an explicit set of threads.
 *
 * This is the ONLY entry point the AI layer may use to answer "does this thread
 * still need a response?". It deliberately delegates to `getThreads` rather than
 * re-querying, so the answer is produced by the same latest-turn ownership
 * derivation the Work Queue, Inbox and badge counts already consume. There is
 * no AI-specific ownership predicate anywhere in the codebase, by construction.
 *
 * Fail-closed: a thread id that resolves to no row — wrong company, deleted, or
 * never ingested — is reported as NOT actionable. For a read-only suggestion
 * that costs the user a refusal; for a send it prevents acting on a thread whose
 * state we cannot establish. Both are the safe direction.
 */
export async function getThreadActionability(
  organizationId: string,
  threadIds: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const ids = Array.from(
    new Set(
      (threadIds ?? [])
        .map((id) => (id ?? '').toString().trim())
        .filter((id) => id.length > 0),
    ),
  );
  if (!organizationId || ids.length === 0) return result;

  for (const id of ids) result.set(id, false);

  // `exclude_ignored` is deliberately NOT set: an ignored thread is a triage
  // decision, not an ownership fact, and filtering it here would silently
  // change the answer to a different question than the one being asked.
  const threads = await getThreads({
    organization_id: organizationId,
    platform: null,
    thread_ids: ids,
    limit: Math.max(1, ids.length),
  });

  for (const t of threads) {
    if (result.has(t.thread_id)) result.set(t.thread_id, t.actionable === true);
  }
  return result;
}

/**
 * Single-thread convenience over {@link getThreadActionability}. Same
 * fail-closed contract.
 */
export async function isThreadActionable(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  const map = await getThreadActionability(organizationId, [threadId]);
  return map.get((threadId ?? '').toString().trim()) === true;
}
