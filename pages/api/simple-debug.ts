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

    console.log('Checking campaign data for:', campaignId);

    // Get weekly refinements
    const { data: weeklyRefinements, error: refinementsError } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number');

    console.log('Weekly refinements query result:', { 
      count: weeklyRefinements?.length || 0, 
      error: refinementsError?.message 
    });

    if (weeklyRefinements && weeklyRefinements.length > 0) {
      console.log('First refinement sample:', weeklyRefinements[0]);
    }

    // Simple response
    res.status(200).json({
      success: true,
      message: 'Check server console for detailed logs',
      data: {
        campaignId,
        weeklyRefinementsCount: weeklyRefinements?.length || 0,
        hasError: !!refinementsError,
        errorMessage: refinementsError?.message || null,
        sampleRefinement: weeklyRefinements?.[0] || null
      }
    });

  } catch (error) {
    console.error('Error in simple-debug API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}





