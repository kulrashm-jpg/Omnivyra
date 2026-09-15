import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCampaignSummary(req, res);
  } else if (req.method === 'PUT') {
    return updateCampaignSummary(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function getCampaignSummary(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // ROUTE-AUTH-001: authenticate and bind the campaign to the caller's tenant.
    const access = await requireCampaignAccess(req, res, campaignId as string);
    if (!access) return;

    // Get campaign with summary data
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', access.campaignId)
      .single();

    if (error) {
      console.error('Error fetching campaign:', error);
      return res.status(500).json({ error: 'Failed to fetch campaign' });
    }

    res.status(200).json(campaign);

  } catch (error) {
    console.error('Error in getCampaignSummary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateCampaignSummary(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { campaignId } = req.query;
    const {
      objective,
      target_audience,
      content_focus,
      target_metrics,
      campaign_summary,
      ai_generated_summary,
      weekly_themes,
      performance_targets
    } = req.body;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // ROUTE-AUTH-001: authenticate and bind the campaign before any write.
    const access = await requireCampaignAccess(req, res, campaignId as string);
    if (!access) return;

    // Update campaign summary fields
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (objective !== undefined) updateData.objective = objective;
    if (target_audience !== undefined) updateData.target_audience = target_audience;
    if (content_focus !== undefined) updateData.content_focus = content_focus;
    if (target_metrics !== undefined) updateData.target_metrics = target_metrics;
    if (campaign_summary !== undefined) updateData.campaign_summary = campaign_summary;
    if (ai_generated_summary !== undefined) updateData.ai_generated_summary = ai_generated_summary;
    if (weekly_themes !== undefined) updateData.weekly_themes = weekly_themes;
    if (performance_targets !== undefined) updateData.performance_targets = performance_targets;

    const { data, error } = await supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', access.campaignId)
      .select()
      .single();

    if (error) {
      console.error('Error updating campaign summary:', error);
      return res.status(500).json({ error: 'Failed to update campaign summary' });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Campaign summary updated successfully',
      data 
    });

  } catch (error) {
    console.error('Error in updateCampaignSummary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/campaign-summary-update' });
