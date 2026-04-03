
/**
 * GET /api/engagement/trending-topics
 * Returns topic clusters from engagement messages.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getTrendingTopics } from '../../../backend/services/trendingTopicsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as string | undefined;
    const windowHours = Math.min(
      168,
      Math.max(1, parseInt(String(req.query.window_hours ?? 24), 10) || 24)
    );

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const topics = await getTrendingTopics(organizationId, windowHours);
    return res.status(200).json({ topics });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch trending topics';
    console.error('[engagement/trending-topics]', msg);
    return res.status(500).json({ error: msg });
  }
}
