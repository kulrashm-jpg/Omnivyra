import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // Get campaign data
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    // Get weekly refinements
    const { data: weeklyRefinements, error: refinementsError } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    // Get content plans
    const { data: contentPlans, error: contentPlansError } = await supabase
      .from('content_plans')
      .select('*')
      .eq('campaign_id', campaignId);

    // Get daily plans
    const { data: dailyPlans, error: dailyPlansError } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId);

    res.status(200).json({
      success: true,
      data: {
        campaign: campaign || null,
        campaignError: campaignError?.message || null,
        weeklyRefinements: weeklyRefinements || [],
        refinementsError: refinementsError?.message || null,
        contentPlans: contentPlans || [],
        contentPlansError: contentPlansError?.message || null,
        dailyPlans: dailyPlans || [],
        dailyPlansError: dailyPlansError?.message || null,
        summary: {
          campaignExists: !!campaign,
          weeklyRefinementsCount: weeklyRefinements?.length || 0,
          contentPlansCount: contentPlans?.length || 0,
          dailyPlansCount: dailyPlans?.length || 0
        }
      }
    });

  } catch (error) {
    console.error('Error in debug-campaign API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}





