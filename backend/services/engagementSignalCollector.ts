/**
 * Engagement Signal Collector
 * Collects engagement signals (comments, replies, mentions, etc.) from campaign activities.
 * Inserts into campaign_activity_engagement_signals.
 * Rate-limited per platform.
 */

import { supabase } from '../db/supabaseClient';
import { checkRateLimit } from '../utils/rateLimiter';

export type SignalType =
  | 'comment'
  | 'reply'
  | 'mention'
  | 'quote'
  | 'discussion'
  | 'buyer_intent_signal';

export interface EngagementSignalInsert {
  campaign_id: string;
  activity_id: string;
  platform: string;
  source_type: string;
  source_id?: string | null;
  conversation_url?: string | null;
  author?: string | null;
  content?: string | null;
  signal_type: SignalType;
  engagement_score: number;
  organization_id?: string | null;
}

async function resolveActivityToExternalPost(activityId: string): Promise<{
  campaign_id: string;
  external_post_id: string;
  platform: string;
  organization_id?: string | null;
} | null> {
  const { data: plan } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, platform, external_post_id, scheduled_post_id')
    .or(`id.eq.${activityId},execution_id.eq.${activityId}`)
    .limit(1)
    .maybeSingle();

  if (!plan?.campaign_id) return null;

  let platformPostId = (plan as { external_post_id?: string }).external_post_id;
  if (!platformPostId && (plan as { scheduled_post_id?: string }).scheduled_post_id) {
    const { data: sp } = await supabase
      .from('scheduled_posts')
      .select('platform_post_id')
      .eq('id', (plan as { scheduled_post_id: string }).scheduled_post_id)
      .maybeSingle();
    platformPostId = (sp as { platform_post_id?: string })?.platform_post_id;
  }

  if (!platformPostId) return null;

  return {
    campaign_id: (plan as { campaign_id: string }).campaign_id,
    external_post_id: String(platformPostId),
    platform: String((plan as { platform?: string }).platform || 'linkedin').toLowerCase(),
    organization_id: null,
  };
}

async function insertSignals(signals: EngagementSignalInsert[]): Promise<void> {
  if (signals.length === 0) return;
  for (const s of signals) {
    const row = {
      campaign_id: s.campaign_id,
      activity_id: s.activity_id,
      platform: s.platform,
      source_type: s.source_type,
      source_id: s.source_id ?? null,
      conversation_url: s.conversation_url ?? null,
      author: s.author ?? null,
      content: s.content ?? null,
      signal_type: s.signal_type,
      engagement_score: s.engagement_score,
      organization_id: s.organization_id ?? null,
    };
    const { error } = await supabase.from('campaign_activity_engagement_signals').insert(row);
    if (error && error.code !== '23505') {
      console.warn('[engagementSignalCollector] insert:', error.message);
    }
  }
}

/**
 * Collect LinkedIn signals for an activity.
 */
export async function collectLinkedInSignals(activityId: string): Promise<number> {
  const ctx = await resolveActivityToExternalPost(activityId);
  if (!ctx) return 0;

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, platform, source_id, platform_thread_id')
    .eq('platform', 'linkedin')
    .or(`source_id.ilike.%${ctx.external_post_id}%,source_id.eq.${ctx.external_post_id}`);

  if (!threads?.length) return 0;

  const threadIds = threads.map((t: { id: string }) => t.id);
  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform_created_at')
    .in('thread_id', threadIds)
    .order('platform_created_at', { ascending: false });

  const signals: EngagementSignalInsert[] = [];
  const seen = new Set<string>();
  for (const m of messages ?? []) {
    const key = `${(m as { thread_id: string }).thread_id}-${(m as { id: string }).id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({
      campaign_id: ctx.campaign_id,
      activity_id: activityId,
      platform: 'linkedin',
      source_type: 'engagement_message',
      source_id: (m as { id: string }).id,
      content: (m as { content?: string }).content ?? null,
      author: null,
      signal_type: 'reply',
      engagement_score: 0.5,
      organization_id: ctx.organization_id,
    });
  }
  await insertSignals(signals);
  return signals.length;
}

/**
 * Collect Twitter/X signals for an activity.
 */
export async function collectTwitterSignals(activityId: string): Promise<number> {
  if (!(await checkRateLimit('twitter'))) return 0;
  const ctx = await resolveActivityToExternalPost(activityId);
  if (!ctx) return 0;

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, platform, source_id')
    .in('platform', ['twitter', 'x'])
    .or(`source_id.ilike.%${ctx.external_post_id}%,source_id.eq.${ctx.external_post_id}`);

  if (!threads?.length) return 0;

  const threadIds = threads.map((t: { id: string }) => t.id);
  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds);

  const signals: EngagementSignalInsert[] = (messages ?? []).map((m) => ({
    campaign_id: ctx.campaign_id,
    activity_id: activityId,
    platform: 'twitter',
    source_type: 'engagement_message',
    source_id: (m as { id: string }).id,
    content: (m as { content?: string }).content ?? null,
    signal_type: 'reply' as SignalType,
    engagement_score: 0.5,
  }));
  await insertSignals(signals);
  return signals.length;
}

/**
 * Collect community platform signals (Discord, Slack, Reddit, GitHub).
 */
export async function collectCommunitySignals(activityId: string): Promise<number> {
  const ctx = await resolveActivityToExternalPost(activityId);
  if (!ctx) return 0;

  const platforms = ['discord', 'slack', 'reddit', 'github'];
  let total = 0;

  for (const platform of platforms) {
    if (!(await checkRateLimit(platform))) continue;
    const { data: threads } = await supabase
      .from('engagement_threads')
      .select('id, source_id')
      .eq('platform', platform)
      .or(`source_id.ilike.%${ctx.external_post_id}%,source_id.eq.${ctx.external_post_id}`);

    if (!threads?.length) continue;

    const threadIds = threads.map((t: { id: string }) => t.id);
    const { data: messages } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, content')
      .in('thread_id', threadIds);

    const signals: EngagementSignalInsert[] = (messages ?? []).map((m) => ({
      campaign_id: ctx.campaign_id,
      activity_id: activityId,
      platform,
      source_type: 'engagement_message',
      source_id: (m as { id: string }).id,
      content: (m as { content?: string }).content ?? null,
      signal_type: 'discussion' as SignalType,
      engagement_score: 0.5,
    }));
    await insertSignals(signals);
    total += signals.length;
  }
  return total;
}
