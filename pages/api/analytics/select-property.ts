import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { saveSelectedProperty } from '../../../backend/services/analyticsIntegrationService';
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

  if (!(await requireCompanyAccess(user.id, companyId, res))) return;
  if (!propertyId) {
    return res.status(400).json({ status: 'error', message: 'propertyId is required' });
  }

  try {
    const property = await saveSelectedProperty(companyId, propertyId);
    return res.status(200).json({
      status: 'connected',
      initial_sync: 'started',
      property,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to connect Google Analytics',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

