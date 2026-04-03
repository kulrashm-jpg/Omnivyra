
/**
 * GET /api/engagement/opportunity-learning
 * Returns opportunity learning metrics for an organization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getLearningMetrics } from '../../../backend/services/opportunityLearningService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const metrics = await getLearningMetrics(organizationId);
    const data = Array.from(metrics.entries()).map(([opportunity_type, m]) => ({
      opportunity_type,
      approval_rate: m.approval_rate,
      ignore_rate: m.ignore_rate,
      campaign_conversion_rate: m.campaign_conversion_rate,
    }));

    return res.status(200).json({ metrics: data });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch opportunity learning metrics';
    console.error('[engagement/opportunity-learning]', msg);
    return res.status(500).json({ error: msg });
  }
}
