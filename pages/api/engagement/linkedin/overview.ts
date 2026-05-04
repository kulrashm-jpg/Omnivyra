import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getLinkedInEngagementOverview } from '../../../../backend/services/linkedinEngagementWorkspaceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const companyId = organizationId?.trim();

  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const overview = await getLinkedInEngagementOverview(companyId);
    return res.status(200).json({ success: true, overview });
  } catch (error) {
    console.error('[engagement/linkedin/overview]', error);
    return res.status(500).json({
      error: (error as Error)?.message ?? 'Failed to load LinkedIn engagement overview',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

