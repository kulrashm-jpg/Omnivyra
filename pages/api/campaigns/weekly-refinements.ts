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

    // Fetch weekly refinements
    const { data: refinements, error } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });

    if (error) {
      console.error('Error fetching weekly refinements:', error);
      return res.status(500).json({ error: 'Failed to fetch weekly refinements' });
    }

    res.status(200).json({
      success: true,
      refinements: refinements || []
    });

  } catch (error) {
    console.error('Error in weekly refinements API:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






