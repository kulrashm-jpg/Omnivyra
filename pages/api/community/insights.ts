
/**
 * Community Insights API
 * Returns decision intelligence from growth_view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { listDecisionObjects } from '../../../backend/services/decisionObjectService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? 20), 10) || 20));
    const minImpact = parseFloat(String(req.query.minImpact ?? 0));

    let insights = await runInApiReadContext('communityInsightsApi', async () =>
      listDecisionObjects({
        viewName: 'growth_view',
        companyId: companyContext.companyId,
        status: ['open'],
        limit,
      })
    );

    if (!Number.isNaN(minImpact) && minImpact > 0) {
      insights = insights.filter((row) => row.priority_score >= minImpact);
    }

    return res.status(200).json({
      insights: insights.map((row) => ({
        issue_type: row.issue_type,
        summary: row.description,
        priority_score: row.priority_score,
        execution_score: row.execution_score,
        action_type: row.action_type,
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch insights';
    console.error('[community/insights]', message);
    return res.status(500).json({ error: message });
  }
}
