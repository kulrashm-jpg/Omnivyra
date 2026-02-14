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

    let weeklyPlans: any[] | null = null;
    let weeklyError: any = null;

    const { data: plans, error } = await supabase
      .from('weekly_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    if (error) {
      weeklyError = error;
      const { data: refinements, error: refError } = await supabase
        .from('weekly_content_refinements')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('week_number');
      weeklyPlans = refError ? [] : (refinements || []);
    } else {
      weeklyPlans = plans || [];
    }

    if (weeklyError && !weeklyPlans) {
      console.error('Error fetching weekly plans:', weeklyError);
      return res.status(500).json({ error: 'Failed to fetch weekly plans' });
    }

    const source = weeklyPlans || [];

    // Format response (supports both weekly_content_plans and weekly_content_refinements schemas)
    const response = source.map(plan => ({
      weekNumber: plan.week_number,
      phase: plan.phase ?? null,
      theme: plan.theme ?? plan.focus_area ?? null,
      focusArea: plan.focus_area ?? plan.theme ?? null,
      keyMessaging: plan.key_messaging ?? null,
      contentTypes: plan.content_types ?? [],
      platformStrategy: plan.platform_strategy ?? null,
      callToAction: plan.call_to_action ?? null,
      targetMetrics: plan.target_metrics ?? null,
      contentGuidelines: plan.content_guidelines ?? null,
      hashtagSuggestions: plan.hashtag_suggestions ?? [],
      status: plan.status ?? plan.refinement_status ?? 'planned',
      completionPercentage: plan.completion_percentage ?? 0,
    }));

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in get-weekly-plans API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



