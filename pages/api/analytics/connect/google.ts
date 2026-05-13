import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../../backend/middleware/authMiddleware';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { connectGoogleAnalytics, connectGoogleSearchConsole } from '../../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

function errorMessageForClient(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (process.env.NODE_ENV !== 'production' && message) return message;
  if (/OAuth provider config/i.test(message) || /client ID|client secret|disabled/i.test(message)) {
    return 'Google OAuth is not configured. Ask a super admin to configure the Google data provider.';
  }
  return fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      status: 'error',
      message: 'Sign in again before connecting Google integrations.',
      detail: process.env.NODE_ENV !== 'production' ? authError ?? 'No authenticated user found' : undefined,
    });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  const capability = req.body?.capability === 'google_search_console' || req.body?.capability === 'gsc'
    ? 'google_search_console'
    : 'google_analytics';
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  try {
    const connector = capability === 'google_search_console'
      ? connectGoogleSearchConsole
      : connectGoogleAnalytics;
    const { authorizationUrl } = await connector(companyId, {
      userId: user.id,
      returnTo: typeof req.body?.returnTo === 'string' ? req.body.returnTo : undefined,
      requestBaseUrl: getBaseUrl(req),
    });

    return res.status(200).json({
      status: 'ok',
      authorizationUrl,
    });
  } catch (error) {
    const fallback = capability === 'google_search_console'
      ? 'Failed to connect Search Console'
      : 'Failed to connect Google Analytics';
    const message = errorMessageForClient(error, fallback);
    console.error('[analytics-connect-google] failed', {
      capability,
      company_id: companyId || null,
      user_id: user.id,
      message: error instanceof Error ? error.message : String(error),
      stack: process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      status: 'error',
      message,
    });
  }
}
