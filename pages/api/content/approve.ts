import type { NextApiRequest, NextApiResponse } from 'next';
import { approveContentAsset } from '../../../backend/services/contentAssetService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, assetId, approver } = req.body || {};
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }
    const updated = await approveContentAsset({ assetId, approver });
    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to approve content' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_MANAGER]);
