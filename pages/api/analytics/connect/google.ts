import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../../backend/middleware/authMiddleware';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { connectGoogleAnalytics } from '../../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  try {
    const { authorizationUrl } = await connectGoogleAnalytics(companyId, {
      userId: user.id,
      returnTo: typeof req.body?.returnTo === 'string' ? req.body.returnTo : undefined,
      requestBaseUrl: getBaseUrl(req),
    });

    return res.status(200).json({
      status: 'ok',
      authorizationUrl,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to connect Google Analytics',
    });
  }
}
