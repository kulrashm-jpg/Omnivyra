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

    // Get performance data for the campaign
    const { data: performance, error } = await supabase
      .from('campaign_performance')
      .select('*')
      .eq('campaign_id', campaignId);

    if (error) {
      console.log('No performance data found, returning default metrics');
      return res.status(200).json({
        metrics: {
          reach: 0,
          engagement: 0,
          conversions: 0,
          impressions: 0,
          clicks: 0,
          shares: 0
        },
        timeline: [],
        achievements: []
      });
    }

    // Calculate totals
    const totals = performance.reduce((acc, record) => ({
      reach: acc.reach + (record.reach || 0),
      engagement: acc.engagement + (record.engagement || 0),
      conversions: acc.conversions + (record.conversions || 0),
      impressions: acc.impressions + (record.impressions || 0),
      clicks: acc.clicks + (record.clicks || 0),
      shares: acc.shares + (record.shares || 0)
    }), {
      reach: 0,
      engagement: 0,
      conversions: 0,
      impressions: 0,
      clicks: 0,
      shares: 0
    });

    return res.status(200).json({
      metrics: totals,
      timeline: performance.map(p => ({
        date: p.date,
        reach: p.reach,
        engagement: p.engagement,
        conversions: p.conversions
      })),
      achievements: performance.filter(p => p.conversions > 10).map(p => ({
        id: p.id,
        date: p.date,
        description: `${p.conversions} conversions achieved`,
        type: 'milestone'
      }))
    });

  } catch (error) {
    console.error('Error in performance-data API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}