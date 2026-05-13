import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { listGoogleAnalyticsProperties, listSearchConsoleProperties } from '../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      status: 'error',
      message: 'Failed to load Google Analytics properties',
    });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  const capability = req.query.capability === 'google_search_console' || req.query.capability === 'gsc'
    ? 'google_search_console'
    : 'google_analytics';
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  try {
    const properties = capability === 'google_search_console'
      ? await listSearchConsoleProperties(companyId)
      : await listGoogleAnalyticsProperties(companyId);
    if (properties.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: capability === 'google_search_console'
          ? 'No Search Console properties found'
          : 'No GA properties found',
        properties: [],
      });
    }
    return res.status(200).json({ status: 'ok', properties });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: capability === 'google_search_console'
        ? 'Failed to load Search Console properties'
        : 'Failed to load Google Analytics properties',
    });
  }
}
