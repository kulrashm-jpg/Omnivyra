import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weeklyPlan } = req.body;

    if (!campaignId || !weeklyPlan) {
      return res.status(400).json({ error: 'Campaign ID and weekly plan are required' });
    }

    // Save weekly plan
    const { data: planData, error: planError } = await supabase
      .from('weekly_content_plans')
      .upsert({
        campaign_id: campaignId,
        week_number: weeklyPlan.weekNumber,
        phase: weeklyPlan.phase,
        theme: weeklyPlan.theme,
        focus_area: weeklyPlan.focusArea,
        key_messaging: weeklyPlan.keyMessaging,
        content_types: weeklyPlan.contentTypes,
        platform_strategy: weeklyPlan.platformStrategy,
        call_to_action: weeklyPlan.callToAction,
        target_metrics: weeklyPlan.targetMetrics,
        content_guidelines: weeklyPlan.contentGuidelines,
        hashtag_suggestions: weeklyPlan.hashtagSuggestions,
        status: weeklyPlan.status,
        completion_percentage: weeklyPlan.completionPercentage,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (planError) {
      console.error('Error saving weekly plan:', planError);
      return res.status(500).json({ error: 'Failed to save weekly plan' });
    }

    res.status(200).json({
      success: true,
      message: 'Weekly plan saved successfully',
      data: planData
    });

  } catch (error) {
    console.error('Error in save-weekly-plan API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
