import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { getGoogleAnalyticsStatusPayload } from '../../../backend/services/googleAnalyticsExperienceService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      connected: false,
      status: 'error',
      message: 'Failed to connect Google Analytics',
      property: null,
      last_sync: null,
    });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  try {
    const status = await getGoogleAnalyticsStatusPayload(companyId);
    return res.status(200).json(status);
  } catch (error) {
    return res.status(500).json({
      connected: false,
      status: 'error',
      message: 'Failed to connect Google Analytics',
      property: null,
      last_sync: null,
    });
  }
}
