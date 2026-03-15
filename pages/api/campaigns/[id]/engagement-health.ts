/**
 * GET /api/campaigns/[id]/engagement-health
 * Returns EngagementHealthReport for a campaign.
 * Used by Engagement Inbox, Audience Insights, Content Performance dashboards.
 * Kept separate from Campaign Health (design/plan evaluation).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data: ver } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (ver?.company_id) return ver.company_id as string;
  const { data: camp } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  return camp?.company_id ? (camp.company_id as string) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  try {
    const companyId =
      (await getCompanyId(campaignId)) ??
      (typeof req.query.companyId === 'string' ? req.query.companyId : null);
    if (!companyId) {
      return res.status(400).json({ error: 'Campaign must be linked to a company' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!access) return;

    const report: Record<string, unknown> = {
      campaign_id: campaignId,
      company_id: companyId,
      engagement_status: 'unknown',
      total_posts: 0,
      engagement_rate: 0,
      reply_pending_count: 0,
      last_updated_at: new Date().toISOString(),
    };

    return res.status(200).json(report);
  } catch (err) {
    console.error('[campaigns/engagement-health]', err);
    return res.status(500).json({
      error: 'Failed to fetch engagement health',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
