import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { saveSelectedProperty, saveSelectedSearchConsoleProperty } from '../../../backend/services/analyticsIntegrationService';
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
      message: 'Failed to connect Google Analytics',
    });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  const propertyId = typeof req.body?.propertyId === 'string' ? req.body.propertyId : '';
  const capability = req.body?.capability === 'google_search_console' || req.body?.capability === 'gsc'
    ? 'google_search_console'
    : 'google_analytics';

  if (!(await requireCompanyAccess(user.id, companyId, res))) return;
  if (!propertyId) {
    return res.status(400).json({ status: 'error', message: 'propertyId is required' });
  }

  try {
    const property = capability === 'google_search_console'
      ? await saveSelectedSearchConsoleProperty(companyId, propertyId)
      : await saveSelectedProperty(companyId, propertyId);
    return res.status(200).json({
      status: 'connected',
      initial_sync: 'started',
      property,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: capability === 'google_search_console'
        ? 'Failed to connect Search Console'
        : 'Failed to connect Google Analytics',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/select-property' });
