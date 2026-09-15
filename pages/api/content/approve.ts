import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { approveContentAsset } from '../../../backend/services/contentAssetService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { checkContentAssetOwnership } from '../../../backend/services/content/contentAssetOwnership';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, assetId } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }
    // SEC91-W2G-N1: the asset must belong to the authorized company (a role
    // holder of A could otherwise approve B's asset by id), and the approver
    // is the authorized principal, not a body field.
    const ownership = await checkContentAssetOwnership(String(assetId), String(companyId));
    if (ownership === 'not_found') return res.status(404).json({ error: 'Content asset not found' });
    if (ownership !== 'owned') return res.status(403).json({ error: 'Access denied to asset' });
    const updated = await approveContentAsset({ assetId, approver: access.userId });
    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to approve content' });
  }
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_MANAGER]), { route: '/api/content/approve' });
