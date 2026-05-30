/**
 * GET /api/creator-intelligence/campaign-variant-estimate
 *
 * Pre-execution billing estimate for a campaign's persisted
 * variant_strategy. Used by the UI to render the
 * "this run will generate X assets" confirmation BEFORE the campaign
 * triggers actual generation.
 *
 * Read-only. NO charging. NO mutation. NO new billing contract — the
 * underlying per-orchestrator-invocation charging wrappers
 * (wirePhase2Route / withQueueBilling) remain authoritative.
 *
 * Query:
 *   ?company_id=…       (required)
 *   ?campaign_id=…      (required)
 *   ?platform=…         (optional, threaded into winner-engine lookup)
 *   ?creator_id=…       (optional)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { estimateCampaignVariantBilling } from '../../../backend/services/creator/campaignVariantBillingEstimator';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const campaignId = String(req.query.campaign_id || '').trim();
  if (!campaignId) {
    return res.status(400).json({ success: false, error: 'campaign_id required', code: 'CAMPAIGN_ID_REQUIRED' });
  }
  const user = await resolveUserContext(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
  const creatorId = typeof req.query.creator_id === 'string' ? req.query.creator_id : null;
  const contentType = typeof req.query.content_type === 'string' ? req.query.content_type : null;
  const targetPlatformsRaw = typeof req.query.target_platforms === 'string'
    ? req.query.target_platforms
    : '';
  const targetPlatforms = targetPlatformsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { data: campaignRow, error } = await supabase
      .from('campaign_versions')
      .select('campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to load campaign snapshot',
        code: 'CAMPAIGN_SNAPSHOT_LOAD_FAILED',
        message: error.message,
      });
    }
    const estimate = estimateCampaignVariantBilling({
      campaign: campaignRow,
      companyId,
      campaignId,
      platform,
      creatorId,
      contentType,
      targetPlatforms: targetPlatforms.length > 0 ? targetPlatforms : null,
    });
    return res.status(200).json({
      success: true,
      campaign_id: campaignId,
      estimate,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Failed to compute estimate',
      code: 'ESTIMATE_FAILED',
      message: err?.message || String(err),
    });
  }
}
