import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { syncLinkedInEngagement } from '../../../../backend/services/linkedinEngagementWorkspaceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.body?.organization_id ?? req.body?.organizationId ?? req.body?.companyId) as string | undefined;
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

    const result = await syncLinkedInEngagement(companyId);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('[engagement/linkedin/sync]', error);
    return res.status(500).json({
      error: (error as Error)?.message ?? 'Failed to sync LinkedIn engagement',
    });
  }
}


// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/linkedin/sync' });
