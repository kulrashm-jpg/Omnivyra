/**
 * Campaign Progress API
 * GET /api/campaigns/[id]/progress
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { ALL_ROLES } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { resolveEffectiveCampaignRole, type CampaignAuthContext } from '../../../../backend/services/campaignRoleService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    const companyId = req.query.companyId as string | undefined;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: id,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: ownershipRows, error: ownershipError } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId)
      .eq('campaign_id', id);

    if (ownershipError) {
      return res.status(500).json({ error: 'Failed to verify campaign ownership' });
    }

    if (!ownershipRows || ownershipRows.length === 0) {
      return res.status(403).json({
        error: 'CAMPAIGN_NOT_IN_COMPANY',
        code: 'CAMPAIGN_NOT_IN_COMPANY',
      });
    }

    const campaignAuthResult = await resolveEffectiveCampaignRole(
      access.userId,
      id,
      companyId as string
    );
    if (campaignAuthResult.error === 'CAMPAIGN_ROLE_REQUIRED') {
      return res.status(403).json({ error: 'CAMPAIGN_ROLE_REQUIRED' });
    }
    if (!campaignAuthResult.error) {
      const campaignAuth: CampaignAuthContext = {
        companyRole: campaignAuthResult.companyRole,
        campaignRole: campaignAuthResult.campaignRole,
        effectiveRole: campaignAuthResult.effectiveRole,
        source: campaignAuthResult.source,
      };
      (req as NextApiRequest & { campaignAuth?: CampaignAuthContext }).campaignAuth = campaignAuth;
      if (process.env.NODE_ENV !== 'test') {
        console.log('CAMPAIGN_AUTH_PROGRESS', { campaignId: id, companyId, ...campaignAuth });
      }
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

export default withRBAC(handler, ALL_ROLES);