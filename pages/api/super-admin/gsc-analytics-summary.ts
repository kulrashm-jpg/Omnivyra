import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getOmnivyraGscDashboardSummary } from '../../../backend/services/omnivyraGscAnalyticsService';
import { requireSuperAdminGaAccess } from '../../../backend/services/superAdminGaAccess';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      code: 'GSC_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  const access = await requireSuperAdminGaAccess(req, res);
  if (!access) return;

  try {
    const summary = await getOmnivyraGscDashboardSummary(30);
    return res.status(200).json(summary);
  } catch (error: any) {
    return res.status(500).json({
      status: {
        connected: false,
        status: 'failed',
        degraded_state: 'failed',
        message: error?.message || 'Failed to load Search Console analytics',
        selected_property: null,
        last_sync: null,
        last_successful_data_date: null,
        rows_ingested: 0,
        error_message: error?.message || 'Failed to load Search Console analytics',
      },
      summary: { clicks: 0, impressions: 0, ctr: 0, avg_position: 0 },
      top_queries: [],
      top_pages: [],
      devices: [],
      countries: [],
      provenance: {
        source: 'fallback_no_gsc',
        company_id: null,
        website: 'omnivyra.com',
        property_url: null,
      },
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/gsc-analytics-summary' });
