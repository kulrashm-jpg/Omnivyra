import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all campaigns with simplified fields
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select(`
        id,
        name,
        description,
        status,
        current_stage,
        timeframe,
        start_date,
        end_date,
        created_at,
        updated_at,
        weekly_themes
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching campaigns:', error);
      return res.status(500).json({ error: 'Failed to fetch campaigns', details: error });
    }

    // Add simple stats for each campaign
    const campaignsWithCounts = campaigns.map((campaign) => ({
      ...campaign,
      name: campaign.name || `Campaign ${campaign.id.substring(0, 8)}`, // Fallback for missing names
      stats: {
        goals: 0,
        weeklyPlans: campaign.weekly_themes ? campaign.weekly_themes.length : 0,
        dailyPlans: 0,
        totalContent: campaign.weekly_themes ? campaign.weekly_themes.length : 0
      }
    }));

    return res.status(200).json({
      success: true,
      campaigns: campaignsWithCounts,
      total: campaignsWithCounts.length
    });

  } catch (error) {
    console.error('Error in campaigns list API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
