import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { getGoogleAnalyticsStatusPayload } from '../../../backend/services/googleAnalyticsExperienceService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

function statusErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return process.env.NODE_ENV !== 'production' && message ? message : fallback;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      connected: false,
      status: 'error',
      message: 'Sign in again to view Google integration status.',
      detail: process.env.NODE_ENV !== 'production' ? authError ?? 'No authenticated user found' : undefined,
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
    console.error('[analytics-status] failed', {
      company_id: companyId || null,
      user_id: user.id,
      message: error instanceof Error ? error.message : String(error),
      stack: process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      connected: false,
      status: 'error',
      message: statusErrorMessage(error, 'Failed to load Google integration status'),
      property: null,
      last_sync: null,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/status' });
