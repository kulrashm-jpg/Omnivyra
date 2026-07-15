import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { disconnectSearchConsole, disconnectGoogleAnalytics } from '../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
    });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  const rawCap = req.body?.capability;
  const capability =
    rawCap === 'google_search_console' || rawCap === 'gsc'
      ? 'google_search_console'
      : rawCap === 'google_analytics' || rawCap === 'ga4' || rawCap === 'ga'
        ? 'google_analytics'
        : null;

  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  if (!capability) {
    return res.status(400).json({
      status: 'error',
      message: 'capability must be google_search_console or google_analytics.',
    });
  }

  try {
    const result =
      capability === 'google_search_console'
        ? await disconnectSearchConsole(companyId)
        : await disconnectGoogleAnalytics(companyId);
    return res.status(200).json({
      status: 'disconnected',
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : `Failed to disconnect ${capability}`,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/disconnect' });
