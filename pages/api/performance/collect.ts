import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { recordPerformance } from '../../../backend/services/performanceFeedbackService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    campaign_id,
    recommendation_id,
    platform,
    post_id,
    impressions,
    likes,
    shares,
    comments,
    clicks,
    engagement_rate,
    collected_at,
    source,
  } = req.body || {};

  if (!campaign_id || !platform || !post_id || !source) {
    return res.status(400).json({ error: 'campaign_id, platform, post_id, and source are required' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): this wrote performance_feedback for ANY
  // campaign with no authentication. Bind the campaign to the caller.
  const access = await requireCampaignAccess(req, res, String(campaign_id));
  if (!access) return;

  // A recommendation id is an object of its own company
  // (recommendation_snapshots.company_id): it may only be attached when it
  // belongs to the campaign's company. Unknown and foreign ids get the same 404.
  if (recommendation_id) {
    const { data: rec, error: recError } = await supabase
      .from('recommendation_snapshots')
      .select('id, company_id')
      .eq('id', String(recommendation_id))
      .maybeSingle();
    if (recError) {
      return res.status(500).json({ error: 'Failed to verify recommendation' });
    }
    if (!rec || String(rec.company_id ?? '') !== access.companyId) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }
  }

  const ok = await recordPerformance({
    campaign_id,
    recommendation_id: recommendation_id ?? null,
    platform,
    post_id,
    impressions,
    likes,
    shares,
    comments,
    clicks,
    engagement_rate,
    collected_at,
    source,
  });

  return res.status(200).json({ ok });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/performance/collect' });
