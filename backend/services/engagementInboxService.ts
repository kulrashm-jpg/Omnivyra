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

export async function getPlatformCounts(organizationId: string): Promise<PlatformCounts> {
  if (!organizationId) return {} as PlatformCounts;

  const { data, error } = await supabase
    .from('engagement_threads')
    .select('platform, priority_score, unread_count')
    .eq('organization_id', organizationId)
    .eq('ignored', false);

  if (error) {
    console.warn('[engagementInboxService] getPlatformCounts error', error.message);
    return {} as PlatformCounts;
  }

  const result: PlatformCounts = {};
  for (const p of PLATFORMS) {
    result[p] = {
      thread_count: 0,
      unread_count: 0,
      max_priority_tier: 'low',
    };
  }

  for (const r of data ?? []) {
    const platform = (r as { platform: string }).platform?.toLowerCase() ?? '';
    if (!result[platform]) result[platform] = { thread_count: 0, unread_count: 0, max_priority_tier: 'low' };
    result[platform].thread_count += 1;
    result[platform].unread_count += Number((r as { unread_count?: number }).unread_count ?? 0) || 0;
    const score = Number((r as { priority_score?: number }).priority_score) ?? 0;
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
