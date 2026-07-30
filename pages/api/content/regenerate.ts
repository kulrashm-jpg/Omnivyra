import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { regenerateContentAsset } from '../../../backend/services/contentAssetService';
import { getContentAssetById } from '../../../backend/db/contentAssetStore';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, assetId, instruction } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!assetId || !instruction) {
      return res.status(400).json({ error: 'assetId and instruction are required' });
    }
    // IDOR guard: enforceCompanyAccess only proved the caller owns `companyId`.
    // The AI acts on `assetId`, which was NOT scoped to that company — a caller
    // could regenerate another tenant's asset. Verify the asset's owning company
    // (campaign_versions is the canonical campaign→company map) before proceeding.
    const asset = await getContentAssetById(String(assetId));
    if (!asset) {
      return res.status(404).json({ error: 'Content asset not found' });
    }
    const { data: campaignRow } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', asset.campaign_id)
      .limit(1)
      .maybeSingle();
    if (!campaignRow?.company_id || String(campaignRow.company_id) !== String(companyId)) {
      return res.status(403).json({ error: 'Access denied to asset' });
    }
    const updated = await regenerateContentAsset({ assetId, instruction });
    // Canonical telemetry (append-only, fail-soft): an AI asset was regenerated.
    // Not deduped — each regenerate is a distinct action.
    trackEvent({
      type: 'ai.regenerated',
      organizationId: companyId,
      actorId: access.userId,
      entityId: assetId,
      metadata: { surface: 'content' },
      dedupKey: null,
    });
    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to regenerate content' });
  }
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_MANAGER]), { route: '/api/content/regenerate' });
