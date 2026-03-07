import type { NextApiRequest, NextApiResponse } from 'next';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { refineUserFacingResponse } from '@/backend/utils/refineUserFacingResponse';
import { ALL_ROLES } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { resolveEffectiveCampaignRole, type CampaignAuthContext } from '../../../backend/services/campaignRoleService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber } = req.query;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: typeof companyId === 'string' ? companyId : undefined,
      campaignId: typeof campaignId === 'string' ? campaignId : undefined,
      requireCampaignId: true,
    });
    if (!access) return;
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const companyIdStr = typeof companyId === 'string' ? companyId : undefined;
    if (companyIdStr) {
      const campaignAuthResult = await resolveEffectiveCampaignRole(
        access.userId,
        campaignId,
        companyIdStr
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
          console.log('CAMPAIGN_AUTH_CONTENT_LIST', { campaignId, companyId: companyIdStr, ...campaignAuth });
        }
      }
    }
    const week = weekNumber ? Number(weekNumber) : undefined;
    const assets = await listAssetsWithLatestContent({ campaignId, weekNumber: week });
    const refinedAssets = await refineUserFacingResponse(assets);
    return res.status(200).json({ assets: refinedAssets });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to list content assets' });
  }
}

export default withRBAC(handler, ALL_ROLES);
