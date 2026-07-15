import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAnalyticsHealthSummary } from '../../../backend/services/analyticsHealthService';
import { resolveOmnivyraWebsiteCompany } from '../../../backend/services/omnivyraWebsiteCompanyService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      code: 'ANALYTICS_HEALTH_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) {
    return res.status(404).json({
      status: 'error',
      code: 'OMNIVYRA_WEBSITE_COMPANY_NOT_FOUND',
      message: 'No Omnivyra website company is configured.',
    });
  }

  try {
    const summary = await getAnalyticsHealthSummary(company.id);
    return res.status(200).json(summary);
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      code: 'ANALYTICS_HEALTH_LOAD_FAILED',
      message: error?.message || 'Failed to load analytics health summary',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/analytics-health' });
