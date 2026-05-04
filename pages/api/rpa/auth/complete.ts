import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/rpa/auth/complete
 *
 * Zero-manual-step session registration. The Chrome extension (or a
 * first-party desktop helper) captures cookies + localStorage after the
 * user completes platform login and POSTs the raw payload here. The
 * server converts it to a Playwright storageState and persists via
 * rpaSessionStore. No manual JSON export required.
 *
 * Body:
 *   {
 *     session_token: string,                       // from /api/rpa/auth/start
 *     capture: {
 *       cookies: Array<chrome.cookies.Cookie | {...}>,
 *       origins?: Array<{ origin, localStorage: [{name,value}] }>
 *     },
 *     account_tier?: 'business' | 'creator' | 'personal' | null,
 *     expires_at?: ISO string
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { verifyRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';
import { saveRpaSession } from '../../../../backend/services/rpaWorker/rpaSessionStore';
import { importSessionCapture } from '../../../../backend/services/rpaWorker/rpaSessionImporter';

type Body = {
  session_token?: string;
  capture?: { cookies?: unknown; origins?: unknown };
  account_tier?: string | null;
  expires_at?: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as Body;
    const token = (body.session_token ?? '').toString();
    const capture = body.capture;

    if (!token) return res.status(400).json({ error: 'session_token required' });
    if (!capture || typeof capture !== 'object') {
      return res.status(400).json({ error: 'capture object required' });
    }
    const cookies = (capture as { cookies?: unknown }).cookies;
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ error: 'capture.cookies must be a non-empty array' });
    }

    const verified = verifyRpaAuthToken(token);
    if (verified.ok !== true) {
      return res.status(401).json({ error: 'INVALID_SESSION_TOKEN', reason: verified.reason });
    }

    const { organization_id, platform } = verified.payload;
    const storageState = importSessionCapture({
      cookies: cookies as any,
      origins: Array.isArray((capture as { origins?: unknown }).origins)
        ? ((capture as { origins?: unknown }).origins as any)
        : [],
    });

    if (!storageState.cookies || storageState.cookies.length === 0) {
      return res.status(400).json({ error: 'capture yielded zero valid cookies' });
    }

    await saveRpaSession(organization_id, platform, storageState, {
      account_tier: body.account_tier != null ? String(body.account_tier) : null,
      last_login_at: new Date().toISOString(),
      expires_at: body.expires_at ?? null,
      last_verified_at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      organization_id,
      platform,
      cookie_count: storageState.cookies.length,
      origin_count: (storageState.origins ?? []).length,
      account_tier: body.account_tier ?? null,
    });
  } catch (err) {
    console.error('[rpa/auth/complete]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to complete RPA auth' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

