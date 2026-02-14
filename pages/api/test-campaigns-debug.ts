import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get raw count from campaigns table
    const { count: totalCount, error: countError } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting campaigns:', countError);
      return res.status(500).json({ error: 'Failed to count campaigns', details: countError.message });
    }

    // Get active campaigns count
    const { count: activeCount, error: activeError } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .in('status', ['active', 'running']);

    if (activeError) {
      console.error('Error counting active campaigns:', activeError);
    }

    // Get all campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id, name, status, created_at')
      .order('created_at', { ascending: false });

    if (campaignsError) {
      console.error('Error fetching campaigns:', campaignsError);
      return res.status(500).json({ error: 'Failed to fetch campaigns', details: campaignsError.message });
    }

    res.status(200).json({
      success: true,
      debug: {
        totalCount,
        activeCount: activeCount || 0,
        campaignsFromSelect: campaigns?.length || 0,
        campaigns: campaigns?.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          created: c.created_at
        })) || [],
        databaseCheck: 'Campaigns table queried successfully'
      }
    });

  } catch (error) {
    console.error('Error in campaigns API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}







