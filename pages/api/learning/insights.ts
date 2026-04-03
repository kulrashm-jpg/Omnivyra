import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { listDecisionObjects } from '../../../backend/services/decisionObjectService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

function deriveLearningPayloadFromDecisions(campaignId: string, decisions: Array<{ title: string; recommendation: string; confidence_score: number; source_service: string; issue_type: string }>) {
  const insights = decisions.slice(0, 10).map((d) => d.title);
  const recommendations = decisions.slice(0, 10).map((d) => ({
    type: d.source_service.includes('seo') ? 'content' as const : d.source_service.includes('lead') ? 'platform' as const : d.source_service.includes('funnel') ? 'timing' as const : 'trend' as const,
    message: d.recommendation,
    confidence: Math.round(Number(d.confidence_score ?? 0) * 100),
  }));

  return {
    campaignId,
    insights,
    recommendations,
    rulesToApply: {
      preferredPlatforms: [],
      preferredTimes: [],
      avoidTrends: [],
      boostContentTypes: [],
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const campaignId =
      (typeof body.campaignId === 'string' ? body.campaignId : null) ||
      (typeof req.query.campaignId === 'string' ? req.query.campaignId : null);
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const decisions = await runInApiReadContext('learningInsightsApi', async () =>
      listDecisionObjects({
        viewName: 'deep_view',
        companyId: access.companyId,
        entityType: 'campaign',
        entityId: access.campaignId,
        status: ['open'],
        limit: 200,
      })
    );

    const insights = deriveLearningPayloadFromDecisions(access.campaignId, (decisions as Array<{ title: string; recommendation: string; confidence_score: number; source_service: string; issue_type: string }>));
    return res.status(200).json(insights);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load insights' });
  }
}
