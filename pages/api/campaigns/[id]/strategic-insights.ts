import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/campaigns/[id]/strategic-insights
 * Aggregates Campaign Health, Engagement Health, Trend Signals, Inbox Signals
 * to generate CMO-level strategic insights.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownerCompanyOfRow } from '../../../../backend/db/tenantTable';
import { getTrendSnapshots } from '../../../../backend/db/campaignVersionStore';
import { getDecisionReportView } from '../../../../backend/services/decisionReportService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../../backend/services/intelligenceExecutionContext';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  try {
    // S2 derive-then-authorize (e9 ruling, as campaigns/[id]/source-recommendation): ownerCompanyOfRow answers ONLY
    // which company owns the campaign (campaigns.company_id, NOT NULL since 20270217000025), no longer "any
    // campaign_versions row" (an unordered .limit(1) read). SOURCE-OF-TRUTH MOVE: versions -> campaigns; C36: 0
    // mismatches in prod. The ?companyId= fallback for a campaign with no owner is unchanged, and the access check
    // still binds the campaign to whichever company it authorizes (checkCampaignOwnership).
    const ownerCompanyId = await ownerCompanyOfRow('campaigns', campaignId, 'campaign strategic insights: owner of the campaign');
    const queryCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const companyContext = await requireCompanyContext({
      req,
      res,
      companyId: ownerCompanyId ?? queryCompanyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!companyContext) return;

    const reportView = await runInApiReadContext('campaignStrategicInsightsApi', async () =>
      getDecisionReportView({
        companyId: companyContext.companyId,
        reportTier: 'growth',
        entityType: 'campaign',
        entityId: campaignId,
        sourceService: 'strategicInsightService',
      })
    );

    return res.status(200).json(reportView);
  } catch (err) {
    console.error('[campaigns/strategic-insights]', err);
    return res.status(500).json({
      error: 'Failed to generate strategic insights',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/strategic-insights' });
