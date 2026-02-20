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

    // Transform the data to match the expected format (include all fields for day detail modal)
    const transformedPlans = dailyPlans?.map(plan => ({
      id: plan.id,
      weekNumber: plan.week_number,
      dayOfWeek: plan.day_of_week,
      platform: plan.platform,
      contentType: plan.content_type,
      title: plan.title,
      content: plan.content,
      description: plan.description,
      topic: plan.topic,
      introObjective: plan.intro_objective,
      summary: plan.summary,
      objective: plan.objective,
      keyPoints: (() => {
        const k = plan.key_points ?? plan.main_points;
        if (Array.isArray(k)) return k;
        if (typeof k === 'string') { try { const p = JSON.parse(k); return Array.isArray(p) ? p : []; } catch { return []; } }
        return [];
      })(),
      cta: plan.cta,
      brandVoice: plan.brand_voice,
      themeLinkage: plan.theme_linkage,
      formatNotes: plan.format_notes,
      weekTheme: plan.week_theme,
      campaignTheme: plan.campaign_theme,
      hashtags: plan.hashtags || [],
      scheduledTime: plan.scheduled_time || plan.optimal_posting_time,
      status: plan.status || 'planned'
    })) || [];

    res.status(200).json(transformedPlans);

  } catch (error) {
    console.error('Error in daily plans API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}