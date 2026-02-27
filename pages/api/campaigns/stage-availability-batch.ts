import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';

/**
 * GET /api/campaigns/stage-availability-batch?campaignIds=id1,id2,id3
 * Returns stage availability for multiple campaigns.
 * Used by dashboard to show stage cards without N individual requests.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { campaignIds } = req.query;
  if (!campaignIds || typeof campaignIds !== 'string') {
    return res.status(400).json({ error: 'campaignIds query param required (comma-separated)' });
  }

  const ids = campaignIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    return res.status(200).json({ availability: {} });
  }

  // Limit to avoid abuse
  const limitedIds = ids.slice(0, 50);

  try {
    const availability: Record<string, {
      stages: Record<string, boolean>;
      counts: Record<string, number>;
    }> = {};

    for (const campaignId of limitedIds) {
      try {
        const blueprint = await getUnifiedCampaignBlueprint(campaignId);
        const has12WeekPlan = !!(blueprint?.weeks?.length);

        const { count: weekPlansCount } = await supabase
          .from('weekly_content_refinements')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId);
        const hasDetailedWeekPlans = (weekPlansCount ?? 0) > 0;

        const { count: aiEnrichedCount } = await supabase
          .from('weekly_content_refinements')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('ai_enhancement_applied', true);
        const hasAiEnrichedWeeks = (aiEnrichedCount ?? 0) > 0;

        const { count: dailyPlansCount } = await supabase
          .from('daily_content_plans')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId);
        const hasDailyPlans = (dailyPlansCount ?? 0) > 0;
        let contentReadyDailyPlansCount = 0;
        try {
          const { count: readyCount } = await supabase
            .from('daily_content_plans')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .not('content', 'is', null);
          contentReadyDailyPlansCount = readyCount ?? 0;
        } catch { /* ignore */ }

        let hasCharting = false;
        let scheduledPostsCount = 0;
        let publishedPostsCount = 0;
        try {
          const { count: p } = await supabase
            .from('platform_execution_plans')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId);
          hasCharting = (p ?? 0) > 0;
        } catch { /* ignore */ }
        try {
          const { count: s } = await supabase
            .from('scheduled_posts')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId);
          scheduledPostsCount = s ?? 0;
          const { count: publishedCount } = await supabase
            .from('scheduled_posts')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('status', 'published');
          publishedPostsCount = publishedCount ?? 0;
        } catch { /* ignore */ }

        availability[campaignId] = {
          stages: {
            twelveWeekPlan: has12WeekPlan,
            detailedWeekPlans: hasDetailedWeekPlans,
            aiEnrichedWeeks: hasAiEnrichedWeeks,
            dailyPlans: hasDailyPlans,
            charting: hasCharting,
            schedule: scheduledPostsCount > 0,
          },
          counts: {
            weekPlans: weekPlansCount ?? 0,
            aiEnrichedWeeks: aiEnrichedCount ?? 0,
            dailyPlans: dailyPlansCount ?? 0,
            contentReadyDailyPlans: contentReadyDailyPlansCount,
            scheduledPosts: scheduledPostsCount,
            publishedPosts: publishedPostsCount,
          },
        };
      } catch (e) {
        console.warn(`stage-availability for ${campaignId}:`, e);
        availability[campaignId] = { stages: {}, counts: {} };
      }
    }

    return res.status(200).json({ availability });
  } catch (error) {
    console.error('stage-availability-batch error:', error);
    return res.status(500).json({
      error: 'Failed to load stage availability',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
