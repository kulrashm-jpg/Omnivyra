/**
 * Engagement Inbox Service
 * Platform counts, threads by platform, thread detail.
 */

import { supabase } from '../db/supabaseClient';
import { getThreads } from './engagementThreadService';

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'reddit'];

export type PlatformCounts = Record<
  string,
  { thread_count: number; unread_count: number; max_priority_tier: 'high' | 'medium' | 'low' }
>;

/**
 * D2: badge counts are derived, never summed from the cache.
 *
 * This previously read `engagement_threads.unread_count` straight off the table
 * and summed it. That column is an ingestion-time cache with no outbound
 * rewrite, so after the connected account replied the badge still showed unread
 * while the work queue correctly showed zero — two surfaces disagreeing about
 * the same thread.
 *
 * Counts now come from `getThreads`, which resolves ownership through the one
 * authoritative predicate (`isAuthorSelf` → author_id ↔ connected-account map →
 * unresolved ⇒ external) and returns an unread value already zeroed when the
 * latest turn is ours. No second ownership predicate, no schema change, no
 * client-side correction.
 */
export async function getPlatformCounts(organizationId: string): Promise<PlatformCounts> {
  if (!organizationId) return {} as PlatformCounts;

  const result: PlatformCounts = {};
  for (const p of PLATFORMS) {
    result[p] = {
      thread_count: 0,
      unread_count: 0,
      max_priority_tier: 'low',
    };
  }

  let threads: Awaited<ReturnType<typeof getThreads>>;
  try {
    // Platform-agnostic: one pass, then bucket. `exclude_ignored` mirrors the
    // previous `.eq('ignored', false)` scope so the thread_count denominator is
    // unchanged by this fix.
    threads = await getThreads({
      organization_id: organizationId,
      platform: null,
      limit: 500,
      exclude_ignored: true,
    });
  } catch (error) {
    console.warn(
      '[engagementInboxService] getPlatformCounts error',
      error instanceof Error ? error.message : String(error),
    );
    return {} as PlatformCounts;
  }

  for (const t of threads) {
    const platform = (t.platform ?? '').toLowerCase();
    if (!result[platform]) result[platform] = { thread_count: 0, unread_count: 0, max_priority_tier: 'low' };
    // thread_count remains every non-ignored thread (unchanged denominator).
    result[platform].thread_count += 1;
    // F2: unread is contributed only by threads that are actually actionable.
    // `getThreads` already zeroes unread on an answered thread, so this is
    // belt-and-braces against the two ever drifting apart — the badge reads the
    // canonical `actionable` flag rather than trusting a number.
    result[platform].unread_count += t.actionable ? Number(t.unread_count ?? 0) || 0 : 0;
    const score = Number(t.priority_score ?? 0) || 0;
    const tier = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    const cur = result[platform].max_priority_tier;
    if (tier === 'high') result[platform].max_priority_tier = 'high';
    else if (tier === 'medium' && cur !== 'high') result[platform].max_priority_tier = 'medium';
  }

  return result;
}

export type InboxThread = {
  thread_id: string;
  author: string;
  latest_message: string | null;
  platform: string;
  priority_score: number;
  lead_indicator: boolean;
  opportunity_indicator: boolean;
  classification_category?: string | null;
  triage_priority?: number | null;
  sentiment?: string | null;
};

export async function getThreadsByPlatform(
  organizationId: string,
  platform: string
): Promise<InboxThread[]> {
  const threads = await getThreads({
    organization_id: organizationId,
    platform: platform || null,
    limit: 50,
    exclude_ignored: true,
  });

  const threadIds = threads.map((t) => t.thread_id);
  let opportunityByThread = new Set<string>();
  if (threadIds.length > 0) {
    const { data: opps } = await supabase
      .from('engagement_opportunities')
      .select('source_thread_id')
      .in('source_thread_id', threadIds)
      .eq('resolved', false);
    (opps ?? []).forEach((o: { source_thread_id: string }) => opportunityByThread.add(o.source_thread_id));
  }

  return threads.map((t) => ({
    thread_id: t.thread_id,
    author: t.author_summary ?? 'Unknown',
    latest_message: t.latest_message ?? null,
    platform: t.platform,
    priority_score: t.priority_score ?? 0,
    lead_indicator: t.lead_detected ?? false,
    opportunity_indicator: opportunityByThread.has(t.thread_id),
    classification_category: t.classification_category ?? null,
    triage_priority: t.triage_priority ?? null,
    sentiment: t.sentiment ?? null,
  }));
}

export async function getThreadDetail(threadId: string): Promise<{
  thread_id: string;
  platform: string;
  organization_id: string | null;
  author: string | null;
} | null> {
  if (!threadId) return null;

  const { data, error } = await supabase
    .from('engagement_threads')
    .select('id, platform, organization_id')
    .eq('id', threadId)
    .maybeSingle();

  if (error || !data) return null;

  const thread = data as { id: string; platform: string; organization_id: string | null };
  let author: string | null = null;

  const { data: firstMsg } = await supabase
    .from('engagement_messages')
    .select('author_id')
    .eq('thread_id', threadId)
    .order('platform_created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstMsg?.author_id) {
    const { data: auth } = await supabase
      .from('engagement_authors')
      .select('display_name, username')
      .eq('id', (firstMsg as { author_id: string }).author_id)
      .maybeSingle();
    author = (auth as { display_name?: string; username?: string })?.display_name ??
      (auth as { display_name?: string; username?: string })?.username ??
      null;
  }

  return {
    thread_id: thread.id,
    platform: thread.platform,
    organization_id: thread.organization_id,
    author,
  };
}
