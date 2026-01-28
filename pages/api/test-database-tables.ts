import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if required tables exist
    const { data: tables, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .in('table_name', ['campaigns', 'weekly_content_refinements', 'daily_content_plans', 'campaign_performance'])
      .eq('table_schema', 'public');

    if (error) {
      console.error('Error checking tables:', error);
      return res.status(500).json({ error: 'Failed to check tables', details: error.message });
    }

    const tableNames = tables?.map(t => t.table_name) || [];
    
    res.status(200).json({
      tables: tableNames,
      hasCampaigns: tableNames.includes('campaigns'),
      hasWeeklyRefinements: tableNames.includes('weekly_content_refinements'),
      hasDailyPlans: tableNames.includes('daily_content_plans'),
      hasCampaignPerformance: tableNames.includes('campaign_performance'),
      message: 'Database table check completed'
    });

  } catch (error) {
    console.error('Error in database check:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
