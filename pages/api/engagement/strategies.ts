/**
 * GET /api/engagement/strategies
 * Returns top strategies for classification + sentiment. Params: organization_id, classification, sentiment.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getTopStrategiesForContext } from '../../../backend/services/responseStrategyIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const classification = (req.query.classification ?? req.query.classification_category) as string | undefined;
    const sentiment = (req.query.sentiment as string)?.trim() || 'neutral';

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!classification) {
      return res.status(400).json({ error: 'classification required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const strategies = await getTopStrategiesForContext(
      organizationId,
      classification,
      sentiment,
      3
    );

    return res.status(200).json({
      strategies: strategies.map((s) => ({
        strategy_type: s.strategy_type,
        engagement_score: s.engagement_score,
        confidence_score: s.confidence_score,
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch strategies';
    console.error('[engagement/strategies]', message);
    return res.status(500).json({ error: message });
  }
}
