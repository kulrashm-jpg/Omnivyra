/**
 * POST /api/rpa/auth/start
 *
 * Returns an HMAC-signed session_token the operator's browser must carry
 * back to /api/rpa/auth/save-session with the captured storageState. Also
 * returns the platform's public login URL so the caller can open it in a
 * real (non-headless) browser tab or desktop window.
 *
 * Body: { organization_id, platform }
 * Returns: { session_token, expires_at, login_url, instructions }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { issueRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';

const LOGIN_URLS: Record<string, string> = {
  linkedin:  'https://www.linkedin.com/login',
  facebook:  'https://www.facebook.com/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  twitter:   'https://twitter.com/i/flow/login',
  reddit:    'https://www.reddit.com/login/',
};

const SUPPORTED_PLATFORMS = Object.keys(LOGIN_URLS);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as { organization_id?: string; platform?: string };
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const platformRaw = (body.platform ?? '').toString().trim().toLowerCase();
    const platform = platformRaw === 'x' ? 'twitter' : platformRaw;

    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
    if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}` });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const userId = (user as { userId?: string })?.userId ?? null;
    const issued = issueRpaAuthToken({ organization_id: organizationId, platform, user_id: userId });

    return res.status(200).json({
      success: true,
      session_token: issued.token,
      expires_at: new Date(issued.expires_at).toISOString(),
      login_url: LOGIN_URLS[platform],
      platform,
      instructions:
        'Open the login_url in a real browser, complete sign-in, then POST the captured ' +
        "Playwright storageState JSON to /api/rpa/auth/save-session with this session_token.",
    });
  } catch (err) {
    console.error('[rpa/auth/start]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to start RPA auth' });
  }
}
