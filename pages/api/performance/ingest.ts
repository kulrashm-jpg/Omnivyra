import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ingestPerformanceData } from '../../../backend/services/performanceIngestionService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): authenticate before the asset is looked up.
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { platform, contentAssetId, metrics, capturedAt } = req.body || {};
    if (!platform || !contentAssetId || !metrics) {
      return res.status(400).json({ error: 'platform, contentAssetId, metrics are required' });
    }

    // Bind the asset to the caller through its owning campaign
    // (content_assets.campaign_id → campaign_versions company).
    const { data: asset, error: assetError } = await supabase
      .from('content_assets')
      .select('asset_id, campaign_id')
      .eq('asset_id', String(contentAssetId))
      .maybeSingle();
    if (assetError) {
      return res.status(500).json({ error: 'Failed to ingest performance' });
    }
    if (!asset?.campaign_id) {
      return res.status(404).json({ error: 'Content asset not found' });
    }
    const access = await requireCampaignAccess(req, res, String(asset.campaign_id));
    if (!access) return;

    await ingestPerformanceData({ platform, contentAssetId, metrics, capturedAt });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to ingest performance' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/performance/ingest' });
