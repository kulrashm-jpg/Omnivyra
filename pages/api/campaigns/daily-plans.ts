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

    // Get daily plans for the campaign
    const { data: dailyPlans, error } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true })
      .order('day_of_week', { ascending: true });

    if (error) {
      console.error('Error fetching daily plans:', error);
      return res.status(500).json({ error: 'Failed to fetch daily plans' });
    }

    // Transform the data to match the expected format
    const transformedPlans = dailyPlans?.map(plan => ({
      id: plan.id,
      weekNumber: plan.week_number,
      dayOfWeek: plan.day_of_week,
      platform: plan.platform,
      contentType: plan.content_type,
      title: plan.title,
      content: plan.content,
      hashtags: plan.hashtags || [],
      status: plan.status || 'planned'
    })) || [];

    res.status(200).json(transformedPlans);

  } catch (error) {
    console.error('Error in daily plans API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}