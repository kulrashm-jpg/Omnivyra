import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getStrategyHistoryForCompany } from '../../../backend/services/strategyHistoryService';

/**
 * GET /api/recommendations/strategy-history?companyId=...
 * Returns strategy memory: aspect usage and underused areas for the company.
 * Used to guide recommendations (continuation vs expansion) without changing ranking.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    const result = await getStrategyHistoryForCompany(companyId);
    return res.status(200).json(result);
  } catch (e) {
    console.warn('strategy-history error', e);
    return res.status(200).json({
      campaigns_count: 0,
      aspect_counts: {},
      intent_tag_counts: {},
      dominant_aspects: [],
      underused_aspects: [],
      strategy_momentum: null,
    });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);
