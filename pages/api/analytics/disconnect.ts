import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { disconnectSearchConsole } from '../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  const capability = req.body?.capability === 'google_search_console' || req.body?.capability === 'gsc'
    ? 'google_search_console'
    : null;

  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  if (capability !== 'google_search_console') {
    return res.status(400).json({
      status: 'error',
      message: 'Only Search Console disconnect is supported here.',
    });
  }

  try {
    const result = await disconnectSearchConsole(companyId);
    return res.status(200).json({
      status: 'disconnected',
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to disconnect Search Console',
    });
  }
}
