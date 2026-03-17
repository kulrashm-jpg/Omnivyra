import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../../backend/services/campaignBlueprintService';

/**
 * GET /api/campaigns/[id]/stage-availability?companyId=...
 * Returns which planning stages have data for this campaign.
 * Used by dashboard to show View/Edit cards only for available stages.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  try {
    const campaignId = id;

    // 1. 12 Week Plan (blueprint in twelve_week_plan)
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    const has12WeekPlan = !!(blueprint?.weeks?.length);

    // 2. Detailed Week Plans (weekly_content_refinements - at least one row)
    const { count: weekPlansCount } = await supabase
      .from('weekly_content_refinements')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);
    const hasDetailedWeekPlans = (weekPlansCount ?? 0) > 0;

    // 3. AI-Enriched Week Plans (weekly_content_refinements with ai_enhancement_applied)
    const { count: aiEnrichedCount } = await supabase
      .from('weekly_content_refinements')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('ai_enhancement_applied', true);
    const hasAiEnrichedWeeks = (aiEnrichedCount ?? 0) > 0;

    // 4. Daily Plans (daily_content_plans)
    const { count: dailyPlansCount } = await supabase
      .from('daily_content_plans')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);
    const hasDailyPlans = (dailyPlansCount ?? 0) > 0;

    // 5. Schedule (scheduled posts)
    let scheduledPostsCount = 0;
    try {
      const { count } = await supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId);
      scheduledPostsCount = count ?? 0;
    } catch {
      // Table may not exist
    }
    const hasSchedule = scheduledPostsCount > 0;

    return res.status(200).json({
      campaignId,
      stages: {
        twelveWeekPlan: has12WeekPlan,
        detailedWeekPlans: hasDetailedWeekPlans,
        aiEnrichedWeeks: hasAiEnrichedWeeks,
        dailyPlans: hasDailyPlans,
        schedule: hasSchedule,
      },
      counts: {
        weekPlans: weekPlansCount ?? 0,
        aiEnrichedWeeks: aiEnrichedCount ?? 0,
        dailyPlans: dailyPlansCount ?? 0,
        scheduledPosts: scheduledPostsCount,
      },
    });
  } catch (error) {
    console.error('stage-availability error:', error);
    return res.status(500).json({
      error: 'Failed to load stage availability',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
