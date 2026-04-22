import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { listGoogleAnalyticsProperties } from '../../../backend/services/analyticsIntegrationService';
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
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  try {
    const properties = await listGoogleAnalyticsProperties(companyId);
    if (properties.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No GA properties found',
        properties: [],
      });
    }
    return res.status(200).json({ status: 'ok', properties });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load Google Analytics properties',
    });
  }
}
