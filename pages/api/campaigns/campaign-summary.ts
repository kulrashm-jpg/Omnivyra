import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // Get campaign summary data
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError) {
      console.log('Campaign not found, returning fallback summary');
      return res.status(200).json({
        campaign: {
          id: campaignId,
          name: 'Campaign ' + campaignId,
          status: 'planning',
          totalGoals: 0,
          contentTypes: 0,
          platforms: 0,
          totalContent: 0
        }
      });
    }

    // Count goals
    const { count: goalsCount } = await supabase
      .from('campaign_goals')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    // Count weekly plans
    const { count: weeklyCount } = await supabase
      .from('weekly_content_refinements')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    // Count daily plans
    const { count: dailyCount } = await supabase
      .from('daily_content_plans')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    return res.status(200).json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalGoals: goalsCount || 0,
        contentTypes: weeklyCount || 0,
        platforms: dailyCount || 0,
        totalContent: (weeklyCount || 0) + (dailyCount || 0)
      }
    });

  } catch (error) {
    console.error('Error in campaign-summary API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
