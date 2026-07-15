import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getTopPerformingBlogs } from '../../../../backend/services/blogAnalyticsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  try {
    const rows = await getTopPerformingBlogs(companyId, limit);
    return res.status(200).json({ rows, windowDays: 28 });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/blogs/analytics/top' });
