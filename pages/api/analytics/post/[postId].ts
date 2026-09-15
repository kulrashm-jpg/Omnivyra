import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Analytics API - Get post analytics
 * GET /api/analytics/post/[postId]
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getPostAnalytics } from '../../../../backend/services/analyticsService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { supabase } from '../../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): authenticate before the post is looked up.
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { postId } = req.query;
    const { start_date, end_date } = req.query;

    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: 'postId is required' });
    }

    // Bind the post to the caller. scheduled_posts carries no company_id: a
    // campaign post is owned by the campaign's company (campaign_versions, via
    // requireCampaignAccess); a post outside any campaign is owned by its
    // user_id. Unknown and foreign posts get the same 404.
    const { data: post, error: postError } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, campaign_id')
      .eq('id', postId)
      .maybeSingle();
    if (postError) {
      return res.status(500).json({ error: 'Failed to fetch analytics' });
    }
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (post.campaign_id) {
      const access = await requireCampaignAccess(req, res, String(post.campaign_id));
      if (!access) return;
    } else if (String(post.user_id ?? '') !== user.id) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const startDate = start_date ? new Date(start_date as string) : undefined;
    const endDate = end_date ? new Date(end_date as string) : undefined;

    const analytics = await getPostAnalytics(postId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error: any) {
    console.error('Analytics API error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/post/:postId' });
