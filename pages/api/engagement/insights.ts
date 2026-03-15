/**
 * GET /api/engagement/insights
 * Returns engagement insights with evidence.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getInsights } from '../../../backend/services/insightIntelligenceService';

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

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const insights = await getInsights(organizationId);

    return res.status(200).json({
      insights: insights.map((i) => ({
        id: i.id,
        insight_title: i.insight_title,
        insight_summary: i.insight_summary,
        insight_type: i.insight_type,
        change_percentage: i.change_percentage,
        evidence_count: i.evidence_count,
        evidence: i.evidence.map((e) => ({
          thread_id: e.thread_id,
          message_id: e.message_id,
          author_name: e.author_name,
          platform: e.platform,
          text_snippet: e.text_snippet,
        })),
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch insights';
    console.error('[engagement/insights]', message);
    return res.status(500).json({ error: message });
  }
}
