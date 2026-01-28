import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // Get weekly plans
    const { data: weeklyPlans, error: weeklyError } = await supabase
      .from('weekly_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    if (weeklyError) {
      console.error('Error fetching weekly plans:', weeklyError);
      return res.status(500).json({ error: 'Failed to fetch weekly plans' });
    }

    // Format response
    const response = weeklyPlans?.map(plan => ({
      weekNumber: plan.week_number,
      phase: plan.phase,
      theme: plan.theme,
      focusArea: plan.focus_area,
      keyMessaging: plan.key_messaging,
      contentTypes: plan.content_types,
      platformStrategy: plan.platform_strategy,
      callToAction: plan.call_to_action,
      targetMetrics: plan.target_metrics,
      contentGuidelines: plan.content_guidelines,
      hashtagSuggestions: plan.hashtag_suggestions,
      status: plan.status,
      completionPercentage: plan.completion_percentage
    })) || [];

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in get-weekly-plans API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



