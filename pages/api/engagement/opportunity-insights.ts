
/**
 * GET /api/engagement/opportunity-insights
 * Returns opportunity insights: top performing type, highest approval type, topics generating campaigns.
 * Params: organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getOpportunityInsights } from '../../../backend/services/opportunityHealthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as
      | string
      | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const insights = await getOpportunityInsights(organizationId);
    return res.status(200).json(insights);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch opportunity insights';
    console.error('[engagement/opportunity-insights]', msg);
    return res.status(500).json({ error: msg });
  }
}
