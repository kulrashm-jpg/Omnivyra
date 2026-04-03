
/**
 * GET /api/engagement/opportunity-health
 * Returns opportunity pipeline health metrics for executive insights.
 * Params: organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getOpportunityHealth } from '../../../backend/services/opportunityHealthService';

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

    const metrics = await getOpportunityHealth(organizationId);

    return res.status(200).json({
      detected: metrics.opportunities_detected_last_7d,
      approved: metrics.opportunities_approved_last_7d,
      ignored: metrics.opportunities_ignored_last_7d,
      sent_to_campaign: metrics.opportunities_sent_to_campaign,
      completed: metrics.opportunities_completed,
      average_confidence: metrics.average_confidence_score,
      approval_rate: metrics.approval_rate,
      campaign_conversion_rate: metrics.campaign_conversion_rate,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch opportunity health';
    console.error('[engagement/opportunity-health]', msg);
    return res.status(500).json({ error: msg });
  }
}
