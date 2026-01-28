/**
 * Campaign Progress API
 * GET /api/campaigns/[id]/progress
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // Get campaign progress data
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get scheduled posts count
    const { count: scheduledCount } = await supabase
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'scheduled');

    // Get published posts count
    const { count: publishedCount } = await supabase
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'published');

    // Calculate progress percentage
    const totalPosts = (scheduledCount || 0) + (publishedCount || 0);
    const progressPercentage = totalPosts > 0 ? (publishedCount || 0) / totalPosts * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        campaign_id: id,
        scheduled_posts: scheduledCount || 0,
        published_posts: publishedCount || 0,
        total_posts: totalPosts,
        progress_percentage: Math.round(progressPercentage),
      },
    });
  } catch (error: any) {
    console.error('Campaign progress error:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign progress',
      message: error.message,
    });
  }
}

