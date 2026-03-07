/**
 * Performance Ingestion Job
 * Campaign Learning Layer: fetches analytics from content_analytics (and optionally social APIs)
 * and normalizes into campaign_performance_signals.
 * Runs every 6 hours. Idempotent.
 */

import { supabase } from '../db/supabaseClient';
import { invalidateStrategyProfileCache } from '../services/strategyProfileCache';

const LOOKBACK_DAYS = 30;
const BATCH_SIZE = 200;

export type PerformanceIngestionResult = {
  signalsInserted: number;
  postsProcessed: number;
  errors: string[];
};

/**
 * Ingest performance metrics from content_analytics into campaign_performance_signals.
 * Joins scheduled_posts, campaigns, and daily_content_plans to resolve company, theme, week, content_slot_id.
 * content_analytics uses `date` column (not analytics_date).
 */
export async function runPerformanceIngestion(): Promise<PerformanceIngestionResult> {
  const errors: string[] = [];
  let signalsInserted = 0;
  let postsProcessed = 0;

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString().split('T')[0];

  try {
    const { data: analytics, error: analyticsError } = await supabase
      .from('content_analytics')
      .select(`
        scheduled_post_id,
        user_id,
        platform,
        date,
        views,
        likes,
        shares,
        comments,
        saves,
        retweets,
        quotes,
        reactions,
        impressions,
        reach,
        engagement_rate
      `)
      .gte('date', sinceStr)
      .order('date', { ascending: false })
      .limit(BATCH_SIZE);

    if (analyticsError) {
      errors.push(`content_analytics query failed: ${analyticsError.message}`);
      return { signalsInserted: 0, postsProcessed: 0, errors };
    }

    if (!analytics?.length) {
      return { signalsInserted: 0, postsProcessed: 0, errors: [] };
    }

    const postIds = [...new Set(analytics.map((r: { scheduled_post_id?: string }) => r.scheduled_post_id).filter(Boolean))] as string[];

    const { data: posts, error: postsError } = await supabase
      .from('scheduled_posts')
      .select('id, campaign_id, platform, content_type, user_id')
      .in('id', postIds)
      .eq('status', 'published');

    if (postsError || !posts?.length) {
      return { signalsInserted: 0, postsProcessed: 0, errors: postsError ? [postsError.message] : [] };
    }

    const campaignIds = [...new Set(posts.map((p: { campaign_id?: string }) => p.campaign_id).filter(Boolean))] as string[];
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .in('id', campaignIds);

    const campaignToCompany = new Map<string, string>();
    (campaigns || []).forEach((c: { id: string; company_id?: string }) => {
      if (c.company_id) campaignToCompany.set(c.id, String(c.company_id));
    });

    const { data: dailyPlans } = await supabase
      .from('daily_content_plans')
      .select('id, scheduled_post_id, topic, week_number, campaign_id')
      .in('scheduled_post_id', postIds)
      .not('scheduled_post_id', 'is', null);

    const planByPost = new Map<string, { topic: string; week_number: number; content_slot_id: string; theme_index?: number }>();
    const themeIndexByCampaignWeek = new Map<string, Map<string, number>>();
    (dailyPlans || []).forEach((p: { id: string; scheduled_post_id?: string; topic?: string; week_number?: number }) => {
      if (p.scheduled_post_id) {
        const topic = String(p.topic || '').trim();
        const weekNum = Number(p.week_number) || 0;
        const campaignId = (p as { campaign_id?: string }).campaign_id;
        let themeIdx: number | undefined;
        if (campaignId && topic) {
          const key = `${campaignId}::${weekNum}`;
          let seen = themeIndexByCampaignWeek.get(key);
          if (!seen) {
            seen = new Map<string, number>();
            themeIndexByCampaignWeek.set(key, seen);
          }
          if (!seen.has(topic)) seen.set(topic, seen.size);
          themeIdx = seen.get(topic);
        }
        planByPost.set(p.scheduled_post_id, {
          topic: topic || '',
          week_number: weekNum,
          content_slot_id: p.id,
          theme_index: themeIdx,
        });
      }
    });

    const postById = new Map<string, { campaign_id?: string; platform?: string; content_type?: string }>();
    posts.forEach((p: { id: string; campaign_id?: string; platform?: string; content_type?: string }) => postById.set(p.id, p));

    const aggregatedByPost = new Map<
      string,
      { impressions: number; engagement: number; clicks: number; shares: number; comments: number; conversions: number }
    >();

    for (const row of analytics as Array<Record<string, unknown>>) {
      const pid = row.scheduled_post_id as string;
      if (!pid || !postById.has(pid)) continue;

      const curr = aggregatedByPost.get(pid) ?? {
        impressions: 0,
        engagement: 0,
        clicks: 0,
        shares: 0,
        comments: 0,
        conversions: 0,
      };

      curr.impressions += Number(row.impressions ?? row.views ?? 0) || 0;
      curr.shares += Number(row.shares ?? 0) || 0;
      curr.comments += Number(row.comments ?? 0) || 0;
      curr.engagement +=
        Number(row.likes ?? 0) +
        Number(row.comments ?? 0) +
        Number(row.shares ?? 0) +
        Number(row.saves ?? 0) +
        Number(row.retweets ?? 0) +
        Number(row.reactions ?? 0) ||
        0;

      aggregatedByPost.set(pid, curr);
    }

    const toInsert: Array<Record<string, unknown>> = [];

    for (const [postId, agg] of aggregatedByPost) {
      const post = postById.get(postId);
      if (!post?.campaign_id) continue;

      const companyId = campaignToCompany.get(post.campaign_id);
      if (!companyId) continue;

      const plan = planByPost.get(postId);
      const theme = plan?.topic || null;
      const weekNumber = plan?.week_number ?? null;
      const themeIndex = plan?.theme_index ?? null;
      const contentSlotId = plan?.content_slot_id ?? null;

      toInsert.push({
        company_id: companyId,
        campaign_id: post.campaign_id,
        theme,
        platform: (post.platform || '').toLowerCase().replace(/^twitter$/i, 'x'),
        content_type: (post.content_type || 'post').toLowerCase(),
        post_id: String(postId),
        impressions: agg.impressions,
        engagement: agg.engagement,
        clicks: agg.clicks,
        shares: agg.shares,
        comments: agg.comments,
        conversions: agg.conversions,
        week_number: weekNumber,
        theme_index: themeIndex,
        content_slot_id: contentSlotId,
      });
    }

    if (toInsert.length === 0) {
      return { signalsInserted: 0, postsProcessed: postIds.length, errors };
    }

    const postIdsToReplace = toInsert.map((r) => r.post_id).filter(Boolean) as string[];
    await supabase
      .from('campaign_performance_signals')
      .delete()
      .in('post_id', postIdsToReplace);

    const { error: insertError } = await supabase
      .from('campaign_performance_signals')
      .insert(toInsert);

    if (insertError) {
      errors.push(`insert failed: ${insertError.message}`);
      return { signalsInserted: 0, postsProcessed: postIds.length, errors };
    }

    signalsInserted = toInsert.length;
    postsProcessed = postIds.length;

    const affectedCompanyIds = [...new Set(toInsert.map((r) => r.company_id as string).filter(Boolean))];
    for (const companyId of affectedCompanyIds) {
      invalidateStrategyProfileCache(companyId);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { signalsInserted, postsProcessed, errors };
}
