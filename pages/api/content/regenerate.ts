import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { regenerateContentAsset } from '../../../backend/services/contentAssetService';
import { getContentAssetById } from '../../../backend/db/contentAssetStore';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC, type RbacContext } from '../../../backend/middleware/withRBAC';
import { resolveCampaignOwnership } from '../../../backend/services/campaignOwnershipService';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { assetId, instruction } = req.body || {};
    // 3AH-117 (WS-E) — withRBAC authorized the role in ONE company: the query
    // companyId, else the body companyId. That company is the only one this
    // request may act for; membership is proven for it here, and below it must
    // be the asset campaign's canonical owner. A request cannot pass the role
    // check in one company, the membership check in a second and act on a
    // campaign of a third.
    const authorizedCompanyId = (req as NextApiRequest & { rbac?: RbacContext }).rbac?.companyId;
    if (!authorizedCompanyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const access = await enforceCompanyAccess({ req, res, companyId: authorizedCompanyId });
    if (!access) return;
    if (!assetId || !instruction) {
      return res.status(400).json({ error: 'assetId and instruction are required' });
    }
    // IDOR guard: the AI acts on `assetId`, which is not scoped to a company.
    // Its campaign's owner is the canonical resolver's answer over EVERY owner
    // record (never one version row); only OWNED by the authorized company may
    // proceed. Every other state gets the existing 403, a failed lookup a 503.
    const asset = await getContentAssetById(String(assetId));
    if (!asset) {
      return res.status(404).json({ error: 'Content asset not found' });
    }
    const ownership = await resolveCampaignOwnership(asset.campaign_id);
    if (ownership.status === 'LOOKUP_FAILED') {
      return res.status(503).json({
        error: 'Campaign ownership check is temporarily unavailable. Please try again.',
        code: 'CAMPAIGN_LOOKUP_ERROR',
        retryable: true,
      });
    }
    const claimedCompanies = [authorizedCompanyId, req.query?.companyId, (req.body || {}).companyId]
      .filter((claim) => claim !== undefined && claim !== null && claim !== '')
      .map(String);
    if (ownership.status !== 'OWNED' || claimedCompanies.some((claim) => claim !== ownership.companyId)) {
      return res.status(403).json({ error: 'Access denied to asset' });
    }
    const updated = await regenerateContentAsset({ assetId, instruction });
    // Canonical telemetry (append-only, fail-soft): an AI asset was regenerated.
    // Not deduped — each regenerate is a distinct action.
    trackEvent({
      type: 'ai.regenerated',
      organizationId: ownership.companyId,
      actorId: access.userId,
      entityId: assetId,
      metadata: { surface: 'content' },
      dedupKey: null,
    });
    return res.status(200).json(updated);
  } catch {
    return res.status(500).json({ error: 'Failed to regenerate content' });
  }
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_MANAGER]), { route: '/api/content/regenerate' });
