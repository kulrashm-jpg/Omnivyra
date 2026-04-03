
/**
 * GET /api/engagement/analytics
 * Returns dashboard analytics: categories, sentiment, strategies, trends.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getConversationCategoryDistribution,
  getSentimentDistribution,
  getResponseStrategyPerformance,
  getLeadTrend,
  getOpportunityTrend,
  getReplyPerformanceTrend,
} from '../../../backend/services/engagementAnalyticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const days = Math.min(90, Math.max(7, parseInt(String(req.query.days ?? 30), 10) || 30));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const [categories, sentiment, strategies, lead_trend, opportunity_trend, reply_trend] = await Promise.all([
      getConversationCategoryDistribution(organizationId),
      getSentimentDistribution(organizationId),
      getResponseStrategyPerformance(organizationId),
      getLeadTrend(organizationId, days),
      getOpportunityTrend(organizationId, days),
      getReplyPerformanceTrend(organizationId, days),
    ]);

    return res.status(200).json({
      categories,
      sentiment,
      strategies,
      lead_trend,
      opportunity_trend,
      reply_trend,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch analytics';
    console.error('[engagement/analytics]', message);
    return res.status(500).json({ error: message });
  }
}
