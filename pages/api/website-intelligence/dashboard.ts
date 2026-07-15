import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getWebsiteIntelligenceDashboard } from '../../../backend/services/websiteDashboardService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  const websiteId = typeof req.query.website_id === 'string' ? req.query.website_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  // BETA-012 (RULE 4): guard the dashboard composition (its signal queries throw on DB
  // failure) so the WI dashboard gets a JSON error instead of a raw 500 page.
  try {
    const dashboard = await getWebsiteIntelligenceDashboard({
      companyId,
      websiteId,
      from: typeof req.query.from === 'string' ? req.query.from : null,
      to: typeof req.query.to === 'string' ? req.query.to : null,
      useCache: req.query.cache !== 'false',
    });
    return res.status(200).json(dashboard);
  } catch (err: any) {
    console.error('[website-intelligence/dashboard] error:', err?.message);
    return res.status(500).json({ error: 'Failed to load website intelligence dashboard', code: 'DASHBOARD_LOAD_FAILED' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/dashboard' });
