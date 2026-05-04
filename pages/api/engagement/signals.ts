import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getEngagementSignalsDashboardData } from '../../../backend/services/engagementSignalIntelligenceService';
import { generateEngagementSignalInsights } from '../../../backend/services/behaviorInsightService';

type EngagementSignalsApiResponse =
  | {
      label: 'Social Engagement (Not Traffic Data)';
      confidence: 'high' | 'low_confidence';
      warnings: string[];
      insights: ReturnType<typeof generateEngagementSignalInsights>;
      top_performing_posts: Awaited<ReturnType<typeof getEngagementSignalsDashboardData>>['top_performing_posts'];
      engagement_trends: Awaited<ReturnType<typeof getEngagementSignalsDashboardData>>['engagement_trends'];
      platform_comparison: Awaited<ReturnType<typeof getEngagementSignalsDashboardData>>['platform_comparison'];
    }
  | { error: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EngagementSignalsApiResponse>,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = String(req.query.companyId ?? req.query.company_id ?? user?.defaultCompanyId ?? '').trim();
    const days = Math.min(90, Math.max(7, Number.parseInt(String(req.query.days ?? 30), 10) || 30));

    if (!companyId) {
      return res.status(400).json({ error: 'companyId or company_id is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const engagementSignals = await getEngagementSignalsDashboardData(companyId, days);
    return res.status(200).json({
      ...engagementSignals,
      insights: generateEngagementSignalInsights({
        engagement_signals: engagementSignals,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load engagement signals';
    console.error('[engagement/signals]', message);
    return res.status(500).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

