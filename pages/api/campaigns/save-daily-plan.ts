import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, dailyPlan } = req.body;

    if (!campaignId || !dailyPlan) {
      return res.status(400).json({ error: 'Campaign ID and daily plan are required' });
    }

    // Save daily plan
    const { data: planData, error: planError } = await supabase
      .from('daily_content_plans')
      .upsert({
        campaign_id: campaignId,
        week_number: dailyPlan.weekNumber,
        day_of_week: dailyPlan.dayOfWeek,
        date: dailyPlan.date,
        platform: dailyPlan.platform,
        content_type: dailyPlan.contentType,
        title: dailyPlan.title,
        content: dailyPlan.content,
        description: dailyPlan.description,
        media_requirements: dailyPlan.mediaRequirements,
        hashtags: dailyPlan.hashtags,
        call_to_action: dailyPlan.callToAction,
        optimal_posting_time: dailyPlan.optimalPostingTime,
        target_metrics: dailyPlan.targetMetrics,
        status: dailyPlan.status,
        priority: dailyPlan.priority,
        ai_generated: dailyPlan.aiGenerated || false,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (planError) {
      console.error('Error saving daily plan:', planError);
      return res.status(500).json({ error: 'Failed to save daily plan' });
    }

    res.status(200).json({
      success: true,
      message: 'Daily plan saved successfully',
      data: planData
    });

  } catch (error) {
    console.error('Error in save-daily-plan API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



